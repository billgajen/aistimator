/**
 * T-184: what the server gives the on-site app (and the dashboard) for this
 * ticket: answers by their option labels, the app's quote view additions,
 * the Account read, and the emails to the business without "Powered by".
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { answerText, businessLinks, PRODUCT_NAME, SUPPORT_EMAIL } from '@qolumns/shared'
import { formFields, fieldLabels, requestDetails, type FieldRow } from '@/lib/request-details'
import { appQuoteView } from '@/lib/app-quote-view'
import { appAccount } from '@/lib/app-account'
import {
  generateRevisedQuoteEmailHtml,
  generateFeedbackNotificationEmailHtml,
  generateLimitReachedEmailHtml,
  generateLeadHeldEmailHtml,
  generateQuoteAcceptedEmailHtml,
  generateQuoteDeclinedEmailHtml,
  generateQuoteReminderEmailHtml,
  generateWhatsAppRenewalEmailHtml,
} from '@/lib/email-templates'

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

// A made-up form: none of these words is known to the product
const ROWS: FieldRow[] = [
  {
    service_id: 'svc_a',
    config_json: {
      fields: [
        { fieldId: 'ceiling', label: 'How high is the ceiling?', options: [{ value: 'standard_(8_ft)', label: 'Standard (8 ft)' }, { value: 'high_(10_ft)', label: 'High (10 ft)' }] },
        { fieldId: 'extras', label: 'Which extras?', options: [{ value: 'first_one', label: 'The first one' }, { value: 'second_one', label: 'The second one' }] },
        { fieldId: 'easy', label: 'Is access easy?' },
        { fieldId: 'rooms', label: 'How many rooms?' },
        { fieldId: 'legacy', label: 'An older question', options: ['plain_text_option'] },
      ] as never,
    },
  },
]

describe('T-184: an answer is shown by its option’s label, never its stored value', () => {
  const fields = formFields(ROWS, 'svc_a')

  it('a choice: "standard_(8_ft)" is shown as "Standard (8 ft)"', () => {
    expect(answerText(fields.get('ceiling'), 'standard_(8_ft)')).toBe('Standard (8 ft)')
  })

  it('several choices, yes and no, a number and free text', () => {
    expect(answerText(fields.get('extras'), ['first_one', 'second_one'])).toBe('The first one, The second one')
    expect(answerText(fields.get('easy'), true)).toBe('Yes')
    expect(answerText(fields.get('easy'), false)).toBe('No')
    expect(answerText(fields.get('rooms'), 3)).toBe('3')
    expect(answerText(undefined, 'The back door sticks.')).toBe('The back door sticks.')
  })

  it('a stored id with no label on file is tidied; something a person typed is left alone', () => {
    expect(answerText(undefined, 'standard_(8_ft)')).toBe('Standard (8 ft)')
    expect(answerText(undefined, 'two coats, please')).toBe('two coats, please')
    expect(answerText(fields.get('ceiling'), '')).toBe('')
  })

  it('the request the dashboard and the app show uses it', () => {
    const request = {
      job_answers: [
        { fieldId: '_project_description', value: 'The hall.' },
        { fieldId: 'ceiling', value: 'standard_(8_ft)' },
        { fieldId: 'extras', value: ['second_one'] },
        { fieldId: 'easy', value: true },
      ],
    }
    const details = requestDetails(request, fieldLabels(ROWS, 'svc_a'), fields)
    expect(details.answers).toEqual([
      { label: 'How high is the ceiling?', value: 'Standard (8 ft)' },
      { label: 'Which extras?', value: 'The second one' },
      { label: 'Is access easy?', value: 'Yes' },
    ])
    expect(JSON.stringify(details)).not.toContain('standard_(8_ft)')
  })

  it('both routes that show a request pass the form’s options', () => {
    for (const route of ['app/api/quotes/[quoteId]/route.ts', 'app/api/app/quotes/[quoteId]/route.ts']) {
      expect(read(route), route).toContain('formFields(')
    }
  })
})

const QUOTE = {
  id: 'qte_1',
  status: 'pending_review',
  created_at: '2026-11-19T10:00:00Z',
  approved_at: null,
  customer_json: { name: 'Megan Grant', phone: '+14155550142' },
  pricing_json: {
    currency: 'USD',
    subtotal: 400,
    taxAmount: 0,
    total: 400,
    estimate: { grade: 'A', label: 'Confirmed', description: 'Every quantity the price rests on was given or confirmed.' },
    breakdown: [
      { label: 'Walls  $2 x 100(sq ft)', amount: 200, source: 'photos' },
      { label: 'Doors', amount: 100, source: 'answer' },
      { label: 'Typed by the business', amount: 20 },
    ],
    sections: [{ serviceId: 'svc_b', serviceName: 'Service B', addedBy: 'customer', addedAt: '2026-11-19T10:01:00Z', subtotal: 80, breakdown: [{ label: 'Visit', amount: 80, source: 'fixed' }] }],
  },
  content_json: {
    alsoAsked: [
      { id: 'a1', words: 'the second thing', serviceId: 'svc_b', serviceName: 'Service B', state: 'offered' },
      { id: 'a2', words: 'something else', serviceId: null, state: 'not_offered' },
    ],
  },
}

describe('T-184: the app’s view of a quote', () => {
  const view = appQuoteView({
    quote: QUOTE,
    serviceName: 'Service A',
    businessName: 'Business A',
    request: { description: null, answers: [], postcode: null, address: null, quantity: null },
    photos: [{ id: 'ast_1', url: 'https://files.test/small', fullUrl: 'https://files.test/full' }],
    photoCount: 2,
  })

  it('each line says where its quantity came from, in the business’s words (the shared T-183 wording)', () => {
    expect(view.lines).toEqual([
      { label: 'Walls  $2 x 100(sq ft)', amount: 200, source: 'Measured from photos' },
      { label: 'Doors', amount: 100, source: "The customer's answer" },
      { label: 'Typed by the business', amount: 20 },
    ])
    expect(view.sections?.[0]?.lines).toEqual([{ label: 'Visit', amount: 80, source: 'Your fixed price' }])
  })

  it('"Customer also asked for", each with where it stands; a service on the quote is "added"', () => {
    expect(view.alsoAsked).toEqual([
      { words: 'the second thing', serviceName: 'Service B', state: 'added', stateWords: 'Added by the customer.' },
      { words: 'something else', state: 'not_offered', stateWords: 'Not one of your services. No price was given; the customer was told you will confirm it separately.' },
    ])
  })

  it('photos carry the small copy and the photo itself, and the count is said even when one cannot be signed', () => {
    expect(view.photos).toEqual([{ id: 'ast_1', url: 'https://files.test/small', fullUrl: 'https://files.test/full' }])
    expect(view.photoCount).toBe(2)
  })

  it('the plain sentence about the price travels with it; when it was approved is there for the progress steps', () => {
    expect(view.pricing.estimate?.description).toBe('Every quantity the price rests on was given or confirmed.')
    expect(view.dates?.approvedAt).toBeNull()
    expect(appQuoteView({ quote: { ...QUOTE, approved_at: '2026-11-19T11:00:00Z' }, serviceName: 'Service A', businessName: 'Business A', request: view.request!, photos: [] }).dates?.approvedAt).toBe('2026-11-19T11:00:00Z')
  })

  it('a quote with nothing else asked for has no such list', () => {
    expect(appQuoteView({ quote: { ...QUOTE, content_json: {} }, serviceName: 'Service A', businessName: 'Business A', request: view.request!, photos: [] }).alsoAsked).toBeUndefined()
  })

  it('the route never drops a photo because its small copy could not be found', () => {
    const route = read('app/api/app/quotes/[quoteId]/route.ts')
    expect(route).toContain('let url = fullUrl')
    expect(route).toContain('signed.push({ id, url, fullUrl })')
    expect(route).toContain('photoCount: photos.count')
  })
})

describe('T-184: the Account read', () => {
  const base = { businessName: 'Business A', logoUrl: null, planName: 'Pro', limit: { used: 37, limit: 200, unlimited: false, per: 'month' as const }, links: businessLinks({ appUrl: 'https://qolumns.com/', slug: 'business-a', ownAddress: null, canUseAddress: false, host: null }) }

  it('the name, the plan’s name, its use, the quote link and the support address', () => {
    expect(appAccount(base)).toEqual({
      businessName: 'Business A',
      logoUrl: null,
      planName: 'Pro',
      usage: { used: 37, limit: 200, unlimited: false, per: 'month' },
      quoteLink: 'https://qolumns.com/quote/business-a',
      // T-199: only set when the business's own address is its main link
      alsoLink: null,
      supportEmail: SUPPORT_EMAIL,
    })
  })

  it('a business on the free allowance, one with no limit, one with no link', () => {
    expect(appAccount({ ...base, planName: null, limit: { used: 8, limit: 10, unlimited: false, per: 'total' } }).usage).toEqual({ used: 8, limit: 10, unlimited: false, per: 'total' })
    expect(appAccount({ ...base, limit: { used: 5, limit: 0, unlimited: true, per: 'month' } }).usage).toEqual({ used: 5, limit: 0, unlimited: true, per: 'month' })
    expect(appAccount({ ...base, links: null }).quoteLink).toBeNull()
    // T-199: with its own address, that is the link the app shows and puts in the QR code; the quote link "also works"
    const own = appAccount({ ...base, links: businessLinks({ appUrl: 'https://qolumns.com', slug: 'business-a', ownAddress: 'business-a', canUseAddress: true, host: 'qolumns.com' }) })
    expect([own.quoteLink, own.alsoLink]).toEqual(['https://business-a.qolumns.com', 'https://qolumns.com/quote/business-a'])
  })

  it('answers no price, no upgrade and no link to billing (an app may not point at a purchase outside it)', () => {
    const body = JSON.stringify(appAccount(base))
    expect(body).not.toMatch(/price|cents|upgrade|billing|checkout|stripe/i)
    const route = read('app/api/app/account/route.ts')
    expect(route).toContain('const auth = await requireTenant()')
    expect(route).toContain(".eq('id', tenantId)")
    expect(route).not.toMatch(/overagePriceCents|stripe_customer_id|checkout/)
  })
})

describe('T-184: the six emails to the business carry no "Powered by" line; customer emails keep theirs', () => {
  const common = { customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A' }
  const business: Record<string, string> = {
    feedback: generateFeedbackNotificationEmailHtml({ ...common, feedbackType: 'feedback', feedbackText: 'A question.', dashboardUrl: 'u' }),
    limitReached: generateLimitReachedEmailHtml({ businessName: 'Business A', used: 50, limit: 50, billingUrl: 'u' }),
    requestHeld: generateLeadHeldEmailHtml({ ...common, used: 10, limit: 10, billingUrl: 'u', quoteUrl: 'q', per: 'total' }),
    accepted: generateQuoteAcceptedEmailHtml({ ...common, totalFormatted: '$300.00', dashboardUrl: 'u' }),
    declined: generateQuoteDeclinedEmailHtml({ ...common, dashboardUrl: 'u' }),
    whatsappRenewal: generateWhatsAppRenewalEmailHtml({ businessName: 'Business A', displayPhoneNumber: '+1 555 0100', daysLeft: 5, expiresOn: '12 January 2027', whatsappUrl: 'u' } as Parameters<typeof generateWhatsAppRenewalEmailHtml>[0]),
  }

  it.each(Object.keys(business))('%s (to the business) has none', (name) => {
    expect(business[name]).not.toContain('Powered by')
    // and nothing was left behind where the line was
    expect(business[name]).toMatch(/<\/html>\s*$/)
  })

  it('there are six', () => {
    expect(Object.keys(business)).toHaveLength(6)
  })

  it('the emails a customer gets are unchanged', () => {
    expect(generateRevisedQuoteEmailHtml({ ...common, quoteViewUrl: 'u', total: '$300.00' })).toContain(`Powered by ${PRODUCT_NAME}`)
    expect(generateQuoteReminderEmailHtml({ ...common, totalFormatted: '$300.00', quoteViewUrl: 'u' })).toContain(`Powered by ${PRODUCT_NAME}`)
  })
})
