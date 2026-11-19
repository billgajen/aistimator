/**
 * T-188: what the web side does with a question's choices, the note that goes
 * with an answer, a line's source on the dashboard, and answering for the
 * customer; and the three small site changes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { QUOTE_TURN_COPY } from '@qolumns/shared'
import { appQuoteView, type AppQuoteRow } from '@/lib/app-quote-view'
import { quoteUnderstanding } from '@/lib/quote-understanding'
import { HERO } from '@/lib/marketing/home-copy'

const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const request = { description: null, answers: [], postcode: null, address: null, quantity: null }

const QUESTION = {
  id: 'cq_1',
  targetSignalKey: 'has_covering',
  question: 'The photos show stickers, not a covering. Keep Covering removal?',
  choices: [{ label: 'Keep Covering removal', value: 'true' }, { label: 'No Covering removal', value: 'No' }],
  closed: true,
}
const row = (over: Partial<AppQuoteRow> = {}): AppQuoteRow => ({
  id: 'qte_1',
  status: 'awaiting_clarification',
  created_at: '2026-11-19T10:00:00Z',
  customer_json: { name: 'Dana Whitfield' },
  pricing_json: {
    currency: 'USD',
    subtotal: 1180,
    taxAmount: 0,
    total: 1180,
    breakdown: [
      { label: 'Rooms  $375 × 2 rooms', amount: 750, source: 'answer' },
      { label: 'Covering removal', amount: 180, source: 'answer' },
      { label: 'Heavy prep', amount: 250, source: 'seen' },
    ],
  },
  content_json: {},
  clarification_questions_json: [QUESTION],
  ...over,
})
const view = (requestSource: unknown, over: Partial<AppQuoteRow> = {}) => appQuoteView({ quote: row(over), serviceName: 'Service A', businessName: 'Business A', request, photos: [], requestSource })

describe('T-188: a question reaches the screen with its choices, and never with the key it fills', () => {
  it('a quote the business made: the question, its choices, and that they are every possible answer', () => {
    const v = view({ type: 'app' })
    expect(v.questions).toEqual([{ id: 'cq_1', question: QUESTION.question, choices: QUESTION.choices, closed: true }])
    expect(v.customerQuestions).toBeUndefined()
    expect(JSON.stringify(v.questions)).not.toContain('has_covering')
  })

  it('a customer’s request that waits for its customer: the same questions travel as the customer’s, for the business to answer for them', () => {
    const v = view({ type: 'widget' })
    expect(v.questions).toEqual([])
    expect(v.customerQuestions).toEqual([{ id: 'cq_1', question: QUESTION.question, choices: QUESTION.choices, closed: true }])
    // once answered and priced, there is nothing to answer for anyone
    expect(view({ type: 'widget' }, { status: 'pending_review' }).customerQuestions).toBeUndefined()
  })

  it('a line the product added says so in the app’s view, by the one shared function', () => {
    expect(view({ type: 'app' }).lines?.map((l) => l.source)).toEqual(['Your answer', 'Your answer', 'From the photos'])
    expect(view({ type: 'widget' }).lines?.map((l) => l.source)).toEqual(["The customer's answer", "The customer's answer", 'From the photos'])
  })

  it('the customer’s own question page draws the choices as rows to tap, with a box only where they are not every answer', () => {
    const page = code('app/q/[quoteId]/clarify/page.tsx')
    expect(page).toContain('{q.choices && q.choices.length > 0 ? (')
    expect(page).toContain('onClick={() => setAnswers(prev => ({ ...prev, [q.id]: choice.value }))}')
    expect(page).toContain('{!q.closed && (')
    expect(page).toContain("inputMode={q.answerKind === 'number' ? 'decimal' : 'text'}")
    // the dashboard's card and the app draw them by the shared rule
    expect(code('components/quotes/BusinessQuestions.tsx')).toContain('questionChoices(q)')
  })
})

describe('T-188: "Why (for your records)"', () => {
  it('the words', () => {
    expect(QUOTE_TURN_COPY.questions.noteLabel).toBe('Why (for your records)')
    expect(QUOTE_TURN_COPY.questions.noteHint).toBe('Optional. Only you see it. It does not change the price.')
  })

  it('the business’s answer route keeps it with the answer; a customer’s answer route keeps the question and the answer only', () => {
    const route = code('app/api/app/quotes/[quoteId]/answers/route.ts')
    expect(route).toContain('const note = answerNote(a.note)')
    expect(route).toContain('return { questionId: a.questionId, answer: a.answer.trim(), ...(note && { note }) }')
    const customer = code('app/api/public/quotes/[quoteId]/clarify/route.ts')
    expect(customer).toContain('.map((a) => ({ questionId: a.questionId, answer: a.answer })),')
    expect(customer).not.toMatch(/\bnote\b/)
  })

  it('the card has the note under each question’s choices, and sends it only when something was written', () => {
    const card = code('components/quotes/BusinessQuestions.tsx')
    expect(card).toContain('{C.noteLabel}')
    expect(card).toContain('{C.noteHint}')
    expect(card).toContain('maxLength={ANSWER_NOTE_MAX}')
    expect(card).toContain("return { questionId: q.id, answer: (answers[q.id] ?? '').trim(), ...(note && { note }) }")
    // the answer can be sent with no note: only the answers are required
    expect(card).toContain('disabled={saving || !allAnswered(questions, answers)}')
    expect(card.indexOf('data-testid="question-choice"')).toBeLessThan(card.indexOf('data-testid="question-note"'))
  })

  it('the dashboard quote page shows it beside the answer, with the words of the choice that was pressed', () => {
    const understood = quoteUnderstanding({
      photoCount: 2,
      signals: null,
      content: {},
      pricing: { total: 1000, breakdown: [] },
      questions: [QUESTION],
      answers: [{ questionId: 'cq_1', answer: 'No', note: '  They are vinyl stickers.   She will peel them herself. ' }],
      expectedSignals: [],
      checker: null,
      madeByBusiness: true,
    })
    expect(understood.asked).toEqual([{ question: QUESTION.question, answer: 'No Covering removal', note: 'They are vinyl stickers. She will peel them herself.' }])
    // with no note there is no line for one
    const plain = quoteUnderstanding({ photoCount: 0, signals: null, content: {}, pricing: {}, questions: [QUESTION], answers: [{ questionId: 'cq_1', answer: 'true' }], expectedSignals: [], checker: null })
    expect(plain.asked).toEqual([{ question: QUESTION.question, answer: 'Keep Covering removal' }])
    const panel = code('components/quotes/UnderstoodPanel.tsx')
    expect(panel).toContain('{q.note ? (')
    expect(panel).toContain('{QUOTE_TURN_COPY.questions.noteShown}: {q.note}')
  })

  it('it never reaches a customer: their quote data carries no answers, and what is read from an answer is its value', () => {
    const route = code('app/api/public/quotes/[quoteId]/route.ts')
    expect(route).not.toMatch(/clarificationAnswers|answers: quote\.clarification_answers_json,?\s*\n\s*\}/)
    expect(route).toContain('customerReadLines({')
    const read = code('lib/customer-read.ts')
    expect(read).not.toMatch(/\.note\b/)
  })
})

describe('T-188: the dashboard quote page', () => {
  const page = code('app/(dashboard)/app/quotes/[quoteId]/page.tsx')

  it('each price line says where it came from, by the function the app, the approval page and the email use', () => {
    expect(page).toContain('const lineNotes = businessSources(priceLines, takeoff, { madeByBusiness })')
    expect(page).toContain('<LineSourceNote note={lineNotes[index]} />')
    expect(page).toContain('<LineSourceNote note={businessSources(section.lines, section.main ? takeoff : undefined, { madeByBusiness })[index]} />')
    // one function, four places
    expect(src('lib/app-quote-view.ts')).toContain('businessSources(list, takeoff, { madeByBusiness })')
    expect(readFileSync(join(__dirname, '../../../../packages/shared/src/approval-detail.ts'), 'utf8')).toContain('businessSources(split.lines, takeoff, { madeByBusiness })')
    // and no source words are typed on the page
    expect(page).not.toMatch(/From the photos|From the notes|Your fixed price|Your answer/)
  })

  it('"Answer for the customer": a quiet link on a request that waits for the customer, opening the same card', () => {
    expect(QUOTE_TURN_COPY.questions.answerForCustomer).toBe('Answer for the customer')
    expect(page).toContain('{customerQuestions.length > 0 && !story.asksBusiness && (')
    expect(page).toContain('data-testid="answer-for-customer"')
    expect(page).toContain('{QUOTE_TURN_COPY.questions.answerForCustomer}')
    expect(page).toMatch(/<BusinessQuestions\s+forCustomer\s+quoteId=\{quote\.id\}\s+questions=\{customerQuestions\}/)
    // a link, not a button that competes with the page's next step
    expect(page).toMatch(/className="inline-flex min-h-\[44px\] items-center text-sm font-semibold text-primary underline[^"]*"\s+data-testid="answer-for-customer"/)
    const api = code('app/api/quotes/[quoteId]/route.ts')
    expect(api).toContain('quote.status === QUESTIONS_OPEN_STATUS && !isMadeByBusiness(requestRow?.source_json)')
    // the page still says the customer was asked: the story is unchanged
    const card = code('components/quotes/BusinessQuestions.tsx')
    expect(card).toContain('{forCustomer ? C.forCustomerTitle(questions.length) : C.title(questions.length)}')
  })
})

describe('T-188: three small things on the site', () => {
  it('the hero’s small line no longer says "small to corporate"', () => {
    expect(HERO.smallLine).toBe('For any business that quotes for its work. No website? Use your quote link.')
  })

  it('"Add it anywhere": the second row is centred, and every way has one title layout (title, mark, words)', () => {
    const css = src('app/globals.css')
    expect(css).toContain('.add-it { grid-template-columns: repeat(6, minmax(0, 1fr));')
    expect(css).toContain('.add-it-item { grid-column: span 2; grid-row: span 2; grid-template-rows: subgrid; gap: 1.25rem; }')
    expect(css).toContain('.add-it-next-first { grid-column: 2 / span 2; }')
    const add = code('components/marketing/home/AddItAnywhere.tsx')
    expect(add.match(/add-it-next-first/g)).toHaveLength(1)
    // one <Title> draws all five, and the mark has a line of its own in it
    expect(add.match(/<Title /g)).toHaveLength(5)
    expect(add).toMatch(/<h3 className="font-display text-lg font-bold text-text-primary">\{title\}<\/h3>\s*\{soon \? \(\s*<p className="mt-1\.5 leading-none">\s*<Soon of=\{soon\} \/>/)
  })

  it('the slow test: one search of the repository, not eight', () => {
    const test = src('__tests__/rename-qolumns.test.ts')
    expect(test).toContain('const hits = filesWithAny(oldNames).filter((f) => !isHistory(f))')
    expect(test).toContain("execSync(`git grep --untracked -l -F ${texts.map((text) => `-e \"${text}\"`).join(' ')}`")
    // no longer limit was added
    expect(test).not.toMatch(/\}, \d{4,}\)|timeout: \d/)
  })
})
