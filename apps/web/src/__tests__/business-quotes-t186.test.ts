/**
 * T-186: what the web side does for a quote the business made itself.
 *
 * The on-site app's view (who is asked, whose answer a line names, the
 * certainty sentence), the quotes list and Home (such a quote is under "Needs
 * you"), the customer's routes (a customer is never shown or allowed to
 * answer its questions), and the two leftovers from T-185.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { QUOTE_GROUP_STATUSES, type QuoteContent, type QuotePricing, type TenantBranding, type TenantTemplate } from '@qolumns/shared'
import { appQuoteView, type AppQuoteRow } from '@/lib/app-quote-view'
import { applyGroupFilter, businessAskedQuoteIds, groupFilter, questionCountOf, requestSourceOf } from '@/lib/business-asked'
import { waitingForYou } from '@/lib/home-numbers'
import { generateQuotePdfHtml } from '@/lib/pdf-template'
import { UNDERSTOOD_COPY, quoteUnderstanding, understoodCopyFor } from '@/lib/quote-understanding'

const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')
const request = { description: null, answers: [], postcode: null, address: null, quantity: null }

const row = (over: Partial<AppQuoteRow> = {}): AppQuoteRow => ({
  id: 'qte_1',
  status: 'awaiting_clarification',
  created_at: '2026-11-19T10:00:00Z',
  customer_json: { name: 'Jordan Reyes' },
  pricing_json: {
    currency: 'USD',
    subtotal: 810,
    taxAmount: 0,
    total: 810,
    breakdown: [
      { label: 'Rooms  $375 × 2 rooms', amount: 750, source: 'answer' },
      { label: 'Call-out', amount: 60, source: 'fixed' },
    ],
    // as stored by a worker from before T-186: graded B for a doubted typed quantity, worded as a measurement
    estimate: { grade: 'B', label: 'Measured', description: 'The quantities were measured from the photos, and the measurements agree. Confirm them before work starts.' },
  },
  content_json: {},
  clarification_questions_json: [{ id: 'cq_1', targetSignalKey: 'rooms', question: 'The photos show three rooms. What should we allow for?', options: ['2', '3'] }],
  ...over,
})
const view = (requestSource: unknown, over: Partial<AppQuoteRow> = {}) =>
  appQuoteView({ quote: row(over), serviceName: 'Service A', businessName: 'Business A', request, photos: [], requestSource })

// ---------------------------------------------------------------------------
// The on-site app's view
// ---------------------------------------------------------------------------

describe('T-186: the app’s view of a quote the business made', () => {
  it('the owner’s case: its questions are sent to the app, its lines read "Your answer", and nothing claims a measurement', () => {
    const v = view({ type: 'app', userId: 'u1' })
    expect(v.madeByBusiness).toBe(true)
    expect(v.questions).toEqual([{ id: 'cq_1', question: 'The photos show three rooms. What should we allow for?', options: ['2', '3'] }])
    expect(v.lines?.map((l) => l.source)).toEqual(['Your answer', 'Your fixed price'])
    expect(v.pricing.certainty).toBe('Not every quantity behind this price is confirmed yet. Confirm them before work starts.')
    expect(JSON.stringify(v.lines)).not.toMatch(/customer/i)
  })

  it('a customer’s quote in the same status: the customer was asked, so the app is sent no questions', () => {
    const v = view({ type: 'widget' })
    expect(v.madeByBusiness).toBe(false)
    expect(v.questions).toEqual([])
    expect(v.lines?.map((l) => l.source)).toEqual(["The customer's answer", 'Your fixed price'])
  })

  it('a quote priced now carries its reasons, and the sentence is built from them', () => {
    const pricing = { ...(row().pricing_json as object), estimate: { grade: 'B', label: 'To check', description: 'x', reasons: ['doubted'] } }
    expect(view({ type: 'app' }, { pricing_json: pricing }).pricing.certainty).toBe(
      'A quantity that was typed in does not seem to match the photos or the description. Check it before you send the price.'
    )
  })

  it('a quote whose lines were measured keeps "measured from the photos"', () => {
    const pricing = { ...(row().pricing_json as object), breakdown: [{ label: 'Walls  $2 × 90 sq ft', amount: 180, source: 'photos' }] }
    expect(view({ type: 'widget' }, { pricing_json: pricing }).pricing.certainty).toMatch(/measured from the photos/)
  })

  it('the route reads who made the request and passes it to the view', () => {
    const route = src('app/api/app/quotes/[quoteId]/route.ts')
    expect(route).toContain('job_quantity, source_json)')
    expect(route).toContain('requestSource: requestRow?.source_json')
  })
})

// ---------------------------------------------------------------------------
// The quotes list and Home
// ---------------------------------------------------------------------------

/** Records the filters a query was given */
function recorder() {
  const calls: string[] = []
  const q = {
    calls,
    in: (column: string, values: readonly string[]) => (calls.push(`in ${column} ${values.join('|')}`), q),
    or: (filter: string) => (calls.push(`or ${filter}`), q),
    not: (column: string, operator: string, value: string) => (calls.push(`not ${column} ${operator} ${value}`), q),
  }
  return q
}

