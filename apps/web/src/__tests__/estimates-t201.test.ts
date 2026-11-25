/**
 * T-201, the quote link and estimates (items 11, 15 to 20, 27, 28):
 *
 *   11  the business opening its own quote link does not tick "Share your quote link"
 *   15  "Preview on a demo page" (the developer page) is gone from the dashboard
 *   16  the Advanced tip names the real page, not "Pricing Rules"
 *   17  only an estimate that waits for approval says the business "will review and confirm it"
 *   18  "Hold until I approve": no price and no low or high figure until the business approves
 *   19  "Try again" on a request that could not be priced, never counted a second time
 *   20  the pricing trace says "What Qolumns understood" in lines, not the stored record
 *   27  "Default Terms & Conditions" are printed on the estimate page and the PDF, when filled in
 *   28  the Quote Template tick boxes say "PDF only"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { QUOTE_TURN_COPY, customerEstimateNote, customerRangeAllowed, customerSeesNoFigure, findConfidenceLanguage, isShownEarly } from '@qolumns/shared'
import type { QuoteContent, QuotePricing, TenantBranding, TenantTemplate } from '@qolumns/shared'
import { BUSINESS_RETRY_LIMIT, RETRY_COPY, businessRetriesOf, canBusinessRetry } from '@/lib/quote-retry-rules'
import { TRACE_UNDERSTOOD_COPY, fromWords, keyWords, understoodTrace, understoodTraceEmpty, valueWords } from '@/lib/trace-understood'
import { TERMS_HEADING, TERMS_MAX_CHARS, customerTerms, termsParagraphs } from '@/lib/quote-terms'
import { generateQuotePdfHtml } from '@/lib/pdf-template'
import { PDF_ONLY_LINE, PDF_ONLY_TAG } from '@/components/dashboard/PdfOnlyTag'

const read = (path: string) => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')

// ---------------------------------------------------------------------------
describe('T-201 item 11: the business opening its own quote link is not a share', () => {
  // T-202 went further: opening the link ticks nothing for anyone (a visit cannot tell the owner from a
  // customer), so the "own visit" mark and the first-visit rule of T-201 are gone. share-t202.test.ts
  // holds the rule as it is now. What is left of item 11:
  it('both "Open" buttons open the plain link, and Copy copies it', () => {
    for (const file of ['apps/web/src/components/home/HomeQuoteLink.tsx', 'apps/web/src/components/share/QuoteLinkCard.tsx']) {
      const source = read(file)
      expect(source, file).toMatch(/href=\{(link|main)\}/)
      expect(source, file).not.toContain('ownVisitUrl')
      expect(source, file).toMatch(/copy\('(home-link|link)', (link|main)\)/)
    }
  })

  it('the page records no visit', () => {
    const page = read('apps/web/src/app/quote/[slug]/page.tsx')
    expect(page).not.toMatch(/markFirstVisit|countsAsFirstVisit|OwnVisitMark|searchParams/)
  })
})

// ---------------------------------------------------------------------------
describe('T-201 items 15 and 16: the Quote link page', () => {
  it('no link to the developer page, and no "Preview on a demo page" button', () => {
    const card = read('apps/web/src/components/share/EmbedCodeCard.tsx')
    expect(card).not.toContain('href={`/demo')
    expect(card).not.toMatch(/>\s*Preview on a demo page\s*</)
  })

  it('the Advanced tip names Services, "Customer Questions", "Adjustments" and "Pricing Setup": no "Pricing Rules", no Field ID to type', () => {
    const builder = read('apps/web/src/components/share/FormFieldsBuilder.tsx')
    const tip = builder.slice(builder.indexOf('To change a price by an answer'), builder.indexOf('To change a price by an answer') + 900)
    expect(tip).toContain('href="/app/services"')
    for (const name of ['Customer Questions', 'Adjustments', 'Pricing Setup']) expect(tip).toContain(name)
    expect(builder).not.toMatch(/Go to Pricing Rules/)
    expect(builder).not.toContain('Use with Pricing Multipliers')
    expect(builder).not.toContain('when setting up multiplier conditions')
  })

  it('the names the tip uses are the service editor’s own', () => {
    const services = read('apps/web/src/app/(dashboard)/app/services/page.tsx')
    expect(services).toContain("label: 'Customer Questions'")
    expect(services).toContain("label: 'Pricing Setup'")
    expect(services).toContain('Adjustments')
  })
})

// ---------------------------------------------------------------------------
describe('T-201 item 17: only an estimate that waits for approval says the business will review it', () => {
  const businessName = 'Harlow Painting'

  it('sent automatically: an estimate, and no review is promised', () => {
    const line = customerEstimateNote({ reviewed: false, confirmationPending: false, businessName })
    expect(line).toBe('This is an estimate based on your photos and details.')
    expect(line).not.toMatch(/review|confirm/i)
  })

  it('shown while it waits for approval: the business will review and confirm it', () => {
    expect(customerEstimateNote({ reviewed: false, confirmationPending: true, businessName })).toBe(
      'This is an estimate based on your photos and details. Harlow Painting will review and confirm it.'
    )
  })

  it('approved: reviewed and confirmed', () => {
    expect(customerEstimateNote({ reviewed: true, confirmationPending: false, businessName })).toBe('Reviewed and confirmed by Harlow Painting.')
    expect(customerEstimateNote({ reviewed: true, confirmationPending: true, businessName })).toBe('Reviewed and confirmed by Harlow Painting.')
  })

  it('none of the three uses a word a customer must not read', () => {
    for (const reviewed of [true, false]) for (const confirmationPending of [true, false]) expect(findConfidenceLanguage(customerEstimateNote({ reviewed, confirmationPending, businessName }))).toEqual([])
  })

  it('the customer’s page words the line with it, and types no "will review and confirm it" of its own', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('customerEstimateNote({ reviewed: isReviewedQuote, confirmationPending, businessName: business.name })')
    expect(page).not.toContain('will review and confirm it')
  })

  it('the email that says so goes only to an estimate shown before approval', () => {
    const templates = read('apps/worker/src/email/templates.ts')
    expect(templates).toMatch(/const estimate = data\.awaitingConfirmation === true\s+const validitySection = estimate\s+\? `[^`]*will review and confirm this estimate/)
  })
})

// ---------------------------------------------------------------------------
describe('T-201 item 18: "Hold until I approve" shows no figure until the business approves', () => {
  it('a quote waiting for the business that was not shown early: no figure', () => {
    expect(customerSeesNoFigure({ status: 'pending_review', shownEarly: false })).toBe(true)
  })

  it('"Show the estimate, then I confirm it" still shows it, and a sent quote is not withheld', () => {
    expect(customerSeesNoFigure({ status: 'pending_review', shownEarly: true })).toBe(false)
    for (const status of ['sent', 'viewed', 'accepted', 'awaiting_clarification']) expect(customerSeesNoFigure({ status, shownEarly: false }), status).toBe(false)
  })

  it('a held quote is never "shown early", whatever range the engine measured', () => {
    const held = { status: 'pending_review', review_hold: 'held', total: 1400 }
    expect(isShownEarly(held)).toBe(false)
    expect(customerSeesNoFigure({ status: held.status, shownEarly: isShownEarly(held) })).toBe(true)
    expect(customerSeesNoFigure({ status: 'pending_review', shownEarly: isShownEarly({ status: 'pending_review', review_hold: 'check', total: 1400 }) })).toBe(true)
  })

  it('a range is for a customer confirming a detail, never for a quote waiting for the business', () => {
    expect(customerRangeAllowed({ status: 'awaiting_clarification', mode: 'show_then_confirm' })).toBe(true)
    expect(customerRangeAllowed({ status: 'awaiting_clarification', mode: 'auto_send' })).toBe(true)
    for (const mode of ['show_then_confirm', 'hold_until_approved', 'auto_send'] as const) expect(customerRangeAllowed({ status: 'pending_review', mode }), mode).toBe(false)
  })

  it('…and not even then for a service that holds until approved', () => {
    expect(customerRangeAllowed({ status: 'awaiting_clarification', mode: 'hold_until_approved' })).toBe(false)
  })

  it('the public quote API uses both rules, and sends no note, no wording and no PDF link with a withheld price', () => {
    const route = read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    expect(route).toContain('customerRangeAllowed({ status: customerStatus, mode: reviewModeOf(serviceRow ?? {}) })')
    expect(route).toContain('customerSeesNoFigure({ status: customerStatus, shownEarly })')
    expect(route).toContain('if (isProvisional) delete actions.pdfUrl')
    expect(route).toContain('notes: noFigures ? [] : pricing.notes || []')
    expect(route).toMatch(/notes: noFigures\s+\? \{ validityDays: content\.validityDays \}/)
    expect(route).toContain('!noFigures && content.crossServicePricing')
    expect(route).toContain('!noFigures && content.signalRecommendations')
    // the old rule: a measured range was shown while the business reviewed
    expect(route).not.toContain('hasMeasuredRange')
  })

  it('the public PDF address refuses a held quote and one still being confirmed', () => {
    const route = read('apps/web/src/app/api/public/quotes/[quoteId]/pdf/route.ts')
    expect(route).toContain("quote.status === 'awaiting_clarification' || customerSeesNoFigure(")
    // T-204: the address no longer needs a PDF the business made (it makes one), so the refusal is the rule alone
    expect(route).toContain('!customerCanDownloadPdf(quote.status as string) || priceWithheld ||')
  })

  it('the request form keeps no range on the screen for a held quote', () => {
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).not.toContain('data-testid="finished-held"')
  })

  it('the customer’s page shows the holding screen for a held quote, and asks for the details with no figure when no range is sent', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain("const awaitingBusiness = status === 'pending_review' && !quote.provisional && !confirmationPending")
    expect(page).toContain("if (quote.provisional || status === 'awaiting_clarification') {")
    expect(page).toContain('data-testid="confirm-no-figure"')
  })
})

// ---------------------------------------------------------------------------
describe('T-201 item 19: "Try again" on a request that could not be priced', () => {
  it('only a failed request, and only so many times', () => {
    expect(canBusinessRetry({ status: 'failed', content_json: { error: 'x' } })).toBe(true)
    expect(canBusinessRetry({ status: 'failed', content_json: { businessRetries: BUSINESS_RETRY_LIMIT - 1 } })).toBe(true)
    expect(canBusinessRetry({ status: 'failed', content_json: { businessRetries: BUSINESS_RETRY_LIMIT } })).toBe(false)
    for (const status of ['queued', 'generating', 'pending_review', 'sent', 'accepted']) expect(canBusinessRetry({ status, content_json: {} }), status).toBe(false)
  })

  it('tries are read from the quote, and anything that is not a count is none', () => {
    expect(businessRetriesOf(null)).toBe(0)
    expect(businessRetriesOf({ businessRetries: '3' })).toBe(0)
    expect(businessRetriesOf({ businessRetries: -1 })).toBe(0)
    expect(businessRetriesOf({ businessRetries: 2 })).toBe(2)
  })

  it('the words: no dash, and the limit names the number', () => {
    expect(QUOTE_TURN_COPY.pageButtons.tryAgain).toBe('Try again')
    expect(RETRY_COPY.limit).toContain(String(BUSINESS_RETRY_LIMIT))
    for (const line of Object.values(RETRY_COPY)) expect(line).not.toMatch(/[—–]/)
  })

  it('the page offers it on a failed request with tries left, through the same route as "Price this request"', () => {
    const page = read('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain('canBusinessRetry({ status: quote.status, content_json: content }) && { onTryAgain: handleTryAgain }')
    const handler = page.slice(page.indexOf('const handleTryAgain'), page.indexOf('const handleTextLink'))
    expect(handler).toContain('fetch(`/api/quotes/${quoteId}/process`, { method: \'POST\' })')
    const box = read('apps/web/src/components/quotes/NextStepBox.tsx')
    expect(box).toContain('data-testid="try-again"')
    expect(box).toContain('B.tryAgain')
  })

  it('the route hands a failed request to the retry before any claim on the plan', () => {
    const route = read('apps/web/src/app/api/quotes/[quoteId]/process/route.ts')
    const retry = route.indexOf("if (quote.status === 'failed') {")
    expect(retry).toBeGreaterThan(-1)
    expect(route.slice(retry, retry + 200)).toContain('return retryFailedQuote(')
    // whatever prices a held request (and counts it) comes after
    expect(route.indexOf('limitHold')).toBeGreaterThan(retry)
  })

  it('the retry itself claims nothing: it does not read or change the plan’s count', () => {
    const retry = read('apps/web/src/lib/quote-retry.ts')
    const code = retry.slice(retry.indexOf('import { NextResponse }'))
    expect(code).not.toMatch(/plan-limits|claimPlanQuote|releasePlanQuote|claim_plan_quote|usage_counters/)
  })
})

// ---- the retry against a quote held in memory -------------------------------
const queued: Array<{ quoteId: string }> = []
let failQueue = false
vi.mock('@/lib/queue', () => ({
  enqueueQuoteJob: async (job: { quoteId: string }) => {
    if (failQueue) throw new Error('worker unreachable')
    queued.push(job)
  },
}))
const markedFailed: string[] = []
vi.mock('@/lib/failed-quote', () => ({
  markQuoteFailed: async (_admin: unknown, quoteId: string) => {
    markedFailed.push(quoteId)
    return { marked: true, emailed: false }
  },
}))

type QuoteRow = { id: string; tenant_id: string; status: string; content_json: Record<string, unknown>; quote_request_id: string; quote_token_hash?: string }

/** A service-role client over one quote and one business: just the calls the retry makes */
function fakeAdmin(quote: QuoteRow, tenant: { suspended_at: string | null }) {
  const tables: string[] = []
  const admin = {
    tables,
    from(table: string) {
      tables.push(table)
      if (table === 'tenants') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenant, error: null }) }) }) }
      if (table !== 'quotes') throw new Error(`unexpected table ${table}`)
      return {
        update(values: Partial<QuoteRow>) {
          const filters: Record<string, unknown> = {}
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value
              return chain
            },
            async select() {
              const matches = Object.entries(filters).every(([column, value]) => (quote as unknown as Record<string, unknown>)[column] === value)
              if (!matches) return { data: [], error: null }
              Object.assign(quote, values)
              return { data: [{ id: quote.id }], error: null }
            },
          }
          return chain
        },
      }
    },
  }
  return admin
}

