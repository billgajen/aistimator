/**
 * T-200: "Ask Qolumns" asks back instead of guessing. A one-word or unclear
 * question gets one short line and two or three choices, each a question the
 * guide answers. That turn is not kept, so it does not count against the
 * day's limit.
 *
 * The model here is a function the test writes; the database is held in memory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ASK_CLARIFY_MAX,
  ASK_COPY,
  ASK_DAILY_LIMIT,
  ASK_SYSTEM_PROMPT,
  EMPTY_HELP_STATE,
  askActions,
  canBeRated,
  clarifyAnswer,
  finishAnswer,
  isKeptAnswer,
  isOneWord,
  likelyEntries,
  parseAskHead,
  type HelpState,
} from '@qolumns/shared'
import { memoryDb, type MemRow } from '../../../../packages/shared/src/testing/memory-db'
import { answerQuestion, askedToday, doneEvent, underAskLimit, type AskModel } from '@/lib/help/ask'
import { helpGuide } from '@/lib/help/guide'
import { dashboardPath } from '@/lib/help/state'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const CONVERSATION = '11111111-1111-4111-8111-111111111111'
const GUIDE = helpGuide()
const heading = (id: string) => GUIDE.entries.find((entry) => entry.id === id)!.question

function world(rows: MemRow[] = []) {
  const tables: Record<string, MemRow[]> = { tenants: [{ id: 'tnt_a', name: 'Harbour Painting' }], quotes: [], help_questions: rows }
  const db = memoryDb(tables)
  return { tables, supabase: db as unknown as SupabaseClient }
}
const STATE: HelpState = { ...EMPTY_HELP_STATE, plan: 'Free', services: [{ name: 'Room refresh', active: true }], region: 'US', currency: 'USD' }
/** A model that says what the test wrote, and counts how often it was asked */
function model(...pieces: string[]): AskModel & { asked: () => number } {
  let calls = 0
  const run = async function* () {
    calls += 1
    for (const piece of pieces) yield piece
  } as unknown as AskModel & { asked: () => number }
  run.asked = () => calls
  return run
}
const deps = (w: ReturnType<typeof world>, m: AskModel) => ({ supabase: w.supabase, admin: w.supabase, model: m, loadState: async (_s: unknown, _t: string, page: unknown) => ({ ...STATE, page: dashboardPath(page) }) })
const request = (question: string, over: Record<string, unknown> = {}) => ({ tenantId: 'tnt_a', userId: 'u-a', conversationId: CONVERSATION, question, page: '/app', ...over })

afterEach(() => vi.restoreAllMocks())

describe('a one-word question is asked back, not guessed at', () => {
  it('"WhatsApp" gets our one line and two or three of the guide’s own questions; the model is not asked', async () => {
    const w = world()
    const m = model('answered | | \nA guess.')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const pieces: string[] = []
    const result = await answerQuestion(request('WhatsApp'), deps(w, m), (piece) => pieces.push(piece))
    expect(m.asked()).toBe(0)
    expect(result.prompt).toBeNull()
    expect(pieces).toEqual([])
    expect(result.answer.outcome).toBe('clarify')
    expect(result.answer.text).toBe(ASK_COPY.clarify)
    // one short line
    expect(ASK_COPY.clarify.split('\n')).toHaveLength(1)
    expect(ASK_COPY.clarify.length).toBeLessThanOrEqual(70)
    const choices = result.answer.choices!
    expect(choices.length).toBeGreaterThanOrEqual(2)
    expect(choices.length).toBeLessThanOrEqual(3)
    // every choice is the heading of a guide entry (a question the guide answers), and is about what was typed
    expect(choices).toEqual(result.answer.entries.map(heading))
    expect(result.answer.entries).toEqual(likelyEntries(GUIDE, 'WhatsApp', ASK_CLARIFY_MAX).map((entry) => entry.id))
    for (const id of result.answer.entries) expect(`${heading(id)} ${GUIDE.entries.find((e) => e.id === id)!.body}`.toLowerCase()).toContain('whatsapp')
    // the browser is sent the line and the choices as buttons that ask; nothing to rate, nothing to open
    expect(doneEvent(result.id, result.answer)).toEqual({ t: 'done', id: null, outcome: 'clarify', text: ASK_COPY.clarify, actions: choices.map((label) => ({ kind: 'ask', label })), rate: false })
  })

  it('"pricing?", "Refund" and " billing " are one word; a sentence is not, and neither is nothing', () => {
    for (const one of ['WhatsApp', 'pricing?', ' billing ', 'Refund!', '"logo"', '???  services']) expect(isOneWord(one), one).toBe(true)
    for (const not of ['', '   ', '?', 'How do I add a service?', 'room scan', 'why not']) expect(isOneWord(not), not).toBe(false)
  })

  it('a word the guide does not know has nothing to choose between: the model is asked, as for any question', async () => {
    const w = world()
    const m = model('not_sure | | ')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(likelyEntries(GUIDE, 'Zxqvarn')).toEqual([])
    const result = await answerQuestion(request('Zxqvarn'), deps(w, m))
    expect(m.asked()).toBe(1)
    expect(result.answer).toMatchObject({ outcome: 'not_sure', text: ASK_COPY.notSure })
  })

  it('one word that follows an answer is a follow-up: it goes to the model with the conversation', async () => {
    const w = world([{ id: 'h-1', tenant_id: 'tnt_a', user_id: 'u-a', conversation_id: CONVERSATION, question: 'How do I add a service?', answer: 'Press "Add Service".', outcome: 'answered', created_at: new Date(Date.now() - 60_000).toISOString() }])
    const m = model('answered | services-add | \nOn the Services page.')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const result = await answerQuestion(request('Where?'), deps(w, m))
    expect(m.asked()).toBe(1)
    expect(result.prompt).toContain('THE CONVERSATION SO FAR')
    expect(result.answer.outcome).toBe('answered')
  })
})

