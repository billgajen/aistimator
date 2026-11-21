/**
 * T-197: the worker's side of the Help button: sorting a problem report,
 * titling and matching feature requests, the owner's daily summary, and how
 * the queue treats a support job. The model here is a function the test
 * writes; the database is held in memory.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPPORT_COPY, TICKET_SAFETY_LINE } from '@qolumns/shared'
import { memoryDb, type MemRow } from '../../../../packages/shared/src/testing/memory-db'
import { isSupportJob, matchFeatures, runSupportJob, sortReport, supportDaily, titleFeature, type Ask, type SupportEnv } from '../support'

const ENV: SupportEnv = { ENVIRONMENT: 'development', GEMINI_API_KEY: 'k', ALERT_EMAIL: 'owner@qolumns.test', POSTMARK_API_TOKEN: 't', POSTMARK_FROM_EMAIL: 'quotes@qolumns.test', APP_URL: 'https://qolumns.test' }
const CUSTOMER = { name: 'Megan Grant', email: 'megan.grant@example.test', phone: '+1 (314) 555-0142' }
const WORDS = `Megan Grant (megan.grant@example.test, +1 (314) 555-0142) of 12 Alder Close says two rooms should be about $750. This is far too high.`

function world(extra: Record<string, MemRow[]> = {}) {
  const tables: Record<string, MemRow[]> = {
    tenants: [{ id: 'tnt_a', name: 'Harbour Painting', region: 'US' }, { id: 'tnt_b', name: 'Rival Decorating', region: 'US' }],
    services: [{ id: 'svc_1', name: 'Room refresh', work_steps: [{ id: 'rooms', name: 'Rooms painted', costType: 'per_unit', defaultCost: 3750, unitLabel: 'room' }] }],
    quote_requests: [{ id: 'qr_1', job_address: '12 Alder Close', job_postcode: '63021' }],
    quotes: [
      {
        id: 'qte_1',
        tenant_id: 'tnt_a',
        status: 'sent',
        is_test: false,
        service_id: 'svc_1',
        quote_request_id: 'qr_1',
        customer_json: CUSTOMER,
        pricing_json: { total: 7500, currency: 'USD', breakdown: [{ label: 'Rooms painted  $3,750 × 2 rooms', amount: 7500 }], estimate: { grade: 'A' } },
        pricing_trace_json: { trace: [{ type: 'work_step', id: 'rooms', description: 'Rooms painted', calculation: '2 room × 3750/room = 7500', amount: 7500, quantitySource: 'form_field', quantityTrusted: true, signalsUsed: [{ key: 'room_count', value: 2 }, { key: 'note', value: 'gate code 4417' }] }], summary: { minimumApplied: false } },
      },
      { id: 'qte_other', tenant_id: 'tnt_b', status: 'sent', service_id: 'svc_1', quote_request_id: 'qr_1', customer_json: { name: 'Dana Whitfield' }, pricing_json: { total: 99, currency: 'USD' }, pricing_trace_json: { trace: [] } },
    ],
    support_reports: [
      { id: 'r-est', tenant_id: 'tnt_a', kind: 'estimate', body: WORDS, choices: ['too_high'], expected_total: 750, quote_id: 'qte_1', context_json: { page: '/app/quotes/qte_1', plan: 'Pro' }, status: 'new', setup_hint: null },
      { id: 'r-open', tenant_id: 'tnt_b', kind: 'problem', body: 'Send again does nothing.', choices: [], expected_total: null, quote_id: null, context_json: {}, status: 'new', setup_hint: null },
      { id: 'r-closed', tenant_id: 'tnt_b', kind: 'problem', body: 'Old one.', choices: [], expected_total: null, quote_id: null, context_json: {}, status: 'fixed', setup_hint: null },
    ],
    support_report_internal: [
      { report_id: 'r-est', sort_state: 'waiting', sort_attempts: 0, severity: null, merged_into: null },
      { report_id: 'r-open', sort_state: 'sorted', sort_attempts: 1, severity: 'high', title: 'Send again does nothing', summary: 'The button has no effect.', merged_into: null },
      { report_id: 'r-closed', sort_state: 'sorted', sort_attempts: 1, severity: 'low', title: 'An old problem', summary: 'Closed.', merged_into: null },
    ],
    feature_requests: [
      { id: 'f-ai', title: 'Export quotes to a spreadsheet', summary: 'Download quotes as CSV.', title_source: 'ai', status: 'under_review', merged_into: null, created_at: '2026-11-19T00:00:00Z' },
      { id: 'f-words', title: 'At Harbour Painting we want deposits', summary: '', title_source: 'words', status: 'under_review', merged_into: null, created_at: '2026-11-20T00:00:00Z' },
      { id: 'f-shipped', title: 'Dark mode', summary: '', title_source: 'owner', status: 'shipped', merged_into: null, created_at: '2026-11-18T00:00:00Z' },
      { id: 'f-merged', title: 'CSV', summary: '', title_source: 'owner', status: 'under_review', merged_into: 'f-ai', created_at: '2026-11-18T00:00:00Z' },
    ],
    feature_votes: [{ id: 'v-1', request_id: 'f-words', tenant_id: 'tnt_a', body: 'At Harbour Painting we want customers to pay a deposit by card.', created_at: '2026-11-20T00:00:00Z' }],
    ops_alerts: [],
    ...extra,
  }
  const db = memoryDb(tables, { keys: { support_report_internal: 'report_id' } })
  return { tables, db, supabase: db as unknown as SupabaseClient }
}

const GOOD = {
  title: 'Room refresh total is ten times what the business expects',
  summary: 'The business expected about $750 for two rooms and got $7,500.',
  kind: 'how_to',
  severity: 'medium',
  similar: [{ ref: 1, confidence: 0.2 }],
  likely_cause: 'setup',
  evidence: 'Rooms painted is set to $3,750.00 per room; 2 rooms give $7,500.00.',
  setup_line: 'rooms',
  ticket: { title: 'Rate looks ten times too high', wrong: 'The rate for Rooms painted is $3,750 per room.', evidence: '2 × $3,750 = $7,500', expected: 'The business sets the rate it means.', check: 'Price two rooms again.' },
}
const asks = (answer: unknown): { ask: Ask; calls: Array<{ task: string; prompt: string }> } => {
  const calls: Array<{ task: string; prompt: string }> = []
  return {
    calls,
    ask: async (task, prompt) => {
      calls.push({ task, prompt })
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}
const noAlert = vi.fn(async () => 'sent' as const)

afterEach(() => {
  vi.restoreAllMocks()
  noAlert.mockClear()
})

describe('sorting a problem report', () => {
  it('stores the title, kind, severity, likely cause, evidence and the draft fix ticket on the owner’s side', async () => {
    const { tables, supabase } = world()
    const model = asks(GOOD)
    expect(await sortReport(supabase, ENV, 'r-est', { ask: model.ask, alert: noAlert })).toBe('sorted')
    const internal = tables.support_report_internal!.find((r) => r.report_id === 'r-est')!
    expect(internal).toMatchObject({ title: GOOD.title, ai_kind: 'how_to', severity: 'medium', likely_cause: 'setup', sort_state: 'sorted', sort_attempts: 1, similar_json: [] })
    expect(internal.fix_ticket).toContain(TICKET_SAFETY_LINE)
    expect(internal.fix_ticket).toContain('Support report r-est, estimate qte_1')
    expect(model.calls.map((c) => c.task)).toEqual(['support_sort'])
  })

  it('shows the business one thing: a possibility, written from its own setup, when the AI named a line that is in it', async () => {
    const { tables, supabase } = world()
    await sortReport(supabase, ENV, 'r-est', { ask: asks(GOOD).ask, alert: noAlert })
    const hint = tables.support_reports!.find((r) => r.id === 'r-est')!.setup_hint as { line: string; rate: string }
    expect(hint).toEqual({ line: 'Rooms painted', rate: '$3,750.00 per room', serviceId: 'svc_1' })
    expect(SUPPORT_COPY.setupHint(hint.line, hint.rate)).toBe('This may be down to your prices: Rooms painted is set to $3,750.00 per room. Check it in Services.')

    // a line the AI made up gives no hint; nor does a cause that is not the setup
    const made = world()
    await sortReport(made.supabase, ENV, 'r-est', { ask: asks({ ...GOOD, setup_line: 'ceilings' }).ask, alert: noAlert })
    expect(made.tables.support_reports!.find((r) => r.id === 'r-est')!.setup_hint).toBeNull()
    const reading = world()
    await sortReport(reading.supabase, ENV, 'r-est', { ask: asks({ ...GOOD, likely_cause: 'ai_reading' }).ask, alert: noAlert })
    expect(reading.tables.support_reports!.find((r) => r.id === 'r-est')!.setup_hint).toBeNull()
  })

  it('sends the model ids, numbers, line names and the business’s own words, and nothing about the customer', async () => {
    const { supabase } = world()
    const model = asks(GOOD)
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => void logged.push(args.join(' ')))
    vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args.join(' ')))
    await sortReport(supabase, ENV, 'r-est', { ask: model.ask, alert: noAlert })
    const prompt = model.calls[0]!.prompt
    expect(prompt).not.toMatch(/megan|grant|example\.test|555|alder|gate code|63021/i)
    for (const part of ['qte_1', 'Room refresh', 'Rooms painted', '$3,750.00 per room', 'should have been: $750.00', 'room_count=2', 'two rooms should be about $750']) expect(prompt).toContain(part)
    // the open problem of another business is offered by its title only; a closed one is not offered
    expect(prompt).toContain('1. Send again does nothing')
    expect(prompt).not.toContain('An old problem')
    expect(prompt).not.toMatch(/Rival Decorating|Harbour Painting|tnt_/)
    expect(logged.join('\n')).not.toMatch(/megan|grant|example\.test|555|alder|\$750/i)
    expect(logged.join('\n')).toContain('[Support] sorted r-est: how_to, medium')
  })

  it('reads the estimate only through the report’s own business: a report can never reach another business’s quote', async () => {
    const { tables, supabase } = world()
    tables.support_reports!.find((r) => r.id === 'r-est')!.quote_id = 'qte_other'
    const model = asks(GOOD)
    await sortReport(supabase, ENV, 'r-est', { ask: model.ask, alert: noAlert })
    expect(model.calls[0]!.prompt).not.toContain('THE ESTIMATE')
    expect(model.calls[0]!.prompt).not.toMatch(/qte_other|\$99/)
  })

  it('a look-alike is stored for the owner and never merged by the sorter', async () => {
    const { tables, supabase } = world()
    await sortReport(supabase, ENV, 'r-est', { ask: asks({ ...GOOD, similar: [{ ref: 1, confidence: 0.93 }] }).ask, alert: noAlert })
    const internal = tables.support_report_internal!.find((r) => r.report_id === 'r-est')!
    expect(internal.similar_json).toEqual([{ id: 'r-open', confidence: 0.93 }])
    expect(internal.merged_into).toBeNull()
  })

  it.each([
    ['the model throws', new Error('boom')],
    ['the model answers nonsense', { hello: 'world' }],
    ['the model answers a kind that is not ours', { ...GOOD, kind: 'catastrophe' }],
  ])('when %s the report is kept exactly as sent, marked unsorted, and the model is not asked again', async (_name, answer) => {
    const { tables, supabase } = world()
    const before = JSON.stringify(tables.support_reports)
    const model = asks(answer)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await sortReport(supabase, ENV, 'r-est', { ask: model.ask, alert: noAlert })).toBe('failed')
    expect(JSON.stringify(tables.support_reports)).toBe(before)
    expect(tables.support_reports!.find((r) => r.id === 'r-est')!.status).toBe('new')
    expect(tables.support_report_internal!.find((r) => r.report_id === 'r-est')).toMatchObject({ sort_state: 'failed', sort_attempts: 1 })
    expect(model.calls.length).toBe(1)
    expect(noAlert).not.toHaveBeenCalled()
  })

  it('a model that does not answer in time is a failed sort too, and the report is kept', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const never: Ask = () => new Promise(() => undefined)
    const started = Date.now()
    expect(await sortReport(supabase, ENV, 'r-est', { ask: never, timeoutMs: 30, alert: noAlert })).toBe('failed')
    expect(Date.now() - started).toBeLessThan(2000)
    expect(tables.support_report_internal!.find((r) => r.report_id === 'r-est')!.sort_state).toBe('failed')
    expect(tables.support_reports!.find((r) => r.id === 'r-est')!.body).toBe(WORDS)
  })

  it('with no model to ask (no key, or the checks’ stand-in) the report stays unsorted', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await sortReport(supabase, ENV, 'r-est', { ask: null })).toBe('failed')
    expect(await sortReport(supabase, { ...ENV, AI_STAND_IN: 'off' }, 'r-est')).toBe('failed')
    expect(tables.support_report_internal!.find((r) => r.report_id === 'r-est')).toMatchObject({ sort_state: 'failed', sort_attempts: 2 })
    expect(tables.support_reports!.find((r) => r.id === 'r-est')!.status).toBe('new')
  })

  it('"Sort again" is one more try: it counts up and sorts', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await sortReport(supabase, ENV, 'r-est', { ask: asks(new Error('down')).ask, alert: noAlert })
    expect(await sortReport(supabase, ENV, 'r-est', { ask: asks(GOOD).ask, alert: noAlert })).toBe('sorted')
    expect(tables.support_report_internal!.find((r) => r.report_id === 'r-est')).toMatchObject({ sort_state: 'sorted', sort_attempts: 2 })
  })

  it('a report that does not exist is nothing to sort', async () => {
    const { supabase } = world()
    const model = asks(GOOD)
    expect(await sortReport(supabase, ENV, 'nope', { ask: model.ask })).toBe('missing')
    expect(model.calls.length).toBe(0)
  })

  it('a high-severity problem raises the owner’s alert once: sorting it again as high does not raise it again', async () => {
    const { supabase } = world()
    const high = { ...GOOD, kind: 'fault', severity: 'high' }
    await sortReport(supabase, ENV, 'r-est', { ask: asks(high).ask, alert: noAlert })
    expect(noAlert).toHaveBeenCalledTimes(1)
    const alert = noAlert.mock.calls[0] as unknown as [unknown, unknown, { kind: string; details: Record<string, unknown> }]
    expect(alert[2]).toEqual({ kind: 'support_high', details: { Report: 'r-est', Kind: 'fault', Businesses: 1 } })
    await sortReport(supabase, ENV, 'r-est', { ask: asks(high).ask, alert: noAlert })
    expect(noAlert).toHaveBeenCalledTimes(1)
    // a medium one raises nothing
    const calm = world()
    await sortReport(calm.supabase, ENV, 'r-est', { ask: asks(GOOD).ask, alert: noAlert })
    expect(noAlert).toHaveBeenCalledTimes(1)
  })

  it('writes to the support tables only: no quote, service or price is touched', async () => {
    const { tables, db, supabase } = world()
    const before = JSON.stringify([tables.quotes, tables.services])
    await sortReport(supabase, ENV, 'r-est', { ask: asks(GOOD).ask, alert: noAlert })
    expect(JSON.stringify([tables.quotes, tables.services])).toBe(before)
    const written = db.log.filter((entry) => entry.op !== 'select').map((entry) => entry.table)
    expect([...new Set(written)].sort()).toEqual(['support_report_internal', 'support_reports'])
    const source = readFileSync(fileURLToPath(new URL('../support.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/from\('(quotes|services|quote_requests|tenants)'\)\s*\.(update|insert|upsert|delete)/)
  })
})

describe('feature requests', () => {
  it('offers another business only requests that are open, not merged away, and titled by the AI or the owner', async () => {
    const { supabase } = world()
    const model = asks({ matches: [{ ref: 1, confidence: 0.9 }] })
    const matches = await matchFeatures(supabase, ENV, 'Download my quotes as CSV, write to megan.grant@example.test', { ask: model.ask })
    expect(matches).toEqual([{ id: 'f-ai', title: 'Export quotes to a spreadsheet', summary: 'Download quotes as CSV.' }])
    const prompt = model.calls[0]!.prompt
    expect(model.calls[0]!.task).toBe('feature_match')
    expect(prompt).toContain('1. Export quotes to a spreadsheet')
    // someone's own words, a shipped request and a merged one are never shown to another business
    expect(prompt).not.toMatch(/Harbour Painting|Dark mode|\bCSV\n|example\.test/)
    expect(prompt.match(/^\d+\. /gm)!.length).toBe(1)
  })

  it('a match step that fails, answers nonsense or runs out of time gives no matches: the request is saved as new', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { supabase } = world()
    expect(await matchFeatures(supabase, ENV, 'x', { ask: asks(new Error('down')).ask })).toEqual([])
    expect(await matchFeatures(supabase, ENV, 'x', { ask: asks({ matches: [{ ref: 7, confidence: 1 }] }).ask })).toEqual([])
    expect(await matchFeatures(supabase, ENV, 'x', { ask: () => new Promise(() => undefined), timeoutMs: 20 })).toEqual([])
    expect(await matchFeatures(supabase, ENV, 'x', { ask: null })).toEqual([])
    // nothing to compare with: the model is not asked at all
    const empty = world({ feature_requests: [] })
    const model = asks({ matches: [] })
    expect(await matchFeatures(empty.supabase, ENV, 'x', { ask: model.ask })).toEqual([])
    expect(model.calls.length).toBe(0)
  })

  it('gives a new request a plain title in place of the business’s own words, and leaves the owner’s title alone', async () => {
    const { tables, supabase } = world()
    const model = asks({ title: 'Take a card deposit when an estimate is accepted', summary: 'Customers pay a deposit by card on accepting.' })
    expect(await titleFeature(supabase, ENV, 'f-words', { ask: model.ask })).toBe('titled')
    expect(tables.feature_requests!.find((f) => f.id === 'f-words')).toMatchObject({ title: 'Take a card deposit when an estimate is accepted', title_source: 'ai' })
    expect(model.calls[0]!.task).toBe('feature_match')
    // already titled: not asked again
    expect(await titleFeature(supabase, ENV, 'f-words', { ask: model.ask })).toBe('skipped')
    expect(await titleFeature(supabase, ENV, 'f-shipped', { ask: model.ask })).toBe('skipped')
    expect(tables.feature_requests!.find((f) => f.id === 'f-shipped')!.title).toBe('Dark mode')
    expect(model.calls.length).toBe(1)
  })

  it('a title that cannot be written leaves the request as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { tables, supabase } = world()
    expect(await titleFeature(supabase, ENV, 'f-words', { ask: asks({ title: '' }).ask })).toBe('failed')
    expect(tables.feature_requests!.find((f) => f.id === 'f-words')).toMatchObject({ title: 'At Harbour Painting we want deposits', title_source: 'words' })
  })
})

describe('the jobs on the queue', () => {
  it('knows a support job from a quote job', () => {
    expect(isSupportJob({ kind: 'support_sort', id: '0b6f1c2e-8a53-4d2a-9d3e-000000000001' })).toBe(true)
    expect(isSupportJob({ kind: 'feature_title', id: 'abc' })).toBe(true)
    expect(isSupportJob({ quoteId: 'qte_1', quoteRequestId: 'qr_1', tenantId: 'tnt_1', timestamp: 1 })).toBe(false)
    expect(isSupportJob({ kind: 'support_sort', id: '../x' })).toBe(false)
    expect(isSupportJob(null)).toBe(false)
  })

  it('runs the job it is given', async () => {
    const { supabase } = world()
    expect(await runSupportJob(supabase, ENV, { kind: 'support_sort', id: 'r-est' }, { ask: asks(GOOD).ask, alert: noAlert })).toBe('sorted')
    expect(await runSupportJob(supabase, ENV, { kind: 'feature_title', id: 'f-shipped' }, { ask: asks(GOOD).ask })).toBe('skipped')
  })

  it('a support job is acknowledged whatever happens and never put back; quote jobs keep their own rules', () => {
    const entry = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8')
    const branch = entry.split('if (isSupportJob(message.body)) {')[1]!.split('continue')[0]!
    expect(branch).toContain('message.ack()')
    expect(branch).not.toContain('retry')
    // the branch comes before the quote rules, so a support job never reaches the limiter or markFailed
    expect(entry.indexOf('isSupportJob(message.body)')).toBeLessThan(entry.indexOf('handleQuoteJob<QuoteJobMessage>('))
  })
})

describe('the owner’s daily summary', () => {
  const NOW = new Date('2026-11-21T08:00:00Z')
  const recorder = () => {
    const sent: Array<{ to: string; subject: string; textBody?: string }> = []
    const send = (async (_config: unknown, message: { to: string; subject: string; textBody?: string }) => {
      sent.push(message)
      return { success: true }
    }) as unknown as Parameters<typeof supportDaily>[3]
    return { sent, send }
  }
  const fresh = () =>
    world({
      support_reports: [
        { id: 'r-1', tenant_id: 'tnt_a', created_at: '2026-11-21T01:00:00Z' },
        { id: 'r-2', tenant_id: 'tnt_b', created_at: '2026-11-21T02:00:00Z' },
        { id: 'r-old', tenant_id: 'tnt_b', created_at: '2026-11-10T02:00:00Z' },
      ],
      support_report_internal: [
        { report_id: 'r-1', title: 'Send again does nothing', ai_kind: 'fault', severity: 'high', merged_into: null },
        { report_id: 'r-2', title: null, ai_kind: null, severity: null, merged_into: null },
        { report_id: 'r-old', title: 'Old', ai_kind: 'billing', severity: 'low', merged_into: null },
      ],
      feature_requests: [{ id: 'f-1', title: 'x', created_at: '2026-11-21T03:00:00Z' }],
    })

  it('sends one email with counts by kind and the top problems when something is new', async () => {
    const { supabase } = fresh()
    const { sent, send } = recorder()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await supportDaily(supabase, ENV, NOW, send)).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'owner@qolumns.test', subject: 'Qolumns support (development): 3 new items' })
    for (const part of ['Fault: 1', 'Not sorted yet: 1', 'Feature requests: 1', '1. Send again does nothing (High; 1 business)']) expect(sent[0]!.textBody).toContain(part)
    expect(sent[0]!.textBody).not.toContain('Old')
  })

  it('at most once a day', async () => {
    const { supabase } = fresh()
    const { sent, send } = recorder()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await supportDaily(supabase, ENV, new Date(), send)
    expect(await supportDaily(supabase, ENV, new Date(), send)).toBe('too_soon')
    expect(sent).toHaveLength(1)
  })

  it('no new items, no email, and the day is not used up', async () => {
    const { tables, supabase } = world({ support_reports: [], support_report_internal: [], feature_requests: [] })
    const { sent, send } = recorder()
    expect(await supportDaily(supabase, ENV, NOW, send)).toBe('nothing')
    expect(sent).toHaveLength(0)
    expect(tables.ops_alerts).toEqual([])
  })

  it('is off without the alert address, and never throws', async () => {
    const { sent, send } = recorder()
    expect(await supportDaily(fresh().supabase, { ...ENV, ALERT_EMAIL: '' }, NOW, send)).toBe('off')
    expect(sent).toHaveLength(0)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { from: () => { throw new Error('down') } } as unknown as SupabaseClient
    expect(await supportDaily(broken, ENV, NOW, send)).toBe('failed')
  })
})
