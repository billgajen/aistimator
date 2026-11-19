/**
 * T-186: a quote the business made speaks to the business.
 *
 * The shared rules every screen uses (who is asked, the one story of a quote
 * screen, whose answer a line names, the certainty sentence, a question's
 * choices, an older line's detail), and the worker's side of them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  QUOTE_GROUP_STATUSES,
  QUOTE_TURN_COPY,
  allAnswered,
  anyMeasuredFromPhotos,
  approvalDetail,
  businessIsAsked,
  businessSources,
  capFlatRateGrade,
  certaintyLabel,
  certaintyReasons,
  certaintySentence,
  chosenChoice,
  computeEstimateGrade,
  findConfidenceLanguage,
  isMadeByBusiness,
  isTypedAnswer,
  lineLabelNow,
  lineSourceCodes,
  questionChoices,
  quoteGroupOf,
  quoteStory,
  quoteTurn,
  sourceForBusiness,
  type CertaintyReason,
  type LineSource,
  type QuantityProvenance,
  type QuoteStep,
} from '@qolumns/shared'

const NOW = { now: new Date('2026-11-19T12:00:00Z') }
const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

// ---------------------------------------------------------------------------
// 1. Who is asked
// ---------------------------------------------------------------------------

describe('T-186: a quote the business made asks the business', () => {
  it('who made a request is read from its own record', () => {
    expect(isMadeByBusiness({ type: 'app', userId: 'u1' })).toBe(true)
    for (const source of [{ type: 'widget' }, { type: 'whatsapp' }, {}, null, undefined, 'app']) expect(isMadeByBusiness(source)).toBe(false)
  })

  it('with open questions it is under "Needs you"; a customer’s quote in the same status waits for the customer', () => {
    expect(quoteGroupOf('awaiting_clarification', true)).toBe('needs_you')
    expect(quoteGroupOf('awaiting_clarification', false)).toBe('waiting')
    expect(quoteGroupOf('awaiting_clarification')).toBe('waiting')
    expect(businessIsAsked('awaiting_clarification', true)).toBe(true)
    expect(businessIsAsked('pending_review', true)).toBe(false)
    // no other status moves
    for (const [group, statuses] of Object.entries(QUOTE_GROUP_STATUSES)) {
      for (const status of statuses) if (status !== 'awaiting_clarification') expect(quoteGroupOf(status, true)).toBe(group)
    }
  })

  it('the wording never says a customer was asked, and the next step is to answer', () => {
    const turn = quoteTurn({ status: 'awaiting_clarification', customerName: 'Jordan Reyes', hasEmail: false, total: 750, madeByBusiness: true, openQuestions: 1 })
    expect(turn.group).toBe('needs_you')
    expect(turn.tone).toBe('attention')
    expect(turn.label).toBe('Needs your answer')
    expect(turn.detail).toBe('1 question to answer')
    expect(turn.action).toBe('give_answers')
    expect(turn.sentence).toBe('Answer the question below. The price is worked out again from your answer, then you can approve and send it.')
    expect(`${turn.label} ${turn.detail} ${turn.sentence}`).not.toMatch(/Waiting for|was asked|Jordan|customer/i)
    const two = quoteTurn({ status: 'awaiting_clarification', hasEmail: false, total: 750, madeByBusiness: true, openQuestions: 2 })
    expect(two.detail).toBe('2 questions to answer')
    expect(two.sentence).toMatch(/^Answer the questions below\./)
  })

  it('a customer’s quote reads as before', () => {
    const turn = quoteTurn({ status: 'awaiting_clarification', customerName: 'Jordan Reyes', hasEmail: true, total: 750 })
    expect(turn.label).toBe('Waiting for customer')
    expect(turn.sentence).toBe('Nothing for you to do. Jordan was asked for more details. The price comes once they answer.')
    expect(turn.action).toBeNull()
  })

  it('the worker uses the same rule: a business-made quote is held hidden, and no "New quote" email is sent about it', () => {
    const processor = src('quote-processor.ts')
    expect(processor).toContain('businessCreated: isMadeByBusiness(quoteRequest.source_json)')
    expect(processor).toContain('!isMadeByBusiness(quoteRequest.source_json) &&')
    // nothing is sent to anyone when a quote stops for its questions: the worker stores them and returns
    const gate = processor.slice(processor.indexOf("status: 'awaiting_clarification',"), processor.indexOf("} else if (qualityGateResult.action === 'require_review')"))
    expect(gate).toContain('return { success: true')
    expect(gate).not.toMatch(/send[A-Z]\w*\(|postmark|whatsapp/i)
  })
})

// ---------------------------------------------------------------------------
// 2. One story per screen
// ---------------------------------------------------------------------------

describe('T-186: the chip, the sentence, Progress and the main button are one result', () => {
  const steps = (s: QuoteStep[]) => s.map((x) => `${x.name}:${x.state}${x.note ? ` (${x.note})` : ''}`)

  it('the owner’s case: a quote made on site with a question to answer', () => {
    const story = quoteStory({ status: 'awaiting_clarification', total: 750, createdAt: '2026-11-19T09:00:00Z', madeByBusiness: true, openQuestions: 1 }, NOW)
    expect(story.turn.label).toBe('Needs your answer')
    expect(story.button).toBe('answer')
    expect(story.asksBusiness).toBe(true)
    expect(steps(story.steps)).toEqual(['Received:done', 'Approve and send:current (Answer the questions first)', 'Opened:later', 'Accepted:later'])
  })

  it('a customer’s quote that waits for the customer: nothing to press, and "Approve and send" is not the step now', () => {
    const story = quoteStory({ status: 'awaiting_clarification', total: 750, createdAt: '2026-11-19T09:00:00Z', customerName: 'Sam Carter' }, NOW)
    expect(story.turn.label).toBe('Waiting for customer')
    expect(story.button).toBeNull()
    expect(story.asksBusiness).toBe(false)
    expect(steps(story.steps)).toEqual(['Received:done', 'Approve and send:later (After the customer answers)', 'Opened:later', 'Accepted:later'])
  })

  it('every state: the button is the turn’s own next step, and Progress agrees with it', () => {
    const cases: Array<[Parameters<typeof quoteStory>[0], string | null, string]> = [
      [{ status: 'queued' }, 'wait', 'Approve and send:later (When the price is ready)'],
      [{ status: 'generating' }, 'wait', 'Approve and send:later (When the price is ready)'],
      [{ status: 'pending_review', total: 300 }, 'approve', 'Approve and send:current (Now)'],
      [{ status: 'pending_review', total: 0 }, 'add_price', 'Approve and send:current (It needs a price first)'],
      [{ status: 'pending_review', total: 0, held: true }, 'price_request', 'Approve and send:current (It needs a price first)'],
      [{ status: 'failed', total: 0 }, 'contact', 'Approve and send:later'],
      [{ status: 'sent', total: 300, sentAt: '2026-11-19T10:00:00Z', approvedAt: '2026-11-19T10:00:00Z' }, 'share', 'Approve and send:done'],
      [{ status: 'accepted', total: 300, sentAt: '2026-11-18T10:00:00Z', approvedAt: '2026-11-18T10:00:00Z', viewedAt: '2026-11-18T11:00:00Z', acceptedAt: '2026-11-19T10:00:00Z' }, 'share', 'Approve and send:done'],
      [{ status: 'declined', total: 300, sentAt: '2026-11-18T10:00:00Z', approvedAt: '2026-11-18T10:00:00Z', declinedAt: '2026-11-19T10:00:00Z' }, null, 'Approve and send:done'],
    ]
    for (const [input, button, second] of cases) {
      const story = quoteStory({ createdAt: '2026-11-18T09:00:00Z', ...input }, NOW)
      expect(story.button, input.status).toBe(button)
      expect(steps(story.steps)[1], input.status).toBe(second)
      // "Approve and send" is the step now exactly when the quote is with the business and not yet sent
      const approveIsNow = story.steps[1]!.state === 'current'
      expect(approveIsNow, input.status).toBe(['approve', 'add_price', 'price_request', 'answer'].includes(story.button ?? ''))
      // and the sentence never says "Nothing for you to do" beside a step that is the business's
      if (approveIsNow) expect(story.turn.sentence).not.toMatch(/Nothing for you to do/)
    }
  })

  it('at most one step is the step now, and it says so', () => {
    const sent = quoteStory({ status: 'sent', total: 300, createdAt: '2026-11-18T09:00:00Z', sentAt: '2026-11-19T10:00:00Z', approvedAt: '2026-11-19T10:00:00Z' }, NOW)
    expect(steps(sent.steps)).toEqual(['Received:done', 'Approve and send:done', 'Opened:current (Now)', 'Accepted:later'])
    const auto = quoteStory({ status: 'sent', total: 300, createdAt: '2026-11-18T09:00:00Z', sentAt: '2026-11-19T10:00:00Z' }, NOW)
    expect(steps(auto.steps)[1]).toBe('Approve and send:done (Sent automatically)')
  })
})

// ---------------------------------------------------------------------------
// 3. Whose answer
// ---------------------------------------------------------------------------

describe('T-186: an answer the business typed reads "Your answer"', () => {
  const own = { madeByBusiness: true }

  it('the same source, worded by who made the quote', () => {
    expect(sourceForBusiness({ source: 'answer' })).toBe("The customer's answer")
    expect(sourceForBusiness({ source: 'answer' }, own)).toBe('Your answer')
    expect(sourceForBusiness({ source: 'calculated' }, own)).toBe('Worked out from your answers')
    expect(sourceForBusiness({ source: 'details' }, own)).toBe('Estimated from the details you gave')
    // T-188: a line the product added from what was written says "From the notes", whoever wrote it
    expect(sourceForBusiness({ source: 'words' }, own)).toBe('From the notes')
    expect(sourceForBusiness({ source: 'choice' }, own)).toBe('Your choice')
  })

  it('on a quote the business made, no line names the customer; what was measured, scanned or fixed reads the same', () => {
    const all: LineSource[] = ['photos', 'label', 'answer', 'scan', 'details', 'calculated', 'fixed', 'words', 'choice']
    for (const source of all) expect(sourceForBusiness({ source }, own)).not.toMatch(/customer/i)
    for (const source of ['photos', 'label', 'scan', 'fixed'] as const) expect(sourceForBusiness({ source }, own)).toBe(sourceForBusiness({ source }))
  })

  it('every screen gets it from the one function: the notes, and the approval detail by the request’s own record', () => {
    const lines = [
      { label: 'Rooms  $375 × 2 rooms', amount: 750, source: 'answer' },
      { label: 'Call-out', amount: 60, source: 'fixed' },
    ]
    expect(businessSources(lines, undefined, own)).toEqual(['Your answer', 'Your fixed price'])
    expect(businessSources(lines)).toEqual(["The customer's answer", 'Your fixed price'])
    const detail = (requestSource: unknown) =>
      approvalDetail({ pricing: { currency: 'USD', subtotal: 810, taxAmount: 0, total: 810, breakdown: lines }, content: {}, mainServiceName: 'Painting', requestSource, photoCount: 2, currency: 'USD', locale: 'en-US' })
    expect(detail({ type: 'app' }).parts[0]!.lines.map((l) => l.source)).toEqual(['Your answer', 'Your fixed price'])
    expect(detail({ type: 'app' }).photosLine).toBe('2 photos with this job')
    expect(detail({ type: 'widget' }).parts[0]!.lines.map((l) => l.source)).toEqual(["The customer's answer", 'Your fixed price'])
    expect(detail({ type: 'widget' }).photosLine).toBe('2 photos from the customer')
  })
})

// ---------------------------------------------------------------------------
// 4. The certainty sentence says what is true
// ---------------------------------------------------------------------------

describe('T-186: the certainty sentence is built from why the price is not confirmed', () => {
  const q = (basis: QuantityProvenance['basis'], confidence = 0.7): QuantityProvenance => ({ signalKey: basis, basis, confidence })

  it('the cause: a typed quantity that is doubted was graded as a measurement, and read "measured from the photos"', () => {
    const doubted = computeEstimateGrade([q('doubted')])
    expect(doubted.grade).toBe('B')
    expect(doubted.reasons).toEqual(['doubted'])
    expect(doubted.description).toBe('A quantity that was typed in does not seem to match the photos or the description. Check it before you send the price.')
    expect(doubted.description).not.toMatch(/measured/i)
    expect(doubted.label).toBe('To check')
    // the worker enters it as what it is, and a price range as a price range
    const processor = src('quote-processor.ts')
    expect(processor).toContain("{ signalKey: 'stated_quantity_concern', basis: 'doubted', confidence: 0.7 }")
    expect(processor).toContain("basis: 'rate', confidence: 0.7")
    expect(processor).not.toContain("{ signalKey: 'stated_quantity_concern', basis: 'measured'")
    expect(processor).toContain('reasons: gradeResult.reasons ?? []')
  })

  it('no grade letter changed: the new reasons rank exactly as "measured" did in their place', () => {
    const sets: QuantityProvenance[][] = [
      [], [q('confirmed', 1)], [q('scanned', 1)], [q('measured')], [q('adjudicated')], [q('identified')], [q('measured', 0.4)], [q('envelope')], [q('defaulted', 0.2)],
      [q('confirmed', 1), q('measured')], [q('measured'), q('defaulted', 0.2)],
    ]
    const letter = (set: QuantityProvenance[]) => computeEstimateGrade(set).grade
    expect(sets.map(letter)).toEqual(['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C', 'B', 'C'])
    for (const basis of ['doubted', 'rate'] as const) {
      expect(letter([q(basis)])).toBe(letter([q('measured')]))
      expect(letter([q(basis), q('defaulted', 0.2)])).toBe(letter([q('measured'), q('defaulted', 0.2)]))
      expect(letter([q('confirmed', 1), q(basis)])).toBe(letter([q('confirmed', 1), q('measured')]))
    }
  })

  it('each real source has its own sentence', () => {
    const words = (set: QuantityProvenance[]) => computeEstimateGrade(set).description
    expect(words([])).toBe('Every quantity this price depends on was given or confirmed.')
    expect(words([q('confirmed', 1)])).toBe('Every quantity this price depends on was given or confirmed.')
    expect(words([q('scanned', 1)])).toBe('Every quantity this price depends on was given, confirmed or scanned on site.')
    expect(words([q('measured')])).toMatch(/measured from the photos, and the measurements agree/)
    expect(words([q('identified')])).toMatch(/read from a label in the photos/)
    expect(words([q('rate')])).toBe('One of your prices is set as a range, so the final figure can move within it.')
    expect(words([q('defaulted', 0.2)])).toMatch(/A quantity was not given/)
    expect(words([q('envelope')])).toMatch(/typical figures/)
    expect(words([q('measured', 0.4)])).toMatch(/did not show enough to measure well/)
    // only a real measurement says "measured from the photos"
    for (const basis of ['doubted', 'rate', 'defaulted', 'envelope', 'identified'] as const) expect(words([q(basis, basis === 'defaulted' ? 0.2 : 0.7)])).not.toMatch(/measured from the photos/)
  })

  it('the most important reason speaks first, each reason once', () => {
    expect(certaintyReasons([q('measured'), q('rate'), q('doubted'), q('measured')])).toEqual(['doubted', 'measured', 'rate'])
    expect(certaintyReasons([q('confirmed', 1), q('scanned', 1)])).toEqual([])
  })

  it('no sentence and no label uses a word the customer-language rules ban, or a dash', () => {
    const reasons: CertaintyReason[] = ['doubted', 'not_given', 'typical', 'measured_weak', 'measured', 'label', 'rate', 'site_visit']
    for (const reason of reasons) {
      const sentence = certaintySentence({ grade: 'B', reasons: [reason] })!
      expect(findConfidenceLanguage(sentence), reason).toEqual([])
      expect(sentence).not.toMatch(/[—–]/)
      expect(findConfidenceLanguage(certaintyLabel({ grade: 'B', reasons: [reason] })!), reason).toEqual([])
    }
    for (const grade of ['A', 'B', 'C']) expect(findConfidenceLanguage(certaintySentence({ grade, reasons: [] })!)).toEqual([])
  })

  it('a quote that carries its reasons is worded from them, whatever sentence was stored', () => {
    const stored = 'The quantities were measured from the photos, and the measurements agree. Confirm them before work starts.'
    expect(certaintySentence({ grade: 'B', description: stored, reasons: ['doubted'] })).toMatch(/typed in/)
    expect(certaintySentence({ grade: 'A', description: stored, reasons: [] })).toBe('Every quantity this price depends on was given or confirmed.')
  })

  it('an older quote: "measured from the photos" is not shown when none of its lines was measured', () => {
    const stored = { grade: 'B', label: 'Measured', description: 'The quantities were measured from the photos, and the measurements agree. Confirm them before work starts.' }
    const typed = anyMeasuredFromPhotos(lineSourceCodes([{ label: 'Rooms  $375 × 2 rooms', amount: 750, source: 'answer' }, { label: 'Call-out', amount: 60, source: 'fixed' }]))
    expect(typed).toBe(false)
    expect(certaintySentence(stored, { measuredOnQuote: typed })).toBe('Not every quantity behind this price is confirmed yet. Confirm them before work starts.')
    expect(certaintyLabel(stored, { measuredOnQuote: typed })).toBe('Not confirmed')
    // one that was measured keeps its sentence; one whose lines say nothing keeps it too (nothing is proved)
    const measured = anyMeasuredFromPhotos(lineSourceCodes([{ label: 'Walls', amount: 180, source: 'photos' }]))
    expect(certaintySentence(stored, { measuredOnQuote: measured })).toBe(stored.description)
    expect(anyMeasuredFromPhotos(lineSourceCodes([{ label: 'Walls', amount: 180 }]))).toBeUndefined()
    expect(certaintySentence(stored, { measuredOnQuote: undefined })).toBe(stored.description)
    // a quote priced before the source was stored on the line: its takeoff says how the line was arrived at
    const fromTakeoff = lineSourceCodes([{ label: 'Rooms  $375 x 2(Room)', amount: 750 }], [{ item: 'Rooms', amount: 750, method: 'Quantity provided by you' }])
    expect(fromTakeoff).toEqual(['answer'])
  })

  it('a fixed price with a site visit still recommended keeps its own sentence and reason', () => {
    const capped = capFlatRateGrade(computeEstimateGrade([]), { priceDependsOnJobFacts: false, siteVisitRecommended: true })
    expect(capped.grade).toBe('B')
    expect(capped.reasons).toEqual(['site_visit'])
    expect(certaintySentence(capped)).toMatch(/^Standard price from your rates\./)
  })
})

// ---------------------------------------------------------------------------
// 5. A question's choices
// ---------------------------------------------------------------------------

describe('T-186: a question with clear choices is answered by pressing one', () => {
  it('options become buttons, with typing only behind "Other"', () => {
    const { choices, otherLabel } = questionChoices({ options: ['Keep it', 'Remove it'] })
    expect(choices).toEqual([{ label: 'Keep it', value: 'Keep it' }, { label: 'Remove it', value: 'Remove it' }])
    expect(otherLabel).toBe(QUOTE_TURN_COPY.questions.other)
    expect(isTypedAnswer(choices, undefined)).toBe(false) // nothing pressed yet: no text box
    expect(isTypedAnswer(choices, 'Keep it')).toBe(false)
    expect(chosenChoice(choices, 'Keep it')?.value).toBe('Keep it')
    expect(isTypedAnswer(choices, '')).toBe(true) // "Other" pressed
    expect(isTypedAnswer(choices, 'Half of it')).toBe(true)
  })

  it('a figure to confirm is one press ("Yes, 4"), with any other value behind "Other"', () => {
    const { choices, otherLabel, numeric } = questionChoices({ type: 'confirm_value', aiValue: 4 })
    expect(choices).toEqual([{ label: 'Yes, 4', value: '4' }])
    expect(otherLabel).toBe('Other')
    expect(numeric).toBe(true)
    // with allowed values, the others are buttons too, and the confirmed one is not repeated
    expect(questionChoices({ type: 'confirm_value', aiValue: '3 ton', options: ['2 ton', '3 ton', '4 ton'] }).choices.map((c) => c.label)).toEqual(['Yes, 3 ton', '2 ton', '4 ton'])
  })

  it('a question with no choices is answered in words, with no "Other" button', () => {
    const { choices, otherLabel } = questionChoices({ options: [] })
    expect(choices).toEqual([])
    expect(otherLabel).toBeNull()
    expect(isTypedAnswer(choices, undefined)).toBe(true)
  })

  it('every question needs an answer before it can be sent', () => {
    const questions = [{ id: 'a' }, { id: 'b' }]
    expect(allAnswered(questions, { a: 'Keep it' })).toBe(false)
    expect(allAnswered(questions, { a: 'Keep it', b: '   ' })).toBe(false)
    expect(allAnswered(questions, { a: 'Keep it', b: '12' })).toBe(true)
  })

  it('no question’s text is known to the code: the choices are the question’s own', () => {
    const source = readFileSync(join(__dirname, '../../../../packages/shared/src/question-choices.ts'), 'utf8')
    expect(source).not.toMatch(/keep|remove/i)
  })
})

// ---------------------------------------------------------------------------
// 6. An older line's detail
// ---------------------------------------------------------------------------

describe('T-186: a line priced before T-185 shows its detail the new way', () => {
  it('the stored label is printed through one function', () => {
    expect(lineLabelNow('Rooms  $375 x 2(Room)')).toBe('Rooms  $375 × 2 rooms')
    expect(lineLabelNow('Walls  £18 x 34.6(Sqm)')).toBe('Walls  £18 × 34.6 sqm')
    // a new label, a fixed price and a line the business typed come back as they are
    for (const label of ['Rooms  $375 × 2 rooms', 'Call-out fee', 'Extra coat x 2']) expect(lineLabelNow(label)).toBe(label)
  })

  it('the approval page and the review email print it that way (they are one result)', () => {
    const detail = approvalDetail({
      pricing: { currency: 'USD', subtotal: 750, taxAmount: 0, total: 750, breakdown: [{ label: 'Rooms  $375 x 2(Room)', amount: 750 }] },
      content: { takeoff: [{ item: 'Rooms', amount: 750, method: 'Quantity provided by you' }] },
      mainServiceName: 'Painting',
      photoCount: 0,
      currency: 'USD',
      locale: 'en-US',
    })
    expect(detail.parts[0]!.lines).toEqual([{ label: 'Rooms  $375 × 2 rooms', amount: '$750.00', source: "The customer's answer" }])
  })
})