describe('T-201 item 19: the retry runs the pricing again and counts nothing', () => {
  const fresh = (): QuoteRow => ({
    id: 'qte_1',
    tenant_id: 'tnt_1',
    status: 'failed',
    content_json: { error: 'The model did not answer', failedAt: '2026-11-24T09:00:00Z', failedNotifiedAt: '2026-11-24T09:00:01Z' },
    quote_request_id: 'qr_1',
    quote_token_hash: 'old',
  })

  beforeEach(() => {
    queued.length = 0
    markedFailed.length = 0
    failQueue = false
  })

  it('a failed request goes back to the pricing worker, with its try counted and "the business was told" kept', async () => {
    const { retryFailedQuote } = await import('@/lib/quote-retry')
    const quote = fresh()
    const admin = fakeAdmin(quote, { suspended_at: null })
    const response = await retryFailedQuote(admin as never, quote)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ queued: true, retried: true })
    expect(quote.status).toBe('queued')
    expect(quote.content_json).toEqual({ failedNotifiedAt: '2026-11-24T09:00:01Z', businessRetries: 1 })
    expect(quote.quote_token_hash).not.toBe('old')
    expect(queued.map((job) => job.quoteId)).toEqual(['qte_1'])
    // nothing but the quote and the business's paused flag is touched: no plan, no usage count
    expect([...new Set(admin.tables)].sort()).toEqual(['quotes', 'tenants'])
  })

  it('a paused business prices nothing', async () => {
    const { retryFailedQuote } = await import('@/lib/quote-retry')
    const quote = fresh()
    const response = await retryFailedQuote(fakeAdmin(quote, { suspended_at: '2026-11-20T00:00:00Z' }) as never, quote)
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('ACCOUNT_PAUSED')
    expect(quote.status).toBe('failed')
    expect(queued).toEqual([])
  })

  it('after the last try it is refused, in words that say what to do', async () => {
    const { retryFailedQuote } = await import('@/lib/quote-retry')
    const quote = { ...fresh(), content_json: { businessRetries: BUSINESS_RETRY_LIMIT } }
    const response = await retryFailedQuote(fakeAdmin(quote, { suspended_at: null }) as never, quote)
    expect(response.status).toBe(429)
    expect((await response.json()).error).toEqual({ code: 'RETRY_LIMIT', message: RETRY_COPY.limit })
    expect(queued).toEqual([])
  })

  it('a request someone else started a moment ago is not started twice', async () => {
    const { retryFailedQuote } = await import('@/lib/quote-retry')
    const stored = { ...fresh(), status: 'queued' }
    // the caller read it while it was still failed
    const response = await retryFailedQuote(fakeAdmin(stored, { suspended_at: null }) as never, { ...stored, status: 'failed' })
    expect(response.status).toBe(200)
    expect(queued).toEqual([])
  })

  it('a worker that cannot be reached leaves it failed, and says so', async () => {
    const { retryFailedQuote } = await import('@/lib/quote-retry')
    failQueue = true
    const quote = fresh()
    const response = await retryFailedQuote(fakeAdmin(quote, { suspended_at: null }) as never, quote)
    expect(response.status).toBe(502)
    expect(markedFailed).toEqual(['qte_1'])
  })
})

