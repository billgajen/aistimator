/**
 * T-185: the shared rules behind the app's polish, and the worker's own two
 * changes (the line detail the engine writes, and the "New quote" email).
 */
import { describe, it, expect } from 'vitest'
import {
  businessSources,
  certaintySentence,
  dropStaleLabelMath,
  findConfidenceLanguage,
  computeEstimateGrade,
  lineDetail,
  lineLabelParts,
  PRODUCT_NAME,
  quantityLineLabel,
  quoteSteps,
  splitLabelMath,
  unitWords,
  type ExtractedSignalsV2,
  type WorkStepConfig,
} from '@qolumns/shared'
import { calculatePricingWithTrace, type PricingRules, type TaxConfig } from '../pricing/rules-engine'
import type { ExtractedSignals } from '../ai/signals'
import { businessNotificationEmail, customerQuoteEmail } from '../email/templates'

// ---------------------------------------------------------------------------
// 1. The steps, by name
// ---------------------------------------------------------------------------

describe('T-185: the progress steps are named, and one of them is current', () => {
  const NOW = { now: new Date('2026-11-19T12:00:00Z') }
  const names = (s: ReturnType<typeof quoteSteps>) => s.map((x) => `${x.name}:${x.state}`)

  it('a quote that needs approval: "Approve and send" is the current step', () => {
    const steps = quoteSteps({ status: 'pending_review', total: 300, createdAt: '2026-11-19T09:00:00Z' }, NOW)
    expect(names(steps)).toEqual(['Received:done', 'Approve and send:current', 'Opened:later', 'Accepted:later'])
    expect(steps[0]!.date).toBeTruthy()
    expect(steps[1]!.date).toBeNull()
  })

  it('approved and sent: "Opened" is current; opened: "Accepted" is current', () => {
    const sent = quoteSteps({ status: 'sent', total: 300, createdAt: '2026-11-18T09:00:00Z', approvedAt: '2026-11-18T10:00:00Z', sentAt: '2026-11-18T10:00:00Z' }, NOW)
    expect(names(sent)).toEqual(['Received:done', 'Approve and send:done', 'Opened:current', 'Accepted:later'])
    expect(sent[1]!.date).toBeTruthy()
    expect(sent[1]!.note).toBeNull()
    const opened = quoteSteps({ status: 'viewed', total: 300, createdAt: '2026-11-18T09:00:00Z', approvedAt: '2026-11-18T10:00:00Z', sentAt: '2026-11-18T10:00:00Z', viewedAt: '2026-11-19T08:00:00Z' }, NOW)
    expect(names(opened)).toEqual(['Received:done', 'Approve and send:done', 'Opened:done', 'Accepted:current'])
  })

  it('accepted: every step is done, each with its date; paid is a note', () => {
    const steps = quoteSteps({ status: 'paid', total: 300, createdAt: '2026-11-16T09:00:00Z', approvedAt: '2026-11-16T10:00:00Z', sentAt: '2026-11-16T10:00:00Z', viewedAt: '2026-11-17T08:00:00Z', acceptedAt: '2026-11-18T08:00:00Z', paidAt: '2026-11-19T08:00:00Z' }, NOW)
    expect(names(steps)).toEqual(['Received:done', 'Approve and send:done', 'Opened:done', 'Accepted:done'])
    expect(steps.every((s) => s.date)).toBe(true)
    expect(steps[3]!.note).toMatch(/^Paid /)
  })

  it('a quote sent with nobody approving it says so under the step, not as its name', () => {
    const steps = quoteSteps({ status: 'sent', total: 300, createdAt: '2026-11-18T09:00:00Z', sentAt: '2026-11-18T09:01:00Z' }, NOW)
    expect(steps[1]).toMatchObject({ name: 'Approve and send', state: 'done', note: 'Sent automatically' })
  })

  it('a request with no price yet, or held at the plan limit, still has "Approve and send" as current', () => {
    for (const input of [{ status: 'pending_review', total: 0 }, { status: 'pending_review', total: 0, held: true }]) {
      expect(names(quoteSteps({ ...input, createdAt: '2026-11-19T09:00:00Z' }, NOW))[1]).toBe('Approve and send:current')
    }
    // T-186: a request that could not be priced is not waiting for an approval, so the step stays ahead
    expect(names(quoteSteps({ status: 'failed', total: 0, createdAt: '2026-11-19T09:00:00Z' }, NOW))[1]).toBe('Approve and send:later')
  })

  it('declined or expired: the last step says so and nothing is current', () => {
    const declined = quoteSteps({ status: 'declined', total: 300, createdAt: '2026-11-16T09:00:00Z', approvedAt: '2026-11-16T10:00:00Z', sentAt: '2026-11-16T10:00:00Z', declinedAt: '2026-11-18T10:00:00Z' }, NOW)
    expect(names(declined)).toEqual(['Received:done', 'Approve and send:done', 'Opened:later', 'Declined:ended'])
    const expired = quoteSteps({ status: 'expired', total: 300, createdAt: '2026-10-16T09:00:00Z', sentAt: '2026-10-16T10:00:00Z', expiresAt: '2026-11-15T10:00:00Z' }, NOW)
    expect(names(expired)[3]).toBe('Expired:ended')
    expect(names(expired).some((n) => n.endsWith(':current'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. The certainty sentence
// ---------------------------------------------------------------------------

describe('T-185: how sure the price is, in plain words with no banned word', () => {
  const grades = ['A', 'B', 'C'] as const

  it('each level’s sentence passes the customer-language rules and has no dash', () => {
    for (const grade of grades) {
      const sentence = certaintySentence({ grade })!
      expect(sentence, grade).toBeTruthy()
      expect(findConfidenceLanguage(sentence), sentence).toEqual([])
      expect(sentence).not.toMatch(/[—–]|\bgrade\b|your photos|like yours/i)
    }
  })

  it('what the worker stores from now on is the same sentence', () => {
    // no quantity is uncertain: the top level
    const graded = computeEstimateGrade([])
    expect(graded.grade).toBe('A')
    expect(graded.description).toBe(certaintySentence({ grade: 'A' }))
    expect(graded.description).toBe('Every quantity this price depends on was given or confirmed.')
  })

  it('a quote stored before, ending "this price is exact", is shown the new sentence for its level', () => {
    const old = { grade: 'A', description: 'All price-driving quantities were provided or confirmed — this price is exact.' }
    expect(certaintySentence(old)).toBe('Every quantity this price depends on was given or confirmed.')
    expect(certaintySentence({ grade: 'B', description: 'Quantities were measured from your photos with good agreement — final price confirmed before work starts.' })).toBe(certaintySentence({ grade: 'B' }))
  })

  it('a stored sentence that is already plain is shown as it is; nothing at all gives nothing', () => {
    const plain = 'Standard price from the business’s rates. A site visit confirms the details before work starts, so the final price may change.'
    expect(certaintySentence({ grade: 'B', description: plain })).toBe(plain)
    expect(certaintySentence(null)).toBeNull()
    expect(certaintySentence({})).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. The line detail
// ---------------------------------------------------------------------------

describe('T-185: a line’s detail reads "$375 × 2 rooms"', () => {
  it('the business’s own unit name is made lower case and plural after a number', () => {
    expect(lineDetail('$375', 2, 'Room')).toBe('$375 × 2 rooms')
    expect(lineDetail('$375', 1, 'Room')).toBe('$375 × 1 room')
    expect(lineDetail('£40', 3, 'doors')).toBe('£40 × 3 doors')
    expect(lineDetail('$40', 1, 'doors')).toBe('$40 × 1 door')
    expect(unitWords('Storey', 2)).toBe('storeys')
    expect(unitWords('Box', 3)).toBe('boxes')
    expect(unitWords('Gallery', 2)).toBe('galleries')
    expect(unitWords('glass', 1)).toBe('glass')
  })

  it('a measure the product knows keeps its short label and gets no "s"', () => {
    expect(lineDetail('$2', 100, 'sqft')).toBe('$2 × 100 sq ft')
    expect(lineDetail('£18', 34.6, 'Sqm')).toBe(`£18 × 34.6 ${unitWords('sqm', 2)}`)
    expect(unitWords('sqm', 34.6)).not.toMatch(/s$/)
  })

  it('anything that is not one plain word is the business’s text, left alone', () => {
    expect(unitWords('Hrs', 4)).toBe('hrs')
    expect(unitWords('per visit', 2)).toBe('per visit')
    expect(unitWords('m²', 2)).toBe(unitWords('m²', 1))
    expect(lineDetail('$90', 2, '')).toBe('$90 × 2')
  })

  it('the engine writes it, with the business’s name for the step first', () => {
    const steps: WorkStepConfig[] = [{ id: 'rooms', name: 'Walls and ceilings', description: '', costType: 'per_unit', defaultCost: 375, optional: false, unitLabel: 'Room', quantitySource: { type: 'form_field', fieldId: 'room_count' } }]
    const rules: PricingRules = { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: steps }
    const legacy: ExtractedSignals = { category: 'general', materials: [], condition: { rating: 'good' }, complexity: { level: 'medium', factors: [] }, access: { difficulty: 'easy' }, observations: [], warnings: [], confidence: 0.9, siteVisitRecommended: false }
    const structured: ExtractedSignalsV2 = { extractedAt: '2026-01-01T00:00:00.000Z', overallConfidence: 0.9, signals: [], complexity: { level: 'medium', factors: [] }, siteVisitRecommended: false, lowConfidenceSignals: [] }
    const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Tax' }
    const { result } = calculatePricingWithTrace(rules, legacy, structured, [{ fieldId: 'room_count', value: 2 }], noTax, 'USD')
    expect(result.breakdown[0]).toMatchObject({ label: 'Walls and ceilings  $375 × 2 rooms', amount: 750 })
    expect(result.breakdown[0]!.label).toBe(quantityLineLabel('Walls and ceilings', '$375', 2, 'Room'))
    expect(result.breakdown[0]!.label).not.toMatch(/ x |\(/)
  })

  it('a label is read back the same whether it was written now or before', () => {
    expect(lineLabelParts('Walls and ceilings  $375 × 2 rooms')).toEqual({ name: 'Walls and ceilings', detail: '$375 × 2 rooms' })
    expect(lineLabelParts('Walls and ceilings  $375 x 2(Room)')).toEqual({ name: 'Walls and ceilings', detail: '$375 × 2 rooms' })
    expect(lineLabelParts('Exterior walls  £18 x 34.6(Sqm)').detail).toBe(lineDetail('£18', 34.6, 'Sqm'))
    // a label with no detail comes back whole
    expect(lineLabelParts('Set-up')).toEqual({ name: 'Set-up', detail: null })
    expect(lineLabelParts('Who provides the materials: Please supply it (+15%)').detail).toBeNull()
    expect(splitLabelMath('Walls and ceilings  $375 x 2(Room)')).toEqual(['Walls and ceilings', '$375 × 2 rooms'])
  })

  it('the editor still drops the detail from a generated line whose amount the business changed, in either form', () => {
    for (const label of ['Walls  $375 × 2 rooms', 'Walls  $375 x 2(Room)']) {
      const before = [{ label, amount: 750 }]
      expect(dropStaleLabelMath(before, [{ label, amount: 600 }], [label])).toEqual([{ label: 'Walls', amount: 600 }])
      expect(dropStaleLabelMath(before, [{ label, amount: 750 }], [label])).toEqual([{ label, amount: 750 }])
    }
  })
})

// ---------------------------------------------------------------------------
// 6. One place for a line's note
// ---------------------------------------------------------------------------

describe('T-185: a line’s note comes from one place, so a base fee reads the same on every quote', () => {
  const lines = [
    { label: 'Base service fee', amount: 50 },
    { label: 'Walls  $2 × 100 sq ft', amount: 200 },
  ]

  it('priced since T-183 (the source is on the line) and priced before (only the takeoff knows): the same words', () => {
    const now = businessSources(lines.map((l, i) => ({ ...l, source: i === 0 ? 'fixed' : 'photos' })))
    const before = businessSources(lines, [
      { item: 'Base service fee', amount: 50, method: 'Standard charge for every job' },
      { item: 'Walls', amount: 200, method: 'From your photos' },
    ])
    expect(now).toEqual(['Your fixed price', 'Measured from photos'])
    expect(before).toEqual(now)
  })

  it('a line nothing is known about has no note; a takeoff row is used once', () => {
    expect(businessSources([{ label: 'Typed by the business', amount: 20 }], [])).toEqual([null])
    const twice = businessSources(
      [{ label: 'Set-up', amount: 60 }, { label: 'Set-up', amount: 60 }],
      [{ item: 'Set-up', amount: 60, method: 'Fixed price' }]
    )
    expect(twice).toEqual(['Your fixed price', null])
  })

  it('where a label was read is still named, from the takeoff’s words', () => {
    expect(businessSources([{ label: 'Unit', amount: 900, source: 'label' }], [{ item: 'Unit', amount: 900, method: "From the unit's rating plate" }])).toEqual(["Read from the unit's rating plate"])
  })
})

// ---------------------------------------------------------------------------
// 8. The "New quote" email
// ---------------------------------------------------------------------------

describe('T-185: the worker’s "New quote" email to the business has no "Powered by" line', () => {
  const data = { businessName: 'Business A', customerName: 'Megan Grant', customerEmail: 'megan@example.com', serviceName: 'Service A', quoteId: 'qte_1', dashboardUrl: 'u', total: '$300.00', currency: 'USD' }

  it('neither form of it (sent automatically, or waiting for review)', () => {
    for (const html of [businessNotificationEmail(data), businessNotificationEmail({ ...data, awaitingReview: true })]) {
      expect(html).not.toContain('Powered by')
      expect(html).toContain('Megan Grant')
      expect(html).toMatch(/<\/html>\s*$/)
    }
  })

  it('the email a customer gets keeps its line', () => {
    expect(customerQuoteEmail({ customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A', quoteViewUrl: 'u', total: '$300.00', currency: 'USD' })).toContain(`Powered by ${PRODUCT_NAME}`)
  })
})
