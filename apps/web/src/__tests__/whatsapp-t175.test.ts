/**
 * T-175: connect WhatsApp in one click (Meta Embedded Signup).
 * The rules that are pure: encryption, the webhook's signature and routing
 * rules, what the page is told, the browser side of the sign-up, the 60-day
 * renewal. The whole flow against a stand-in for Meta is verify-t175.mts.
 */
import crypto from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const renewStoredToken = vi.fn(async (_admin: unknown, _tenantId: string) => false)
const sendEmail = vi.fn(async (_message: Record<string, unknown>) => ({ success: true }))
vi.mock('@/lib/whatsapp-connect', () => ({ renewStoredToken: (admin: unknown, tenantId: string) => renewStoredToken(admin, tenantId) }))
vi.mock('@/lib/postmark', () => ({ sendEmail: (message: Record<string, unknown>) => sendEmail(message), isPostmarkConfigured: () => true }))
vi.mock('@/lib/business-email', () => ({ resolveBusinessEmail: async () => 'owner@kentgaragedoors.example' }))

import { WhatsAppKeyMissingError, decryptSecret, encryptSecret, whatsappKeyConfigured } from '@/lib/whatsapp-crypto'
import { verifyWebhookSignature } from '@/lib/whatsapp'
import { ACCOUNT_GONE_EVENTS, parseAccountUpdates, signedForConnection } from '@/lib/whatsapp-webhook'
import { CONNECTION_VIEW_COLUMNS, TOKEN_RENEW_DAYS, TOKEN_WARN_DAYS, connectionView, daysUntil, paymentSettingsUrl, tokenState, type WhatsAppConfigRow } from '@/lib/whatsapp-state'
import { EMBEDDED_SIGNUP_VERSION, fromMeta, readSignupMessage, signupLoginOptions } from '@/lib/whatsapp-signup'
import { GRAPH_API_VERSION, graphApiUrl } from '@/lib/whatsapp-graph'
import { checkWhatsAppTokens } from '@/lib/whatsapp-renewal'
import { generateWhatsAppRenewalEmailHtml } from '@/lib/email-templates'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const KEY = 'unit-test-key-t175'
const saved = { ...process.env }
beforeEach(() => {
  process.env.WHATSAPP_ENCRYPTION_KEY = KEY
})
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllEnvs()
  renewStoredToken.mockReset().mockResolvedValue(false)
  sendEmail.mockReset().mockResolvedValue({ success: true })
})

describe('T-175: a stored token is encrypted, with the configured key only', () => {
  it('round-trips, and never stores the value in the clear', () => {
    const stored = encryptSecret('EAAexample-token')
    expect(stored.startsWith('v2:')).toBe(true)
    expect(stored).not.toContain('EAAexample-token')
    expect(decryptSecret(stored)).toBe('EAAexample-token')
    // a fresh IV each time
    expect(encryptSecret('EAAexample-token')).not.toBe(stored)
  })

  it('a stored value that was altered does not decrypt', () => {
    const stored = encryptSecret('EAAexample-token')
    const parts = stored.split(':')
    const flipped = [...parts.slice(0, 3), parts[3]!.replace(/.$/, (c) => (c === '0' ? '1' : '0'))].join(':')
    expect(() => decryptSecret(flipped)).toThrow()
    expect(() => decryptSecret('nonsense')).toThrow()
  })

  it('a value written before T-175 (AES-256-CBC) is still read', () => {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(KEY, 'salt', 32), iv)
    const legacy = `${iv.toString('hex')}:${cipher.update('EAAold-token', 'utf8', 'hex')}${cipher.final('hex')}`
    expect(decryptSecret(legacy)).toBe('EAAold-token')
  })

  it('with no key set nothing is encrypted or decrypted: there is no built-in key', () => {
    const stored = encryptSecret('EAAexample-token')
    delete process.env.WHATSAPP_ENCRYPTION_KEY
    expect(whatsappKeyConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(WhatsAppKeyMissingError)
    expect(() => decryptSecret(stored)).toThrow(WhatsAppKeyMissingError)
    expect(read('apps/web/src/lib/whatsapp.ts')).not.toMatch(/default-key|WHATSAPP_ENCRYPTION_KEY \|\|/)
    expect(code('apps/web/src/lib/whatsapp-crypto.ts')).not.toMatch(/WHATSAPP_ENCRYPTION_KEY \|\|/)
  })

  it('a different key does not open it', () => {
    const stored = encryptSecret('EAAexample-token')
    process.env.WHATSAPP_ENCRYPTION_KEY = 'another-key'
    expect(() => decryptSecret(stored)).toThrow()
  })
})

