/**
 * T-183: approval the business can trust, line names, quote wording.
 *
 *   1. a price line is named from the business's own labels, never from the
 *      customer's answer text
 *   2. each line says where its quantity came from, in the business's words
 *   3. the approval detail (one builder for the page and the email): warnings
 *      first, then lines, sections, the total and the photo count
 *   4. the "Review and approve" email shows all of it, in that order, has no
 *      "Powered by" line and has a spot for the product's logo
 *   5. the scope summary's opening, and sentence case in every email
 */
import { describe, it, expect } from 'vitest'
import {
  adjustmentLineLabel,
  approvalDetail,
  checkerFindings,
  sourceForBusiness,
  sourceFromMethod,
  CUSTOMER_METHOD,
  MINIMUM_ENTRY_LABEL,
  PRODUCT_NAME,
  type ExtractedSignalsV2,
  type PricingTrace,
  type WorkStepConfig,
} from '@qolumns/shared'
import { calculatePricingWithTrace, type PricingRules, type TaxConfig } from '../pricing/rules-engine'
import type { ExtractedSignals } from '../ai/signals'
import { buildTakeoff, withLineSources } from '../takeoff'
import { buildReviewRequestEmail, type ReviewRequestEmailData } from '../email'
import {
  customerQuoteEmail,
  businessNotificationEmail,
  reviewRequestEmail,
  feedbackNotificationEmail,
  revisedQuoteEmail,
  customerClarificationEmail,
} from '../email/templates'
import { getSystemPrompt, WORDING_PROMPT, SCOPE_SUMMARY_OPENING_RULE } from '../ai/wording'

// ---------------------------------------------------------------------------
// 1. Line names
// ---------------------------------------------------------------------------

// A made-up form: the question and option words below belong to no real business
const FIELDS = [
  {
    fieldId: 'materials_choice',
    label: 'Who provides the materials?',
    options: [
      { value: 'I have them already', label: 'I have them already' },
      { value: 'Please supply it', label: 'Please supply it' },
    ],
  },
  { fieldId: 'timing', label: 'When do you need it', options: [{ value: 'rush_48h', label: 'Within 48 hours' }] },
  { fieldId: 'is_weekend', label: 'Weekend visit? (optional)' },
  { fieldId: 'floors', label: 'How many floors:' },
]

describe('T-183: an adjustment line is named from the business’s own labels', () => {
  it('a choice answered with an option: "<question>: <option> (+15%)", never "<answer> surcharge"', () => {
    const label = adjustmentLineLabel({ when: { fieldId: 'materials_choice', equals: 'Please supply it' }, multiplier: 1.15 }, FIELDS)
    expect(label).toBe('Who provides the materials: Please supply it (+15%)')
    expect(label).not.toMatch(/surcharge|discount/i)
    expect(label.startsWith('Please supply it')).toBe(false)
  })

  it('the option’s label is used, not its stored value', () => {
    expect(adjustmentLineLabel({ when: { fieldId: 'timing', equals: 'rush_48h' }, multiplier: 1.25 }, FIELDS)).toBe('When do you need it: Within 48 hours (+25%)')
  })

  it('the business’s own label for the rule wins over everything', () => {
    expect(adjustmentLineLabel({ when: { fieldId: 'timing', equals: 'rush_48h' }, multiplier: 1.25, label: 'Priority booking' }, FIELDS)).toBe('Priority booking')
    // blank is not a label
    expect(adjustmentLineLabel({ when: { fieldId: 'timing', equals: 'rush_48h' }, multiplier: 1.25, label: '  ' }, FIELDS)).toBe('When do you need it: Within 48 hours (+25%)')
  })

  it('a yes/no question answered yes is the question itself; "(optional)" and the question mark are dropped', () => {
    expect(adjustmentLineLabel({ when: { fieldId: 'is_weekend', equals: true }, multiplier: 1.5 }, FIELDS)).toBe('Weekend visit (+50%)')
    expect(adjustmentLineLabel({ when: { fieldId: 'is_weekend', equals: 'yes' }, multiplier: 1.5 }, FIELDS)).toBe('Weekend visit (+50%)')
    expect(adjustmentLineLabel({ when: { fieldId: 'is_weekend', equals: false }, multiplier: 0.9 }, FIELDS)).toBe('Weekend visit: No (-10%)')
  })

  it('a number test says the relation', () => {
    expect(adjustmentLineLabel({ when: { fieldId: 'floors', operator: 'gte', value: 3 }, multiplier: 1.1 }, FIELDS)).toBe('How many floors at least 3 (+10%)')
  })

  it('with no form question known, the question’s id is made readable; the name still starts with the question', () => {
    expect(adjustmentLineLabel({ when: { fieldId: 'materials_choice_select', equals: 'Please supply it' }, multiplier: 1.15 })).toBe('Materials choice: Please supply it (+15%)')
    expect(adjustmentLineLabel({ when: { fieldId: 'job_urgency', equals: 'emergency' }, multiplier: 1.5 })).toBe('Job urgency: Emergency (+50%)')
  })

  it('a rule on the job’s own total keeps its order-value name', () => {
    expect(adjustmentLineLabel({ when: { subject: 'subtotal', operator: 'gt', value: 5000 }, multiplier: 0.9 })).toBe('Discount for jobs over 5000 (-10%)')
  })
})

