/**
 * T-176: WhatsApp review-ready. The rules that are pure: the 24-hour window,
 * the one message template (its wording, Meta's statuses), the notice sent
 * when an estimate is approved, the words about a personal number, payment
 * and the display name's review. The whole flow against a stand-in for Meta
 * is verify-t176.mts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_NAME } from '@qolumns/shared'

const sendTextMessage = vi.fn(async (_config: unknown, _params: { to: string; text: string }) => ({ success: true, messageId: 'wamid.text' }) as { success: boolean; messageId?: string; errorCode?: number })
const sendTemplateMessage = vi.fn(async (_config: unknown, _params: Record<string, unknown>) => ({ success: true, messageId: 'wamid.template' }) as { success: boolean; messageId?: string; errorCode?: number })
const templatesNamed = vi.fn(async (_token: string, _wabaId: string, _name: string): Promise<MetaTemplate[]> => [])
vi.mock('@/lib/whatsapp', async (original) => ({
  ...((await original()) as object),
  sendTextMessage: (config: unknown, params: { to: string; text: string }) => sendTextMessage(config, params),
  sendTemplateMessage: (config: unknown, params: Record<string, unknown>) => sendTemplateMessage(config, params),
}))
vi.mock('@/lib/whatsapp-graph', async (original) => ({
  ...((await original()) as object),
  templatesNamed: (token: string, wabaId: string, name: string) => templatesNamed(token, wabaId, name),
}))

import type { MetaTemplate } from '@/lib/whatsapp-graph'
import { parseWebhookPayload } from '@/lib/whatsapp'
import { encryptSecret } from '@/lib/whatsapp-crypto'
import { META_ERROR } from '@/lib/whatsapp-graph'
import { SERVICE_WINDOW_MS, windowOpen } from '@/lib/whatsapp-window'
import {
  ESTIMATE_TEMPLATE_NAME,
  estimateReadyText,
  estimateTemplateBody,
  estimateTemplateDefinition,
  estimateTemplateParameters,
  nameForTemplate,
  pickTemplate,
  rejectedReasonWords,
  templateLanguage,
  templateManagerUrl,
  templateState,
  templateView,
} from '@/lib/whatsapp-templates'
import { nameReview } from '@/lib/whatsapp-state'
import { NAME_REVIEW_DAYS, PAYMENT_NOTE, PAYMENT_NOTE_TITLE, PERSONAL_NUMBER_LINE, isMetaIssuedNumber } from '@/lib/whatsapp-copy'
import { NOTICE_TIME_LIMIT_MS, notifyEstimateReady } from '@/lib/whatsapp-notify'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const saved = { ...process.env }
const now = new Date('2026-11-17T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const HOUR = 3_600_000

beforeEach(() => {
  process.env.WHATSAPP_ENCRYPTION_KEY = 'unit-test-key-t176'
})
afterEach(() => {
  process.env = { ...saved }
  sendTextMessage.mockReset().mockResolvedValue({ success: true, messageId: 'wamid.text' })
  sendTemplateMessage.mockReset().mockResolvedValue({ success: true, messageId: 'wamid.template' })
  templatesNamed.mockReset().mockResolvedValue([])
  vi.useRealTimers()
})

const template = (over: Partial<MetaTemplate> = {}): MetaTemplate => ({
  id: '900000000000001',
  name: ESTIMATE_TEMPLATE_NAME,
  language: 'en_US',
  status: 'APPROVED',
  category: 'UTILITY',
  rejectedReason: null,
  bodyText: estimateTemplateBody('Kent Garage Doors'),
  ...over,
})

describe('T-176: the 24-hour window, by the customer’s last message', () => {
  it('is open for a day after the customer wrote, with a small margin at the edge', () => {
    expect(windowOpen(ago(1 * HOUR), now)).toBe(true)
    expect(windowOpen(ago(23 * HOUR), now)).toBe(true)
    // the last five minutes are treated as closed: Meta's clock decides, not ours
    expect(windowOpen(ago(SERVICE_WINDOW_MS - 60_000), now)).toBe(false)
    expect(windowOpen(ago(25 * HOUR), now)).toBe(false)
  })

  it('is closed when the customer never wrote, or the date is not one', () => {
    expect(windowOpen(null, now)).toBe(false)
    expect(windowOpen('not a date', now)).toBe(false)
    // a message "from the future" proves nothing
    expect(windowOpen(new Date(now.getTime() + HOUR).toISOString(), now)).toBe(false)
  })
})

describe('T-176: the template’s wording follows Meta’s rules', () => {
  const body = estimateTemplateBody('Kent Garage Doors')

  it('has a name Meta accepts: lowercase letters, digits and underscores', () => {
    expect(ESTIMATE_TEMPLATE_NAME).toMatch(/^[a-z0-9_]+$/)
  })

  it('names the business, carries one variable (the link), and neither starts nor ends with it', () => {
    expect(body).toContain('Your estimate from Kent Garage Doors is ready')
    expect(body.match(/\{\{\d+\}\}/g)).toEqual(['{{1}}'])
    expect(body.startsWith('{{')).toBe(false)
    expect(body.trimEnd().endsWith('}}')).toBe(false)
    expect(body.length).toBeLessThanOrEqual(1024)
  })

  it('says nothing promotional and does not invite a reply (the number answers with the quote questions)', () => {
    expect(body).not.toMatch(/offer|discount|sale|deal|free|reply|!/i)
  })

  it('is sent to Meta as a utility template with an example for the variable', () => {
    const definition = estimateTemplateDefinition({ businessName: 'Kent Garage Doors', language: 'en_GB', exampleLink: 'https://app.example/q/example?token=example' })
    expect(definition.name).toBe(ESTIMATE_TEMPLATE_NAME)
    expect(definition.language).toBe('en_GB')
    expect(definition.category).toBe('UTILITY')
    expect(definition.components).toHaveLength(1)
    expect(definition.components[0]).toEqual({ type: 'BODY', text: body, example: { body_text: [['https://app.example/q/example?token=example']] } })
  })

  it('a send carries the customer’s link as the one body parameter', () => {
    expect(estimateTemplateParameters('https://app.example/q/1?token=t')).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'https://app.example/q/1?token=t' }] }])
  })

  it('the free-form message inside the 24 hours reads the same as the template', () => {
    expect(estimateReadyText('Kent Garage Doors', 'https://app.example/q/1?token=t')).toBe(body.replace('{{1}}', 'https://app.example/q/1?token=t'))
  })

  it('a business name cannot break the wording', () => {
    expect(nameForTemplate('  Kent   Garage\nDoors ')).toBe('Kent Garage Doors')
    expect(nameForTemplate('{{1}} Doors')).toBe('1 Doors')
    expect(nameForTemplate('x'.repeat(200)).length).toBe(60)
    expect(nameForTemplate('  ')).toBe('us')
    expect(estimateTemplateBody('{{2}}').match(/\{\{\d+\}\}/g)).toEqual(['{{1}}'])
  })

  it('the language follows the business’s region', () => {
    expect(templateLanguage('en-GB')).toBe('en_GB')
    expect(templateLanguage('en-US')).toBe('en_US')
    expect(templateLanguage(null)).toBe('en_US')
  })
})

describe('T-176: Meta’s review of the template, in the page’s words', () => {
  it('maps every status Meta documents; only APPROVED can be sent', () => {
    expect(templateState(null)).toBe('none')
    expect(templateState('APPROVED')).toBe('approved')
    expect(templateState('PENDING')).toBe('pending')
    expect(templateState('IN_APPEAL')).toBe('pending')
    expect(templateState('REJECTED')).toBe('rejected')
    expect(templateState('PAUSED')).toBe('paused')
    for (const status of ['DISABLED', 'ARCHIVED', 'DELETED', 'PENDING_DELETION', 'LIMIT_EXCEEDED']) expect(templateState(status)).toBe('disabled')
    expect(templateState('SOMETHING_NEW')).toBe('unknown')
    expect(templateState('approved')).toBe('approved')
  })

  it('says Meta’s rejection reason in plain words, and its own word for one it does not know', () => {
    expect(rejectedReasonWords('PROMOTIONAL')).toMatch(/advertising/)
    expect(rejectedReasonWords('INVALID_FORMAT')).toMatch(/laid out/)
    expect(rejectedReasonWords('NONE')).toBeNull()
    expect(rejectedReasonWords(null)).toBeNull()
    expect(rejectedReasonWords('BRAND_NEW_REASON')).toContain('brand new reason')
  })

  it('of several languages, an approved one is shown and sent; the business’s own language breaks a tie', () => {
    const gbPending = template({ id: '1', language: 'en_GB', status: 'PENDING' })
    const usApproved = template({ id: '2', language: 'en_US', status: 'APPROVED' })
    const gbApproved = template({ id: '3', language: 'en_GB', status: 'APPROVED' })
    expect(pickTemplate([gbPending, usApproved], 'en_GB')?.id).toBe('2')
    expect(pickTemplate([usApproved, gbApproved], 'en_GB')?.id).toBe('3')
    expect(pickTemplate([gbPending], 'en_US')?.id).toBe('1')
    expect(pickTemplate([], 'en_US')).toBeNull()
  })

  it('the page is shown Meta’s own copy of the wording, the category Meta chose, and no secret', () => {
    const view = templateView({
      found: template({ status: 'REJECTED', category: 'MARKETING', rejectedReason: 'PROMOTIONAL', bodyText: 'Your estimate from Old Name is ready. Open it here: {{1}}\n\nThank you.' }),
      businessName: 'New Name',
      language: 'en_US',
      sampleLink: 'https://app.example/q/…',
      wabaId: '102289599326934',
      businessId: '506914307656634',
    })
    expect(view.state).toBe('rejected')
    expect(view.category).toBe('MARKETING')
    expect(view.reason).toMatch(/advertising/)
    expect(view.text).toContain('Old Name')
    expect(view.text).toContain('https://app.example/q/…')
    expect(view.text).not.toContain('{{1}}')
    expect(view.managerUrl).toBe('https://business.facebook.com/wa/manage/message-templates/?waba_id=102289599326934&business_id=506914307656634')
    expect(Object.keys(view).sort()).toEqual(['category', 'language', 'managerUrl', 'metaStatus', 'name', 'reason', 'state', 'text'])

    const none = templateView({ found: null, businessName: 'New Name', language: 'en_GB', sampleLink: 'https://app.example/q/…', wabaId: null, businessId: null })
    expect(none.state).toBe('none')
    expect(none.language).toBe('en_GB')
    expect(none.text).toContain('Your estimate from New Name is ready')
    expect(none.managerUrl).toBeNull()
    expect(templateManagerUrl(null, '1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------
// The notice at approval
// ---------------------------------------------------------------------------------------
interface Stored {
  conversations: Array<{ id: string; customer_phone: string }>
  config: Record<string, unknown> | null
  lastInbound: string | null
  inserted: Array<Record<string, unknown>>
  filters: Array<[string, string, unknown]>
  /** T-177: the business's subscription (the approval notice needs a plan with WhatsApp, live) */
  subscription?: { plan_id: string; status: string } | null
}