describe('T-175: the webhook’s signature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
  const sign = (secret: string, raw = body) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`

  it('is the HMAC-SHA256 of the raw body with the app secret, as Meta sends it', () => {
    expect(verifyWebhookSignature(body, sign('app-secret'), 'app-secret')).toBe(true)
    expect(verifyWebhookSignature(body, sign('other-secret'), 'app-secret')).toBe(false)
    expect(verifyWebhookSignature(`${body} `, sign('app-secret'), 'app-secret')).toBe(false)
    expect(verifyWebhookSignature(body, sign('app-secret').slice(7), 'app-secret')).toBe(false)
    expect(verifyWebhookSignature(body, '', 'app-secret')).toBe(false)
    expect(verifyWebhookSignature(body, sign(''), '')).toBe(false)
    expect(code('apps/web/src/lib/whatsapp.ts')).toContain('crypto.timingSafeEqual')
  })

  it('a call counts for a connection only when signed by the app that connection is made through', () => {
    const platform = 'platform-secret'
    const embedded = { connection_method: 'embedded' as const, ownAppSecret: null }
    const manual = { connection_method: 'manual' as const, ownAppSecret: 'business-own-secret' }
    expect(signedForConnection(body, sign(platform), embedded, platform)).toBe(true)
    expect(signedForConnection(body, sign('business-own-secret'), manual, platform)).toBe(true)
    // the platform's signature does not drive a manual connection, nor a business's own secret an embedded one
    expect(signedForConnection(body, sign(platform), manual, platform)).toBe(false)
    expect(signedForConnection(body, sign('business-own-secret'), embedded, platform)).toBe(false)
    // nothing to check against: never passes
    expect(signedForConnection(body, sign(''), { connection_method: 'manual', ownAppSecret: null }, platform)).toBe(false)
    expect(signedForConnection(body, sign(platform), embedded, undefined)).toBe(false)
    expect(signedForConnection(body, null, embedded, platform)).toBe(false)
  })

  it('the route has no path that skips the check, and logs nothing about the customer', () => {
    const route = code('apps/web/src/app/api/whatsapp/webhook/route.ts')
    expect(route).toContain("if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 401 })")
    expect(route).toContain("if (!acted) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })")
    expect(route).not.toMatch(/if \(APP_SECRET\)|if \(platformSecret\) \{/)
    for (const log of route.match(/console\.\w+\([^)]*\)/g) ?? []) {
      expect(log, log).not.toMatch(/message\.(from|text|caption)|customer_phone|accessToken|signature/)
    }
    // one business's receipts and repeats are looked up inside that business only
    expect(route).toContain(".eq('tenant_id', tenantId).eq('wa_message_id', status.messageId)")
  })
})

describe('T-175: account events and the quiet rule', () => {
  it('reads the account from waba_info, and knows which events mean the app was removed', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'partner-business-id', changes: [{ field: 'account_update', value: { event: 'PARTNER_REMOVED', waba_info: { waba_id: '102289599326934', owner_business_id: '1' } } }, { field: 'messages', value: {} }] }],
    }
    expect(parseAccountUpdates(payload)).toEqual([{ event: 'PARTNER_REMOVED', wabaId: '102289599326934' }])
    expect(parseAccountUpdates({ object: 'page', entry: payload.entry })).toEqual([])
    expect(parseAccountUpdates(null)).toEqual([])
    expect([...ACCOUNT_GONE_EVENTS].sort()).toEqual(['ACCOUNT_DELETED', 'ACCOUNT_OFFBOARDED', 'PARTNER_APP_UNINSTALLED', 'PARTNER_REMOVED'])
    expect(ACCOUNT_GONE_EVENTS).not.toContain('PARTNER_ADDED')
  })

  it('T-177: which messages are answered is no longer decided by the kind of number (the assistant decides, for every number)', () => {
    expect(code('apps/web/src/lib/whatsapp-webhook.ts')).not.toContain('shouldAnswer')
    expect(code('apps/web/src/app/api/whatsapp/webhook/route.ts')).toContain('handleCustomerMessage(')
  })
})

describe('T-175: what the page is told', () => {
  const now = new Date('2026-11-16T12:00:00Z')
  const row = (over: Partial<WhatsAppConfigRow> = {}): WhatsAppConfigRow => ({
    phone_number_id: '106540352242922',
    display_phone_number: '+1 555-0100',
    is_active: true,
    connection_method: 'embedded',
    waba_id: '102289599326934',
    business_id: '506914307656634',
    verified_name: 'Kent Garage Doors',
    number_kind: 'new_number',
    token_expires_at: '2027-01-15T12:00:00Z',
    registered_at: '2026-11-16T12:00:00Z',
    messages_ready_at: null,
    connected_at: '2026-11-16T12:00:00Z',
    created_at: '2026-11-16T12:00:00Z',
    updated_at: '2026-11-16T12:00:00Z',
    ...over,
  })

  it('the 60 days: fine, then a warning from 14 days out, then run out', () => {
    expect(TOKEN_WARN_DAYS).toBe(14)
    expect(TOKEN_RENEW_DAYS).toBeGreaterThan(TOKEN_WARN_DAYS)
    expect(daysUntil('2027-01-15T12:00:00Z', now)).toBe(60)
    expect(tokenState('2027-01-15T12:00:00Z', now)).toBe('ok')
    expect(tokenState('2026-11-30T12:00:00Z', now)).toBe('ok') // exactly 14 days
    expect(tokenState('2026-11-30T11:59:00Z', now)).toBe('expiring')
    expect(daysUntil('2026-11-16T20:00:00Z', now)).toBe(0)
    expect(tokenState('2026-11-16T20:00:00Z', now)).toBe('expiring')
    expect(tokenState('2026-11-16T11:59:00Z', now)).toBe('expired')
    // a manual connection's permanent token has no date
    expect(tokenState(null, now)).toBe('no_expiry')
    expect(daysUntil(null, now)).toBeNull()
  })

  it('the view is built field by field and can carry no secret', () => {
    const view = connectionView({ ...row(), access_token_encrypted: 'v2:secret', app_secret_encrypted: 'v2:secret', registration_pin_encrypted: 'v2:secret' } as WhatsAppConfigRow, now)
    expect(JSON.stringify(view)).not.toMatch(/secret|encrypted/)
    expect(view).toMatchObject({ method: 'embedded', displayPhoneNumber: '+1 555-0100', registered: true, messagesReady: false, alsoOnBusinessApp: false })
    expect(view.token).toEqual({ state: 'ok', expiresAt: '2027-01-15T12:00:00Z', daysLeft: 60 })
    for (const column of ['access_token_encrypted', 'app_secret_encrypted', 'registration_pin_encrypted']) expect(CONNECTION_VIEW_COLUMNS).not.toContain(column)
  })

  it('the payment step links to WhatsApp Manager for that account, and only for a connection made through Meta', () => {
    expect(paymentSettingsUrl('102289599326934', '506914307656634')).toBe('https://business.facebook.com/wa/manage/home/?waba_id=102289599326934&business_id=506914307656634')
    expect(connectionView(row(), now).paymentUrl).toContain('waba_id=102289599326934')
    expect(connectionView(row({ connection_method: 'manual', waba_id: null }), now).paymentUrl).toBeNull()
    expect(connectionView(row({ messages_ready_at: '2026-11-16T13:00:00Z' }), now).messagesReady).toBe(true)
    expect(connectionView(row({ registered_at: null }), now).registered).toBe(false)
    expect(connectionView(row({ number_kind: 'business_app' }), now).alsoOnBusinessApp).toBe(true)
  })
})

describe('T-175: the browser side of Embedded Signup', () => {
  it('opens Meta with our configuration, on the current version, with the Business app option', () => {
    // T-177: v5 (Meta's current version), where the Business app option is on by default
    expect(EMBEDDED_SIGNUP_VERSION).toBe('v5')
    expect(signupLoginOptions('1566858898811795')).toEqual({
      config_id: '1566858898811795',
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, version: 'v5' },
    })
    // v4 asked for the Business app option by name
    expect(signupLoginOptions('1', 'v4').extras).toEqual({ setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' })
    // neither id is written into the code
    const client = read('apps/web/src/components/whatsapp/ConnectWhatsApp.tsx') + read('apps/web/src/lib/whatsapp-signup.ts') + read('apps/web/src/lib/whatsapp-graph.ts')
    expect(client).not.toMatch(/4654271271562035|1566858898811795/)
  })

  it('reads Meta’s message in both shapes (v4 and v5), and nothing else', () => {
    const v4 = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '106540352242922', waba_id: '102289599326934', business_id: '506914307656634' } }
    expect(readSignupMessage(JSON.stringify(v4))).toEqual({ kind: 'finished', wabaId: '102289599326934', phoneNumberId: '106540352242922', businessId: '506914307656634', onBusinessApp: false })
    const v5 = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { phone_number_id: '106540352242922', is_on_biz_app: true, messaging_account_ids: ['102289599326934'], business_id: '506914307656634' } }
    expect(readSignupMessage(v5)).toEqual({ kind: 'finished', wabaId: '102289599326934', phoneNumberId: '106540352242922', businessId: '506914307656634', onBusinessApp: true })
    // a Business app number on v4: the account alone
    expect(readSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '102289599326934' } })).toMatchObject({ wabaId: '102289599326934', phoneNumberId: null, onBusinessApp: true })
    expect(readSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } })).toEqual({ kind: 'cancelled', step: 'PHONE_NUMBER_SETUP' })
    expect(readSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'Something went wrong' } })).toEqual({ kind: 'error', message: 'Something went wrong' })
    // ids that are not Meta ids are dropped; other messages are not ours
    expect(readSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '../oauth', phone_number_id: 'x' } })).toMatchObject({ wabaId: null, phoneNumberId: null })
    expect(readSignupMessage({ type: 'something-else', event: 'FINISH' })).toBeNull()
    expect(readSignupMessage('not json')).toBeNull()
    expect(readSignupMessage(null)).toBeNull()
  })

  it('only a message from Meta’s own address is listened to', () => {
    expect(fromMeta('https://www.facebook.com')).toBe(true)
    expect(fromMeta('https://web.facebook.com')).toBe(true)
    expect(fromMeta('https://facebook.com')).toBe(true)
    // Meta's sample checks endsWith('facebook.com'), which these would pass
    expect(fromMeta('https://evilfacebook.com')).toBe(false)
    expect(fromMeta('https://facebook.com.evil.example')).toBe(false)
    expect(fromMeta('null')).toBe(false)
  })
})

describe('T-175: calls to Meta', () => {
  it('use one Graph API version, the current one, and go to Meta in production whatever is set', () => {
    expect(GRAPH_API_VERSION).toBe('v27.0')
    delete process.env.WHATSAPP_GRAPH_BASE_URL
    expect(graphApiUrl()).toBe('https://graph.facebook.com/v27.0')
    vi.stubEnv('WHATSAPP_GRAPH_BASE_URL', 'http://127.0.0.1:8799/')
    expect(graphApiUrl()).toBe('http://127.0.0.1:8799/v27.0')
    vi.stubEnv('NODE_ENV', 'production')
    expect(graphApiUrl()).toBe('https://graph.facebook.com/v27.0')
    // no other version is typed anywhere in the WhatsApp code
    for (const file of ['lib/whatsapp.ts', 'lib/whatsapp-connect.ts', 'app/api/whatsapp/verify/route.ts', 'app/api/whatsapp/send/route.ts', 'app/api/whatsapp/webhook/route.ts']) {
      expect(code(`apps/web/src/${file}`), file).not.toMatch(/graph\.facebook\.com|\/v\d\d\.\d/)
    }
  })

  it('happen on the server only, and no token, code or PIN is logged', () => {
    for (const file of ['components/whatsapp/ConnectWhatsApp.tsx', 'components/whatsapp/ConnectedCard.tsx', 'components/whatsapp/ManualConnect.tsx', 'app/(dashboard)/app/whatsapp/page.tsx']) {
      const source = code(`apps/web/src/${file}`)
      expect(source, file).not.toMatch(/graph\.facebook\.com|WHATSAPP_APP_SECRET|client_secret|whatsapp-graph|whatsapp-connect'|whatsapp-crypto/)
    }
    // A log line may only put in what describe() gives (Meta's status and code, or our own words) and which sync it was
    let logLines = 0
    for (const file of ['lib/whatsapp-connect.ts', 'lib/whatsapp-graph.ts', 'lib/whatsapp-renewal.ts', 'lib/whatsapp-crypto.ts']) {
      const source = code(`apps/web/src/${file}`)
      for (const line of source.split('\n').filter((l) => /console\.\w+\(/.test(l))) {
        logLines++
        const put = [...line.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1])
        for (const expression of put) expect(['describe(error)', 'syncType'], `${file}: ${line.trim()}`).toContain(expression)
        // and nothing is passed after the message
        expect(line.trim(), file).toMatch(/console\.\w+\((`[^`]*`|'[^']*')\)$/)
      }
    }
    expect(logLines).toBeGreaterThan(5)
    // describe() itself: Meta's status and code, or the message of an error this code raised
    expect(code('apps/web/src/lib/whatsapp-connect.ts')).toContain("if (error instanceof GraphError) return `Meta HTTP ${error.status}, code ${error.code ?? 'none'}`")
    // the number is never deregistered by us
    expect(code('apps/web/src/lib/whatsapp-graph.ts')).not.toContain('/deregister')
  })

  it('the stored row is server-only (migration 42)', () => {
    const migration = read('supabase/migrations/00000000000042_whatsapp_embedded_signup.sql')
    expect(migration).toContain('DROP POLICY IF EXISTS "Users manage own tenant whatsapp config" ON whatsapp_configs;')
    expect(migration).toContain('REVOKE ALL ON whatsapp_configs FROM authenticated;')
    expect(migration).toContain('REVOKE ALL ON whatsapp_configs FROM anon;')
    // every route reads it with the service role, for the signed-in tenant
    for (const route of ['config', 'connect', 'status', 'register', 'verify', 'send']) {
      const source = code(`apps/web/src/app/api/whatsapp/${route}/route.ts`)
      expect(source, route).toContain('currentTenant()')
      expect(source, route).not.toMatch(/auth\.supabase\s*\.from\('whatsapp_configs'\)/)
    }
  })
})