// ---------------------------------------------------------------------------
describe('T-201 item 20: the pricing trace says what was understood, in lines', () => {
  const stored = {
    extractedAt: '2026-11-24T09:00:00Z',
    overallConfidence: 0.82,
    signals: [
      { key: 'wall_area_sqft', value: 919.14, confidence: 0.7, source: 'vision', basis: 'measured', evidence: 'measured across 3 passes, spread 6%', quantityBand: { low: 860, high: 980 } },
      { key: 'tank_capacity', value: 50, confidence: 0.95, source: 'vision', basis: 'identified', evidence: 'Read from the rating label (photo 2): "50 GAL" → 50' },
      { key: 'storeys', value: 'two_storey', confidence: 0.9, source: 'form' },
      { key: 'hasPets', value: true, confidence: 0.6, source: 'nlp', evidence: 'the customer mentions a dog' },
      { key: 'empty', value: '', confidence: 0.1, source: 'inferred' },
    ],
    condition: { rating: 'fair', notes: 'some flaking on the south wall' },
    complexity: { level: 'medium', factors: ['second storey', 'narrow side access'] },
    siteVisitRecommended: true,
    siteVisitReason: 'the rear wall is not in any photo',
    lowConfidenceSignals: ['hasPets'],
  }
  const expected = [{ signalKey: 'wall_area_sqft', description: 'Exterior wall area. Measured in square feet.' }]

  it('one line per item: its name, its value, where it came from, the note kept with it', () => {
    const trace = understoodTrace(stored, expected)
    expect(trace.lines).toEqual([
      { name: 'Exterior wall area', value: '919.14', from: 'Measured from the photos', note: 'Measured across 3 passes, spread 6%', range: 'Likely between 860 and 980' },
      { name: 'Tank capacity', value: '50', from: 'Read from a label in a photo', note: 'Read from the rating label (photo 2): "50 GAL" → 50' },
      { name: 'Storeys', value: 'Two storey', from: 'From the form' },
      { name: 'Has pets', value: 'Yes', from: 'From what the customer wrote', note: 'The customer mentions a dog', unsure: true },
    ])
  })

  it('what was noted about the job as a whole, each as a sentence', () => {
    expect(understoodTrace(stored, expected).notes).toEqual([
      'Condition: fair. Some flaking on the south wall',
      'How hard the job looks: medium (second storey; narrow side access)',
      'A visit before the job is suggested: the rear wall is not in any photo',
    ])
  })

  it('no stored key, no bracket and no score reaches the page', () => {
    const trace = understoodTrace(stored, expected)
    const all = JSON.stringify([trace.lines.map((l) => [l.name, l.value, l.from, l.range]), trace.notes])
    expect(all).not.toMatch(/wall_area_sqft|tank_capacity|hasPets|overallConfidence|0\.82|0\.7\b|lowConfidenceSignals|siteVisitRecommended/)
  })

  it('a record with nothing in it is "nothing", not an empty box', () => {
    expect(understoodTraceEmpty(understoodTrace({ signals: [], siteVisitRecommended: false, lowConfidenceSignals: [] }))).toBe(true)
    expect(understoodTraceEmpty(understoodTrace(null))).toBe(true)
    expect(understoodTraceEmpty(understoodTrace(stored))).toBe(false)
  })

  it('the small words', () => {
    expect(keyWords('wall_area_sqft')).toBe('Wall area sqft')
    expect(keyWords('hasPets')).toBe('Has pets')
    expect(valueWords(1250)).toBe('1,250')
    expect(valueWords(false)).toBe('No')
    expect(valueWords('Needs a new valve')).toBe('Needs a new valve')
    expect(fromWords('vision', undefined)).toBe('From the photos')
    expect(fromWords('form', 'confirmed')).toBe('Confirmed by the customer')
    expect(fromWords('vision', 'scanned')).toBe('Measured by the room scan')
  })

  it('the page uses it under the new heading, and prints no stored record', () => {
    const page = read('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/trace/page.tsx')
    expect(TRACE_UNDERSTOOD_COPY.title).toBe('What Qolumns understood')
    expect(page).toContain('{TRACE_UNDERSTOOD_COPY.title}')
    expect(page).toContain('understoodTrace(quote.signals_json, quote.service?.expected_signals)')
    expect(page).not.toMatch(/>\s*Extracted Signals\s*</)
    expect(page).not.toContain('JSON.stringify(quote.signals_json')
  })

  it('it is still reached from "More" on the quote page', () => {
    const list = read('apps/web/src/app/(dashboard)/app/quotes/page.tsx')
    expect(list).toContain("label: M.pricingTrace, href: `/app/quotes/${quote.quoteId}/trace`")
    expect(QUOTE_TURN_COPY.more.pricingTrace).toBe('Pricing trace')
  })
})