const legacy = (): ExtractedSignals => ({
  category: 'general',
  materials: [],
  condition: { rating: 'good' },
  complexity: { level: 'medium', factors: [] },
  access: { difficulty: 'easy' },
  observations: [],
  warnings: [],
  confidence: 0.9,
  siteVisitRecommended: false,
})
const structured = (signals: ExtractedSignalsV2['signals'] = []): ExtractedSignalsV2 => ({
  extractedAt: '2026-01-01T00:00:00.000Z',
  overallConfidence: 0.9,
  signals,
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Tax' }

const STEPS: WorkStepConfig[] = [
  { id: 'walls', name: 'Walls', description: '', costType: 'per_unit', defaultCost: 2, optional: false, unitLabel: 'sq ft', quantitySource: { type: 'ai_signal', signalKey: 'wall_area' } },
  { id: 'doors', name: 'Doors', description: '', costType: 'per_unit', defaultCost: 40, optional: false, unitLabel: 'doors', quantitySource: { type: 'form_field', fieldId: 'door_count' } },
  { id: 'setup', name: 'Set-up', description: '', costType: 'fixed', defaultCost: 60, optional: false },
]
const rules = (): PricingRules => ({
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [{ when: { fieldId: 'materials_choice', operator: 'equals', equals: 'Please supply it' }, multiplier: 1.15 }],
  workSteps: STEPS,
})
const ANSWERS = [
  { fieldId: 'materials_choice', value: 'Please supply it' },
  { fieldId: 'door_count', value: 3 },
]
const MEASURED = structured([{ key: 'wall_area', value: 200, confidence: 0.7, source: 'vision', evidence: 'Measured across 3 takeoffs' }])

function price() {
  return calculatePricingWithTrace(rules(), legacy(), MEASURED, ANSWERS, noTax, 'USD', undefined, undefined, undefined, { name: 'Service A', fields: FIELDS })
}

describe('T-183: the pricing engine names the line', () => {
  it('a choice option produces the business’s label on the stored line', () => {
    const { result } = price()
    const labels = result.breakdown.map((line) => line.label)
    expect(labels).toContain('Who provides the materials: Please supply it (+15%)')
    expect(labels.some((label) => /^Please supply it/.test(label))).toBe(false)
    // 200 x 2 + 3 x 40 + 60 = 580; +15% = 87
    expect(result.breakdown.find((line) => line.label.startsWith('Who provides'))?.amount).toBe(87)
    expect(result.subtotal).toBe(667)
  })

  it('with no form questions passed, the name still starts with the question, never the answer', () => {
    const { result } = calculatePricingWithTrace(rules(), legacy(), MEASURED, ANSWERS, noTax, 'USD')
    expect(result.breakdown.map((line) => line.label)).toContain('Materials: Please supply it (+15%)')
  })

  it('every other line is the business’s own name for the step or extra', () => {
    const { result } = price()
    for (const name of ['Walls', 'Doors', 'Set-up']) expect(result.breakdown.some((line) => line.label.startsWith(name))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Where a quantity came from
// ---------------------------------------------------------------------------

describe('T-183: each line says where its quantity came from', () => {
  it('the takeoff carries a code beside the customer’s words', () => {
    const { trace } = price()
    const takeoff = buildTakeoff({ trace, structuredSignals: MEASURED, workSteps: STEPS })
    expect(takeoff.map((row) => [row.item, row.source])).toEqual([
      ['Walls', 'photos'],
      ['Doors', 'answer'],
      ['Set-up', 'fixed'],
      ['Who provides the materials: Please supply it (+15%)', 'answer'],
    ])
    // the customer's words are unchanged
    expect(takeoff[0]!.method).toBe(CUSTOMER_METHOD.photos)
    expect(takeoff[1]!.method).toBe(CUSTOMER_METHOD.quantityGiven)
  })

  it('the code is copied onto the price lines, and the business reads it in its own words', () => {
    const { result, trace } = price()
    const lines = withLineSources(result.breakdown, buildTakeoff({ trace, structuredSignals: MEASURED, workSteps: STEPS }))
    expect(lines.map((line) => sourceForBusiness(line))).toEqual(['Measured from photos', "The customer's answer", 'Your fixed price', "The customer's answer"])
    // amounts and names are untouched
    expect(lines.map((line) => [line.label, line.amount])).toEqual(result.breakdown.map((line) => [line.label, line.amount]))
  })

  it('a quantity the customer confirmed is the customer’s answer, not a measurement', () => {
    const confirmed = structured([{ key: 'wall_area', value: 200, confidence: 1, source: 'form', evidence: 'Confirmed by the customer' }])
    const { result, trace } = calculatePricingWithTrace(rules(), legacy(), confirmed, ANSWERS, noTax, 'USD')
    const lines = withLineSources(result.breakdown, buildTakeoff({ trace, structuredSignals: confirmed, workSteps: STEPS }))
    expect(sourceForBusiness(lines[0])).toBe("The customer's answer")
  })

  it('the minimum top-up is never given a source, and two lines of the same amount keep their own', () => {
    const trace: PricingTrace = {
      calculatedAt: '2026-01-01T00:00:00.000Z',
      configVersion: 'v1',
      trace: [
        { type: 'work_step', id: 'setup', description: 'Set-up', signalsUsed: [], calculation: '', amount: 60, runningTotal: 60 },
        { type: 'addon', id: 'x', description: 'Extra visit', signalsUsed: [], calculation: '', amount: 60, runningTotal: 120 },
      ],
      summary: { baseFee: 0, workStepsTotal: 60, addonsTotal: 60, multiplierAdjustment: 0, taxAmount: 0, total: 120 },
    } as unknown as PricingTrace
    const takeoff = buildTakeoff({ trace, structuredSignals: null, workSteps: STEPS })
    const lines = withLineSources(
      [
        { label: 'Set-up', amount: 60 },
        { label: 'Extra visit', amount: 60 },
        { label: MINIMUM_ENTRY_LABEL, amount: 30, kind: 'minimum', minimumCharge: 150 },
      ],
      takeoff
    )
    expect(lines.map((line) => line.source)).toEqual(['fixed', 'choice', undefined])
  })

  it('a quote priced before the code was stored is read from the customer’s words', () => {
    expect(sourceFromMethod('From your photos')).toBe('photos')
    expect(sourceFromMethod('Quantity provided by you')).toBe('answer')
    expect(sourceForBusiness({ method: "From the unit's rating plate" })).toBe("Read from the unit's rating plate")
    expect(sourceForBusiness({ method: "3 ton — from the unit's rating plate" })).toBe("Read from the unit's rating plate")
    // words we cannot stand behind say nothing
    expect(sourceForBusiness({ method: 'Something else' })).toBeNull()
    expect(sourceForBusiness({})).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. The approval detail
// ---------------------------------------------------------------------------

const PRICING = {
  currency: 'USD',
  subtotal: 420,
  taxLabel: 'Sales tax',
  taxAmount: 42,
  total: 462,
  breakdown: [
    { label: 'Walls  $2 x 90(sq ft)', amount: 180, source: 'photos' },
    { label: 'Doors  $40 x 3(doors)', amount: 120, source: 'answer' },
    { label: 'Typed by the business', amount: 20 },
  ],
  sections: [
    {
      serviceId: 'svc_b',
      serviceName: 'Service B',
      addedBy: 'customer',
      addedAt: '2026-01-01T00:00:00.000Z',
      subtotal: 100,
      breakdown: [
        { label: 'Visit', amount: 70, source: 'fixed' },
        { label: MINIMUM_ENTRY_LABEL, amount: 30, kind: 'minimum', minimumCharge: 100 },
      ],
    },
  ],
}
const CONTENT = {
  alsoAsked: [
    { id: 'a1', words: 'the second thing', serviceId: 'svc_b', serviceName: 'Service B', state: 'offered' },
    { id: 'a2', words: 'the third thing', serviceId: null, state: 'not_offered' },
  ],
}
const SOURCE = { type: 'widget', serviceSuggestion: { serviceId: 'svc_c', serviceName: 'Service C', reason: 'They describe other work.' } }
const ISSUES = [
  { check: 'addon', description: 'an extra was added that the customer did not mention' },
  { check: 'addon', description: 'an extra was added that the customer did not mention' },
  { check: 'invented fee', description: 'an unconfigured minimum charge was added' },
]

function detail(over: Partial<Parameters<typeof approvalDetail>[0]> = {}) {
  return approvalDetail({ pricing: PRICING, content: CONTENT, mainServiceName: 'Service A', requestSource: SOURCE, checkerIssues: ISSUES, photoCount: 3, currency: 'USD', locale: 'en-US', ...over })
}

describe('T-183: the approval detail', () => {
  it('warnings come in reading order: the service, what else was asked for, the automatic check', () => {
    const d = detail()
    expect(d.warnings.map((w) => [w.kind, w.title])).toEqual([
      ['service', 'Check the service'],
      ['also_asked', 'Customer also asked for'],
      ['check', 'Worth checking'],
    ])
    expect(d.warnings[0]!.lines[0]).toContain('"Service C"')
    // the section on the quote makes the first one "added"; the other is not one of the business's services
    expect(d.warnings[1]!.lines[0]).toBe('Service B: “the second thing”. Added by the customer.')
    expect(d.warnings[1]!.lines[1]).toMatch(/^“the third thing”\. Not one of your services\./)
    // one sentence per finding, no repeats (this quote's main service applied no minimum, so that finding stays)
    expect(d.warnings[2]!.lines).toEqual(['An extra was added that the customer did not mention', 'An unconfigured minimum charge was added'])
  })

  it('a finding the quote itself proves wrong is left out (the minimum is the business’s own setting)', () => {
    const withMinimum = [...PRICING.breakdown, { label: MINIMUM_ENTRY_LABEL, amount: 10, kind: 'minimum', minimumCharge: 330 }]
    expect(checkerFindings(ISSUES, withMinimum)).toEqual(['An extra was added that the customer did not mention'])
  })

  it('no warnings: an empty list, nothing invented', () => {
    expect(detail({ content: {}, requestSource: { type: 'widget' }, checkerIssues: null }).warnings).toEqual([])
  })

  it('every line has its amount and, where it is known, its source', () => {
    const [main] = detail().parts
    expect(main!.lines).toEqual([
      // T-186: a label stored the old way ("$2 x 90(sq ft)") is shown the way a new one is written
      { label: 'Walls  $2 × 90 sq ft', amount: '$180.00', source: 'Measured from photos' },
      { label: 'Doors  $40 × 3 doors', amount: '$120.00', source: "The customer's answer" },
      { label: 'Typed by the business', amount: '$20.00', source: null },
    ])
  })

  it('a combined quote is parts with subtotals and one total; the minimum is a note, never a line', () => {
    const d = detail()
    expect(d.combined).toBe(true)
    expect(d.parts.map((p) => [p.serviceName, p.main, p.subtotal])).toEqual([
      ['Service A', true, '$320.00'],
      ['Service B', false, '$100.00'],
    ])
    const added = d.parts[1]!
    expect(added.addedBy).toBe('customer')
    expect(added.lines).toEqual([{ label: 'Visit', amount: '$70.00', source: 'Your fixed price' }])
    expect(added.minimumNote).toContain('$100.00')
    expect(d.totals).toEqual({ subtotal: '$420.00', tax: { label: 'Sales tax', amount: '$42.00' }, total: '$462.00' })
  })

  it('a single-service quote is one part; an older quote takes its sources from the takeoff', () => {
    const d = approvalDetail({
      pricing: { currency: 'GBP', subtotal: 300, taxAmount: 0, total: 300, breakdown: [{ label: 'Walls  £2 x 90(sqm)', amount: 180 }, { label: 'Doors', amount: 120 }] },
      content: { takeoff: [{ item: 'Walls', amount: 180, method: 'From your photos' }, { item: 'Doors', amount: 120, method: 'Quantity provided by you' }] },
      mainServiceName: 'Service A',
      photoCount: 0,
      currency: 'GBP',
      locale: 'en-GB',
    })
    expect(d.combined).toBe(false)
    expect(d.parts).toHaveLength(1)
    expect(d.parts[0]!.lines.map((l) => l.source)).toEqual(['Measured from photos', "The customer's answer"])
    expect(d.totals.total).toBe('£300.00')
    expect(d.totals.tax).toBeNull()
    expect(d.photosLine).toBeNull()
  })

  it('the photo count is said in words', () => {
    expect(detail().photosLine).toBe('3 photos from the customer')
    expect(detail({ photoCount: 1 }).photosLine).toBe('1 photo from the customer')
  })
})

// ---------------------------------------------------------------------------
// 4. The "Review and approve" email
// ---------------------------------------------------------------------------

const APP = 'https://app.example.com'
const EMAIL: ReviewRequestEmailData = {
  quoteId: 'qte_123',
  ownerEmail: 'owner@example.com',
  businessName: 'Business A',
  customerName: 'Megan Grant',
  customerEmail: 'megan@example.com',
  serviceName: 'Service A',
  total: 462,
  currency: 'USD',
  locale: 'en-US',
  reviewHold: 'shown',
  approveUrl: `${APP}/approve/${'a'.repeat(43)}`,
  detail: detail(),
}

describe('T-183: the review email', () => {
  const { html } = buildReviewRequestEmail(APP, EMAIL)
  const at = (needle: string) => {
    const i = html.indexOf(needle)
    expect(i, needle).toBeGreaterThan(-1)
    return i
  }

  it('reads in order: warnings, the lines, the total, the photos, then the button', () => {
    const order = [at('data-role="warning"'), at('data-role="price-lines"'), at('data-role="total"'), at('data-role="photos"'), at('data-role="approve"'), at('data-role="dashboard"')]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('shows every warning, each line with its amount and source, each service’s subtotal and the one total', () => {
    for (const text of ['Check the service', 'Customer also asked for', 'Worth checking']) at(text)
    for (const text of ['Walls  $2 × 90 sq ft', '$180.00', 'Measured from photos', 'The customer&#39;s answer', 'Your fixed price']) at(text)
    expect(html.match(/data-role="part"/g)).toHaveLength(2)
    expect(html.match(/data-role="part-subtotal"/g)).toHaveLength(2)
    at('$320.00')
    at('$100.00')
    at('Sales tax')
    expect(html.match(/data-role="total"/g)).toHaveLength(1)
    at('$462.00')
    // the minimum is a note, not a line
    at('data-role="minimum"')
    expect(html).not.toContain(MINIMUM_ENTRY_LABEL)
  })

  it('photos are one line pointing at the approval page; no customer photo is put in the email', () => {
    at('3 photos: view them on the approval page')
    expect(html).not.toMatch(/<img/i)
  })

  it('Approve & send is one link; "Open in dashboard to edit" stays', () => {
    expect(html.match(/data-role="approve"/g)).toHaveLength(1)
    at('Approve &amp; send')
    at('Open in dashboard to edit')
  })

  it('has no "Powered by" line and has the spot for the product’s logo at the top', () => {
    expect(html).not.toContain('Powered by')
    const logo = at('data-role="product-logo"')
    expect(logo).toBeLessThan(at('Estimate ready for your approval'))
    expect(html).toContain(`>${PRODUCT_NAME}</td>`)
    expect(html).toContain('<!-- PRODUCT LOGO:')
  })

  it('a reason that is already the "Check the service" warning is not said twice', () => {
    const reason = detail().warnings[0]!.lines[0]!
    const again = buildReviewRequestEmail(APP, { ...EMAIL, reason }).html
    expect(again).not.toContain('data-role="reason"')
    // a different reason is still said
    expect(buildReviewRequestEmail(APP, { ...EMAIL, reason: 'The photo is too dark to read.' }).html).toContain('data-role="reason"')
  })

  it('without the detail it reads as it did (the price, the hold line, the button)', () => {
    const plain = buildReviewRequestEmail(APP, { ...EMAIL, detail: undefined }).html
    expect(plain).toContain('$462.00')
    expect(plain).not.toContain('data-role="price-lines"')
    expect(plain).toContain('data-role="approve"')
  })

  it('emails the business sends to its customers keep their "Powered by" line', () => {
    const customer = customerQuoteEmail({ customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A', quoteViewUrl: `${APP}/q/x`, total: '$462.00', currency: 'USD' })
    expect(customer).toContain(`Powered by ${PRODUCT_NAME}`)
    expect(customer).not.toContain('data-role="product-logo"')
  })
})

// ---------------------------------------------------------------------------
// 5. Wording
// ---------------------------------------------------------------------------

describe('T-183: the scope summary opens with the work', () => {
  // T-189: there is one document style, so one system prompt (it took a tone until then)
  it('the prompt asks for no informal opener', () => {
    const prompt = getSystemPrompt()
    expect(prompt).not.toMatch(/here'?s a quick estimate|based on what you'?ve shared|we are pleased to provide|please find our quotation/i)
    expect(prompt).not.toMatch(/conversational|casual/i)
  })

  it('the prompt says the first sentence states the work, and the user prompt repeats it for the scope summary', () => {
    expect(getSystemPrompt()).toMatch(/first sentence states the work to be done/)
    expect(getSystemPrompt()).toMatch(/Never open it with a greeting/)
    expect(WORDING_PROMPT).toContain(SCOPE_SUMMARY_OPENING_RULE)
  })

  it('the rule names no service and no business', () => {
    expect(SCOPE_SUMMARY_OPENING_RULE).toBe(
      'scopeSummary: plain and professional. The first sentence states the work to be done. Do not open with a greeting, an introduction, or a remark about the estimate or quote itself.'
    )
  })
})

/**
 * Headings, labels and buttons are sentence case: one capital at the start.
 * A short piece of text with a capital on a later word is Title Case, unless
 * that word is a name we passed in or the product's own.
 */
function titleCased(html: string, names: string[]): string[] {
  const allowed = new Set([...names.flatMap((n) => n.split(/\s+/)), PRODUCT_NAME, 'WhatsApp', 'ID', 'I'])
  const found: string[] = []
  for (const match of html.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1]!.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    const words = text.split(' ')
    // a heading, label or button: short, and not a sentence
    if (!text || words.length < 2 || words.length > 5 || /[.,:!?]/.test(text)) continue
    if (words.slice(1).some((word) => /^[A-Z][a-z]+$/.test(word) && !allowed.has(word))) found.push(text)
  }
  return found
}

describe('T-183: sentence case in every email', () => {
  // everything passed in below that is a name or a value, not the template's own words
  const names = ['Megan Grant', 'Business A', 'Service A', 'TEST REQUEST', '1 Jan', '1 Main Street']
  const common = { customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A' }
  const emails: Record<string, string> = {
    customerQuote: customerQuoteEmail({ ...common, quoteViewUrl: 'u', total: '$1.00', currency: 'USD', scopeSummary: 'The work is described here.', validUntil: '1 Jan' }),
    customerEstimate: customerQuoteEmail({ ...common, quoteViewUrl: 'u', total: '$1.00', currency: 'USD', awaitingConfirmation: true }),
    businessNotification: businessNotificationEmail({ ...common, customerEmail: 'megan@example.com', customerPhone: '555 0100', jobAddress: '1 Main Street', quoteId: 'qte_1', dashboardUrl: 'u', total: '$1.00', currency: 'USD' }),
    businessReview: businessNotificationEmail({ ...common, customerEmail: '', quoteId: 'qte_1', dashboardUrl: 'u', total: '$1.00', currency: 'USD', awaitingReview: true }),
    review: reviewRequestEmail({ ...common, quoteId: 'qte_1', total: '$1.00', approveUrl: 'a', dashboardUrl: 'u', holdLine: 'The customer can already see this.', detail: detail(), testBanner: 'This is your own test.' }),
    reviewNoLink: reviewRequestEmail({ ...common, quoteId: 'qte_1', total: '$1.00', dashboardUrl: 'u', holdLine: 'Held until you approve.' }),
    feedback: feedbackNotificationEmail({ ...common, feedbackType: 'approval_request', feedbackText: 'Please check.', dashboardUrl: 'u' }),
    revised: revisedQuoteEmail({ ...common, quoteViewUrl: 'u', total: '$1.00' }),
    clarification: customerClarificationEmail({ ...common, clarifyUrl: 'u', questions: [{ question: 'How many rooms?' }] }),
  }

  it.each(Object.keys(emails))('%s has no Title Case heading, label or button', (name) => {
    expect(titleCased(emails[name]!, names)).toEqual([])
  })

  it('the named headings and buttons read as sentences', () => {
    expect(emails.customerQuote).toContain('Scope of work')
    expect(emails.customerQuote).toContain('View full quote')
    expect(emails.customerEstimate).toContain('View your estimate')
    expect(emails.businessNotification).toContain('View in dashboard')
  })

  it('the check itself catches Title Case', () => {
    expect(titleCased('<p>Scope of Work</p><a>View Your Estimate</a><p>Megan Grant</p>', names)).toEqual(['Scope of Work', 'View Your Estimate'])
  })
})
