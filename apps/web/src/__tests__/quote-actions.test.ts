/**
 * T-157: quote actions that always work.
 *
 * 1. the business email rule (setting filled, setting empty, demo tenant);
 * 2. the action rules, shared by each button and the route it calls;
 * 3. the token filter that keeps every earlier link valid;
 * 4. "Mark as answered" is saved, tenant-scoped, and never blocks the customer;
 * 5. revised stays revised;
 * 6. money is rounded and stale label maths is dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The answered route authenticates through this; each test sets who is signed in
const session: { supabase: unknown; tenantId: string } = { supabase: null, tenantId: '' }
vi.mock('@/lib/auth-tenant', () => ({
  requireTenant: async () => ({ ok: true, supabase: session.supabase, tenantId: session.tenantId, userId: 'usr_1' }),
}))

import {
  chooseBusinessEmail,
  roundMoney,
  splitLabelMath,
  dropStaleLabelMath,
  quoteActions,
  canEditQuote,
  canSendQuoteAgain,
  canCopyQuoteLink,
  canDownloadQuotePdf,
  canTextQuoteLink,
  canCustomerDecide,
  statusAfterResend,
  statusAfterEditAndSend,
  statusAfterQuestionAnswered,
  QUOTE_SEND_AGAIN_STATUSES,
  QUOTE_LINK_STATUSES,
  QUOTE_TEXT_LINK_STATUSES,
  type QuoteStatus,
} from '@estimator/shared'
import { resolveBusinessEmail } from '@/lib/business-email'
import { quoteTokenFilter, quoteTokenMatches, hashToken } from '@/lib/tokens'
import { approvedWithoutEmailMessage, copyLinkFallbackMessage } from '@/lib/quote-action-copy'
import { POST as markAnswered } from '@/app/api/quotes/[quoteId]/feedback/[feedbackId]/answered/route'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
/** Source without comments, for checks on what the code does */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const ALL_STATUSES: QuoteStatus[] = [
  'queued',
  'generating',
  'pending_review',
  'awaiting_clarification',
  'sent',
  'viewed',
  'feedback_received',
  'revised',
  'accepted',
  'declined',
  'paid',
  'expired',
  'failed',
]

// ---------------------------------------------------------------------------
// A small in-memory stand-in for the database client
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>
class FakeDb {
  tables: Record<string, Row[]> = { tenants: [], user_profiles: [], quotes: [], quote_feedback: [] }
  authUsers: Record<string, string | null> = {}
  reads: string[] = []
  authLookups = 0
  from(table: string) {
    this.reads.push(table)
    return new FakeQuery(this, table)
  }
  auth = {
    admin: {
      getUserById: async (id: string) => {
        this.authLookups++
        const email = this.authUsers[id]
        return { data: { user: email ? { email } : null }, error: null }
      },
    },
  }
}
class FakeQuery {
  private op: 'select' | 'update' = 'select'
  private values: Row = {}
  private countOnly = false
  private returning = false
  private filters: Array<(r: Row) => boolean> = []
  private sortBy: string | null = null
  constructor(private db: FakeDb, private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'update') this.returning = true
    if (opts?.head) this.countOnly = true
    return this
  }
  update(values: Row) {
    this.op = 'update'
    this.values = values
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val)
    return this
  }
  order(col: string) {
    this.sortBy = col
    return this
  }
  limit() {
    return this
  }
  private rows() {
    const hit = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)))
    return this.sortBy ? [...hit].sort((a, b) => String(a[this.sortBy!]).localeCompare(String(b[this.sortBy!]))) : hit
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null })
  }
  single() {
    const row = this.rows()[0]
    return Promise.resolve({ data: row ?? null, error: row ? null : { code: 'PGRST116', message: 'none' } })
  }
  then<T>(resolve: (v: { data: unknown; error: null; count?: number }) => T) {
    if (this.op === 'update') {
      const hit = this.rows()
      for (const r of hit) Object.assign(r, this.values)
      return Promise.resolve(resolve({ data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }))
    }
    if (this.countOnly) return Promise.resolve(resolve({ data: null, error: null, count: this.rows().length }))
    return Promise.resolve(resolve({ data: this.rows(), error: null }))
  }
}