describe('T-186: a quote the business made, with open questions, is listed under "Needs you"', () => {
  it('the group filter moves it out of "Waiting for customer" and into "Needs you"', () => {
    const ids = ['q1', 'q2']
    expect(groupFilter('needs_you', ids)).toEqual({ statuses: QUOTE_GROUP_STATUSES.needs_you, plusIds: ids, minusIds: [] })
    expect(groupFilter('waiting', ids)).toEqual({ statuses: QUOTE_GROUP_STATUSES.waiting, plusIds: [], minusIds: ids })
    for (const group of ['accepted', 'closed', 'working'] as const) expect(groupFilter(group, ids)).toEqual({ statuses: QUOTE_GROUP_STATUSES[group], plusIds: [], minusIds: [] })
  })

  it('the query: by status, plus or less those quotes; with none it is the status filter alone', () => {
    const needs = recorder()
    applyGroupFilter(needs, groupFilter('needs_you', ['q1', 'q2']))
    expect(needs.calls).toEqual(['or status.in.(pending_review,feedback_received,failed),id.in.(q1,q2)'])
    const waiting = recorder()
    applyGroupFilter(waiting, groupFilter('waiting', ['q1', 'q2']))
    expect(waiting.calls).toEqual(['in status sent|viewed|revised|awaiting_clarification', 'not id in (q1,q2)'])
    for (const group of ['needs_you', 'waiting'] as const) {
      const plain = recorder()
      applyGroupFilter(plain, groupFilter(group, []))
      expect(plain.calls).toEqual([`in status ${QUOTE_GROUP_STATUSES[group].join('|')}`])
    }
  })

  it('which quotes: this tenant’s, with open questions, made by the business (read from the request’s own record)', async () => {
    const seen: string[] = []
    const rows = [
      { id: 'q_app', request: { source_json: { type: 'app' } } },
      { id: 'q_widget', request: { source_json: { type: 'widget' } } },
      { id: 'q_app_list', request: [{ source_json: { type: 'app' } }] },
      { id: 'q_none', request: null },
    ]
    const supabase = {
      from: (table: string) => (seen.push(`from ${table}`), {
        select: () => ({
          eq: (c1: string, v1: string) => (seen.push(`${c1}=${v1}`), {
            eq: (c2: string, v2: string) => (seen.push(`${c2}=${v2}`), { limit: async () => ({ data: rows, error: null }) }),
          }),
        }),
      }),
    }
    expect(await businessAskedQuoteIds(supabase, 'tnt_a')).toEqual(['q_app', 'q_app_list'])
    expect(seen).toEqual(['from quotes', 'tenant_id=tnt_a', 'status=awaiting_clarification'])
    // a failed read moves nothing (the list still works, by status)
    const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: new Error('x') }) }) }) }) }) }
    expect(await businessAskedQuoteIds(failing, 'tnt_a')).toEqual([])
  })

  it('a row tells the shared wording who made it and how many questions are open', () => {
    expect(requestSourceOf({ request: { source_json: { type: 'app' } } })).toEqual({ type: 'app' })
    expect(requestSourceOf({ request: [{ source_json: { type: 'app' } }] })).toEqual({ type: 'app' })
    expect(requestSourceOf({})).toBeNull()
    expect(questionCountOf({ clarification_questions_json: [{}, {}] })).toBe(2)
    expect(questionCountOf({})).toBe(0)
    const route = src('app/api/quotes/route.ts')
    expect(route).toContain('madeByBusiness: isMadeByBusiness(requestSourceOf(quote))')
    expect(route).toContain('openQuestions: businessIsAsked(')
    expect(route).toContain('const businessAsked = groupParam !== null ? await businessAskedQuoteIds(supabase, tenantId) : []')
    // the list page and Home hand both to the shared wording
    for (const page of ['app/(dashboard)/app/quotes/page.tsx', 'app/(dashboard)/app/page.tsx']) {
      expect(src(page)).toMatch(/madeByBusiness: /)
      expect(src(page)).toMatch(/openQuestions: /)
    }
  })

  it('Home: it is in "Waiting for you", and not counted as waiting for a customer', () => {
    const rows = [
      { id: 'a', status: 'awaiting_clarification', created_at: '2026-11-19T10:00:00Z', pricing_json: { total: 100 }, content_json: null, is_test: false, own: true },
      { id: 'b', status: 'awaiting_clarification', created_at: '2026-11-19T09:00:00Z', pricing_json: { total: 100 }, content_json: null, is_test: false, own: false },
      { id: 'c', status: 'pending_review', created_at: '2026-11-19T08:00:00Z', pricing_json: { total: 100 }, content_json: null, is_test: false, own: false },
    ]
    expect(waitingForYou(rows, (q) => q.own).map((q) => q.id)).toEqual(['a', 'c'])
    expect(waitingForYou(rows).map((q) => q.id)).toEqual(['c'])
    const home = src('app/(dashboard)/app/page.tsx')
    expect(home).toContain("groupFilter('needs_you', businessAsked)")
    expect(home).toContain("groupFilter('waiting', businessAsked)")
  })
})