// ---------------------------------------------------------------------------
describe('T-201 item 27: "Default Terms & Conditions" are printed, when filled in', () => {
  it('the business’s words, trimmed; empty or only spaces is no terms', () => {
    expect(customerTerms('  Payment is due on completion.\r\nA deposit of 20% books the job.  ')).toBe('Payment is due on completion.\nA deposit of 20% books the job.')
    for (const nothing of [null, undefined, '', '   \n  ', 42]) expect(customerTerms(nothing)).toBeNull()
  })

  it('a pasted contract is cut at a page of text', () => {
    const long = customerTerms('x'.repeat(TERMS_MAX_CHARS + 500))!
    expect(long.length).toBe(TERMS_MAX_CHARS + 1)
    expect(long.endsWith('…')).toBe(true)
  })

  it('paragraphs and lines are kept', () => {
    expect(termsParagraphs('One.\nTwo.\n\n\nThree.')).toEqual([['One.', 'Two.'], ['Three.']])
  })

  const branding = { logoAssetId: null, primaryColor: '#205E56', footerNotes: 'Thank you for your business.' } as TenantBranding
  const template: TenantTemplate = { showLineItems: true, includeAssumptions: true, includeExclusions: true, validityDays: 30 }
  const pricing = { currency: 'USD', subtotal: 720, taxAmount: 0, total: 720, breakdown: [{ label: 'Exterior walls', amount: 720 }], notes: [] } as unknown as QuotePricing
  const pdf = (terms?: string | null) =>
    generateQuotePdfHtml({
      quoteId: 'q_test',
      businessName: 'Harlow Painting',
      branding,
      template,
      customer: { name: 'Dev Raman', email: 'dev.raman@example.com' },
      pricing,
      content: { scopeSummary: 'Paint the exterior walls.' } as QuoteContent,
      createdAt: '2026-11-24T10:00:00Z',
      locale: 'en-US',
      ...(terms !== undefined && { terms }),
    })

  it('the PDF prints them after the price and before the footer, with their line breaks, and safely', () => {
    const html = pdf('Payment is due on completion.\nA deposit of 20% books the job.\n\nPrices <b>hold</b> for 30 days & no longer.')
    expect(html).toContain(TERMS_HEADING)
    expect(html).toContain('Payment is due on completion.<br />A deposit of 20% books the job.')
    expect(html).toContain('Prices &lt;b&gt;hold&lt;/b&gt; for 30 days &amp; no longer.')
    expect(html.indexOf(TERMS_HEADING)).toBeGreaterThan(html.indexOf('$720.00'))
    expect(html.indexOf(TERMS_HEADING)).toBeLessThan(html.indexOf('Thank you for your business.'))
  })

  it('no terms, no heading', () => {
    for (const none of [undefined, null, '']) {
      const html = pdf(none)
      expect(html).not.toContain(TERMS_HEADING)
      expect(html).not.toContain('data-role="terms"')
    }
  })

  it('both the page’s answer and the PDF read them from the business’s setting', () => {
    const view = read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    expect(view).toContain('default_terms_text')
    expect(view).toContain('!isProvisional && customerTerms(tenant.default_terms_text)')
    // T-204: the PDF is made in one place, for the business's download and the customer's
    const pdfMaker = read('apps/web/src/lib/quote-pdf.ts')
    expect(pdfMaker).toContain('terms: customerTerms(tenant.default_terms_text)')
    expect(read('apps/web/src/app/api/quotes/[quoteId]/pdf/route.ts')).toContain('makeQuotePdf(supabase, quoteId, profile.tenant_id)')
  })

  it('the customer’s page prints them below the price and the notes, with the business’s line breaks', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    const terms = page.indexOf('data-testid="quote-terms"')
    expect(terms).toBeGreaterThan(page.indexOf('Price breakdown'))
    expect(terms).toBeGreaterThan(page.indexOf('A note from {business.name}'))
    expect(terms).toBeLessThan(page.indexOf('{/* Photos */}'))
    expect(page.slice(terms, terms + 400)).toContain('whitespace-pre-line')
    expect(page).toContain('{quote.terms && (')
  })

  it('Settings no longer says the text is only saved', () => {
    const settings = read('apps/web/src/app/(dashboard)/app/settings/page.tsx')
    expect(settings).toContain('Printed on your customer’s estimate page and on the PDF, below the price.')
    expect(settings).not.toContain('This text will appear at the bottom of all quotes')
  })
})