// ---------------------------------------------------------------------------
// 1. The business always gets its emails
// ---------------------------------------------------------------------------
describe('T-157: where emails to the business go', () => {
  function db(tenant: Row) {
    const d = new FakeDb()
    d.tables.tenants!.push({ id: 'tnt_a', ...tenant })
    d.tables.user_profiles!.push(
      { id: 'usr_second', tenant_id: 'tnt_a', created_at: '2026-03-01T00:00:00Z' },
      { id: 'usr_first', tenant_id: 'tnt_a', created_at: '2026-01-01T00:00:00Z' },
      { id: 'usr_other', tenant_id: 'tnt_b', created_at: '2025-01-01T00:00:00Z' }
    )
    d.authUsers = { usr_first: 'founder@example.com', usr_second: 'colleague@example.com', usr_other: 'rival@example.com' }
    return d
  }
  const resolve = (d: FakeDb, tenantId = 'tnt_a') => resolveBusinessEmail(d as never, tenantId)

  it('setting filled: the notification email from Settings, with no account lookup', async () => {
    const d = db({ notification_email: 'office@example.com', is_demo: false })
    expect(await resolve(d)).toBe('office@example.com')
    expect(d.authLookups).toBe(0)
    expect(d.reads).toEqual(['tenants'])
  })

  it('setting empty (the default): the account email of the tenant’s first user', async () => {
    for (const setting of [null, '', '  ']) {
      const d = db({ notification_email: setting, is_demo: false })
      expect(await resolve(d)).toBe('founder@example.com')
    }
  })

  it('demo tenant: no one, even with a setting', async () => {
    const withSetting = db({ notification_email: 'office@example.com', is_demo: true })
    expect(await resolve(withSetting)).toBeNull()
    const without = db({ notification_email: null, is_demo: true })
    expect(await resolve(without)).toBeNull()
    expect(withSetting.authLookups + without.authLookups).toBe(0)
  })

  it('never reads another tenant’s user, and an unknown tenant gets nothing', async () => {
    const d = db({ notification_email: null, is_demo: false })
    expect(await resolve(d, 'tnt_missing')).toBeNull()
    d.tables.tenants!.push({ id: 'tnt_empty', notification_email: null, is_demo: false })
    expect(await resolve(d, 'tnt_empty')).toBeNull()
    expect(d.authLookups).toBe(0)
  })

  it('the pure rule', () => {
    expect(chooseBusinessEmail({ notificationEmail: 'office@example.com', ownerEmail: 'founder@example.com' })).toBe('office@example.com')
    expect(chooseBusinessEmail({ notificationEmail: null, ownerEmail: 'founder@example.com' })).toBe('founder@example.com')
    expect(chooseBusinessEmail({ isDemo: true, notificationEmail: 'office@example.com', ownerEmail: 'founder@example.com' })).toBeNull()
    expect(chooseBusinessEmail({ notificationEmail: null, ownerEmail: null })).toBeNull()
  })

  it('every sender uses the one rule; the copies are gone', () => {
    const publicRoute = (name: string) => code(`apps/web/src/app/api/public/quotes/[quoteId]/${name}/route.ts`)
    for (const name of ['accept', 'decline', 'feedback']) {
      expect(publicRoute(name), name).toContain('resolveBusinessEmail(supabase,')
      // the old gate: nothing was sent unless the Settings address was filled in
      expect(publicRoute(name), name).not.toMatch(/notification_email/)
    }
    for (const file of ['apps/web/src/lib/plan-limits.ts', 'apps/web/src/lib/lead-hold.ts']) {
      const src = code(file)
      expect(src, file).toContain('businessEmailFor(')
      expect(src, file).not.toMatch(/getUserById|notification_email/)
    }
    // reply-to on every email the web app sends a customer
    for (const file of [
      'apps/web/src/lib/quote-approval.ts',
      'apps/web/src/app/api/quotes/[quoteId]/route.ts',
      'apps/web/src/app/api/quotes/[quoteId]/resend/route.ts',
      'apps/web/src/app/api/cron/lifecycle/route.ts',
    ]) {
      expect(code(file), file).toMatch(/replyTo/)
    }
  })

  it('no email address is logged by the code this ticket touches', () => {
    for (const file of [
      'apps/web/src/lib/business-email.ts',
      'apps/web/src/lib/plan-limits.ts',
      'apps/web/src/lib/lead-hold.ts',
      'apps/web/src/app/api/quotes/[quoteId]/resend/route.ts',
      'apps/worker/src/business-email.ts',
      'apps/worker/src/email/index.ts',
    ]) {
      const logLines = code(file)
        .split('\n')
        .filter((l) => /console\.(log|warn|error)/.test(l))
      for (const line of logLines) expect(line, `${file}: ${line.trim()}`).not.toMatch(/\.email\b|Email\}|sentTo|\bto\b\s*[,)}]/)
    }
    const workerEmail = read('apps/worker/src/email/index.ts')
    expect(workerEmail).not.toMatch(/console\.log\([^)]*\$\{data\.(customer\.email|business\.ownerEmail|customerEmail|ownerEmail)\}/)
  })
})

