/**
 * T-202, the small fixes:
 *   item 1  "Try again" for the phone app: one set of rules and words, and the app's view says how many tries are left
 *   item 4  "Clear" on "Scope & Photos" asks first and says exactly what it empties
 *   item 6  the payment-failed email (and the "plan has ended" note) say what really happens to new requests
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import * as shared from '@qolumns/shared'
import { BUSINESS_RETRY_LIMIT, QUOTE_TURN_COPY, RETRY_COPY, freeAllowance, tryAgainView } from '@qolumns/shared'
import * as webRules from '@/lib/quote-retry-rules'
import { appQuoteView, type AppQuoteRow } from '@/lib/app-quote-view'
import { CLEARED_MEDIA, CLEAR_KEEPS, REGENERATE_KEEPS, clearEmpties, clearLoosens, type ServiceForm } from '@/lib/service-questions'
import { afterPlanEndsLine, paymentFailedEmail } from '@/lib/billing-emails'
import { allowanceAfterPlan } from '@/lib/plan-limits'
import { planEndedNote } from '@/lib/plan-ended'

const read = (path: string) => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')

// ---------------------------------------------------------------------------
describe('T-202 item 1: one set of "Try again" rules for the dashboard and the phone app', () => {
  it('the web reads the shared rules and words, not a copy of them', () => {
    expect(webRules.BUSINESS_RETRY_LIMIT).toBe(shared.BUSINESS_RETRY_LIMIT)
    expect(webRules.RETRY_COPY).toBe(shared.RETRY_COPY)
    expect(webRules.canBusinessRetry).toBe(shared.canBusinessRetry)
    expect(webRules.businessRetriesOf).toBe(shared.businessRetriesOf)
    const file = read('apps/web/src/lib/quote-retry-rules.ts')
    expect(file).toContain("from '@qolumns/shared'")
    expect(file).not.toMatch(/export (const|function)/)
  })

  it('the server’s own retry still reads those rules (nothing about pricing or counting moved)', () => {
    const server = read('apps/web/src/lib/quote-retry.ts')
    expect(server).toContain("from '@/lib/quote-retry-rules'")
    expect(server).toContain('businessRetriesOf(quote.content_json) >= BUSINESS_RETRY_LIMIT')
    expect(server).not.toContain('claimPlanQuote(')
  })

  it('the button’s label is the shared one both screens use', () => {
    expect(QUOTE_TURN_COPY.pageButtons.tryAgain).toBe('Try again')
    expect(read('apps/web/src/components/quotes/NextStepBox.tsx')).toContain('{pricing ? B.tryingAgain : B.tryAgain}')
    expect(read('apps/mobile/src/lib/try-again.ts')).toContain('QUOTE_TURN_COPY.pageButtons.tryAgain')
  })

  const row = (over: Partial<AppQuoteRow> = {}): AppQuoteRow => ({
    id: 'qte_1',
    status: 'failed',
    created_at: '2026-11-24T09:00:00Z',
    customer_json: { name: 'Jordan Reyes', email: 'jordan.reyes@example.com', phone: '(555) 201-3434' },
    pricing_json: null,
    content_json: { error: 'The pricing worker stopped', failedAt: '2026-11-24T09:01:00Z' },
    ...over,
  })
  const view = (quote: AppQuoteRow) =>
    appQuoteView({ quote, serviceName: 'Exterior wall painting', businessName: 'Harlow Painting', request: { description: null, answers: [], postcode: null, address: null, quantity: null }, photos: [] })

  it('the app’s view of a request that could not be priced says how many tries are left', () => {
    expect(view(row()).tryAgain).toEqual({ left: BUSINESS_RETRY_LIMIT })
    expect(view(row({ content_json: { businessRetries: 2 } })).tryAgain).toEqual({ left: 3 })
    expect(view(row({ content_json: { businessRetries: 5 } })).tryAgain).toEqual({ left: 0 })
  })

  it('…worked out with the same rule the dashboard’s button and the server’s refusal use', () => {
    for (let tries = 0; tries <= 7; tries++) {
      const quote = { status: 'failed', content_json: { businessRetries: tries } }
      expect(tryAgainView(quote)!.left > 0).toBe(shared.canBusinessRetry(quote))
    }
  })

  it('any other quote says nothing about tries', () => {
    for (const status of ['queued', 'generating', 'pending_review', 'sent', 'viewed', 'accepted', 'awaiting_clarification']) {
      expect(view(row({ status, content_json: { businessRetries: 1 } })).tryAgain).toBeUndefined()
    }
  })

  it('how to reach the customer still travels with a failed request', () => {
    expect(view(row()).customer).toEqual({ name: 'Jordan Reyes', email: 'jordan.reyes@example.com', phone: '(555) 201-3434' })
  })

  it('the limit sentence names the number of tries from the rule, not a typed one', () => {
    expect(RETRY_COPY.limit).toContain(`tried ${BUSINESS_RETRY_LIMIT} times`)
  })
})

// ---------------------------------------------------------------------------
describe('T-202 item 4: "Clear" asks first, and says exactly what it empties', () => {
  const form: ServiceForm = {
    scopeIncludes: ['Preparation', 'Two coats'],
    scopeExcludes: ['Roofline replacement'],
    defaultAssumptions: ['Walls are sound', 'Ground access', 'Standard hours'],
    mediaConfig: { minPhotos: 2, maxPhotos: 6, photoGuidance: 'A photo of each wall', requiredAngles: [{ id: 'front', label: 'Front' }] },
    workSteps: [
      { id: 'walls', name: 'Walls', description: '', costType: 'per_unit', defaultCost: 18, optional: false },
      { id: 'trim', name: 'Trim', description: '', costType: 'per_unit', defaultCost: 7, optional: false },
    ] as ServiceForm['workSteps'],
    expectedSignals: [],
    suggestedFields: [{ fieldId: 'wall_area', label: 'Wall area', type: 'number', required: true }] as ServiceForm['suggestedFields'],
    baseFee: 50,
    minimumCharge: 200,
    addons: [],
    multipliers: [],
  }

  it('lists the scope lists, the photo settings, the questions and the price lines, with how many of each', () => {
    expect(clearEmpties(form)).toEqual([
      'What’s included (2 items now), what’s excluded (1) and your assumptions (3)',
      'The photo settings, back to 1 to 8 photos with no guidance (2 to 6 photos now, your photo guidance, 1 required photo)',
      'Your questions (1 question now)',
      'Your price lines, and what each one measures from the photos (2 lines now)',
    ])
  })

  it('an empty service is said as it is, with nothing invented', () => {
    const empty = { ...form, scopeIncludes: [], scopeExcludes: [], defaultAssumptions: [], workSteps: [], suggestedFields: [], mediaConfig: { ...CLEARED_MEDIA } }
    expect(clearEmpties(empty)).toEqual([
      'What’s included (0 items now), what’s excluded (0) and your assumptions (0)',
      'The photo settings, back to 1 to 8 photos with no guidance (1 to 8 photos now)',
      'Your questions (0 questions now)',
      'Your price lines, and what each one measures from the photos (0 lines now)',
    ])
  })

  it('says what stays, add-ons included (Regenerate replaces add-ons; Clear does not)', () => {
    expect(CLEAR_KEEPS).toBe('Your service name, description, base fee, minimum charge, add-ons and adjustments stay as they are.')
    expect(REGENERATE_KEEPS).not.toContain('add-ons')
  })

  it('warns when an adjustment leans on a question that is about to go, and only then', () => {
    expect(clearLoosens(form)).toBeNull()
    const one = { ...form, multipliers: [{ when: { fieldId: 'wall_area', operator: 'gt', value: 100 }, multiplier: 0.9 }] }
    expect(clearLoosens(one)).toBe('One adjustment uses a question that will be removed, so it stops applying until you choose a question for it again.')
    const two = { ...form, multipliers: [...one.multipliers, { when: { fieldId: 'wall_area', equals: 5 }, multiplier: 1.1 }, { when: { subject: 'subtotal' as const, operator: 'gt', value: 5000 }, multiplier: 0.9 }] }
    expect(clearLoosens(two)).toBe('2 adjustments use a question that will be removed, so they stop applying until you choose a question for them again.')
  })

  const page = read('apps/web/src/app/(dashboard)/app/services/page.tsx')
  const handler = page.slice(page.indexOf('const clearAIDraft = () => {'), page.indexOf('const sampleService'))

  it('what the list says is what the handler empties, and nothing else', () => {
    const emptied = [...handler.matchAll(/^\s{6}(\w+): /gm)].map((m) => m[1])
    expect(emptied.sort()).toEqual(['defaultAssumptions', 'expectedSignals', 'mediaConfig', 'scopeExcludes', 'scopeIncludes', 'suggestedFields', 'workSteps'])
    expect(handler).toContain('mediaConfig: { ...CLEARED_MEDIA }')
    expect(CLEARED_MEDIA).toEqual({ minPhotos: 1, maxPhotos: 8, photoGuidance: null })
    // what the confirmation says stays is not touched
    for (const kept of ['name:', 'description:', 'baseFee:', 'minimumCharge:', 'addons:', 'multipliers:']) expect(handler).not.toContain(kept)
  })

  it('the "Clear" link only opens the question; the emptying is behind "Empty the setup"', () => {
    const link = page.slice(page.indexOf('data-testid="clear-draft"') - 400, page.indexOf('data-testid="clear-draft"'))
    expect(link).toContain('setConfirmClear(true)')
    expect(link).not.toContain('clearAIDraft')
    const box = page.slice(page.indexOf('{aiDraft && confirmClear && ('), page.indexOf('data-testid="clear-cancel"') + 200)
    expect(box).toContain('role="alertdialog"')
    expect(box).toContain('clearEmpties(formData).map')
    expect(box).toContain('{CLEAR_KEEPS} Nothing is saved until you press')
    expect(box).toMatch(/onClick=\{clearAIDraft\}[\s\S]*data-testid="clear-yes"/)
    expect(box).toMatch(/onClick=\{\(\) => setConfirmClear\(false\)\}[\s\S]*data-testid="clear-cancel"/)
  })

  it('"Cancel" only closes the question: it changes no field', () => {
    const cancel = page.slice(page.indexOf('data-testid="clear-yes"'), page.indexOf('data-testid="clear-cancel"'))
    expect(cancel).toContain('onClick={() => setConfirmClear(false)}')
    expect(cancel).not.toContain('setFormData')
    expect(cancel).not.toContain('setAiDraft')
  })

  it('one question at a time, and it is closed when the editor opens or closes', () => {
    expect((page.match(/setConfirmClear\(false\)/g) ?? []).length).toBeGreaterThanOrEqual(6)
    expect(page).toMatch(/setConfirmClear\(false\)\s*\n\s*setConfirmRegenerate\(true\)/)
    expect(page).toMatch(/setConfirmRegenerate\(false\)\s*\n\s*setConfirmClear\(true\)/)
  })
})

// ---------------------------------------------------------------------------
describe('T-202 item 6: the payment-failed email says what really happens to new requests', () => {
  const base = { businessName: 'Harlow Painting', billingUrl: 'https://x.test/app/settings/billing' }
  const afterLine = (html: string) => html.match(/<span data-role="after-plan">([^<]*)<\/span>/)?.[1] ?? ''

  it('free quotes left: the next ones are still priced, then requests are saved', () => {
    const html = paymentFailedEmail({ ...base, afterPlan: { per: 'total', limit: 10, left: 4 } }).html
    expect(afterLine(html)).toBe(
      'If it still cannot be taken, your plan ends. You still have 4 of your 10 free quotes, so the next 4 new requests are still priced. After those, new requests are saved for you but not priced until a plan is active again.'
    )
  })

  it('one free quote left is said in the singular', () => {
    expect(afterPlanEndsLine({ per: 'total', limit: 10, left: 1 })).toBe(
      'If it still cannot be taken, your plan ends. You still have 1 of your 10 free quotes, so the next new request is still priced. After that one, new requests are saved for you but not priced until a plan is active again.'
    )
  })

  it('no free quotes left: requests are saved, not priced, until a plan is active', () => {
    expect(afterPlanEndsLine({ per: 'total', limit: 10, left: 0 })).toBe(
      'If it still cannot be taken, your plan ends. Your 10 free quotes are used, so new requests are then saved for you but not priced until a plan is active again.'
    )
  })

  it('a business on the old monthly allowance is told its monthly number', () => {
    expect(afterPlanEndsLine({ per: 'month', limit: 50, left: 50 })).toBe(
      'If it still cannot be taken, your plan ends. Without a plan, up to 50 new requests a month are still priced; past that, they are saved for you but not priced until a plan is active again.'
    )
  })

  it('when the numbers could not be read it states the rule and promises nothing', () => {
    const line = afterPlanEndsLine(null)
    expect(line).toContain('priced only while you have free quotes left')
    expect(line).not.toMatch(/\d/)
    expect(afterLine(paymentFailedEmail(base).html)).toBe(line)
  })

  it('no case says flatly that requests "are then saved" while free quotes remain', () => {
    for (const left of [1, 3, 10]) expect(afterPlanEndsLine({ per: 'total', limit: 10, left })).not.toContain('are then saved')
    expect(read('apps/web/src/lib/billing-emails.ts')).not.toContain('your plan ends: new requests are then saved')
  })

  it('while the payment is retried it still says requests are priced; one button, the same first line and subject', () => {
    const email = paymentFailedEmail({ ...base, afterPlan: { per: 'total', limit: 10, left: 4 } })
    expect(email.subject).toBe("Your payment didn't go through")
    expect(email.html).toContain('Your payment didn&#39;t go through. Update your card to keep your quotes running.')
    expect(email.html).toContain('Everything keeps working for now, and the payment will be tried again over the next days. New requests are still priced meanwhile.')
    expect(email.html.match(/<a /g)).toHaveLength(1)
  })

  it('the numbers are the business’s own: its region’s allowance, and only the quotes priced as free ones', () => {
    const us = freeAllowance('US')
    // 30 quotes priced, 27 of them on the plan: 3 free ones used
    const rows = [
      { period_yyyymm: '202609', estimates_created: 3, plan_estimates_created: 0 },
      { period_yyyymm: '202610', estimates_created: 20, plan_estimates_created: 20 },
      { period_yyyymm: '202611', estimates_created: 7, plan_estimates_created: 7 },
    ]
    expect(allowanceAfterPlan('US', rows, '202611')).toEqual({ per: 'total', limit: us.quotes, left: us.quotes - 3 })
    // every free quote used before the plan
    expect(allowanceAfterPlan('US', [{ period_yyyymm: '202609', estimates_created: us.quotes, plan_estimates_created: 0 }, ...rows.slice(1)], '202611')).toEqual({ per: 'total', limit: us.quotes, left: 0 })
    // never priced anything without a plan
    expect(allowanceAfterPlan('US', rows.slice(1), '202611').left).toBe(us.quotes)
    expect(allowanceAfterPlan('US', null, '202611').left).toBe(us.quotes)
    // the old monthly allowance counts this month's quotes
    const gb = freeAllowance('GB')
    expect(allowanceAfterPlan('GB', rows, '202611')).toEqual({ per: 'month', limit: gb.quotes, left: gb.quotes - 7 })
  })

  it('the email is sent with those numbers read for that business', () => {
    const sync = read('apps/web/src/lib/billing-sync.ts')
    expect(sync).toContain('const afterPlan = await readAllowanceAfterPlan(admin, tenantId)')
    expect(sync).toContain('billingUrl: `${appUrl}/app/settings/billing`, afterPlan })')
    const limits = read('apps/web/src/lib/plan-limits.ts')
    expect(limits).toContain(".select('period_yyyymm, estimates_created, plan_estimates_created').eq('tenant_id', tenantId)")
  })
})

describe('T-202 item 6: the billing page’s "plan has ended" note says the same', () => {
  it('free quotes left', () => {
    expect(planEndedNote('Pro', { used: 6, limit: 10, per: 'total' })).toBe(
      'Your Pro plan has ended. You still have 4 of your 10 free quotes, so the next 4 new requests are still priced. After those, new requests are saved for you but not priced until you pick a plan.'
    )
    expect(planEndedNote('Starter', { used: 9, limit: 10, per: 'total' })).toContain('so the next new request is still priced. After that one,')
  })

  it('none left: what it said before, now only when it is true', () => {
    expect(planEndedNote('Pro', { used: 10, limit: 10, per: 'total' })).toBe('Your Pro plan has ended. Your 10 free quotes are used, so new requests are saved for you but not priced until you pick a plan.')
    expect(planEndedNote('Pro', { used: 14, limit: 10, per: 'total' })).toContain('Your 10 free quotes are used')
  })

  it('the old monthly allowance', () => {
    expect(planEndedNote('Pro', { used: 7, limit: 50, per: 'month' })).toContain('up to 50 new requests a month are still priced (7 so far this month)')
    expect(planEndedNote('Pro', { used: 50, limit: 50, per: 'month' })).toContain('This month’s 50 requests without a plan are used')
  })

  it('the page uses it with the numbers it already shows', () => {
    const page = read('apps/web/src/app/(dashboard)/app/settings/billing/page.tsx')
    expect(page).toContain('planEndedNote(subscription.endedPlanName, { used: data?.usage.estimatesCreated ?? 0, limit: data?.usage.planLimit ?? 0, per: freeTotal ?')
    expect(page).not.toContain('plan has ended. New requests are saved for you but not priced until you pick a plan.')
  })
})
