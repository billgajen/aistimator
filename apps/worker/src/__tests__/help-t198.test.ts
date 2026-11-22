/**
 * T-198: the worker's side of the Help assistant and of T-197's small fixes:
 *   - a fix ticket is drafted only for a fault; every other kind gets a draft
 *     reply, and one that uses a figure we did not send is not kept;
 *   - a report sent on from the assistant is a how-to question;
 *   - the daily summary's line about the assistant;
 *   - questions and answers are deleted after 90 days.
 * The model is a function the test writes; the database is held in memory.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ASK_KEEP_DAYS, SORT_HELP_MAX, TICKET_SAFETY_LINE, askCutoff } from '@qolumns/shared'
import { memoryDb, type MemRow } from '../../../../packages/shared/src/testing/memory-db'
import { helpCleanup, isSupportJob, runSupportJob, sortReport, supportDaily, type Ask, type SupportEnv } from '../support'

const ENV: SupportEnv = { ENVIRONMENT: 'development', GEMINI_API_KEY: 'k', ALERT_EMAIL: 'owner@qolumns.test', POSTMARK_API_TOKEN: 't', POSTMARK_FROM_EMAIL: 'quotes@qolumns.test', APP_URL: 'https://qolumns.test' }
const noAlert = (async () => 'sent') as unknown as NonNullable<Parameters<typeof sortReport>[3]>['alert']

function world(extra: Record<string, MemRow[]> = {}) {
  const tables: Record<string, MemRow[]> = {
    tenants: [{ id: 'tnt_a', name: 'Harbour Painting', region: 'US' }],
    services: [],
    quote_requests: [],
    quotes: [],
    support_reports: [
      { id: 'r-1', tenant_id: 'tnt_a', kind: 'problem', body: 'How do I change the rate for Rooms painted? It says 45 now.', choices: [], expected_total: null, quote_id: null, context_json: { page: '/app/services', plan: 'Pro' }, status: 'new', setup_hint: null, from_assistant: false },
      { id: 'r-ask', tenant_id: 'tnt_a', kind: 'problem', body: 'Sent from Ask Qolumns: a question the assistant could not settle.\n\nQuestion: Can I take a deposit?\nAnswer: I’m not sure about that.', choices: [], expected_total: null, quote_id: null, context_json: {}, status: 'new', setup_hint: null, from_assistant: true },
    ],
    support_report_internal: [
      { report_id: 'r-1', sort_state: 'waiting', sort_attempts: 0, severity: null, merged_into: null },
      { report_id: 'r-ask', sort_state: 'waiting', sort_attempts: 0, severity: null, merged_into: null },
    ],
    feature_requests: [],
    help_questions: [],
    ops_alerts: [],
    ...extra,
  }
  const db = memoryDb(tables, { keys: { support_report_internal: 'report_id' } })
  return { tables, db, supabase: db as unknown as SupabaseClient }
}

const TICKET = { title: 'Fix it', wrong: 'It is wrong.', evidence: 'Seen.', expected: 'It works.', check: 'Try it.' }
const answer = (over: Record<string, unknown>) => ({ title: 'A title', summary: 'A summary.', kind: 'how_to', severity: 'low', similar: [], likely_cause: null, evidence: '', setup_line: null, ticket: TICKET, reply: null, ...over })
/** The same answer to both questions: the sorter reads its own fields, the reply reads `reply` */
const asks = (said: unknown): { ask: Ask; prompts: string[]; tasks: string[] } => {
  const prompts: string[] = []
  const tasks: string[] = []
  return {
    prompts,
    tasks,
    ask: async (task, prompt) => {
      tasks.push(task)
      prompts.push(prompt)
      return said
    },
  }
}
const internalOf = (tables: Record<string, MemRow[]>, id: string) => tables.support_report_internal!.find((r) => r.report_id === id)!

afterEach(() => vi.restoreAllMocks())

