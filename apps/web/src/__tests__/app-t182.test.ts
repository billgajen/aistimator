/**
 * T-182: the business app's view of a quote (GET /api/app/quotes/:id).
 * The app must show what the dashboard shows, by the same rules; this view
 * is where that is decided, so the rules are pinned here.
 */
import { describe, it, expect } from 'vitest'
import { parseReadingEvidence } from '@qolumns/shared'
import { appQuoteView, appViewWantsPhotos, type AppQuoteRow } from '@/lib/app-quote-view'
import { parseReading } from '@/lib/customer-read'

const request = { description: 'Back wall and the hall', answers: [{ label: 'How many rooms?', value: '3' }], postcode: '94110', address: null, quantity: null }

const row = (over: Partial<AppQuoteRow> = {}): AppQuoteRow => ({
  id: 'qte_1',
  status: 'pending_review',
  created_at: '2026-11-18T10:00:00Z',
  customer_json: { name: 'Megan Grant', email: 'megan@example.test', phone: '+14155550100' },
  pricing_json: {
    currency: 'USD',
    subtotal: 120,
    taxLabel: 'Sales tax',
    taxAmount: 10.2,
    total: 130.2,
    breakdown: [
      { label: 'Call-out', amount: 45 },
      { label: 'Labour', amount: 40 },
      { label: 'Minimum charge', amount: 35, kind: 'minimum', minimumCharge: 120 },
    ],
    estimate: { grade: 'A', label: 'Confirmed', description: '' },
  },
  content_json: { takeoff: [{ item: 'Labour', amount: 40, method: 'Calculated from your answers' }] },
  clarification_questions_json: [{ id: 'c1', question: 'Is it 100 A?', type: 'confirm_value', aiValue: 100, evidence: 'Read from the panel label (photo 1): "RATED 100 AMPS" → 100' }],
  sent_at: null,
  viewed_at: null,
  accepted_at: null,
  paid_at: null,
  declined_at: null,
  token_expires_at: '2026-12-18T10:00:00Z',
  ...over,
})

const view = (over: Partial<AppQuoteRow> = {}, photos: Array<{ id: string; url: string }> = []) =>
  appQuoteView({ quote: row(over), serviceName: 'Main service', businessName: 'A Business', request, photos })

describe('the minimum charge is a floor, said in a note (AD-048)', () => {
  it('is never among the lines, and the note carries the amount', () => {
    const v = view()
    expect(v.lines).toEqual([
      { label: 'Call-out', amount: 45 },
      { label: 'Labour', amount: 40 },
    ])
    expect(v.minimum).toEqual({ topUp: 35, minimumCharge: 120 })
    expect(JSON.stringify(v.lines)).not.toMatch(/minimum/i)
    expect(v.totals).toEqual({ subtotal: 120, tax: { label: 'Sales tax', amount: 10.2 }, total: 130.2 })
  })

  it('no minimum applied: nothing about a minimum is sent', () => {
    const v = view({ pricing_json: { currency: 'USD', subtotal: 85, taxAmount: 0, total: 85, breakdown: [{ label: 'Labour', amount: 85 }] } })
    expect(v.minimum).toBeUndefined()
    expect(v.totals).toEqual({ subtotal: 85, total: 85 }) // no tax row when there is no tax
  })
})

describe('a combined quote is one quote with sections (T-179)', () => {
  const combined = {
    currency: 'USD',
    subtotal: 300,
    taxAmount: 0,
    total: 300,
    breakdown: [{ label: 'Walls', amount: 200 }],
    sections: [
      {
        serviceId: 'svc_2',
        serviceName: 'Second service',
        addedBy: 'customer',
        addedAt: '2026-11-18T11:00:00Z',
        subtotal: 100,
        awaitingApproval: true,
        breakdown: [
          { label: 'Visit', amount: 60 },
          { label: 'Minimum charge', amount: 40, kind: 'minimum', minimumCharge: 100 },
        ],
      },
    ],
  }

  it('one total; the main service keeps its own lines; each added service is a section with its lines, its minimum note and its subtotal', () => {
    const v = view({ pricing_json: combined })
    expect(v.pricing.total).toBe(300)
    expect(v.serviceName).toBe('Main service + Second service')
    expect(v.mainServiceName).toBe('Main service')
    expect(v.lines).toEqual([{ label: 'Walls', amount: 200 }])
    expect(v.mainSubtotal).toBe(200)
    expect(v.sections).toEqual([
      {
        serviceName: 'Second service',
        addedBy: 'customer',
        subtotal: 100,
        lines: [{ label: 'Visit', amount: 60 }],
        minimum: { topUp: 40, minimumCharge: 100 },
        awaitingApproval: true,
      },
    ])
    // the takeoff is the main service's alone: an added service's lines are not mixed into it
    expect(v.takeoff).toEqual([{ item: 'Labour', amount: 40, method: 'Calculated from your answers' }])
  })

  it('a single-service quote has no sections key at all', () => {
    const v = view()
    expect('sections' in v).toBe(false)
    expect('mainSubtotal' in v).toBe(false)
    expect(v.serviceName).toBe('Main service')
  })
})

