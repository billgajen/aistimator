/**
 * T-186: a quote made on site speaks to the business.
 *
 * The owner's test (a quote made in the app, with a question to answer):
 * the screen said "Waiting for customer", asked the business a question,
 * and Progress said "Approve and send: Now". Here: the list, the chip, the
 * sentence, Progress and the main button of that quote, which must agree,
 * and what the screen's source must hold. How it looks on a phone is the
 * owner's test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AppQuoteView, QuoteListItem } from '@qolumns/shared'
import { groupQuotes, listGroupOf, rowWords } from '../lib/quote-list'
import { mainAction } from '../lib/price'
import { storyOfQuote, turnOfListItem } from '../lib/status'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')
const NOW = { now: new Date('2026-11-19T12:00:00Z') }

const view = (over: Partial<AppQuoteView> = {}): AppQuoteView => ({
  id: 'qte_1',
  status: 'awaiting_clarification',
  businessName: 'Business A',
  serviceName: 'Service A',
  customerName: 'Jordan Reyes',
  createdAt: '2026-11-19T09:00:00Z',
  pricing: { total: 750, currency: 'USD' },
  takeoff: [],
  questions: [],
  ...over,
})
const QUESTION = { id: 'cq_1', question: 'The photos show three rooms. What should we allow for?', options: ['2', '3'] }

const item = (over: Partial<QuoteListItem>): QuoteListItem => ({
  quoteId: 'qte_1',
  serviceName: 'Service A',
  customerName: 'Jordan Reyes',
  customerEmail: '',
  status: 'awaiting_clarification',
  createdAt: '2026-11-19T09:00:00Z',
  sentAt: null,
  viewedAt: null,
  acceptedAt: null,
  paidAt: null,
  total: 750,
  currency: 'USD',
  ...over,
})

describe('T-186: the quote the owner made on site', () => {
  const quote = view({ madeByBusiness: true, questions: [QUESTION] })
  const story = storyOfQuote(quote, NOW)

  it('the chip, the sentence, Progress and the main button tell one story: it needs the business’s answer', () => {
    expect(story.turn.label).toBe('Needs your answer')
    expect(story.turn.group).toBe('needs_you')
    expect(story.turn.sentence).toBe('Answer the question below. The price is worked out again from your answer, then you can approve and send it.')
    expect(story.steps.map((s) => `${s.name}:${s.state}:${s.note ?? ''}`)).toEqual([
      'Received:done:',
      'Approve and send:current:Answer the questions first',
      'Opened:later:',
      'Accepted:later:',
    ])
    expect(mainAction(quote)).toBe('confirm')
    expect(story.asksBusiness).toBe(true)
    // none of it says a customer is being waited for
    expect(`${story.turn.label} ${story.turn.sentence}`).not.toMatch(/Waiting for|was asked|Jordan/)
  })

  it('once answered and priced: "Approve and send" is the step now, and the button approves', () => {
    const priced = view({ status: 'pending_review', madeByBusiness: true })
    const after = storyOfQuote(priced, NOW)
    expect(after.turn.label).toBe('Needs your approval')
    expect(after.steps[1]).toMatchObject({ name: 'Approve and send', state: 'current', note: 'Now' })
    expect(mainAction(priced)).toBe('send')
  })

  it('in the list it is under "Needs you", with how many questions as its reason', () => {
    const own = item({ madeByBusiness: true, openQuestions: 1 })
    expect(listGroupOf(own)).toBe('needs_you')
    expect(turnOfListItem(own, NOW).label).toBe('Needs your answer')
    expect(rowWords(own, NOW)).toMatchObject({ state: 'Needs your answer', detail: '1 question to answer', total: '$750.00' })
    expect(groupQuotes([own]).map((g) => g.key)).toEqual(['needs_you'])
  })
})

describe('T-186: a customer’s quote that waits for the customer', () => {
  const quote = view() // the server sends no questions: the customer was asked

  it('the screen asks the business nothing and offers no main button', () => {
    const story = storyOfQuote(quote, NOW)
    expect(story.turn.label).toBe('Waiting for customer')
    expect(story.turn.sentence).toBe('Nothing for you to do. Jordan was asked for more details. The price comes once they answer.')
    expect(story.asksBusiness).toBe(false)
    expect(mainAction(quote)).toBeNull()
    // Progress does not say the approval is the step now
    expect(story.steps[1]).toMatchObject({ name: 'Approve and send', state: 'later', note: 'After the customer answers' })
    expect(story.steps.some((s) => s.state === 'current')).toBe(false)
  })

  it('in the list it stays under "Waiting for customer"', () => {
    expect(listGroupOf(item({}))).toBe('waiting')
    expect(listGroupOf(item({ madeByBusiness: false, openQuestions: 0 }))).toBe('waiting')
  })
})

describe('T-186: a server from before this ticket', () => {
  it('does not say who made the quote, and always sent the questions: they are still answered here', () => {
    const old = view({ questions: [QUESTION] }) // no madeByBusiness
    expect(storyOfQuote(old, NOW).asksBusiness).toBe(true)
    expect(mainAction(old)).toBe('confirm')
  })
})

describe('T-186: what the quote screen’s source must hold', () => {
  const screen = read('app/quote/[id].tsx')
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '')

  it('one story: the chip, the sentence, Progress and the main button all come from storyOfQuote', () => {
    expect(screen).toContain('const story = storyOfQuote(quote)')
    expect(screen).toContain('const turn = story.turn')
    expect(screen).toContain('const steps = story.steps')
    expect(read('src/lib/price.ts')).toContain('const button = storyOfQuote(q).button')
    // nothing on the screen works a step or a status out for itself
    expect(code).not.toMatch(/quoteSteps\(|quoteTurn\(|quoteTracker\(/)
    expect(code).not.toMatch(/status === 'awaiting_clarification'/)
    // "Now" under a step is the story's own line, not typed here
    expect(code).not.toMatch(/>Now</)
  })

  it('the questions card shows only when the business is the one asked, and no longer says "Confirm on site"', () => {
    expect(screen).toContain('{story.asksBusiness && quote.questions.length > 0 ? (')
    expect(code).not.toContain('Confirm on site')
    expect(code).not.toContain('Confirm and reprice')
    expect(screen).toContain('QUOTE_TURN_COPY.questions.title(quote.questions.length)')
    expect(screen).toContain('title={QUOTE_TURN_COPY.pageButtons.giveAnswers}')
  })

  it('a question’s choices are buttons from the shared rule; typing is behind "Other"', () => {
    expect(screen).toContain('const { choices, otherLabel, numeric } = questionChoices(q)')
    expect(screen).toContain('const typed = isTypedAnswer(choices, answer)')
    // (T-188: the questions are drawn by one component, for the business's own and for the customer's)
    expect(screen).toContain("onChange={(v) => onAnswer(q.id, v === OTHER ? '' : v)}")
    expect(screen).toContain('{typed ? (')
    // nothing is filled in before the business presses or types, and "Other" itself is never sent
    expect(code).not.toContain('String(q.aiValue)')
    expect(screen).toContain("answer: (answers[q.id] ?? '').trim()")
    expect(screen).toContain('disabled={!answered}')
  })

  it('the certainty sentence is the server’s own; each line’s note is the server’s alone', () => {
    expect(screen).toContain('quote.pricing.certainty !== undefined ? quote.pricing.certainty : certaintySentence(quote.pricing.estimate)')
    expect(screen).toContain("const note = [detail, line.source].filter(Boolean).join(' · ')")
    // the app words no source itself
    for (const typed of ['Your answer', "The customer's answer", 'The customer’s answer', 'Measured from photos']) expect(code).not.toContain(typed)
  })
})