describe('a fix ticket only for a fault; a draft reply for everything else', () => {
  it('a fault gets a ticket in the house format and no draft reply, even if the model wrote one', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const model = asks(answer({ kind: 'fault', reply: 'We will fix it.' }))
    await sortReport(supabase, ENV, 'r-1', { ask: model.ask, alert: noAlert })
    const internal = internalOf(tables, 'r-1')
    // a fault is never asked for a reply at all
    expect(model.tasks).toEqual(['support_sort'])
    expect(internal.ai_kind).toBe('fault')
    expect(internal.fix_ticket).toContain(TICKET_SAFETY_LINE)
    expect(internal.draft_reply).toBeNull()
  })

  it.each(['how_to', 'billing', 'feature', 'other'])('a report sorted as "%s" gets a draft reply and no ticket, even if the model wrote one', async (kind) => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const reply = 'You can change a rate on the Services page, under Pricing Setup. Rooms painted is set to 45 today.'
    const model = asks(answer({ kind, reply }))
    await sortReport(supabase, ENV, 'r-1', { ask: model.ask, alert: noAlert })
    const internal = internalOf(tables, 'r-1')
    // the reply is its own question, put after the sorting is stored
    expect(model.tasks).toEqual(['support_sort', 'support_reply'])
    expect(internal.ai_kind).toBe(kind)
    expect(internal.fix_ticket).toBeNull()
    expect(internal.draft_reply).toBe(reply)
  })

  it('a draft reply that uses a figure we did not send is not kept: it never invents one', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await sortReport(supabase, ENV, 'r-1', { ask: asks(answer({ reply: 'Set the rate to 60 and it will come to 120 for two rooms.' })).ask, alert: noAlert })
    expect(internalOf(tables, 'r-1').draft_reply).toBeNull()
    // the report is still sorted: only the draft is dropped
    expect(internalOf(tables, 'r-1').sort_state).toBe('sorted')
  })

  it('nothing sends a draft reply: the worker writes it to the owner’s side and to no thread', async () => {
    const { db, supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await sortReport(supabase, ENV, 'r-1', { ask: asks(answer({ reply: 'You can change a rate on the Services page.' })).ask, alert: noAlert })
    expect(db.log.filter((l) => l.table === 'support_messages')).toEqual([])
    const source = readFileSync(fileURLToPath(new URL('../support.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/from\('support_messages'\)\s*(?:\n\s*)?\.(insert|upsert)/)
  })

  it('the sorter is told a ticket is for a fault only; the reply is told to invent nothing and promise nothing', async () => {
    const { supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const model = asks(answer({}))
    await sortReport(supabase, ENV, 'r-1', { ask: model.ask, alert: noAlert })
    expect(model.prompts[0]).toContain('ticket: ONLY when kind is "fault"')
    expect(model.prompts[0]).not.toContain('"reply"')
    expect(model.prompts[1]).toContain('never work out or guess a new one')
    expect(model.prompts[1]).toContain('Promise nothing: no fix, no date, no refund.')
    expect(model.prompts[1]).toContain('HOW IT WAS SORTED\nHow-to question: A title. A summary.')
  })

  it('a draft that is slow, fails or cannot be read costs the report nothing: it stays sorted, with no draft', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args) => void errors.push(args.join(' ')))
    const sortThen = (reply: () => Promise<unknown>): Ask => async (task) => (task === 'support_sort' ? answer({}) : reply())
    for (const reply of [
      () => new Promise<unknown>(() => undefined), // never answers
      async () => { throw Object.assign(new Error('megan.grant@example.test'), { name: 'ModelDown' }) },
      async () => 'not json',
    ]) {
      const { tables, supabase } = world()
      expect(await sortReport(supabase, ENV, 'r-1', { ask: sortThen(reply), alert: noAlert, replyTimeoutMs: 30 })).toBe('sorted')
      expect(internalOf(tables, 'r-1')).toMatchObject({ sort_state: 'sorted', ai_kind: 'how_to', title: 'A title', draft_reply: null })
    }
    // an error's name is logged, never its message
    expect(errors).toEqual(['[Support] no draft reply for r-1 (SupportTimeout); its sorting is kept', '[Support] no draft reply for r-1 (ModelDown); its sorting is kept'])
  })
})