// ---------------------------------------------------------------------------
// The dashboard quote page
// ---------------------------------------------------------------------------

describe('T-186: the dashboard quote page tells the same story as the app', () => {
  const page = src('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
  const tracker = src('components/quotes/QuoteTracker.tsx')
  const questions = src('components/quotes/BusinessQuestions.tsx')

  it('the badge, the sentence and Progress come from the one shared story', () => {
    expect(page).toContain('const story = quoteStory({')
    expect(page).toContain('const turn = story.turn')
    expect(page).toContain('const trackerSteps = story.steps')
    expect(page).not.toMatch(/quoteTracker\(|quoteTurn\(/)
  })

  it('Progress uses the app’s step names, from the shared code, and marks the step now', () => {
    expect(tracker).toContain('{step.name}')
    expect(tracker).toContain("step.state === 'current'")
    expect(tracker).toContain('{step.note}')
    // no step name is typed in the component (its comment names them; the code does not)
    const code = tracker.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const typed of ['Request received', 'You approved', 'Customer opened', 'Customer accepted', 'Approve and send', 'Received', 'Opened']) expect(code).not.toContain(typed)
  })

  it('the business answers its own questions on the page, by the route the app uses, with the shared choices', () => {
    expect(page).toContain('{story.asksBusiness && (')
    expect(page).toContain('<BusinessQuestions')
    expect(questions).toContain('/api/app/quotes/${encodeURIComponent(quoteId)}/answers')
    expect(questions).toContain('questionChoices(q)')
    expect(questions).toContain('isTypedAnswer(choices, answer)')
    expect(questions).toContain('allAnswered(questions, answers)')
    // its words are the shared ones, and no question or answer is typed into the component
    expect(questions).toContain('QUOTE_TURN_COPY.questions')
    expect(questions).not.toMatch(/>\s*(Other|Yes|Keep|Remove)[^<{]*</)
    // a text box draws its focus ring with no colour of its own (system.md)
    expect(questions).not.toMatch(/focus:ring-(primary|ink|secondary)/)
  })

  it('the quote API says who made it and sends the questions only when the business is the one asked', () => {
    const route = src('app/api/quotes/[quoteId]/route.ts')
    expect(route).toContain('madeByBusiness: isMadeByBusiness(requestRow?.source_json)')
    expect(route).toContain('businessQuestions: businessIsAsked(quote.status, isMadeByBusiness(requestRow?.source_json))')
  })

  it('the certainty sentence and its label go through the shared rule, with what the quote’s lines show', () => {
    expect(page).toContain('{certaintySentence(estimate, { measuredOnQuote })}')
    expect(page).toContain('{certaintyLabel(estimate, { measuredOnQuote })}')
    expect(page).not.toContain('{estimate.label}')
  })
})

// ---------------------------------------------------------------------------
// The customer's routes
// ---------------------------------------------------------------------------

describe('T-186: a customer is never asked a business-made quote’s questions', () => {
  it('the customer’s quote data: no questions, and the page reads as a quote still being prepared', () => {
    const route = src('app/api/public/quotes/[quoteId]/route.ts')
    expect(route).toContain("businessIsAsked(quote.status, isMadeByBusiness(requestOfQuote?.source_json)) ? 'pending_review' : quote.status")
    expect(route).toContain("...(customerStatus === 'awaiting_clarification' &&")
    expect(route).toContain('status: customerStatus,')
    expect(route).toContain("reason: customerStatus as 'awaiting_clarification' | 'pending_review'")
    expect(route).not.toContain("...(quote.status === 'awaiting_clarification' &&")
  })

  it('the customer’s answer route refuses them', () => {
    const route = src('app/api/public/quotes/[quoteId]/clarify/route.ts')
    expect(route).toContain("if (quote.status !== 'awaiting_clarification' || isMadeByBusiness(requestOfQuote?.source_json)) {")
    expect(route).toContain('request:quote_requests!quote_request_id (source_json)')
  })
})

// ---------------------------------------------------------------------------
// Leftovers from T-185
// ---------------------------------------------------------------------------

describe('T-186: an older quote shows its line detail the new way', () => {
  const pricing: QuotePricing = { currency: 'USD', subtotal: 750, taxAmount: 0, total: 750, breakdown: [{ label: 'Rooms  $375 x 2(Room)', amount: 750 }] }
  const template: TenantTemplate = { showLineItems: true, includeAssumptions: true, includeExclusions: true, validityDays: 30 }

  it('on the PDF', () => {
    const html = generateQuotePdfHtml({
      quoteId: 'q_test',
      businessName: 'Business A',
      branding: { logoAssetId: null, primaryColor: '#205E56', footerNotes: null } as TenantBranding,
      template,
      customer: { name: 'Megan Grant', email: 'megan@example.test' },
      pricing,
      content: { scopeSummary: 'Paint two rooms.' } as QuoteContent,
      createdAt: '2026-11-15T10:00:00Z',
      locale: 'en-US',
    })
    expect(html).toContain('$375 × 2 rooms')
    expect(html).not.toContain('2(Room)')
  })

  it('on the dashboard quote page (a single service and a combined quote)', () => {
    const page = src('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page.match(/\{lineLabelNow\(item\.label\)\}/g)?.length).toBe(2)
    expect(page).not.toMatch(/\{item\.label\}/)
  })
})

// ---------------------------------------------------------------------------
// The rest of the dashboard quote page
// ---------------------------------------------------------------------------

describe('T-186: on its own quote, nothing on the dashboard page is called the customer’s', () => {
  it('"What Qolumns understood": its notes, its photos, and the questions it was asked', () => {
    const own = understoodCopyFor(true)
    expect([own.wordsTitle, own.askedTitle, own.answered, own.photoStripTitle]).toEqual(['From your notes', 'Asked you', 'You answered', 'Photos with this job'])
    for (const words of [own.wordsTitle, own.askedTitle, own.answered, own.photoStripTitle, own.extra('An extra')]) expect(words).not.toMatch(/customer|their|they/i)
    // a customer's quote reads as before
    expect(understoodCopyFor(false)).toBe(UNDERSTOOD_COPY)
    expect(UNDERSTOOD_COPY.askedTitle).toBe('Asked the customer')
  })

  it('an extra picked up from the notes says whose notes', () => {
    const input = {
      photoCount: 0,
      signals: null,
      content: {},
      pricing: { total: 100, breakdown: [{ label: 'An extra', amount: 20, autoRecommended: true, recommendationReason: 'mentioned in the description' }] },
      questions: [],
      answers: [],
      expectedSignals: [],
      checker: null,
    }
    expect(quoteUnderstanding({ ...input, madeByBusiness: true }).words).toEqual([{ text: 'Picked up from your notes: An extra. Added at your price.' }])
    expect(quoteUnderstanding(input).words).toEqual([{ text: 'Picked up from their words: An extra. Added at your price.' }])
  })

  it('the page tells the panel, the photos strip and the "sent" card who made the quote', () => {
    const page = src('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain('<UnderstoodPanel understanding={data.understanding} photos={data.photos ?? []} customerName={customer.name} madeByBusiness={data.madeByBusiness === true} />')
    expect(page).toContain('madeByBusiness={data.madeByBusiness === true} />}')
    expect(src('components/quotes/CustomerSent.tsx')).toContain("{madeByBusiness ? 'What you entered' : 'What the customer sent'}")
    expect(src('components/quotes/UnderstoodPanel.tsx')).toContain('title={own.photoStripTitle} ownPhotos={madeByBusiness}')
    expect(src('app/api/quotes/[quoteId]/route.ts')).toContain('madeByBusiness: isMadeByBusiness(requestRow?.source_json),\n    })')
  })
})