/** A stand-in for the service-role client: just the calls the notice makes */
function fakeAdmin(stored: Stored) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          stored.filters.push([table, column, value])
          return builder
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: table === 'whatsapp_configs' ? stored.config : table === 'subscriptions' ? (stored.subscription === undefined ? { plan_id: 'plan_us_pro', status: 'active' } : stored.subscription) : null }),
        insert: async (row: Record<string, unknown>) => {
          stored.inserted.push({ table, ...row })
          return { error: null }
        },
        then: (resolve: (value: { data: unknown[] }) => void) =>
          resolve({
            data: table === 'whatsapp_conversations' ? stored.conversations : table === 'whatsapp_messages' && stored.lastInbound ? [{ created_at: stored.lastInbound }] : [],
          }),
      }
      return builder
    },
  } as never
}

const LINK = 'https://app.example/q/quote-1?token=secret-quote-token'
const TOKEN = 'EAAexample-business-token'
function stored(over: Partial<Stored> = {}): Stored {
  return {
    conversations: [{ id: 'conv-1', customer_phone: '15555550142' }],
    config: {
      phone_number_id: '106540352242922',
      display_phone_number: '+1 555-555-0100',
      access_token_encrypted: encryptSecret(TOKEN),
      waba_id: '102289599326934',
      connection_method: 'embedded',
      is_active: true,
    },
    lastInbound: ago(2 * HOUR),
    inserted: [],
    filters: [],
    ...over,
  }
}
const input = { tenantId: 'tenant-a', quoteId: 'quote-1', businessName: 'Kent Garage Doors', region: 'us', quoteViewUrl: LINK, now }