// ---------------------------------------------------------------------------
// 2. A button only shows when it will work
// ---------------------------------------------------------------------------
describe('T-157: action rules', () => {
  const on = (rule: (s: QuoteStatus) => boolean) => ALL_STATUSES.filter(rule)

  it('Send again: sent, viewed, revised, expired, and only with an email address', () => {
    expect(on((s) => canSendQuoteAgain(s, { hasEmail: true }))).toEqual(['sent', 'viewed', 'revised', 'expired'])
    expect(on((s) => canSendQuoteAgain(s, { hasEmail: false }))).toEqual([])
    // the statuses it used to show on and always fail with
    for (const s of ['accepted', 'feedback_received', 'pending_review', 'paid', 'declined', 'awaiting_clarification'] as QuoteStatus[]) {
      expect(canSendQuoteAgain(s, { hasEmail: true }), s).toBe(false)
    }
  })

  it('Copy link and Download PDF: sent, viewed, feedback_received, revised, accepted, paid, expired', () => {
    const expected = ['sent', 'viewed', 'feedback_received', 'revised', 'accepted', 'paid', 'expired']
    expect(on(canCopyQuoteLink)).toEqual(expected)
    expect(on(canDownloadQuotePdf)).toEqual(expected)
  })

  it('Text link: the SMS route’s list, and only with an active SMS number', () => {
    expect(on((s) => canTextQuoteLink(s, { smsActive: true }))).toEqual(['sent', 'viewed', 'feedback_received', 'revised', 'expired'])
    expect(on((s) => canTextQuoteLink(s, { smsActive: false }))).toEqual([])
  })

  it('Edit: unchanged', () => {
    expect(ALL_STATUSES.filter((s) => !canEditQuote(s))).toEqual(['queued', 'generating', 'accepted', 'paid', 'failed'])
    expect(canEditQuote(null)).toBe(false)
  })

  it('quoteActions gives the page every answer at once', () => {
    expect(quoteActions('sent', { hasEmail: true, smsActive: false })).toEqual({ edit: true, sendAgain: true, copyLink: true, downloadPdf: true, textLink: false })
    expect(quoteActions('accepted', { hasEmail: true, smsActive: true })).toEqual({ edit: false, sendAgain: false, copyLink: true, downloadPdf: true, textLink: false })
    // a customer who gave a phone number only: the link is the way to reach them
    expect(quoteActions('viewed', { hasEmail: false, smsActive: false })).toMatchObject({ sendAgain: false, copyLink: true, textLink: false })
    expect(quoteActions('pending_review', { hasEmail: true, smsActive: true })).toEqual({ edit: true, sendAgain: false, copyLink: false, downloadPdf: false, textLink: false })
  })

  it('each route applies the rule its button reads', () => {
    const route = (path: string) => code(`apps/web/src/app/api/${path}/route.ts`)
    expect(route('quotes/[quoteId]/resend')).toContain('QUOTE_SEND_AGAIN_STATUSES')
    expect(route('quotes/[quoteId]/link')).toContain('canCopyQuoteLink(quote.status)')
    expect(route('quotes/[quoteId]/pdf').match(/canDownloadQuotePdf\(quote\.status\)/g)).toHaveLength(2) // POST and GET
    expect(route('sms/send-quote')).toContain('QUOTE_TEXT_LINK_STATUSES')
    expect(route('quotes/[quoteId]')).toContain('canEditQuote(quote.status)')
    // no private copies of the lists left behind
    for (const path of ['quotes/[quoteId]/resend', 'quotes/[quoteId]/link', 'sms/send-quote', 'quotes/[quoteId]']) {
      expect(route(path), path).not.toMatch(/\['sent', 'viewed'/)
    }
    expect([...QUOTE_SEND_AGAIN_STATUSES]).toEqual(['sent', 'viewed', 'revised', 'expired'])
    expect([...QUOTE_TEXT_LINK_STATUSES]).toEqual(['sent', 'viewed', 'feedback_received', 'revised', 'expired'])
    expect(QUOTE_LINK_STATUSES).toHaveLength(7)
  })

  it('the quote page and the list show buttons by the rules, with no alert()', () => {
    const page = code('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain('quoteActions(quote.status')
    expect(page).toContain('actions.sendAgain')
    expect(page).toContain('actions.copyLink')
    expect(page).toContain('actions.textLink')
    expect(page).toContain("'Send again'")
    expect(page).toContain("'Copy link'")
    expect(page).not.toMatch(/\balert\(/)
    expect(page).not.toMatch(/>\s*\{resending \? 'Sending\.\.\.' : 'Send'\}/)
    expect(page).toContain('smsActive: data.smsActive === true')

    const list = code('apps/web/src/app/(dashboard)/app/quotes/page.tsx')
    for (const rule of ['canCopyQuoteLink(quote.status)', 'canDownloadQuotePdf(quote.status)', 'canSendQuoteAgain(quote.status']) {
      expect(list).toContain(rule)
    }
    expect(list).not.toMatch(/\['sent', 'viewed', 'expired'\]/)
    expect(list).not.toMatch(/\balert\(/)
  })

  it('the quote page asks once whether SMS is connected (in the quote’s own load)', () => {
    const route = code('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    expect(route).toMatch(/from\('sms_configs'\)\s*\.select\('is_active'\)\s*\.eq\('tenant_id', auth\.tenantId\)/)
    expect(route).toContain('smsActive:')
  })

  it('"Approved. No email went out" never mentions Text link when it is hidden', () => {
    expect(approvedWithoutEmailMessage({ smsActive: false })).not.toMatch(/text link/i)
    expect(approvedWithoutEmailMessage({ smsActive: false })).toMatch(/^Approved\. No email went out .*Copy link/)
    expect(approvedWithoutEmailMessage({ smsActive: true })).toMatch(/Text link or Copy link/)
    expect(copyLinkFallbackMessage('https://example.test/q/qte_1?token=abc')).toContain('https://example.test/q/qte_1?token=abc')
  })

  it('re-sending keeps a revised quote revised (and an open question open)', () => {
    expect(statusAfterResend('revised')).toBe('revised')
    expect(statusAfterResend('feedback_received')).toBe('feedback_received')
    expect(statusAfterResend('sent')).toBe('sent')
    expect(statusAfterResend('viewed')).toBe('sent')
    expect(statusAfterResend('expired')).toBe('sent')
    expect(code('apps/web/src/app/api/quotes/[quoteId]/resend/route.ts')).toContain('statusAfterResend(quote.status')
  })

  it('Send again checks everything before it writes anything', () => {
    const resend = code('apps/web/src/app/api/quotes/[quoteId]/resend/route.ts')
    const write = resend.indexOf('.update({')
    expect(write).toBeGreaterThan(0)
    for (const check of ["'INVALID_STATUS'", "'NO_EMAIL'", "'EMAIL_NOT_CONFIGURED'"]) {
      expect(resend.indexOf(check), check).toBeGreaterThan(0)
      expect(resend.indexOf(check), check).toBeLessThan(write)
    }
    expect(resend).toMatch(/\.eq\('tenant_id', profile\.tenant_id\)\s*\.eq\('status', quote\.status\)/)
  })
})

// ---------------------------------------------------------------------------
// 3. A link the customer already has keeps working
// ---------------------------------------------------------------------------
describe('T-157: quoteTokenFilter', () => {
  const h = hashToken('first-link')

  it('matches the current link, the pre-approval link and every earlier link', () => {
    expect(quoteTokenFilter(h)).toBe(`quote_token_hash.eq.${h},previous_token_hash.eq.${h},link_token_hashes.cs.{${h}}`)
  })

  it('anything that is not a sha256 hex digest matches nothing and injects nothing', () => {
    const zero = '0'.repeat(64)
    for (const bad of ['x,status.eq.sent', `${h}},id.neq.{`, '', h.toUpperCase(), `${h}0`, 'a'.repeat(63)]) {
      const filter = quoteTokenFilter(bad)
      expect(filter).toBe(`quote_token_hash.eq.${zero},previous_token_hash.eq.${zero},link_token_hashes.cs.{${zero}}`)
    }
  })

  it('quoteTokenMatches is the same rule for a row already loaded', () => {
    const other = hashToken('someone-else')
    expect(quoteTokenMatches({ quote_token_hash: h }, h)).toBe(true)
    expect(quoteTokenMatches({ quote_token_hash: other, previous_token_hash: h }, h)).toBe(true)
    expect(quoteTokenMatches({ quote_token_hash: other, link_token_hashes: [hashToken('x'), h] }, h)).toBe(true)
    expect(quoteTokenMatches({ quote_token_hash: other, previous_token_hash: null, link_token_hashes: [] }, h)).toBe(false)
    expect(quoteTokenMatches({ quote_token_hash: null, link_token_hashes: null }, h)).toBe(false)
    expect(quoteTokenMatches({ quote_token_hash: 'not-a-hash' }, 'not-a-hash')).toBe(false)
  })

  it('every public token route goes through the rule', () => {
    for (const path of ['', '/accept', '/decline', '/feedback', '/pdf']) {
      expect(code(`apps/web/src/app/api/public/quotes/[quoteId]${path}/route.ts`), path).toContain('.or(quoteTokenFilter(tokenHash))')
    }
    expect(code('apps/web/src/app/api/public/assets/[assetId]/route.ts')).toContain('.or(quoteTokenFilter(tokenHash))')
    expect(code('apps/web/src/app/api/public/quotes/[quoteId]/clarify/route.ts')).toContain('quoteTokenMatches(quote, tokenHash)')
  })

  it('migration 38 keeps the replaced hash in a trigger: no duplicates, the newest 10', () => {
    const sql = read('supabase/migrations/00000000000038_quote_link_tokens.sql')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS link_token_hashes TEXT\[\] NOT NULL DEFAULT '\{\}'/)
    expect(sql).toMatch(/BEFORE UPDATE ON quotes/)
    expect(sql).toMatch(/NEW\.quote_token_hash IS DISTINCT FROM OLD\.quote_token_hash/)
    expect(sql).toContain('array_prepend(')
    expect(sql).toContain('array_remove(')
    expect(sql).toContain('kept[1:10]')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/)
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS quotes_keep_link_tokens/)
    // expiry is unchanged: the migration never writes it
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/token_expires_at\s*:?=/)
  })
})

// ---------------------------------------------------------------------------
// 4. A customer question can be closed and never blocks the customer
// ---------------------------------------------------------------------------
describe('T-157: mark as answered', () => {
  // the ids the database gives feedback rows ("fb_" + hex), plus an older uuid
  const FB1 = 'fb_4e4e4e4c2876ac369d4aaa59'
  const FB2 = '22222222-2222-4222-8222-222222222222'
  const FB_RIVAL = 'fb_c81c4275042ecd438eb5af4d'
  let db: FakeDb

  beforeEach(() => {
    db = new FakeDb()
    db.tables.quotes!.push(
      { id: 'qte_a', tenant_id: 'tnt_a', status: 'feedback_received' },
      { id: 'qte_a2', tenant_id: 'tnt_a', status: 'viewed' },
      { id: 'qte_b', tenant_id: 'tnt_b', status: 'feedback_received' }
    )
    db.tables.quote_feedback!.push(
      { id: FB1, quote_id: 'qte_a', tenant_id: 'tnt_a', feedback_type: 'feedback', status: 'pending' },
      { id: FB_RIVAL, quote_id: 'qte_b', tenant_id: 'tnt_b', feedback_type: 'feedback', status: 'pending' }
    )
    session.supabase = db
    session.tenantId = 'tnt_a'
  })

  const press = async (quoteId: string, feedbackId: string) => {
    const res = await markAnswered(new Request('https://example.test', { method: 'POST' }), { params: { quoteId, feedbackId } })
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }
  const feedback = (id: string) => db.tables.quote_feedback!.find((f) => f.id === id)!
  const quote = (id: string) => db.tables.quotes!.find((q) => q.id === id)!

  it('saves it, and the quote goes back to viewed when nothing is pending', async () => {
    const res = await press('qte_a', FB1)
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ feedbackId: FB1, feedbackStatus: 'acknowledged', quoteStatus: 'viewed', pendingLeft: 0 })
    expect(feedback(FB1).status).toBe('acknowledged')
    expect(quote('qte_a').status).toBe('viewed')
  })

  it('with another question still pending the quote stays feedback_received', async () => {
    db.tables.quote_feedback!.push({ id: FB2, quote_id: 'qte_a', tenant_id: 'tnt_a', feedback_type: 'approval_request', status: 'pending' })
    const first = await press('qte_a', FB1)
    expect(first.json).toMatchObject({ quoteStatus: 'feedback_received', pendingLeft: 1 })
    expect(quote('qte_a').status).toBe('feedback_received')
    // an old review request gets the same button
    const second = await press('qte_a', FB2)
    expect(second.json).toMatchObject({ feedbackStatus: 'acknowledged', quoteStatus: 'viewed', pendingLeft: 0 })
  })

  it('pressing twice is harmless', async () => {
    await press('qte_a', FB1)
    const again = await press('qte_a', FB1)
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ feedbackStatus: 'acknowledged', quoteStatus: 'viewed' })
  })

  it('never reaches another business’s question, or another quote’s', async () => {
    // tenant A pressing tenant B's question, by B's quote id and by its own
    expect((await press('qte_b', FB_RIVAL)).status).toBe(404)
    expect((await press('qte_a', FB_RIVAL)).status).toBe(404)
    expect(feedback(FB_RIVAL).status).toBe('pending')
    expect(quote('qte_b').status).toBe('feedback_received')
    // its own question under the wrong quote
    expect((await press('qte_a2', FB1)).status).toBe(404)
    expect(feedback(FB1).status).toBe('pending')
    // not the shape of an id: refused before the database
    const readsBefore = db.reads.length
    expect((await press('qte_a', "x' or 1=1")).status).toBe(404)
    expect(db.reads.length).toBe(readsBefore)
  })

  it('a quote the customer already accepted is never moved back', async () => {
    quote('qte_a').status = 'accepted'
    const res = await press('qte_a', FB1)
    expect(res.json).toMatchObject({ feedbackStatus: 'acknowledged', quoteStatus: 'accepted' })
    expect(quote('qte_a').status).toBe('accepted')
  })

  it('only feedback_received with nothing pending moves, and only to viewed', () => {
    expect(statusAfterQuestionAnswered('feedback_received', 0)).toBe('viewed')
    expect(statusAfterQuestionAnswered('feedback_received', 1)).toBe('feedback_received')
    for (const s of ALL_STATUSES.filter((x) => x !== 'feedback_received')) expect(statusAfterQuestionAnswered(s, 0)).toBe(s)
  })

  it('the dashboard banner: "Customer question", "Mark as answered", saved through the route', () => {
    const page = code('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain("'Customer question'")
    expect(page).toContain("'Mark as answered'")
    expect(page).not.toMatch(/Customer Feedback|Acknowledge/)
    expect(page).toMatch(/fetch\(`\/api\/quotes\/\$\{quoteId\}\/feedback\/\$\{feedbackId\}\/answered`, \{ method: 'POST' \}\)/)
  })

  it('edit and send resolves every pending question on the quote', () => {
    const patch = code('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    expect(patch).toMatch(
      /if \(body\.sendToCustomer\) \{\s*await supabase\s*\.from\('quote_feedback'\)\s*\.update\(\{ status: 'resolved' \}\)\s*\.eq\('quote_id', quoteId\)\s*\.eq\('tenant_id', auth\.tenantId\)\s*\.eq\('status', 'pending'\)/
    )
  })

  it('the customer can accept or decline with a question open; a second question stays off', () => {
    expect(ALL_STATUSES.filter(canCustomerDecide)).toEqual(['sent', 'viewed', 'feedback_received', 'revised'])
    const page = code('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('const canDecide = canCustomerDecide(status) && !settled')
    expect(page).toContain('const questionOpen = feedbackSubmitted || quote.questionPending === true')
    // Accept and Decline hang off canDecide, not off "no question sent yet"
    expect(page).toContain('showAcceptButton && canDecide && !acceptMode')
    expect(page).toContain('!declineMode && canDecide')
    expect(page).not.toContain('canSubmitFeedback')
    // Ask a question hangs off canAskQuestion, which is off while one is open
    expect(page).toMatch(/const canAskQuestion =[\s\S]{0,140}&& !questionOpen && !settled/)
    expect(page).toContain("canAskQuestion && feedbackMode === 'none'")
    // the note stays while the question is open
    expect(page).toMatch(/\{questionOpen && !settled && \([\s\S]{0,260}Message sent/)
    // an estimate shown before approval stays locked after a question (T-147)
    expect(page).toContain("quote.status !== 'pending_review' && { status: 'feedback_received' as QuoteStatus }")
    // the accept and decline routes use the same rule as the page
    for (const name of ['accept', 'decline']) {
      expect(code(`apps/web/src/app/api/public/quotes/[quoteId]/${name}/route.ts`), name).toContain('canCustomerDecide(quote.status)')
    }
    // and the public API says when a question is open, so a reload keeps the note
    expect(code('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')).toContain('questionPending: true')
  })
})

// ---------------------------------------------------------------------------
// 5. Revised stays revised
// ---------------------------------------------------------------------------
describe('T-157: edit and send', () => {
  it('a quote the customer already had becomes, or stays, revised; a first send is sent', () => {
    expect(statusAfterEditAndSend('revised')).toBe('revised') // used to flip back to sent
    expect(statusAfterEditAndSend('sent')).toBe('revised')
    expect(statusAfterEditAndSend('viewed')).toBe('revised')
    expect(statusAfterEditAndSend('feedback_received')).toBe('revised')
    expect(statusAfterEditAndSend('pending_review')).toBe('sent')
    expect(statusAfterEditAndSend('expired')).toBe('sent')
    expect(code('apps/web/src/app/api/quotes/[quoteId]/route.ts')).toContain('statusAfterEditAndSend(newStatus)')
  })
})

// ---------------------------------------------------------------------------
// 6. Money is always rounded
// ---------------------------------------------------------------------------
describe('T-157: roundMoney', () => {
  it('2 decimals, half away from zero, negatives too', () => {
    expect(roundMoney(18 * 34.6)).toBe(622.8)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })

  it('the edit route rounds each line and the subtotal; the editor rounds what it shows and saves', () => {
    const patch = code('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    expect(patch).toContain('amount: roundMoney(Number(item.amount))')
    expect(patch).toContain('pricing.subtotal = roundMoney(pricing.breakdown.reduce(')
    const editor = code('apps/web/src/components/quote-editor/useQuotePricing.ts')
    expect(editor).toContain('amount: roundMoney(b.amount)')
    expect(editor).toContain('amount: roundMoney(updates.amount)')
    expect(editor).toContain('roundMoney(items.reduce(')
  })
})

describe('T-157: the maths label rule', () => {
  const generated = 'Exterior walls  £18 x 34.6(Sqm)'
  const before = [
    { label: generated, amount: 622.8000000000001 },
    { label: 'Trim  £7 x 12(M)', amount: 84 },
    { label: 'Scaffold hire', amount: 250 },
  ]
  const traceLabels = [generated, 'Trim  £7 x 12(M)', 'Scaffold hire']

  it('splitLabelMath reads the label the engine writes', () => {
    expect(splitLabelMath(generated)).toEqual(['Exterior walls', '£18 × 34.6 Sqm'])
    expect(splitLabelMath('Scaffold hire')).toEqual(['Scaffold hire', null])
    expect(splitLabelMath('2 x coats of paint')).toEqual(['2 x coats of paint', null])
  })

  it('amount changed, label untouched: the maths goes', () => {
    const after = dropStaleLabelMath(before, [{ label: generated, amount: 600 }, before[1]!, before[2]!], traceLabels)
    expect(after[0]).toEqual({ label: 'Exterior walls', amount: 600 })
    expect(after[1]).toEqual(before[1])
    expect(after[2]).toEqual(before[2])
  })

  it('amount untouched: the label keeps its maths, also when only float dust was rounded off', () => {
    const after = dropStaleLabelMath(before, [{ label: generated, amount: 622.8 }], traceLabels)
    expect(after[0]!.label).toBe(generated)
  })

  it('text typed by the business is never rewritten', () => {
    // retyped label, new line, and a typed label that merely looks like maths
    const typed = [
      { label: 'Exterior walls (two coats)', amount: 600 },
      { label: 'Extra coat  £5 x 10(Sqm)', amount: 55 },
      { label: 'Exterior walls  £18 x 30(Sqm)', amount: 540 },
    ]
    expect(dropStaleLabelMath(before, typed, traceLabels)).toEqual(typed)
    // the same label is on the quote but the engine never wrote it: left alone
    const ownText = [{ label: 'Hand finish  £9 x 4(Hrs)', amount: 36 }]
    expect(dropStaleLabelMath(ownText, [{ label: 'Hand finish  £9 x 4(Hrs)', amount: 40 }], traceLabels)).toEqual([
      { label: 'Hand finish  £9 x 4(Hrs)', amount: 40 },
    ])
  })

  it('without a trace it still needs the exact stored label', () => {
    expect(dropStaleLabelMath(before, [{ label: generated, amount: 600 }], null)[0]!.label).toBe('Exterior walls')
    expect(dropStaleLabelMath(before, [{ label: generated, amount: 600 }], [])[0]!.label).toBe('Exterior walls')
    expect(dropStaleLabelMath([], [{ label: generated, amount: 600 }], null)[0]!.label).toBe(generated)
  })

  it('keeps the other fields of a line and does not touch its input', () => {
    const line = { label: generated, amount: 600, autoRecommended: true, recommendationReason: 'From your photos' }
    const after = dropStaleLabelMath(before, [line], traceLabels)
    expect(after[0]).toEqual({ ...line, label: 'Exterior walls' })
    expect(line.label).toBe(generated)
  })

  it('two lines with one label: only the one whose amount changed loses its maths', () => {
    const twice = [
      { label: generated, amount: 622.8 },
      { label: generated, amount: 622.8 },
    ]
    const after = dropStaleLabelMath(twice, [{ label: generated, amount: 622.8 }, { label: generated, amount: 500 }], traceLabels)
    expect(after.map((l) => l.label)).toEqual([generated, 'Exterior walls'])
  })

  it('the customer page and the edit route use the shared helpers', () => {
    const customerPage = code('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(customerPage).toMatch(/import \{[^}]*splitLabelMath[^}]*\} from '@estimator\/shared'/)
    expect(customerPage).not.toMatch(/function splitLabelMath/)
    expect(code('apps/web/src/app/api/quotes/[quoteId]/route.ts')).toContain('dropStaleLabelMath(')
  })
})
