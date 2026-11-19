/**
 * T-189: backlog fixes before launch (the worker's side, and the shared rules).
 *
 *   - one document style: one system prompt for every quote, never "binding";
 *   - the owner's alerts: off without an address, one email per kind per
 *     hour, ids only, and a fault in the database does not silence them;
 *   - the queue check: only a request seen waiting twice counts.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  OPS_ALERT_EVERY_SECONDS,
  PRODUCT_NAME,
  QUEUE_WAIT_MINUTES,
  errorNameOf,
  opsAlertEmail,
  raiseOpsAlert,
  stillWaiting,
  type OpsAlertKind,
} from '@qolumns/shared'
import { DOCUMENT_STYLE, getSystemPrompt } from '../ai/wording'
import { checkQueue, sendOpsAlert } from '../ops-alert'
import { markQuoteFailed } from '../failed-quote'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---------------------------------------------------------------------------------------------
describe('T-189 item 2: one document style', () => {
  it('there is one system prompt, and it is the plain, brief one', () => {
    expect(getSystemPrompt.length).toBe(0)
    expect(getSystemPrompt()).toContain(DOCUMENT_STYLE)
    expect(DOCUMENT_STYLE).toContain('TONE: Plain and Brief')
    expect(DOCUMENT_STYLE).toContain('This is an estimate from the details provided')
  })

  it('no quote is called binding, and the other three tones are gone', () => {
    const wording = code('src/ai/wording.ts')
    expect(getSystemPrompt()).not.toMatch(/binding/i)
    expect(wording).not.toMatch(/binding quote|Persuasive and Value-Focused|Technical and Detailed|We propose/)
    expect(wording).not.toMatch(/formal_quote|'sow'|DocumentTone|documentType/)
  })

  it('the stored value reaches no prompt: not the quote’s wording, not a service draft', () => {
    expect(code('src/quote-processor.ts')).not.toMatch(/documentType:/)
    expect(code('src/ai/service-draft.ts')).not.toMatch(/DOCUMENT TYPE|documentType/)
    // the worker still loads the row as it is (nothing is migrated), it just never reads the column
    expect(code('src/ai/wording.ts')).toContain('getSystemPrompt()')
  })
})

// ---------------------------------------------------------------------------------------------
const mailEnv = { POSTMARK_API_TOKEN: 'pm-token', POSTMARK_FROM_EMAIL: 'quotes@sender.test', APP_URL: 'https://app.test', ENVIRONMENT: 'production' }
const ALERT_TO = 'alerts@owner.test'

describe('T-189 item 5: the rule for an alert (shared)', () => {
  const alert = { kind: 'quote_failed' as const, details: { Quote: 'qte_fixture_1', Business: 'tnt_fixture_1' } }
  const deps = (over: Partial<Parameters<typeof raiseOpsAlert>[1]> = {}) => ({
    to: ALERT_TO,
    claim: vi.fn(async () => ({ send: true, heldBack: 0 })),
    send: vi.fn(async () => true),
    memory: new Map<OpsAlertKind, number>(),
    ...over,
  })

  it('no address: off. Nothing is claimed and nothing is sent', async () => {
    for (const to of [undefined, '', '   ']) {
      const d = deps({ to })
      expect(await raiseOpsAlert(alert, d)).toBe('off')
      expect(d.claim).not.toHaveBeenCalled()
      expect(d.send).not.toHaveBeenCalled()
    }
  })

  it('the database says yes: one email, to the alert address, for one hour', async () => {
    const send = vi.fn(async (_email: { to: string; subject: string; html: string; text: string }) => true)
    const d = deps({ send })
    expect(await raiseOpsAlert(alert, d)).toBe('sent')
    expect(d.claim).toHaveBeenCalledWith('quote_failed', 3600)
    expect(OPS_ALERT_EVERY_SECONDS).toBe(3600)
    const email = send.mock.calls[0]![0]
    expect(email.to).toBe(ALERT_TO)
    expect(email.subject).toBe(`${PRODUCT_NAME} alert: A quote could not be priced`)
  })

  it('the database says no: held, nothing sent', async () => {
    const d = deps({ claim: vi.fn(async () => ({ send: false, heldBack: 4 })) })
    expect(await raiseOpsAlert(alert, d)).toBe('held')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('the database cannot answer (it may be the fault): still one email, then held for the hour by this process', async () => {
    let now = 1_000_000
    for (const claim of [vi.fn(async () => null), vi.fn(async () => { throw new Error('down') })]) {
      const d = deps({ claim, now: () => now })
      expect(await raiseOpsAlert(alert, d)).toBe('sent')
      now += 59 * 60_000
      expect(await raiseOpsAlert(alert, d)).toBe('held')
      // another kind has its own hour
      expect(await raiseOpsAlert({ kind: 'worker_error', details: {} }, d)).toBe('sent')
      now += 2 * 60_000
      expect(await raiseOpsAlert(alert, d)).toBe('sent')
      expect(d.send).toHaveBeenCalledTimes(3)
    }
  })

  it('never throws: a send that fails, or throws, is an outcome', async () => {
    expect(await raiseOpsAlert(alert, deps({ send: vi.fn(async () => false) }))).toBe('failed')
    expect(await raiseOpsAlert(alert, deps({ send: vi.fn(async () => { throw new Error('postmark down') }) }))).toBe('failed')
  })

  it('the email says what happened, the facts given, what was held back, where to look and how to turn it off', () => {
    const email = opsAlertEmail(alert, { appUrl: 'https://app.test/', environment: 'production', heldBack: 3 })
    expect(email.html).toContain('Quote: qte_fixture_1')
    expect(email.html).toContain('Business: tnt_fixture_1')
    expect(email.text).toContain('3 more of this kind happened in the last hour and were not emailed.')
    expect(email.html).toContain('href="https://app.test/admin/quotes"')
    expect(email.text).toContain('To turn them off, remove that setting.')
    expect(email.text).toContain('ALERT_EMAIL')
    // another environment is named in the subject, so a test never reads as live
    expect(opsAlertEmail(alert, { environment: 'development' }).subject).toBe(`${PRODUCT_NAME} alert (development): A quote could not be priced`)
    // each kind has its own words
    expect(opsAlertEmail({ kind: 'worker_error', details: {} }).subject).toContain('The pricing worker hit an error')
    expect(opsAlertEmail({ kind: 'queue_backed_up', details: {} }).text).toContain(`waiting more than ${QUEUE_WAIT_MINUTES} minutes`)
    // what is put in a fact is escaped
    expect(opsAlertEmail({ kind: 'worker_error', details: { Where: '<b>x</b>' } }).html).toContain('Where: &lt;b&gt;x&lt;/b&gt;')
  })

  it('an error is carried by its name only', () => {
    expect(errorNameOf(new TypeError('the address was megan@customer.test'))).toBe('TypeError')
    expect(errorNameOf('a string')).toBe('unknown error')
  })
})

// ---------------------------------------------------------------------------------------------
/** A stand-in for the database calls the alert code makes */
function fakeDb(opts: { quote?: Record<string, unknown> | null; claim?: { send: boolean; held_back: number } | 'error'; waiting?: Array<{ id: string; created_at: string }>; seen?: unknown } = {}) {
  const calls = { rpc: [] as Array<[string, Record<string, unknown>]>, upserts: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>> }
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push([name, args])
      if (opts.claim === 'error') return { data: null, error: { message: 'down' } }
      return { data: [opts.claim ?? { send: true, held_back: 0 }], error: null }
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === 'quotes' ? (opts.quote ?? null) : null }),
          maybeSingle: async () => ({ data: table === 'ops_alerts' ? { seen: opts.seen ?? null } : null }),
          order: () => ({ limit: () => ({ single: async () => ({ data: null }) }) }),
        }),
        in: () => ({ lt: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: opts.waiting ?? [], error: null }) }) }) }) }),
      }),
      update: (values: Record<string, unknown>) => {
        calls.updates.push(values)
        return { eq: async () => ({ error: null }) }
      },
      upsert: async (values: Record<string, unknown>) => {
        calls.upserts.push(values)
        return { error: null }
      },
    }),
    auth: { admin: { getUserById: async () => ({ data: null }) } },
  }
  return { db: db as never, calls }
}