describe('T-176: an approved estimate is announced on WhatsApp, to the customer who asked there', () => {
  it('inside the 24 hours: an ordinary message with the link, from the business’s own number', async () => {
    const s = stored()
    expect(await notifyEstimateReady(input, fakeAdmin(s))).toEqual({ sent: 'message' })
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    expect(sendTextMessage.mock.calls[0]![0]).toEqual({ phoneNumberId: '106540352242922', accessToken: TOKEN })
    expect(sendTextMessage.mock.calls[0]![1]).toEqual({ to: '15555550142', text: estimateReadyText('Kent Garage Doors', LINK) })
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(templatesNamed).not.toHaveBeenCalled()
  })

  it('after the 24 hours: the approved template, with the link as its one parameter', async () => {
    templatesNamed.mockResolvedValue([template({ language: 'en_US' })])
    const s = stored({ lastInbound: ago(30 * HOUR) })
    expect(await notifyEstimateReady(input, fakeAdmin(s))).toEqual({ sent: 'template' })
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(templatesNamed).toHaveBeenCalledWith(TOKEN, '102289599326934', ESTIMATE_TEMPLATE_NAME)
    expect(sendTemplateMessage.mock.calls[0]![1]).toEqual({ to: '15555550142', templateName: ESTIMATE_TEMPLATE_NAME, languageCode: 'en_US', components: estimateTemplateParameters(LINK) })
  })

  it('after the 24 hours with no approved template, nothing is sent', async () => {
    const closed = { lastInbound: ago(30 * HOUR) }
    expect(await notifyEstimateReady(input, fakeAdmin(stored(closed)))).toEqual({ sent: null, why: 'no_template' })
    templatesNamed.mockResolvedValue([template({ status: 'PENDING' })])
    expect(await notifyEstimateReady(input, fakeAdmin(stored(closed)))).toEqual({ sent: null, why: 'no_template' })
    templatesNamed.mockResolvedValue([template({ status: 'REJECTED' })])
    expect(await notifyEstimateReady(input, fakeAdmin(stored(closed)))).toEqual({ sent: null, why: 'no_template' })
    // a manual connection knows no account, so it has no template to send
    templatesNamed.mockResolvedValue([template()])
    const manual = stored({ ...closed })
    manual.config = { ...manual.config, connection_method: 'manual', waba_id: null }
    expect(await notifyEstimateReady(input, fakeAdmin(manual))).toEqual({ sent: null, why: 'no_template' })
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('an estimate that was not asked for on WhatsApp is not announced there', async () => {
    const s = stored({ conversations: [] })
    expect(await notifyEstimateReady(input, fakeAdmin(s))).toEqual({ sent: null, why: 'not_whatsapp' })
    expect(sendTextMessage).not.toHaveBeenCalled()
    // the conversation is looked up for this business and this quote, and nothing wider
    expect(s.filters).toContainEqual(['whatsapp_conversations', 'tenant_id', 'tenant-a'])
    expect(s.filters).toContainEqual(['whatsapp_conversations', 'intake_data->>_quoteId', 'quote-1'])
  })

  it('a business that disconnected, or switched WhatsApp off, sends nothing', async () => {
    expect(await notifyEstimateReady(input, fakeAdmin(stored({ config: null })))).toEqual({ sent: null, why: 'not_connected' })
    const off = stored()
    off.config = { ...off.config, is_active: false }
    expect(await notifyEstimateReady(input, fakeAdmin(off))).toEqual({ sent: null, why: 'not_connected' })
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('what is kept of the message never includes the link (it carries the quote’s token)', async () => {
    const s = stored()
    await notifyEstimateReady(input, fakeAdmin(s))
    expect(s.inserted).toHaveLength(1)
    const row = s.inserted[0]!
    expect(row).toMatchObject({ table: 'whatsapp_messages', tenant_id: 'tenant-a', conversation_id: 'conv-1', direction: 'outbound', message_type: 'text', to_phone: '15555550142', wa_message_id: 'wamid.text', status: 'sent' })
    expect(JSON.stringify(row)).not.toContain('secret-quote-token')
    templatesNamed.mockResolvedValue([template()])
    const late = stored({ lastInbound: null })
    await notifyEstimateReady(input, fakeAdmin(late))
    expect(late.inserted[0]).toMatchObject({ message_type: 'template', wa_message_id: 'wamid.template' })
  })

  it('Meta refusing, an error, or a slow answer all end in "not sent": the approval is never failed', async () => {
    sendTextMessage.mockResolvedValue({ success: false, errorCode: META_ERROR.PAYMENT })
    const refused = stored()
    expect(await notifyEstimateReady(input, fakeAdmin(refused))).toEqual({ sent: null, why: 'refused' })
    expect(refused.inserted).toHaveLength(0)

    sendTextMessage.mockRejectedValue(new Error('boom'))
    expect(await notifyEstimateReady(input, fakeAdmin(stored()))).toEqual({ sent: null, why: 'error' })

    // no service-role settings at all (as in this test run): still an answer, never a throw
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect((await notifyEstimateReady(input)).sent).toBeNull()

    vi.useFakeTimers()
    sendTextMessage.mockImplementation(() => new Promise(() => undefined))
    const slow = notifyEstimateReady(input, fakeAdmin(stored()))
    await vi.advanceTimersByTimeAsync(NOTICE_TIME_LIMIT_MS + 10)
    expect(await slow).toEqual({ sent: null, why: 'timed_out' })
  })

  it('“edit, then send” announces a first send only, never a revision', () => {
    const src = code('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    expect(src).toMatch(/body\.sendToCustomer && quoteViewUrl && firstSend\s*\?\s*notifyEstimateReady\(/)
    expect(src.match(/notifyEstimateReady\(/g)).toHaveLength(1)
    expect(src).toContain('await whatsappNotice')
  })

  it('the approval marks the quote sent first, and only then tries WhatsApp', () => {
    const src = code('apps/web/src/lib/quote-approval.ts')
    expect(src.indexOf(".eq('status', 'pending_review')")).toBeGreaterThan(0)
    expect(src.indexOf('notifyEstimateReady(')).toBeGreaterThan(src.indexOf(".eq('status', 'pending_review')"))
  })
})

describe('T-176: what Meta reports later is read', () => {
  it('a failed delivery status carries Meta’s code', () => {
    const entries = parseWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102289599326934',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15555550100', phone_number_id: '106540352242922' },
                statuses: [
                  { id: 'wamid.a', status: 'failed', timestamp: '1', recipient_id: '15555550142', errors: [{ code: 131047, title: 'Re-engagement message' }] },
                  { id: 'wamid.b', status: 'delivered', timestamp: '2', recipient_id: '15555550142' },
                ],
              },
            },
          ],
        },
      ],
    })
    expect(entries[0]!.statuses).toEqual([
      { messageId: 'wamid.a', status: 'failed', timestamp: '1', recipientId: '15555550142', errorCode: 131047 },
      { messageId: 'wamid.b', status: 'delivered', timestamp: '2', recipientId: '15555550142', errorCode: null },
    ])
    expect(META_ERROR.OUTSIDE_WINDOW).toBe(131047)
    expect(META_ERROR.NAME_NOT_APPROVED).toBe(131037)
    expect(META_ERROR.TEMPLATE_NOT_APPROVED).toBe(132001)
  })

  it('the display name’s review is one of three states', () => {
    expect(nameReview('PENDING_REVIEW')).toBe('in_review')
    expect(nameReview('DECLINED')).toBe('declined')
    expect(nameReview('APPROVED')).toBe('approved')
    expect(nameReview('AVAILABLE_WITHOUT_REVIEW')).toBe('approved')
    for (const other of ['NONE', 'EXPIRED', '', null]) expect(nameReview(other)).toBe('unknown')
  })

  it('one of Meta’s own 555 numbers is recognised (it cannot send until its name is approved)', () => {
    expect(isMetaIssuedNumber('+1 555-759-6002')).toBe(true)
    expect(isMetaIssuedNumber('15557596002')).toBe(true)
    expect(isMetaIssuedNumber('+1 415-555-0100')).toBe(false)
    expect(isMetaIssuedNumber('+44 7700 900123')).toBe(false)
    expect(isMetaIssuedNumber('555-759-6002')).toBe(false)
  })
})