// ---------------------------------------------------------------------------
describe('T-201 item 28: the three tick boxes say "PDF only"', () => {
  it('the tag and the line', () => {
    expect(PDF_ONLY_TAG).toBe('PDF only')
    expect(PDF_ONLY_LINE).toContain('PDF only')
  })

  it('each of the three boxes carries the tag, on Settings and on Branding; the accept box and the validity days do not', () => {
    for (const file of ['apps/web/src/app/(dashboard)/app/settings/page.tsx', 'apps/web/src/app/(dashboard)/app/settings/branding/page.tsx']) {
      const page = read(file)
      expect(page.match(/<PdfOnlyTag \/>/g) ?? [], file).toHaveLength(3)
      for (const label of ['Show line items', 'Include assumptions', 'Include exclusions']) {
        expect(page, `${file}: ${label}`).toMatch(new RegExp(`>${label}</span>\\s*<PdfOnlyTag />`))
      }
      expect(page, file).toContain('{PDF_ONLY_LINE}')
    }
  })

  it('the estimate page is unchanged by them: it reads no template setting but the accept button’s', () => {
    const view = read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    for (const setting of ['showLineItems', 'includeAssumptions', 'includeExclusions']) expect(view).not.toContain(setting)
    // …and the PDF still follows all three
    const pdf = read('apps/web/src/lib/pdf-template.ts')
    for (const setting of ['template.showLineItems', 'template.includeAssumptions', 'template.includeExclusions']) expect(pdf).toContain(setting)
  })
})

describe('T-201: files a verify script loads outside Next use no "@/" path', () => {
  // verify-t179 loads these three with tsx, where the "@/" alias does not resolve; the unit tests and
  // the web build both resolve it, so only that script (full level) would notice
  it.each(['pdf-template', 'sections-email', 'request-updated-email', 'quote-terms'])('%s', (name) => {
    expect(read(`apps/web/src/lib/${name}.ts`)).not.toMatch(/from '@\//)
  })
})