describe('an unclear question: the model may ask back, and the choices are still ours', () => {
  it('the entries it names become the choices: their own headings, at most three, and only entries it was given', async () => {
    const w = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const pieces: string[] = []
    const m = model('clarify | services-add, made-up-entry, billing-plans, services-edit, link-copy-share | /app/services\nDid you mean something I am inventing here?')
    const result = await answerQuestion(request('I want to change the thing'), deps(w, m), (piece) => pieces.push(piece))
    expect(m.asked()).toBe(1)
    expect(result.answer).toEqual({ outcome: 'clarify', text: ASK_COPY.clarify, entries: ['services-add', 'billing-plans', 'services-edit'], pages: [], choices: [heading('services-add'), heading('billing-plans'), heading('services-edit')] })
    // nothing the model wrote is shown: no piece is passed on, and its sentence is nowhere in the answer
    expect(pieces).toEqual([])
    expect(JSON.stringify(doneEvent(result.id, result.answer))).not.toContain('inventing')
  })

  it('a first line with nothing after it is read the same way', async () => {
    const w = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const result = await answerQuestion(request('how does that work for me'), deps(w, model('clarify | services-add, billing-plans |')))
    expect(result.answer.outcome).toBe('clarify')
    expect(result.answer.choices).toEqual([heading('services-add'), heading('billing-plans')])
  })

  it('with fewer than two things it could mean it is "not sure" (our sentence, the team offered): never a guess, never one choice', async () => {
    const w = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // one entry named, and the question's own words match nothing in the guide
    const result = await answerQuestion(request('zxqvarn blorptic'), deps(w, model('clarify | services-add | \nMaybe this?')))
    expect(result.answer).toMatchObject({ outcome: 'not_sure', text: ASK_COPY.notSure, pages: [] })
    expect(doneEvent(result.id, result.answer).actions).toEqual([{ kind: 'team', label: ASK_COPY.actions.team }])
    // the pure rules say the same
    expect(clarifyAnswer([])).toBeNull()
    expect(clarifyAnswer(GUIDE.entries.slice(0, 1))).toBeNull()
    expect(clarifyAnswer([GUIDE.entries[0]!, GUIDE.entries[0]!])).toBeNull()
    expect(clarifyAnswer(GUIDE.entries.slice(0, 9))!.choices).toHaveLength(3)
    expect(finishAnswer({ outcome: 'clarify', entries: [], pages: [] }, 'A guess.')).toMatchObject({ outcome: 'not_sure', text: ASK_COPY.notSure })
  })

  it('the model is told when to ask back, and "clarify" is a first line we read', () => {
    expect(ASK_SYSTEM_PROMPT).toContain('The outcome is clarify, with the ids of the two or three guide entries it most likely means.')
    expect(ASK_SYSTEM_PROMPT).toContain('- outcome: one of answered, not_sure, not_offered, broken, team, declined, clarify')
    expect(ASK_SYSTEM_PROMPT).toContain('For not_sure, team, declined and clarify write only the first line.')
    // the rules are still numbered in order
    expect(ASK_SYSTEM_PROMPT.match(/^\d+\. /gm)!.map((n) => Number.parseInt(n, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(parseAskHead('clarify | services-add, services-edit |', GUIDE.entries)).toEqual({ outcome: 'clarify', entries: ['services-add', 'services-edit'], pages: [] })
  })
})

describe('asking back does not count against the day’s limit', () => {
  it('no row is written for it, so the count the limit reads does not move; an answer still counts', async () => {
    const w = world()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    for (const word of ['WhatsApp', 'billing', 'services', 'logo']) {
      const result = await answerQuestion(request(word), deps(w, model('answered | | \nA guess.')))
      expect(result.answer.outcome, word).toBe('clarify')
      expect(result.id).toBeNull()
      expect(isKeptAnswer(result.answer)).toBe(false)
    }
    await answerQuestion(request('I want to change the thing'), deps(w, model('clarify | services-add, services-edit |')))
    expect(w.tables.help_questions).toEqual([])
    expect(await askedToday(w.supabase, 'tnt_a')).toBe(0)
    // a choice, once pressed, is an ordinary question: answered, kept and counted
    const picked = await answerQuestion(request(heading('services-add')), deps(w, model('answered | services-add | /app/services\nPress "Add Service".')))
    expect(picked.answer.outcome).toBe('answered')
    expect(picked.id).not.toBeNull()
    expect(w.tables.help_questions!.map((row) => [row.question, row.outcome])).toEqual([[heading('services-add'), 'answered']])
  })

  it('a business at one below the limit is still under it after any number of questions asked back', async () => {
    const now = Date.now()
    const w = world(Array.from({ length: ASK_DAILY_LIMIT - 1 }, (_, i) => ({ id: `h-${i}`, tenant_id: 'tnt_a', conversation_id: CONVERSATION, question: 'q', outcome: 'answered', created_at: new Date(now - (i + 1) * 60_000).toISOString() })))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    // (these have earlier turns in the conversation, so the model is the one that asks back)
    for (let i = 0; i < 5; i += 1) await answerQuestion(request('that one'), deps(w, model('clarify | services-add, services-edit |')))
    expect(await askedToday(w.supabase, 'tnt_a')).toBe(ASK_DAILY_LIMIT - 1)
    expect(underAskLimit(await askedToday(w.supabase, 'tnt_a'))).toBe(true)
  })

  it('it is not a stored outcome: the table’s rule is unchanged (no migration), and it is never rated', () => {
    const table = read('supabase/migrations/00000000000048_help_questions.sql')
    expect(table).toContain("outcome IN ('answered', 'not_sure', 'not_offered', 'broken', 'team', 'declined', 'failed')")
    expect(canBeRated('clarify')).toBe(false)
    const ask = read('apps/web/src/lib/help/ask.ts')
    expect(ask).toContain('const id = isKeptAnswer(answer) ? await keepQuestion(')
  })
})

describe('in the panel', () => {
  it('each choice is a button that asks it as the next question; the other buttons are as they were', () => {
    const panel = read('apps/web/src/components/help/Ask.tsx')
    expect(panel).toContain('data-testid="ask-choices"')
    expect(panel).toContain('<button type="button" onClick={() => onAsk(choice.label)} disabled={busy} className={QUESTION_BUTTON} data-testid="ask-choice">')
    // a choice is 44 px tall like every other target in the panel
    expect(panel).toMatch(/const QUESTION_BUTTON = 'flex min-h-\[44px\] w-full /)
    expect(askActions({ outcome: 'clarify', pages: ['/app/services'], choices: ['One?', 'Two?', 'Three?', 'Four?'] }, { '/app/services': 'Services' })).toEqual([
      { kind: 'ask', label: 'One?' },
      { kind: 'ask', label: 'Two?' },
      { kind: 'ask', label: 'Three?' },
    ])
    expect(askActions({ outcome: 'answered', pages: ['/app/services'] }, { '/app/services': 'Services' })).toEqual([{ kind: 'open', href: '/app/services', label: 'Open Services' }])
  })
})