describe('requests with no price', () => {
  it('held at the plan limit or by a paused account: marked held, with what was sent', () => {
    const v = view({ pricing_json: {}, content_json: { limitHold: true } })
    expect(v.held).toBe(true)
    expect(v.pricing.total).toBe(0)
    expect(v.request).toEqual(request)
  })

  it('"held" is only a pending request with the hold mark: an ordinary review hold is not one', () => {
    expect(view().held).toBe(false)
    expect(view({ status: 'sent', content_json: { limitHold: true } }).held).toBe(false)
  })

  it('could not be priced (T-178): the request and its photos are there to quote from by hand', () => {
    const photos = [{ id: 'ast_1', url: 'https://storage.test/signed-1' }]
    const v = view({ status: 'failed', pricing_json: null, content_json: { error: 'internal reason' } }, photos)
    expect(v.status).toBe('failed')
    expect(v.request?.answers).toEqual([{ label: 'How many rooms?', value: '3' }])
    expect(v.photos).toEqual(photos)
    expect(v.customer).toEqual({ name: 'Megan Grant', email: 'megan@example.test', phone: '+14155550100' })
    // the internal reason is the platform's, not the business's
    expect(JSON.stringify(v)).not.toContain('internal reason')
  })

  it('a customer with no email (the on-site path) is a customer all the same', () => {
    const v = view({ customer_json: { name: 'Megan Grant' } })
    expect(v.customer).toEqual({ name: 'Megan Grant', email: null, phone: null })
  })
})

describe('what else the view carries', () => {
  it('open questions only while the quote waits for them', () => {
    expect(view().questions).toEqual([])
    expect(view({ status: 'awaiting_clarification' }).questions).toHaveLength(1)
  })

  it('the dates the status wording needs', () => {
    const v = view({ status: 'viewed', sent_at: '2026-11-18T10:05:00Z', viewed_at: '2026-11-18T10:09:00Z' })
    expect(v.dates).toEqual({ sentAt: '2026-11-18T10:05:00Z', viewedAt: '2026-11-18T10:09:00Z', acceptedAt: null, paidAt: null, declinedAt: null, expiresAt: '2026-12-18T10:00:00Z' })
  })

  it('photos are not signed while the price is being worked out (the app asks again every few seconds then)', () => {
    expect(appViewWantsPhotos('queued')).toBe(false)
    expect(appViewWantsPhotos('generating')).toBe(false)
    for (const status of ['pending_review', 'failed', 'sent', 'awaiting_clarification']) expect(appViewWantsPhotos(status)).toBe(true)
  })
})

describe('a label reading is read back in one place', () => {
  const line = 'Read from the unit\'s rating plate (photo 2): "MODEL GSX140361" → 3 ton (model number)'

  it('the business may see the words on the label; the customer is given only where and what', () => {
    expect(parseReadingEvidence(line)).toEqual({ where: "the unit's rating plate", value: '3 ton', photo: 2, words: 'MODEL GSX140361' })
    expect(parseReading(line)).toEqual({ where: "the unit's rating plate", value: '3 ton' })
    expect(parseReadingEvidence('Read from the tank label: 50 gal')).toEqual({ where: 'the tank label', value: '50 gal' })
    expect(parseReadingEvidence('Measured from two photos')).toBeNull()
    expect(parseReading(42)).toBeNull()
  })
})
