/**
 * T-188 in the app: a question's choices are the worker's own, an answer can
 * carry a note, and the business can answer for the customer. The rules are
 * the shared ones; here is what the screen's source must hold. How it looks
 * on a phone is the owner's test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { allAnswered, questionChoices, type AppQuoteView } from '@qolumns/shared'
import { mainAction } from '../lib/price'
import { storyOfQuote } from '../lib/status'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')
const screen = read('app/quote/[id].tsx')
const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')

const view = (over: Partial<AppQuoteView> = {}): AppQuoteView => ({
  id: 'qte_1',
  status: 'awaiting_clarification',
  businessName: 'Business A',
  serviceName: 'Service A',
  customerName: 'Sam Carter',
  createdAt: '2026-11-19T09:00:00Z',
  pricing: { total: 750, currency: 'USD' },
  takeoff: [],
  questions: [],
  ...over,
})
const QUESTION = { id: 'cq_1', question: 'The photos show stickers, not a covering. Keep Covering removal?', choices: [{ label: 'Keep Covering removal', value: 'true' }, { label: 'No Covering removal', value: 'No' }], closed: true }

describe('T-188: the choices the worker built', () => {
  it('are the buttons, with no "Other" when they are every possible answer', () => {
    const drawn = questionChoices(QUESTION)
    expect(drawn.choices.map((c) => c.label)).toEqual(['Keep Covering removal', 'No Covering removal'])
    expect(drawn.otherLabel).toBeNull()
    // the value sent is the choice's own, not its words
    expect(drawn.choices.map((c) => c.value)).toEqual(['true', 'No'])
    expect(screen).toContain('const { choices, otherLabel, numeric } = questionChoices(q)')
  })
})

describe('T-188: an optional note with each answer', () => {
  it('is under the choices, is not needed to send, and goes with its answer only when written', () => {
    expect(screen).toContain('<Field label={QUOTE_TURN_COPY.questions.noteLabel}')
    expect(screen).toContain('{QUOTE_TURN_COPY.questions.noteHint}')
    expect(screen).toContain('v.slice(0, ANSWER_NOTE_MAX)')
    expect(screen).toContain("return { questionId: q.id, answer: (answers[q.id] ?? '').trim(), ...(note && { note }) }")
    expect(allAnswered([{ id: 'cq_1' }], { cq_1: 'No' })).toBe(true)
    expect(code.indexOf('<Rows')).toBeLessThan(code.indexOf('QUOTE_TURN_COPY.questions.noteLabel'))
    expect(read('src/lib/api.ts')).toContain('answers: Array<{ questionId: string; answer: string; note?: string }>')
    // its words are the shared ones
    expect(code).not.toMatch(/Why \(for your records\)/)
  })
})

describe('T-188: answering for the customer', () => {
  const waiting = view({ customerQuestions: [QUESTION] })

  it('the screen still says the customer was asked, and has no main button', () => {
    const story = storyOfQuote(waiting)
    expect(story.turn.label).toBe('Waiting for customer')
    expect(story.asksBusiness).toBe(false)
    expect(mainAction(waiting)).toBeNull()
  })

  it('a quiet link opens the same questions, and its own button sends them', () => {
    expect(screen).toContain('{!story.asksBusiness && customerQuestions.length > 0 ? (')
    expect(screen).toContain('<LinkRow title={QUOTE_TURN_COPY.questions.answerForCustomer}')
    expect(screen).toContain('<Questions asked={customerQuestions}')
    expect(screen).toContain('onPress={() => sendAnswers(customerQuestions)}')
    expect(screen).toContain('disabled={!allAnswered(customerQuestions, answers)}')
    // one component draws the questions, for the business's own and for the customer's
    expect(code.match(/<Questions asked=/g)).toHaveLength(2)
    expect(code).not.toMatch(/Answer for the customer/)
  })

  it('a server from before this ticket sends no customer questions: no link, nothing breaks', () => {
    expect(screen).toContain('const customerQuestions = quote.customerQuestions ?? []')
    expect(mainAction(view())).toBeNull()
  })
})