describe('T-175: the daily look at connections close to running out', () => {
  const now = new Date('2026-11-16T08:00:00Z')
  const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000 + 3_600_000).toISOString()
  function fakeAdmin(rows: Array<Record<string, unknown>>) {
    const updates: Array<{ tenantId: string; values: Record<string, unknown> }> = []
    const admin = {
      from(table: string) {
        if (table === 'tenants') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Kent Garage Doors' } }) }) }) }
        return {
          select: () => ({ eq: () => ({ not: () => ({ lte: (_c: string, horizon: string) => ({ limit: async () => ({ data: rows.filter((r) => String(r.token_expires_at) <= horizon) }) }) }) }) }),
          update: (values: Record<string, unknown>) => ({ eq: async (_c: string, tenantId: string) => void updates.push({ tenantId, values }) }),
        }
      },
    }
    return { admin: admin as never, updates }
  }
  const row = (tenant: string, daysLeft: number, warnedDaysAgo: number | null = null) => ({
    tenant_id: tenant,
    display_phone_number: '+1 555-0100',
    token_expires_at: inDays(daysLeft),
    expiry_warned_at: warnedDaysAgo === null ? null : new Date(now.getTime() - warnedDaysAgo * 86_400_000).toISOString(),
  })

  it('tries Meta first; a renewed connection gets no email', async () => {
    renewStoredToken.mockResolvedValue(true)
    const { admin, updates } = fakeAdmin([row('tnt_a', 5)])
    expect(await checkWhatsAppTokens(admin, now)).toEqual({ checked: 1, renewed: 1, warned: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('when Meta will not renew: an email to the business under 14 days, none before, and not again within 6 days', async () => {
    const { admin, updates } = fakeAdmin([row('tnt_soon', 5), row('tnt_far', 20), row('tnt_told', 5, 2), row('tnt_told_long_ago', 5, 7), row('tnt_fine', 45)])
    const summary = await checkWhatsAppTokens(admin, now)
    expect(summary).toEqual({ checked: 4, renewed: 0, warned: 2 }) // 45 days out is not looked at
    expect(renewStoredToken).toHaveBeenCalledTimes(4)
    expect(updates.map((u) => u.tenantId).sort()).toEqual(['tnt_soon', 'tnt_told_long_ago'])
    expect(updates[0]!.values).toEqual({ expiry_warned_at: now.toISOString() })
    const email = sendEmail.mock.calls[0]![0]
    expect(email.from).toEqual({ kind: 'business' })
    expect(email.to).toBe('owner@kentgaragedoors.example')
    expect(String(email.htmlBody)).toContain('/app/whatsapp')
    expect(String(email.htmlBody)).toContain('runs out in 5 days')
  })

  it('a connection that has run out is not exchanged (Meta refuses an expired one) but the business is told', async () => {
    const { admin } = fakeAdmin([row('tnt_gone', -1)])
    expect(await checkWhatsAppTokens(admin, now)).toEqual({ checked: 1, renewed: 0, warned: 1 })
    expect(renewStoredToken).not.toHaveBeenCalled()
    expect(sendEmail.mock.calls[0]![0].subject).toBe('Your WhatsApp connection has run out')
  })

  it('the email says when, and links to the one-click reconnect', () => {
    const html = generateWhatsAppRenewalEmailHtml({ businessName: 'Kent <Garage> Doors', displayPhoneNumber: '+1 555-0100', daysLeft: 0, expiresOn: '16 November 2026', whatsappUrl: 'https://qolumns.com/app/whatsapp' })
    expect(html).toContain('runs out today')
    expect(html).toContain('Kent &lt;Garage&gt; Doors')
    expect(html).toContain('href="https://qolumns.com/app/whatsapp"')
    expect(html).toContain('Reconnect WhatsApp')
  })
})