describe('T-189 item 5: the worker sends the alerts', () => {
  it('off unless ALERT_EMAIL is set: no claim, no email', async () => {
    const { db, calls } = fakeDb()
    const send = vi.fn(async () => ({ success: true }))
    expect(await sendOpsAlert(db, mailEnv, { kind: 'worker_error', details: {} }, send)).toBe('off')
    expect(calls.rpc).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
    // and off when there is no way to send
    expect(await sendOpsAlert(db, { ALERT_EMAIL: ALERT_TO }, { kind: 'worker_error', details: {} }, send)).toBe('off')
  })

  it('with the address: the database is asked for this kind’s hour, and one email goes to it', async () => {
    const { db, calls } = fakeDb()
    const send = vi.fn(async () => ({ success: true }))
    expect(await sendOpsAlert(db, { ...mailEnv, ALERT_EMAIL: ALERT_TO }, { kind: 'worker_error', details: { Where: 'the queue', Error: 'TypeError' } }, send)).toBe('sent')
    expect(calls.rpc).toEqual([['claim_ops_alert', { p_kind: 'worker_error', p_every_seconds: 3600 }]])
    const [config, mail] = send.mock.calls[0] as unknown as [{ fromEmail: string }, { to: string; tag: string; htmlBody: string; from: { kind: string } }]
    expect(config.fromEmail).toBe('quotes@sender.test')
    expect(mail).toMatchObject({ to: ALERT_TO, tag: 'ops-alert', from: { kind: 'business' } })
    expect(mail.htmlBody).toContain('Error: TypeError')
  })

  it('a second fault inside the hour is held, and said in the next email', async () => {
    const held = fakeDb({ claim: { send: false, held_back: 2 } })
    const send = vi.fn(async () => ({ success: true }))
    expect(await sendOpsAlert(held.db, { ...mailEnv, ALERT_EMAIL: ALERT_TO }, { kind: 'quote_failed', details: {} }, send)).toBe('held')
    expect(send).not.toHaveBeenCalled()
    const next = fakeDb({ claim: { send: true, held_back: 2 } })
    expect(await sendOpsAlert(next.db, { ...mailEnv, ALERT_EMAIL: ALERT_TO }, { kind: 'quote_failed', details: {} }, send)).toBe('sent')
    expect((send.mock.calls[0] as unknown as [unknown, { textBody: string }])[1].textBody).toContain('2 more of this kind happened in the last hour')
  })

  it('a quote that fails to price: the business is emailed as before, and the owner too, with ids and nothing of the customer', async () => {
    const quote = {
      tenant_id: 'tnt_fixture_1',
      customer_json: { name: 'Megan Grant', email: 'megan@customer.test', phone: '+1 415 555 0142' },
      content_json: {},
      is_test: false,
      is_demo: false,
      tenant: { name: 'Fixture Business', notification_email: 'owner@business.test', is_demo: false },
      service: { name: 'Service Alpha' },
    }
    const { db, calls } = fakeDb({ quote })
    const send = vi.fn(async () => ({ success: true }))
    const result = await markQuoteFailed(db, { ...mailEnv, ALERT_EMAIL: ALERT_TO }, 'qte_fixture_1', 'the model timed out near megan@customer.test', send)
    expect(result).toEqual({ marked: true, emailed: true })
    expect(send).toHaveBeenCalledTimes(2)
    const mails = send.mock.calls.map((c) => (c as unknown as [unknown, { to: string; htmlBody: string; subject: string }])[1])
    expect(mails[0]!.to).toBe('owner@business.test')
    const alert = mails[1]!
    expect(alert.to).toBe(ALERT_TO)
    expect(alert.htmlBody).toContain('Quote: qte_fixture_1')
    expect(alert.htmlBody).toContain('Business: tnt_fixture_1')
    expect(`${alert.subject} ${alert.htmlBody}`).not.toMatch(/Megan|megan@customer\.test|555 0142|timed out|Service Alpha|Fixture Business/)
    expect(calls.updates[0]!.status).toBe('failed')
  })

  it('without the address a failed quote is handled exactly as before: one email, to the business', async () => {
    const { db, calls } = fakeDb({ quote: { tenant_id: 'tnt_fixture_1', customer_json: { name: 'Megan Grant' }, content_json: {}, tenant: { notification_email: 'owner@business.test' }, service: { name: 'Service Alpha' } } })
    const send = vi.fn(async () => ({ success: true }))
    await markQuoteFailed(db, mailEnv, 'qte_fixture_1', 'the model timed out', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(calls.rpc).toHaveLength(0)
  })

  it('the demo business’s own quotes raise no alert', async () => {
    const { db } = fakeDb({ quote: { tenant_id: 'tnt_demo', customer_json: {}, content_json: {}, is_demo: true, tenant: { is_demo: true }, service: { name: 'Service Alpha' } } })
    const send = vi.fn(async () => ({ success: true }))
    await markQuoteFailed(db, { ...mailEnv, ALERT_EMAIL: ALERT_TO }, 'qte_demo_1', 'x', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('the worker reports its own errors where it catches them, by the error’s name', () => {
    const entry = code('src/index.ts')
    for (const where of ['the queue is not bound to the worker', 'a request could not be put on the queue', 'pricing a quote again after an answer', 'the worker has no database settings', 'taking a request off the queue', 'the check of waiting requests']) {
      expect(entry, where).toContain(`'${where}'`)
    }
    expect(entry).toContain("details: { Where: where, Error: typeof error === 'string' ? error : errorNameOf(error) }")
    // an error's message is never put in an alert
    expect(entry.slice(entry.indexOf('async function workerError'), entry.indexOf('function jsonResponse'))).not.toMatch(/\.message/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 5: the queue check', () => {
  const NOW = new Date('2026-11-19T12:00:00Z')
  const env = { ...mailEnv, ALERT_EMAIL: ALERT_TO }
  const waiting = [
    { id: 'qte_a', created_at: '2026-11-19T11:20:00Z' },
    { id: 'qte_b', created_at: '2026-11-19T11:45:00Z' },
  ]

  it('only what was waiting at the previous check counts (pure)', () => {
    expect(stillWaiting(['qte_a', 'qte_x'], ['qte_a', 'qte_b'])).toEqual(['qte_a'])
    expect(stillWaiting(null, ['qte_a'])).toEqual([])
    expect(stillWaiting('qte_a', ['qte_a'])).toEqual([])
    expect(stillWaiting(['qte_a'], [])).toEqual([])
  })

  it('first sight of a waiting request: no alarm (it may be a quote being priced again), and it is remembered', async () => {
    const { db, calls } = fakeDb({ waiting, seen: [] })
    const send = vi.fn(async () => ({ success: true }))
    expect(await checkQueue(db, env, NOW, send)).toEqual({ waiting: 2, stuck: 0, alert: 'none' })
    expect(send).not.toHaveBeenCalled()
    expect(calls.upserts[0]).toMatchObject({ kind: 'queue_watch', seen: ['qte_a', 'qte_b'] })
  })

  it('still waiting at the next check: the owner is told how many and how long, with the quote’s id', async () => {
    const { db, calls } = fakeDb({ waiting, seen: ['qte_a'] })
    const send = vi.fn(async () => ({ success: true }))
    expect(await checkQueue(db, env, NOW, send)).toEqual({ waiting: 2, stuck: 1, alert: 'sent' })
    expect(calls.rpc[0]).toEqual(['claim_ops_alert', { p_kind: 'queue_backed_up', p_every_seconds: 3600 }])
    const mail = (send.mock.calls[0] as unknown as [unknown, { subject: string; htmlBody: string }])[1]
    expect(mail.subject).toContain('Requests are waiting to be priced')
    expect(mail.htmlBody).toContain('Waiting: 1')
    expect(mail.htmlBody).toContain('Oldest, in minutes: 40')
    expect(mail.htmlBody).toContain('Oldest quote: qte_a')
  })

  it('nothing waiting: nothing sent, and the note is cleared', async () => {
    const { db, calls } = fakeDb({ waiting: [], seen: ['qte_a'] })
    const send = vi.fn(async () => ({ success: true }))
    expect(await checkQueue(db, env, NOW, send)).toEqual({ waiting: 0, stuck: 0, alert: 'none' })
    expect(calls.upserts[0]).toMatchObject({ seen: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('it runs on a timer in production only, and prices nothing', () => {
    const toml = read('wrangler.toml')
    expect(toml).toMatch(/\[env\.production\.triggers\]\ncrons = \["\*\/5 \* \* \* \*"\]/)
    expect(toml.match(/crons = /g)).toHaveLength(1)
    const entry = code('src/index.ts')
    expect(entry).toContain('async scheduled(_event: ScheduledEvent, env: Env): Promise<void>')
    const handler = entry.slice(entry.indexOf('async scheduled('))
    expect(handler).not.toMatch(/processQuote|markQuoteFailed|updateQuoteStatus/)
  })
})