describe('T-176: the words on the WhatsApp page', () => {
  it('T-177 replaced the three-answer question with one short line (the question, its lock and its steps are gone)', () => {
    expect(PERSONAL_NUMBER_LINE).toMatch(/Don’t connect a personal number/)
    const button = code('apps/web/src/components/whatsapp/ConnectWhatsApp.tsx')
    expect(button).not.toMatch(/\blocked\b/)
    expect(code('apps/web/src/app/(dashboard)/app/whatsapp/page.tsx')).not.toContain('NumberQuestion')
  })

  it('payment is a note, not a step: the first 1,000 need no card', () => {
    expect(PAYMENT_NOTE_TITLE).toMatch(/don’t need a card/)
    expect(PAYMENT_NOTE).toMatch(/first 1,000/)
    expect(PAYMENT_NOTE).toMatch(/without a card/)
    expect(PAYMENT_NOTE).toMatch(/messages your business starts/)
    expect(PAYMENT_NOTE).toContain(PRODUCT_NAME)
    const card = code('apps/web/src/components/whatsapp/ConnectedCard.tsx')
    expect(card).toContain('const stepsLeft = config.registered ? 0 : 1')
    expect(card).not.toContain('payment-step')
    expect(card).not.toMatch(/Two steps left/)
    expect(card).toContain('data-testid="payment-note"')
  })

  it('a display name in review is said plainly, with how long', () => {
    expect(NAME_REVIEW_DAYS).toBe('up to five working days')
    const card = code('apps/web/src/components/whatsapp/ConnectedCard.tsx')
    expect(card).toContain('data-testid="name-in-review"')
    expect(card).toContain('{NAME_REVIEW_DAYS}')
    expect(card).toMatch(/Nothing is broken/)
  })

  it('the new files use the product’s name from the constant, never typed', () => {
    for (const file of [
      'apps/web/src/components/whatsapp/ConnectedCard.tsx',
      'apps/web/src/components/whatsapp/MessageTemplates.tsx',
      'apps/web/src/lib/whatsapp-copy.ts',
      'apps/web/src/lib/whatsapp-templates.ts',
      'apps/web/src/lib/whatsapp-notify.ts',
    ]) {
      expect(code(file), file).not.toContain(PRODUCT_NAME)
    }
  })
})