describe('a draft reply can answer from the help guide', () => {
  const HELP = '[account-branding-logo] How do I add my logo?\nPage: /app/settings/branding (Branding)\nUpload it on the "Branding" tab. It must be a PNG, JPG or WebP of 2MB or less.'

  it('the guide’s matching entries travel with the job and are put to the model', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const model = asks(answer({ reply: 'Open Settings, then the "Branding" tab, and upload a PNG, JPG or WebP of 2MB or less.' }))
    expect(await runSupportJob(supabase, ENV, { kind: 'support_sort', id: 'r-1', help: HELP }, { ask: model.ask, alert: noAlert })).toBe('sorted')
    // the guide goes to the reply's question only: the sorting is as it was
    expect(model.prompts[0]).not.toContain('WHAT THE HELP GUIDE SAYS')
    expect(model.prompts[1]).toContain(`WHAT THE HELP GUIDE SAYS (entries that share words with what the business wrote; they may or may not bear on it)\n${HELP}`)
    // a figure the guide gives is evidence; the reply is kept
    expect(internalOf(tables, 'r-1').draft_reply).toBe('Open Settings, then the "Branding" tab, and upload a PNG, JPG or WebP of 2MB or less.')
  })

  it('without it the prompt has no such part, and a job with too much of it is not a job', async () => {
    const { supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const model = asks(answer({}))
    await runSupportJob(supabase, ENV, { kind: 'support_sort', id: 'r-1' }, { ask: model.ask, alert: noAlert })
    expect(model.prompts.join('\n')).not.toContain('WHAT THE HELP GUIDE SAYS')
    expect(isSupportJob({ kind: 'support_sort', id: 'r-1', help: HELP })).toBe(true)
    expect(isSupportJob({ kind: 'support_sort', id: 'r-1', help: 'x'.repeat(SORT_HELP_MAX + 1) })).toBe(false)
    expect(isSupportJob({ kind: 'support_sort', id: 'r-1', help: 42 })).toBe(false)
  })
})

describe('a report sent on from the Help assistant', () => {
  it('is a how-to question whatever the model calls it, with a draft reply and no fix ticket', async () => {
    const { tables, supabase } = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const model = asks(answer({ kind: 'fault', reply: 'Qolumns does not take deposits today.' }))
    await sortReport(supabase, ENV, 'r-ask', { ask: model.ask, alert: noAlert })
    const internal = internalOf(tables, 'r-ask')
    expect(internal.ai_kind).toBe('how_to')
    expect(internal.fix_ticket).toBeNull()
    expect(internal.draft_reply).toBe('Qolumns does not take deposits today.')
    expect(model.prompts[0]).toContain('a question the help assistant could not answer')
  })
})

