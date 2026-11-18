/**
 * T-179: one request, several services (AD-061). The arithmetic that exists
 * once (packages/shared/src/quote-sections.ts), the review rule, the
 * customer's add and remove on the server, and what the emails and the
 * accuracy report make of a combined quote. Fixture names are generic.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ADDED_SECTIONS,
  addedSections,
  alsoAskedOf,
  alsoAskedWithStates,
  computeAccuracy,
  displaySections,
  displaySectionsForCustomer,
  editedSectionBreakdown,
  hasSections,
  mainSubtotal,
  minimumEntry,
  notOfferedLine,
  pricingForCustomer,
  questionsToAddLabel,
  reviewAfterAdding,
  sectionPriceWaits,
  sectionsAwaitingApproval,
  strictestReviewMode,
  willConfirmLine,
  withSections,
} from '@qolumns/shared'
import type { AlsoAsked, CombinedPricing, QuoteSection, SectionTax } from '@qolumns/shared'

const sendEmail = vi.fn(async (_message: { to: string; subject: string; htmlBody: string; tag?: string }) => ({ success: true }))
vi.mock('@/lib/postmark', () => ({ isPostmarkConfigured: () => true, sendEmail: (message: { to: string; subject: string; htmlBody: string }) => sendEmail(message) }))
vi.mock('@/lib/business-email', () => ({ resolveBusinessEmail: vi.fn(async () => 'owner@business.test') }))

import { addSectionForCustomer, removeSectionForCustomer, customerCanChangeSections } from '@/lib/quote-sections-service'
import type { SectionQuoteRow } from '@/lib/quote-sections-service'
import { requestUpdatedEmail } from '@/lib/request-updated-email'
import { sectionsEmailHtml } from '@/lib/sections-email'

const root = join(__dirname, '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const TAX: SectionTax = { ratePercent: 10, label: 'Sales tax', mainTaxable: true }
const main = (over: Partial<CombinedPricing> = {}): CombinedPricing => ({
  currency: 'USD',
  subtotal: 200,
  taxLabel: 'Sales tax',
  taxRate: 10,
  taxAmount: 20,
  total: 220,
  breakdown: [{ label: 'Alpha visit', amount: 200 }],
  ...over,
})
const beta = (over: Partial<QuoteSection> = {}): QuoteSection => ({
  serviceId: 'svc_beta',
  serviceName: 'Service Beta',
  breakdown: [{ label: 'Beta job', amount: 150 }, minimumEntry(30, 180)],
  subtotal: 180,
  addedBy: 'customer',
  addedAt: '2026-11-17T12:00:00.000Z',
  ...over,
})
const gamma = (over: Partial<QuoteSection> = {}): QuoteSection => ({
  serviceId: 'svc_gamma',
  serviceName: 'Service Gamma',
  breakdown: [{ label: 'Gamma units', amount: 120 }],
  subtotal: 120,
  addedBy: 'customer',
  addedAt: '2026-11-17T12:05:00.000Z',
  ...over,
})

describe('one total, tax once', () => {
  it('adding a section: subtotal is A + B, tax is worked out once on the combined amount', () => {
    const combined = withSections(main(), [beta()], TAX)
    expect(combined.subtotal).toBe(380)
    expect(combined.taxAmount).toBe(38)
    expect(combined.total).toBe(418)
    expect(combined.breakdown).toEqual([{ label: 'Alpha visit', amount: 200 }])
    expect(combined.sections).toHaveLength(1)
    expect(mainSubtotal(combined)).toBe(200)
    expect(hasSections(combined)).toBe(true)
  })

  it('tax once is not the same as tax twice: rounding happens on the sum', () => {
    const odd = withSections(main({ subtotal: 33.33, taxAmount: 3.33, total: 36.66, breakdown: [{ label: 'a', amount: 33.33 }] }), [beta({ breakdown: [{ label: 'b', amount: 33.33 }], subtotal: 33.33 })], TAX)
    expect(odd.subtotal).toBe(66.66)
    // 6.666 → 6.67; taxing each part alone would give 3.33 + 3.33 = 6.66
    expect(odd.taxAmount).toBe(6.67)
    expect(odd.total).toBe(73.33)
  })

  it('removing every section gives the main service’s own figures back, with no sections key', () => {
    const combined = withSections(main(), [beta()], TAX)
    const back = withSections(combined, [], TAX)
    expect(back).toEqual(main())
    expect('sections' in back).toBe(false)
    expect(hasSections(back)).toBe(false)
  })

  it('a service that is not taxed is left out of the taxed amount; an untaxed main service too', () => {
    expect(withSections(main(), [beta({ taxExempt: true })], TAX).taxAmount).toBe(20)
    const untaxedMain = withSections(main({ taxAmount: 0, total: 200, taxRate: undefined, taxLabel: undefined }), [beta()], { ...TAX, mainTaxable: false })
    expect(untaxedMain.taxAmount).toBe(18)
    expect(untaxedMain.total).toBe(398)
    const noTax = withSections(main({ taxAmount: 0, total: 200, taxRate: undefined, taxLabel: undefined }), [beta()], { ratePercent: 0, mainTaxable: false })
    expect(noTax.taxAmount).toBe(0)
    expect(noTax.total).toBe(380)
  })

  it('a section’s subtotal is always its own lines added up (they can be edited), never a figure sent with it', () => {
    const lying = withSections(main(), [beta({ subtotal: 1 })], TAX)
    expect(lying.sections?.[0]?.subtotal).toBe(180)
    expect(lying.subtotal).toBe(380)
  })

  it(`at most ${MAX_ADDED_SECTIONS} added services`, () => {
    const third: QuoteSection = { ...gamma(), serviceId: 'svc_delta', serviceName: 'Service Delta' }
    expect(withSections(main(), [beta(), gamma(), third], TAX).sections).toHaveLength(MAX_ADDED_SECTIONS)
  })

  it('a range the engine measured for the main service moves with what was added', () => {
    const ranged = main({ estimate: { grade: 'B', label: 'Measured', description: '', rangeLow: 200, rangeHigh: 260 } })
    const combined = withSections(ranged, [beta()], TAX)
    expect(combined.estimate).toMatchObject({ rangeLow: 398, rangeHigh: 458 })
    expect(withSections(combined, [], TAX).estimate).toMatchObject({ rangeLow: 200, rangeHigh: 260 })
  })

  it('AD-048: each service’s minimum is a floor on its own section', () => {
    const combined = withSections(main({ breakdown: [{ label: 'Alpha visit', amount: 120 }, minimumEntry(80, 200)] }), [beta()], TAX)
    const shown = displaySections(combined, { serviceId: 'svc_alpha', serviceName: 'Service Alpha' })!
    expect(shown.map((s) => [s.serviceName, s.main, s.lines.map((l) => l.amount), s.minimum?.minimumCharge ?? null, s.subtotal])).toEqual([
      ['Service Alpha', true, [120], 200, 200],
      ['Service Beta', false, [150], 180, 180],
    ])
  })

  it('a single-service quote has no sections to show, old quotes included', () => {
    expect(displaySections(main(), { serviceName: 'Service Alpha' })).toBeNull()
    expect(displaySections(null, { serviceName: 'Service Alpha' })).toBeNull()
    expect(addedSections({ sections: 'nonsense' })).toEqual([])
    expect(addedSections({ sections: [{ serviceId: 5 }, null, beta()] })).toHaveLength(1)
    // an old quote whose lines do not add up to its subtotal keeps the subtotal it was stored with
    expect(mainSubtotal({ breakdown: [{ label: 'x', amount: 10 }], subtotal: 12 })).toBe(12)
  })
})

describe('a section saved from the editor', () => {
  it('one already on the quote keeps the stored floor, whatever the client sent', () => {
    const stored = beta().breakdown
    expect(editedSectionBreakdown(stored, [{ label: 'Beta job', amount: 100 }, { label: 'x', amount: 999, kind: 'minimum', minimumCharge: 5000 }])).toEqual([{ label: 'Beta job', amount: 100 }, minimumEntry(80, 180)])
    expect(editedSectionBreakdown(stored, [{ label: 'Beta job', amount: 400 }, minimumEntry(30, 180)])).toEqual([{ label: 'Beta job', amount: 400 }])
    // no marked entry sent: the business removed the floor from this section
    expect(editedSectionBreakdown(stored, [{ label: 'Beta job', amount: 100 }])).toEqual([{ label: 'Beta job', amount: 100 }])
  })

  it('one added in this save keeps the floor it was priced with, the top-up worked out again', () => {
    expect(editedSectionBreakdown(undefined, [{ label: 'Beta job', amount: 160 }, minimumEntry(30, 180)])).toEqual([{ label: 'Beta job', amount: 160 }, minimumEntry(20, 180)])
    expect(editedSectionBreakdown(undefined, [{ label: 'Beta job', amount: 200 }, minimumEntry(30, 180)])).toEqual([{ label: 'Beta job', amount: 200 }])
    expect(editedSectionBreakdown(undefined, [{ label: 'Gamma units', amount: 95 }])).toEqual([{ label: 'Gamma units', amount: 95 }])
  })
})

describe('review follows the strictest service on the quote', () => {
  it('auto-sends only if every service auto-sends', () => {
    expect(strictestReviewMode(['auto_send', 'auto_send'])).toBe('auto_send')
    expect(strictestReviewMode(['auto_send', 'show_then_confirm'])).toBe('show_then_confirm')
    expect(strictestReviewMode(['show_then_confirm', 'hold_until_approved', 'auto_send'])).toBe('hold_until_approved')
  })

  const sent = { status: 'sent', reviewHold: null, approvedAt: '2026-11-17T10:00:00.000Z' }
  it('a sent quote stays sent when everything on it auto-sends', () => {
    expect(reviewAfterAdding(sent, ['auto_send', 'auto_send'])).toEqual({ next: sent, changed: false })
  })
  it('a sent quote goes back to the business when an added service is reviewed first, and what the customer saw stays visible: also for "hold until approved"', () => {
    const waitingShown = { next: { status: 'pending_review', reviewHold: 'shown', approvedAt: null }, changed: true }
    expect(reviewAfterAdding(sent, ['auto_send', 'show_then_confirm'])).toEqual(waitingShown)
    expect(reviewAfterAdding(sent, ['auto_send', 'hold_until_approved'])).toEqual(waitingShown)
  })
  it('a quote already waiting is never loosened (a check’s hold stays, "held" stays) and never hidden by an added service', () => {
    const waiting = (reviewHold: 'shown' | 'held' | 'check') => ({ status: 'pending_review', reviewHold, approvedAt: null })
    expect(reviewAfterAdding(waiting('check'), ['show_then_confirm', 'auto_send']).next.reviewHold).toBe('check')
    expect(reviewAfterAdding(waiting('held'), ['show_then_confirm', 'show_then_confirm']).next.reviewHold).toBe('held')
    expect(reviewAfterAdding(waiting('shown'), ['show_then_confirm', 'show_then_confirm'])).toEqual({ next: waiting('shown'), changed: false })
    expect(reviewAfterAdding(waiting('shown'), ['show_then_confirm', 'hold_until_approved'])).toEqual({ next: waiting('shown'), changed: false })
  })
})

describe('a part whose service holds until approved: no price for that part, the rest as it was', () => {
  const held = beta({ awaitingApproval: true })
  const waitingQuote = withSections(main(), [held], TAX)

  it('only a "hold until approved" service (the part’s own, or the main one) makes a part wait', () => {
    expect(sectionPriceWaits('auto_send', 'hold_until_approved')).toBe(true)
    expect(sectionPriceWaits('hold_until_approved', 'auto_send')).toBe(true)
    expect(sectionPriceWaits('auto_send', 'show_then_confirm')).toBe(false)
    expect(sectionPriceWaits('show_then_confirm', 'auto_send')).toBe(false)
  })

  it('while the quote waits, the customer’s figures are the quote as it stood before they added the part', () => {
    expect(waitingQuote).toMatchObject({ subtotal: 380, taxAmount: 38, total: 418 })
    const seen = pricingForCustomer(waitingQuote, 'pending_review', TAX)
    expect(seen.awaiting.map((s) => s.serviceId)).toEqual(['svc_beta'])
    expect(seen.pricing).toEqual(main())
    expect(JSON.stringify(seen.pricing)).not.toContain('180')
  })

  it('a measured range goes back with it', () => {
    const ranged = withSections(main({ estimate: { grade: 'B', rangeLow: 200, rangeHigh: 260 } as CombinedPricing['estimate'] }), [held], TAX)
    expect(ranged.estimate).toMatchObject({ rangeLow: 398, rangeHigh: 458 })
    expect(pricingForCustomer(ranged, 'pending_review', TAX).pricing.estimate).toMatchObject({ rangeLow: 200, rangeHigh: 260 })
  })

  it('a part that does not wait stays in the customer’s figures beside one that does', () => {
    const both = withSections(main(), [held, gamma()], TAX)
    const seen = pricingForCustomer(both, 'pending_review', TAX)
    expect(seen.pricing.sections?.map((s) => s.serviceId)).toEqual(['svc_gamma'])
    expect(seen.pricing.total).toBe(withSections(main(), [gamma()], TAX).total)
    const shown = displaySectionsForCustomer(seen.pricing, seen.awaiting, { serviceId: 'svc_alpha', serviceName: 'Service Alpha' })!
    expect(shown.map((s) => [s.serviceName, s.awaitingApproval === true])).toEqual([['Service Alpha', false], ['Service Gamma', false], ['Service Beta', true]])
  })

  it('the customer is shown the part by name with no line, no subtotal and no amount', () => {
    const seen = pricingForCustomer(waitingQuote, 'pending_review', TAX)
    const shown = displaySectionsForCustomer(seen.pricing, seen.awaiting, { serviceId: 'svc_alpha', serviceName: 'Service Alpha' })!
    expect(shown).toHaveLength(2)
    expect(shown[0]).toMatchObject({ main: true, serviceName: 'Service Alpha', subtotal: 200 })
    expect(shown[1]).toEqual({ serviceId: 'svc_beta', serviceName: 'Service Beta', main: false, lines: [], minimum: null, subtotal: 0, addedBy: 'customer', awaitingApproval: true })
    expect(willConfirmLine('Fixture Trading')).toBe('Fixture Trading will confirm this part')
  })

  it('once the business approves (the quote is no longer waiting) the part shows with its price', () => {
    for (const status of ['sent', 'viewed', 'accepted']) {
      expect(sectionsAwaitingApproval(waitingQuote, status)).toEqual([])
      expect(pricingForCustomer(waitingQuote, status, TAX)).toEqual({ pricing: waitingQuote, awaiting: [] })
    }
    // nothing waiting: the same sections as everyone sees
    expect(displaySectionsForCustomer(waitingQuote, [], { serviceName: 'Service Alpha' })).toEqual(displaySections(waitingQuote, { serviceName: 'Service Alpha' }))
  })

  it('the customer’s page, its add and remove calls and the PDF link never carry the waiting part’s price', () => {
    const view = read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    expect(view).toContain('pricingForCustomerView(')
    expect(view).toContain('displaySectionsForCustomer(pricing, awaitingParts')
    expect(view).toContain('quote.pdf_asset_id && awaitingParts.length === 0')
    const sections = read('apps/web/src/app/api/public/quotes/[quoteId]/sections/route.ts')
    expect(sections).toContain('NextResponse.json({ ok: true, status: result.status })')
    expect(sections).not.toContain('alsoAsked: result.alsoAsked')
    expect(read('apps/web/src/app/api/public/quotes/[quoteId]/pdf/route.ts')).toContain('sectionsAwaitingApproval(')
    // saving an edit in the dashboard is not approving: the mark is kept
    expect(read('apps/web/src/app/api/quotes/[quoteId]/route.ts')).toContain('before?.awaitingApproval === true && { awaitingApproval: true }')
    // accepting stays locked while the quote waits
    expect(read('apps/web/src/app/api/public/quotes/[quoteId]/accept/route.ts')).toContain('canCustomerDecide(quote.status)')
  })
})

describe('what else the customer asked for', () => {
  const items: AlsoAsked[] = [
    { id: 'also_svc_beta', words: 'I also need service beta done', serviceId: 'svc_beta', serviceName: 'Service Beta', state: 'offered', price: 180 },
    { id: 'also_other_1', words: 'repaint my boat', serviceId: null, state: 'not_offered' },
  ]
  it('each offered service’s state follows the sections actually on the quote; "not offered" never changes', () => {
    expect(alsoAskedWithStates(items, [beta()]).map((a) => a.state)).toEqual(['added', 'not_offered'])
    expect(alsoAskedWithStates(alsoAskedWithStates(items, [beta()]), []).map((a) => a.state)).toEqual(['offered', 'not_offered'])
  })
  it('is read defensively', () => {
    expect(alsoAskedOf({ alsoAsked: [...items, { id: 1 }, null, { id: 'x', words: 'y', state: 'priced' }] })).toEqual(items)
    expect(alsoAskedOf(null)).toEqual([])
    expect(alsoAskedOf({})).toEqual([])
  })
  it('the customer’s words for something not offered carry no price', () => {
    expect(notOfferedLine('repaint my boat')).toBe('We’ll confirm “repaint my boat” with you separately.')
    expect(questionsToAddLabel(1)).toBe('Answer 1 question to add it')
    expect(questionsToAddLabel(2)).toBe('Answer 2 questions to add it')
  })
})

// ---------- the customer's add and remove, on the server ----------
type Row = Record<string, unknown>
function fakeDb(services: Row[]) {
  const updates: Row[] = []
  const touched: string[] = []
  const db = {
    from(table: string) {
      touched.push(table)
      const filters: Row = {}
      let ids: unknown[] | null = null
      const rows = () => {
        if (table === 'tenants') return [{ region: 'US', currency: 'USD', unit_system: 'imperial', tax_enabled: true, tax_label: null, tax_rate: 0.1 }]
        if (table === 'services') return services.filter((s) => (!filters.id || s.id === filters.id) && (!ids || ids.includes(s.id)))
        return []
      }
      const q = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          filters[col] = value
          return q
        },
        in: (_col: string, values: unknown[]) => {
          ids = values
          return q
        },
        single: async () => ({ data: rows()[0] ?? null }),
        then: (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: rows() }),
        update: (values: Row) => {
          updates.push(values)
          return { eq: async () => ({ error: null }) }
        },
      }
      return q
    },
  }
  return { db: db as never, updates, touched }
}
const SERVICES = [
  { id: 'svc_alpha', name: 'Service Alpha', tax_exempt: false, auto_send: true, hold_until_approved: false },
  { id: 'svc_beta', name: 'Service Beta', tax_exempt: false, auto_send: false, hold_until_approved: false },
  { id: 'svc_gamma', name: 'Service Gamma', tax_exempt: false, auto_send: true, hold_until_approved: false },
]
// the same business with Service Beta set to "hold until approved"
const SERVICES_BETA_HOLDS = SERVICES.map((row) => (row.id === 'svc_beta' ? { ...row, hold_until_approved: true } : row))
const quote = (over: Partial<SectionQuoteRow> = {}): SectionQuoteRow => ({
  id: 'qte_fixture',
  tenant_id: 'tnt_fixture',
  service_id: 'svc_alpha',
  status: 'sent',
  review_hold: null,
  approved_at: null,
  pricing_json: main(),
  content_json: {
    scopeSummary: 'An alpha visit.',
    alsoAsked: [
      { id: 'also_svc_beta', words: 'I also need service beta done', serviceId: 'svc_beta', serviceName: 'Service Beta', state: 'offered', price: 180 },
      { id: 'also_svc_gamma', words: 'three gamma units', serviceId: 'svc_gamma', serviceName: 'Service Gamma', state: 'offered', questions: [{ key: 'gamma_count', label: 'How many gamma units?', type: 'number' }] },
    ],
  },
  customer_json: { name: 'Megan Grant', email: 'megan@customer.test' },
  ...over,
})
const workerAnswers = (answer: unknown, status = 200) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer), { status })))
const pricedBeta = { success: true, ready: true, serviceName: 'Service Beta', reviewMode: 'show_then_confirm', section: { serviceId: 'svc_beta', serviceName: 'Service Beta', breakdown: beta().breakdown, subtotal: 180 } }

describe('the customer adds and removes a service', () => {
  beforeEach(() => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', 'http://worker.test')
    vi.stubEnv('CLOUDFLARE_WORKER_TOKEN', 'worker-token-fixture')
    sendEmail.mockClear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('adds a service they asked for: priced by the worker, totals worked out once, sent back for review, and nothing counted on the plan', async () => {
    workerAnswers(pricedBeta)
    const { db, updates, touched } = fakeDb(SERVICES)
    const result = await addSectionForCustomer(db, quote(), { serviceId: 'svc_beta' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pricing).toMatchObject({ subtotal: 380, taxAmount: 38, total: 418 })
    expect(result.section).toMatchObject({ serviceId: 'svc_beta', addedBy: 'customer', subtotal: 180 })
    expect(result.status).toBe('pending_review')
    expect(result.alsoAsked.map((a) => a.state)).toEqual(['added', 'offered'])
    const saved = updates[0]!
    expect(saved).toMatchObject({ status: 'pending_review', review_hold: 'shown', approved_at: null, pdf_asset_id: null })
    // where it stood is remembered, so removing the service can put it back
    expect((saved.content_json as Row).sectionsBefore).toEqual({ status: 'sent', approvedAt: null, reviewHold: null })
    // one request is one quote: no usage counter, no subscription, no plan row is touched
    expect(touched.filter((t) => !['tenants', 'services', 'quotes'].includes(t))).toEqual([])
    // the worker was asked with its token, and nothing else was called
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('http://worker.test/section')
    expect(init.headers.Authorization).toBe('Bearer worker-token-fixture')
    expect(JSON.parse(init.body)).toMatchObject({ quoteId: 'qte_fixture', serviceId: 'svc_beta', answers: [] })
  })

  it('a "hold until approved" service is added without hiding the quote: its part is marked, the main price stays, accepting waits', async () => {
    workerAnswers({ ...pricedBeta, reviewMode: 'hold_until_approved' })
    const { db, updates } = fakeDb(SERVICES_BETA_HOLDS)
    const before = quote({ status: 'viewed', approved_at: '2026-11-17T09:00:00.000Z' })
    const result = await addSectionForCustomer(db, before, { serviceId: 'svc_beta' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const saved = updates[0]!
    // still shown to the customer (never 'held'), waiting for the business, so accepting is locked
    expect(saved).toMatchObject({ status: 'pending_review', review_hold: 'shown', approved_at: null })
    expect(result.section).toMatchObject({ serviceId: 'svc_beta', awaitingApproval: true })
    // the business's copy carries the full figures; the customer's is the quote as it was
    expect(saved.pricing_json).toMatchObject({ subtotal: 380, total: 418 })
    expect(pricingForCustomer(saved.pricing_json as CombinedPricing, 'pending_review', TAX).pricing).toEqual(before.pricing_json)

    // removing it restores the quote exactly: figures, status, approval
    const waiting = quote({ status: 'pending_review', review_hold: 'shown', approved_at: null, pricing_json: saved.pricing_json as CombinedPricing, content_json: saved.content_json as SectionQuoteRow['content_json'] })
    const removed = await removeSectionForCustomer(db, waiting, 'svc_beta')
    expect(removed).toMatchObject({ ok: true, status: 'viewed' })
    expect(updates[1]).toMatchObject({ status: 'viewed', approved_at: '2026-11-17T09:00:00.000Z', review_hold: null })
    expect(updates[1]!.pricing_json).toEqual(before.pricing_json)
    expect((updates[1]!.content_json as Row).alsoAsked).toEqual(before.content_json?.alsoAsked)
    expect((updates[1]!.content_json as Row).sectionsBefore).toBeUndefined()
  })

  it('a service reviewed first but not held is added with its price showing', async () => {
    workerAnswers(pricedBeta)
    const { db } = fakeDb(SERVICES)
    const result = await addSectionForCustomer(db, quote(), { serviceId: 'svc_beta' })
    expect(result.ok && result.section?.awaitingApproval).toBeUndefined()
  })

  it('a part the business has since approved is not hidden again when the customer adds another', async () => {
    workerAnswers({ success: true, ready: true, serviceName: 'Service Gamma', reviewMode: 'auto_send', section: { serviceId: 'svc_gamma', serviceName: 'Service Gamma', breakdown: gamma().breakdown, subtotal: gamma().subtotal } })
    const { db, updates } = fakeDb(SERVICES_BETA_HOLDS)
    const approved = quote({ status: 'sent', approved_at: '2026-11-17T13:00:00.000Z', pricing_json: withSections(main(), [beta({ awaitingApproval: true })], TAX) })
    const result = await addSectionForCustomer(db, approved, { serviceId: 'svc_gamma' })
    expect(result.ok).toBe(true)
    const saved = updates[0]!.pricing_json as CombinedPricing
    expect(saved.sections?.map((s) => [s.serviceId, s.awaitingApproval === true])).toEqual([['svc_beta', false], ['svc_gamma', false]])
    // the quote waits again (Service Beta is reviewed first), with every price still showing
    expect(updates[0]).toMatchObject({ status: 'pending_review', review_hold: 'shown' })
    expect(pricingForCustomer(saved, 'pending_review', TAX).awaiting).toEqual([])
  })

  it('a service that needs answers is not added until they are given: the questions come back', async () => {
    workerAnswers({ success: true, ready: false, serviceName: 'Service Gamma', questions: [{ key: 'gamma_count', label: 'How many gamma units?', type: 'number' }] })
    const { db, updates } = fakeDb(SERVICES)
    const result = await addSectionForCustomer(db, quote(), { serviceId: 'svc_gamma' })
    expect(result).toMatchObject({ ok: false, status: 422, code: 'ANSWERS_NEEDED', questions: [{ key: 'gamma_count' }] })
    expect(updates).toEqual([])
  })

  it('only something the customer asked for and the business offers can be added; never twice; never a third', async () => {
    workerAnswers(pricedBeta)
    const { db, updates } = fakeDb(SERVICES)
    expect(await addSectionForCustomer(db, quote(), { serviceId: 'svc_not_asked_for' })).toMatchObject({ ok: false, status: 404, code: 'NOT_OFFERED' })
    const notOffered = quote({ content_json: { alsoAsked: [{ id: 'x', words: 'repaint my boat', serviceId: null, state: 'not_offered' }] } })
    expect(await addSectionForCustomer(db, notOffered, { serviceId: 'svc_beta' })).toMatchObject({ ok: false, status: 404 })
    const withBeta = quote({ pricing_json: withSections(main(), [beta()], TAX) })
    expect(await addSectionForCustomer(db, withBeta, { serviceId: 'svc_beta' })).toMatchObject({ ok: false, status: 409, code: 'ALREADY_ADDED' })
    const full = quote({ pricing_json: withSections(main(), [beta(), gamma()], TAX) })
    expect(await addSectionForCustomer(db, full, { serviceId: 'svc_beta' })).toMatchObject({ ok: false, status: 409 })
    expect(updates).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a quote the customer cannot see, or has already decided on, cannot be changed', async () => {
    workerAnswers(pricedBeta)
    const { db } = fakeDb(SERVICES)
    for (const closed of [
      quote({ status: 'accepted' }),
      quote({ status: 'declined' }),
      quote({ status: 'pending_review', review_hold: 'check' }),
      quote({ status: 'pending_review', review_hold: 'held' }),
      quote({ status: 'awaiting_clarification' }),
      quote({ status: 'failed' }),
    ]) {
      expect(customerCanChangeSections(closed), closed.status).toBe(false)
      expect(await addSectionForCustomer(db, closed, { serviceId: 'svc_beta' })).toMatchObject({ ok: false, status: 409, code: 'NOT_CHANGEABLE' })
    }
    expect(customerCanChangeSections(quote({ status: 'pending_review', review_hold: 'shown' }))).toBe(true)
    expect(customerCanChangeSections(quote({ status: 'viewed' }))).toBe(true)
  })

  it('the worker not answering is "try again", never a made-up price', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    const { db, updates } = fakeDb(SERVICES)
    expect(await addSectionForCustomer(db, quote(), { serviceId: 'svc_beta' })).toMatchObject({ ok: false, status: 503, code: 'TRY_AGAIN' })
    workerAnswers({ success: false, reason: 'no_price' }, 409)
    expect(await addSectionForCustomer(db, quote(), { serviceId: 'svc_beta' })).toMatchObject({ ok: false, status: 404 })
    expect(updates).toEqual([])
  })

  it('removing the only added service puts the totals and the quote back where they stood', async () => {
    const { db, updates } = fakeDb(SERVICES)
    const waiting = quote({
      status: 'pending_review',
      review_hold: 'shown',
      pricing_json: withSections(main(), [beta()], TAX),
      content_json: { ...quote().content_json, sectionsBefore: { status: 'viewed', approvedAt: '2026-11-17T09:00:00.000Z', reviewHold: null } },
    })
    const result = await removeSectionForCustomer(db, waiting, 'svc_beta')
    expect(result).toMatchObject({ ok: true, status: 'viewed', pricing: { subtotal: 200, taxAmount: 20, total: 220 } })
    expect(updates[0]).toMatchObject({ status: 'viewed', approved_at: '2026-11-17T09:00:00.000Z', review_hold: null })
    expect((updates[0]!.content_json as Row).sectionsBefore).toBeUndefined()
    expect(await removeSectionForCustomer(db, quote(), 'svc_beta')).toMatchObject({ ok: false, status: 404 })
  })

  it('a quote the business has approved since is not pulled back by a removal', async () => {
    const { db, updates } = fakeDb(SERVICES)
    const approved = quote({
      status: 'sent',
      approved_at: '2026-11-17T13:00:00.000Z',
      pricing_json: withSections(main(), [beta()], TAX),
      content_json: { ...quote().content_json, sectionsBefore: { status: 'viewed', approvedAt: null, reviewHold: null } },
    })
    const result = await removeSectionForCustomer(db, approved, 'svc_beta')
    expect(result).toMatchObject({ ok: true, status: 'sent' })
    expect(updates[0]!.status).toBeUndefined()
  })
})

describe('emails and the accuracy report', () => {
  const combined = withSections(main(), [beta()], TAX)

  it('the business’s notice is a "request updated" about the same quote, with each section and the one total', () => {
    const mail = requestUpdatedEmail({ customerName: 'Megan <Grant>', mainServiceName: 'Service Alpha', changedServiceName: 'Service Beta', change: 'added', pricing: combined, locale: 'en-US', awaitingApproval: true, dashboardUrl: 'https://app.test/app/quotes/q1', approveUrl: 'https://app.test/approve/t' })
    expect(mail.subject).toBe('Request updated: Megan <Grant> added Service Beta to their quote ($418.00)')
    expect(mail.html).toContain('Megan &lt;Grant&gt;')
    expect(mail.html).toContain('It is still one quote, with one total.')
    expect(mail.html.match(/data-role="section-subtotal"/g)).toHaveLength(2)
    expect(mail.html).toContain('$200.00')
    expect(mail.html).toContain('$180.00')
    expect(mail.html).toContain('$38.00')
    expect(mail.html).toContain('data-role="approve"')
    expect(mail.html).toContain('The customer can accept it once you approve.')
    // a part whose service holds until approved: the business is told the customer sees no price for it
    const waitingMail = requestUpdatedEmail({ customerName: 'Megan Grant', mainServiceName: 'Service Alpha', changedServiceName: 'Service Beta', change: 'added', pricing: withSections(main(), [beta({ awaitingApproval: true })], TAX), locale: 'en-US', awaitingApproval: true, dashboardUrl: 'https://app.test/app/quotes/q1', approveUrl: 'https://app.test/approve/t' })
    expect(waitingMail.html).toContain('The customer sees no price for Service Beta until you approve. The rest of the quote is as they saw it. They can accept once you approve.')
    expect(waitingMail.html).toContain('$418.00')
    const removed = requestUpdatedEmail({ customerName: 'Megan Grant', mainServiceName: 'Service Alpha', changedServiceName: 'Service Beta', change: 'removed', pricing: main(), locale: 'en-US', awaitingApproval: false, dashboardUrl: 'https://app.test/app/quotes/q1', isTest: true })
    expect(removed.subject).toBe('[TEST] Request updated: Megan Grant took Service Beta off their quote ($220.00)')
    expect(removed.html).not.toContain('data-role="approve"')
    expect(removed.html).toContain('Nothing is needed from you')
  })

  it('every email that states the price lists the sections of a combined quote, and adds nothing to a single-service one', () => {
    const rows = sectionsEmailHtml(combined, 'Service Alpha', 'en-US')
    for (const text of ['Service Alpha', 'Service Beta', '$200.00', '$180.00', 'Sales tax', '$38.00', '$418.00']) expect(rows).toContain(text)
    expect(sectionsEmailHtml(main(), 'Service Alpha', 'en-US')).toBe('')
    expect(sectionsEmailHtml(null, 'Service Alpha', 'en-US')).toBe('')
    for (const path of ['apps/web/src/lib/quote-approval.ts', 'apps/web/src/app/api/quotes/[quoteId]/resend/route.ts', 'apps/web/src/app/api/quotes/[quoteId]/route.ts', 'apps/web/src/app/api/public/quotes/[quoteId]/accept/route.ts']) {
      expect(read(path), path).toContain('sectionsEmailHtml(')
    }
  })

  it('a combined quote counts in Overall accuracy only: one invoice says nothing about any one service', () => {
    const report = computeAccuracy([
      { serviceName: 'Service Alpha', quoted: 200, invoiced: 210, grade: 'A' },
      { serviceName: 'Service Alpha', quoted: 418, invoiced: 400, grade: 'A', combined: true },
    ])
    expect(report.overall?.count).toBe(2)
    expect(report.byService).toEqual([expect.objectContaining({ key: 'Service Alpha', count: 1 })])
    expect(report.byGrade).toEqual([expect.objectContaining({ key: 'Grade A', count: 1 })])
  })

  it('the public add and remove endpoints are counted before anything is read, token-checked, then counted for the quote and the business', () => {
    const route = read('apps/web/src/app/api/public/quotes/[quoteId]/sections/route.ts')
    const order = ['limitQuoteAction(request)', 'createAdminClient()', 'quoteTokenMatches(', 'limitQuoteAndBusinessActions(']
    const at = order.map((s) => route.indexOf(s))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(route).toContain('export async function POST')
    expect(route).toContain('export async function DELETE')
  })
})