describe('T-176: nothing secret is logged or returned', () => {
  const files = ['apps/web/src/lib/whatsapp-notify.ts', 'apps/web/src/lib/whatsapp-template-service.ts', 'apps/web/src/app/api/whatsapp/template/route.ts', 'apps/web/src/lib/whatsapp-window.ts']

  it('no log line in the new server files names a token, a link, a phone number or Meta’s own message', () => {
    for (const file of files) {
      const logs = code(file).match(/console\.\w+\([^\n]*\)/g) ?? []
      for (const line of logs) expect(line, `${file}: ${line}`).not.toMatch(/token|quoteViewUrl|link|phone|\.message\b|customer/i)
    }
  })

  it('Meta is called from the Graph file and the sending file only', () => {
    for (const file of files) expect(code(file), file).not.toMatch(/\bfetch\(/)
  })

  it('the template route answers only the signed-in business, through the service role for its own tenant (T-177: it only reads)', () => {
    const route = code('apps/web/src/app/api/whatsapp/template/route.ts')
    expect(route.match(/await currentTenant\(\)/g)).toHaveLength(1)
    expect(route.match(/if \(!auth\.ok\) return auth\.response/g)).toHaveLength(1)
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    expect(route).not.toMatch(/request\.json|searchParams/)
    expect(route).toMatch(/auth\.tenantId/)
  })
})