describe('the daily summary’s line about the assistant', () => {
  const NOW = new Date('2026-11-21T08:00:00Z')
  const recorder = () => {
    const sent: Array<{ subject: string; textBody?: string }> = []
    const send = (async (_config: unknown, message: { subject: string; textBody?: string }) => {
      sent.push(message)
      return { success: true }
    }) as unknown as Parameters<typeof supportDaily>[3]
    return { sent, send }
  }
  const question = (id: string, outcome: string, at = '2026-11-21T02:00:00Z'): MemRow => ({ id, tenant_id: 'tnt_a', question: 'q', outcome, created_at: at })

  it('says how many questions were asked and how many the assistant could not answer', async () => {
    const { supabase } = world({
      support_reports: [{ id: 'r-new', tenant_id: 'tnt_a', created_at: '2026-11-21T01:00:00Z' }],
      support_report_internal: [{ report_id: 'r-new', title: 'A problem', ai_kind: 'fault', severity: 'low', merged_into: null }],
      help_questions: [question('q1', 'answered'), question('q2', 'answered'), question('q3', 'not_sure'), question('q4', 'failed'), question('q5', 'team'), question('q-old', 'not_sure', '2026-11-10T00:00:00Z')],
    })
    const { sent, send } = recorder()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await supportDaily(supabase, ENV, NOW, send)).toBe('sent')
    expect(sent[0]!.textBody).toContain('Questions asked: 5. The assistant could not answer: 2.')
  })

  it('a day of answered questions alone sends nothing; one it could not answer does', async () => {
    const quiet = world({ support_reports: [], support_report_internal: [], help_questions: [question('q1', 'answered'), question('q2', 'declined')] })
    const first = recorder()
    expect(await supportDaily(quiet.supabase, ENV, NOW, first.send)).toBe('nothing')
    expect(first.sent).toEqual([])
    // and the day is not used up
    expect(quiet.tables.ops_alerts).toEqual([])

    const unsure = world({ support_reports: [], support_report_internal: [], help_questions: [question('q1', 'answered'), question('q2', 'not_sure')] })
    const second = recorder()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await supportDaily(unsure.supabase, ENV, NOW, second.send)).toBe('sent')
    expect(second.sent[0]!.textBody).toContain('Questions asked: 2. The assistant could not answer: 1.')
  })

  it('reads only how each question ended, never its words', () => {
    const source = readFileSync(fileURLToPath(new URL('../support.ts', import.meta.url)), 'utf8')
    expect(source).toContain(".from('help_questions').select('outcome')")
    expect(source).not.toMatch(/from\('help_questions'\)\.select\('[^']*(question|answer)/)
  })
})

describe('stored questions and answers are deleted after 90 days', () => {
  const NOW = new Date('2026-11-21T08:00:00Z')
  const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

  it('deletes what is older than 90 days and keeps the rest', async () => {
    const { tables, supabase } = world({
      help_questions: [
        { id: 'q-new', tenant_id: 'tnt_a', created_at: days(1) },
        { id: 'q-89', tenant_id: 'tnt_a', created_at: days(89) },
        { id: 'q-91', tenant_id: 'tnt_a', created_at: days(91) },
        { id: 'q-200', tenant_id: 'tnt_a', created_at: days(200) },
      ],
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(ASK_KEEP_DAYS).toBe(90)
    expect(askCutoff(NOW).toISOString()).toBe(days(90))
    expect(await helpCleanup(supabase, NOW)).toBe('done')
    expect(tables.help_questions!.map((r) => r.id)).toEqual(['q-new', 'q-89'])
  })

  it('once a day: a second run the same day does nothing, and does not ask to claim the day again', async () => {
    const { tables, db, supabase } = world({ help_questions: [{ id: 'q-old', tenant_id: 'tnt_a', created_at: days(120) }] })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await helpCleanup(supabase, new Date())).toBe('done')
    tables.help_questions!.push({ id: 'q-old-2', tenant_id: 'tnt_a', created_at: days(120) })
    const claimsBefore = db.log.filter((l) => l.table === 'rpc:claim_ops_alert').length
    expect(await helpCleanup(supabase, new Date())).toBe('too_soon')
    expect(db.log.filter((l) => l.table === 'rpc:claim_ops_alert').length).toBe(claimsBefore)
    expect(tables.help_questions!.map((r) => r.id)).toEqual(['q-old-2'])
  })

  it('never throws: a table that cannot be reached is tried again the next day', async () => {
    const tables: Record<string, MemRow[]> = { help_questions: [], ops_alerts: [] }
    const db = memoryDb(tables, { fail: new Set(['help_questions']) })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await helpCleanup(db as unknown as SupabaseClient, NOW)).toBe('failed')
  })

  it('runs from the worker’s timer, after the queue check and the summary', () => {
    const index = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8')
    const scheduled = index.slice(index.indexOf('async scheduled('))
    expect(scheduled.indexOf('checkQueue(')).toBeGreaterThan(0)
    expect(scheduled.indexOf('helpCleanup(supabase)')).toBeGreaterThan(scheduled.indexOf('supportDaily(supabase, env)'))
  })
})
