/**
 * T-185: what the web side gives for the app's polish: every line's note from
 * the one shared rule, and the certainty sentence on the dashboard.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { certaintySentence, findConfidenceLanguage } from '@qolumns/shared'
import { appQuoteView } from '@/lib/app-quote-view'

const request = { description: null, answers: [], postcode: null, address: null, quantity: null }
const base = { id: 'qte_1', status: 'pending_review', created_at: '2026-11-19T10:00:00Z', customer_json: { name: 'Megan Grant' } }

describe('T-185: the base fee’s note is the same on every quote', () => {
  const lines = [
    { label: 'Base service fee', amount: 50 },
    { label: 'Walls  $2 × 100 sq ft', amount: 200 },
  ]
  const pricing = (withSource: boolean) => ({
    currency: 'USD',
    subtotal: 250,
    taxAmount: 0,
    total: 250,
    breakdown: withSource ? [{ ...lines[0]!, source: 'fixed' }, { ...lines[1]!, source: 'answer' }] : lines,
  })

  it('a quote priced now (the note is stored on the line) and one priced before (only its takeoff knows) read the same', () => {
    const now = appQuoteView({ quote: { ...base, pricing_json: pricing(true), content_json: {} }, serviceName: 'Service A', businessName: 'Business A', request, photos: [] })
    const before = appQuoteView({
      quote: {
        ...base,
        pricing_json: pricing(false),
        content_json: { takeoff: [{ item: 'Base service fee', amount: 50, method: 'Standard charge for every job' }, { item: 'Walls', amount: 200, method: 'Quantity provided by you' }] },
      },
      serviceName: 'Service A',
      businessName: 'Business A',
      request,
      photos: [],
    })
    expect(now.lines?.map((l) => l.source)).toEqual(['Your fixed price', "The customer's answer"])
    expect(before.lines?.map((l) => l.source)).toEqual(now.lines?.map((l) => l.source))
  })

  it('a quote with neither says nothing rather than guess', () => {
    const none = appQuoteView({ quote: { ...base, pricing_json: pricing(false), content_json: {} }, serviceName: 'Service A', businessName: 'Business A', request, photos: [] })
    expect(none.lines?.every((l) => l.source === undefined)).toBe(true)
  })
})

describe('T-185: the dashboard shows the same certainty sentence as the app', () => {
  it('the quote page uses the shared sentence, not the stored words as they are', () => {
    const page = readFileSync(join(__dirname, '../app/(dashboard)/app/quotes/[quoteId]/page.tsx'), 'utf8')
    // T-186: with what the quote's own lines show, so an older sentence cannot claim a measurement nothing made
    expect(page).toContain('{certaintySentence(estimate, { measuredOnQuote })}')
    expect(page).not.toContain('{estimate.description}')
  })

  it('no level’s sentence uses a banned word', () => {
    for (const grade of ['A', 'B', 'C']) expect(findConfidenceLanguage(certaintySentence({ grade })!)).toEqual([])
  })
})
