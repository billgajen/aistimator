/**
 * T-157 (worker): the business always gets its emails, no address is ever
 * logged, and money is rounded where a line is created.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { chooseBusinessEmail, redactEmails, roundMoney, splitLabelMath } from '@estimator/shared'
import type { ExtractedSignalsV2 } from '@estimator/shared'
import { loadBusinessEmail } from '../business-email'
import { sendQuoteEmails, sendEstimateShownEmail, sendReviewRequestEmail } from '../email'
import {
  calculatePricing,
  calculatePricingWithTrace,
  type PricingRules,
  type FormAnswer,
  type TaxConfig,
} from '../pricing/rules-engine'
import type { ExtractedSignals } from '../ai/signals'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. The business email rule
// ---------------------------------------------------------------------------

/** Enough of the service-role client for the lookup, counting what it reads */
function fakeClient(opts: { ownerId?: string | null; ownerEmail?: string | null }) {
  const calls = { profiles: 0, authUsers: 0 }
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    single: async () => {
      calls.profiles++
      return { data: opts.ownerId ? { id: opts.ownerId } : null, error: null }
    },
  }
  const client = {
    from: () => query,
    auth: {
      admin: {
        getUserById: async () => {
          calls.authUsers++
          return { data: { user: opts.ownerEmail ? { email: opts.ownerEmail } : null }, error: null }
        },
      },
    },
  }
  return { client: client as unknown as Parameters<typeof loadBusinessEmail>[0], calls }
}

describe('T-157: where emails to the business go (worker)', () => {
  it('the Settings address wins, and the account is not even looked up', async () => {
    const { client, calls } = fakeClient({ ownerId: 'usr_1', ownerEmail: 'account@example.com' })
    const to = await loadBusinessEmail(client, 'tnt_a', { notification_email: 'office@example.com', is_demo: false })
    expect(to).toBe('office@example.com')
    expect(calls).toEqual({ profiles: 0, authUsers: 0 })
  })

  it('an empty setting falls back to the first user’s account email', async () => {
    for (const setting of [null, '', '   ', undefined]) {
      const { client } = fakeClient({ ownerId: 'usr_1', ownerEmail: 'account@example.com' })
      expect(await loadBusinessEmail(client, 'tnt_a', { notification_email: setting, is_demo: false })).toBe('account@example.com')
    }
  })

  it('the demo business emails no one, whatever is configured', async () => {
    const { client, calls } = fakeClient({ ownerId: 'usr_1', ownerEmail: 'account@example.com' })
    expect(await loadBusinessEmail(client, 'tnt_demo', { notification_email: 'office@example.com', is_demo: true })).toBeUndefined()
    expect(await loadBusinessEmail(client, 'tnt_demo', { notification_email: null, is_demo: true })).toBeUndefined()
    expect(calls).toEqual({ profiles: 0, authUsers: 0 })
  })

  it('no setting and no user: nothing (the caller keeps its own fallback)', async () => {
    const { client } = fakeClient({ ownerId: null })
    expect(await loadBusinessEmail(client, 'tnt_a', { notification_email: null })).toBeUndefined()
    const noEmail = fakeClient({ ownerId: 'usr_1', ownerEmail: null })
    expect(await loadBusinessEmail(noEmail.client, 'tnt_a', null)).toBeUndefined()
  })

  it('is the same pure rule the web app uses', () => {
    expect(chooseBusinessEmail({ notificationEmail: ' office@example.com ', ownerEmail: 'account@example.com' })).toBe('office@example.com')
    expect(chooseBusinessEmail({ notificationEmail: '', ownerEmail: 'account@example.com' })).toBe('account@example.com')
    expect(chooseBusinessEmail({ isDemo: true, notificationEmail: 'office@example.com', ownerEmail: 'account@example.com' })).toBeNull()
    expect(chooseBusinessEmail({})).toBeNull()
  })

  it('the processor loads it through this rule (no second copy of the lookup)', () => {
    const src = readFileSync(join(__dirname, '..', 'quote-processor.ts'), 'utf8')
    expect(src).toContain('loadBusinessEmail(')
    expect(src).toMatch(/notification_email,\s*\n\s*is_demo/)
    expect(src).not.toContain('auth.admin.getUserById')
  })
})

describe('T-157: no email address in the worker’s logs', () => {
  const config = { postmarkApiToken: 't', fromEmail: 'from@example.com', appUrl: 'https://example.test' }
  const addresses = ['riley.customer@example.com', 'office@example.com', 'from@example.com']

  function captureLogs() {
    const lines: string[] = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '))
      })
    }
    return lines
  }

  it('quote, estimate and review emails log the quote id, never an address', async () => {
    const lines = captureLogs()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ MessageID: 'm' }), { status: 200 })))
    await sendQuoteEmails(config, {
      quoteId: 'qte_log',
      quoteToken: 'tok',
      customer: { name: 'Riley Stone', email: 'riley.customer@example.com' },
      business: { name: 'Stone Decorating', ownerEmail: 'office@example.com' },
      service: { name: 'Exterior painting' },
      pricing: { total: 622.8, currency: 'GBP' },
    })
    await sendEstimateShownEmail(config, {
      quoteId: 'qte_log',
      quoteToken: 'tok',
      customerName: 'Riley Stone',
      customerEmail: 'riley.customer@example.com',
      businessName: 'Stone Decorating',
      replyTo: 'office@example.com',
      serviceName: 'Exterior painting',
      total: 622.8,
      currency: 'GBP',
    })
    await sendReviewRequestEmail(config, {
      quoteId: 'qte_log',
      ownerEmail: 'office@example.com',
      businessName: 'Stone Decorating',
      customerName: 'Riley Stone',
      customerEmail: 'riley.customer@example.com',
      serviceName: 'Exterior painting',
      total: 622.8,
      currency: 'GBP',
    })
    expect(lines.length).toBeGreaterThanOrEqual(4)
    expect(lines.every((l) => l.includes('qte_log'))).toBe(true)
    for (const address of addresses) expect(lines.join('\n')).not.toContain(address)
    expect(lines.join('\n')).not.toMatch(/@/)
  })

  it('a provider error that names the recipient is redacted before it is logged or returned', async () => {
    const lines = captureLogs()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ Message: 'Found inactive addresses: riley.customer@example.com. Inactive recipients are ones that have generated a hard bounce.' }), { status: 422 })
      )
    )
    const result = await sendQuoteEmails(config, {
      quoteId: 'qte_log',
      quoteToken: 'tok',
      customer: { name: 'Riley Stone', email: 'riley.customer@example.com' },
      business: { name: 'Stone Decorating', ownerEmail: 'office@example.com' },
      service: { name: 'Exterior painting' },
      pricing: { total: 622.8, currency: 'GBP' },
    })
    expect(result.customerEmail.success).toBe(false)
    expect(result.customerEmail.error).toContain('[address]')
    expect(`${lines.join('\n')}\n${result.customerEmail.error}`).not.toMatch(/@/)
  })

  it('redactEmails leaves everything else alone', () => {
    expect(redactEmails('HTTP 422')).toBe('HTTP 422')
    expect(redactEmails('to a.b+c@mail.example.co.uk and x@y.io failed')).toBe('to [address] and [address] failed')
  })

  it('the customer email still replies to the business address', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ MessageID: 'm' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await sendQuoteEmails(config, {
      quoteId: 'qte_1',
      quoteToken: 'tok',
      customer: { name: 'Riley Stone', email: 'riley.customer@example.com' },
      business: { name: 'Stone Decorating', ownerEmail: 'office@example.com' },
      service: { name: 'Exterior painting' },
      pricing: { total: 100, currency: 'GBP' },
    })
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body))
    expect(bodies[0]).toMatchObject({ To: 'riley.customer@example.com', ReplyTo: 'office@example.com' })
    expect(bodies[1]).toMatchObject({ To: 'office@example.com' })
  })
})

// ---------------------------------------------------------------------------
// 6. Money is always rounded
// ---------------------------------------------------------------------------

const signals = (): ExtractedSignals => ({
  category: 'test',
  materials: [],
  condition: { rating: 'good' },
  complexity: { level: 'medium', factors: [] },
  access: { difficulty: 'easy' },
  observations: [],
  warnings: [],
  confidence: 0.9,
  siteVisitRecommended: false,
})
const structured = (): ExtractedSignalsV2 => ({
  extractedAt: new Date().toISOString(),
  overallConfidence: 0.95,
  signals: [],
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'VAT' }
const vat: TaxConfig = { enabled: true, rate: 20, label: 'VAT' }
const rules = (over: Partial<PricingRules>): PricingRules => ({ baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], ...over })
const price = (r: PricingRules, answers: FormAnswer[], tax: TaxConfig = noTax) => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  return calculatePricingWithTrace(r, signals(), structured(), answers, tax, 'GBP')
}
const twoDecimals = (n: number) => Number.isInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9 && n === roundMoney(n)
const sum = (lines: Array<{ amount: number }>) => roundMoney(lines.reduce((s, l) => s + l.amount, 0))

const wallsStep = {
  id: 'walls',
  name: 'Exterior walls',
  description: 'Paint the exterior walls',
  costType: 'per_unit' as const,
  defaultCost: 18,
  optional: false,
  unitLabel: 'sqm',
  quantitySource: { type: 'form_field' as const, fieldId: 'wall_area' },
}

describe('T-157: roundMoney', () => {
  it('rounds to 2 decimals, half away from zero, negatives too', () => {
    expect(roundMoney(18 * 34.6)).toBe(622.8)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(-1.005)).toBe(-1.01)
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })

  it('leaves clean amounts alone and never returns dust, -0 or NaN', () => {
    expect(roundMoney(622.8)).toBe(622.8)
    expect(roundMoney(1400)).toBe(1400)
    expect(roundMoney(0)).toBe(0)
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true)
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(1234.005)).toBe(1234.01)
    expect(roundMoney(-0.125)).toBe(-0.13)
    expect(roundMoney(1e-9)).toBe(0)
    expect(roundMoney(Number.NaN)).toBe(0)
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0)
    expect(roundMoney('12' as unknown as number)).toBe(0)
  })
})

describe('T-157: the engine rounds every line where it is created', () => {
  it('18 x 34.6 stores 622.8, and the lines add up to the subtotal', () => {
    const { result, trace } = price(rules({ workSteps: [wallsStep] }), [{ fieldId: 'wall_area', value: 34.6 }])
    expect(18 * 34.6).not.toBe(622.8) // the float dust this ticket removes
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0]!.amount).toBe(622.8)
    expect(result.subtotal).toBe(622.8)
    expect(result.total).toBe(622.8)
    expect(trace.trace[0]!.amount).toBe(622.8)
    expect(trace.trace[0]!.runningTotal).toBe(622.8)
  })

  it('does not change the label format the engine writes', () => {
    const { result } = price(rules({ workSteps: [wallsStep] }), [{ fieldId: 'wall_area', value: 34.6 }])
    expect(result.breakdown[0]!.label).toBe('Exterior walls  £18 x 34.6(Sqm)')
    expect(splitLabelMath(result.breakdown[0]!.label)).toEqual(['Exterior walls', '£18 × 34.6 Sqm'])
  })

  it('every line is 2 decimals and the subtotal is their sum, with a base fee, add-on, multiplier and tax', () => {
    const { result } = price(
      rules({
        baseFee: 49.995,
        workSteps: [
          wallsStep,
          { ...wallsStep, id: 'trim', name: 'Trim', defaultCost: 7.35, quantitySource: { type: 'form_field', fieldId: 'trim_m' } },
          { id: 'fee', name: 'Service charge', description: '', costType: 'percent', defaultCost: 12.5, optional: false, percentOf: ['walls', 'trim'] } as never,
        ],
        addons: [{ id: 'wash', label: 'Pressure wash', price: 33.333 } as never],
        multipliers: [{ when: { fieldId: 'access', equals: 'hard' }, multiplier: 1.175, label: 'Difficult access' } as never],
      }),
      [
        { fieldId: 'wall_area', value: 34.6 },
        { fieldId: 'trim_m', value: 12.7 },
        { fieldId: 'access', value: 'hard' },
        { fieldId: '_project_description', value: 'pressure wash first please' },
      ],
      vat
    )
    expect(result.breakdown.length).toBeGreaterThanOrEqual(4)
    for (const line of result.breakdown) expect(twoDecimals(line.amount), `${line.label}: ${line.amount}`).toBe(true)
    expect(sum(result.breakdown)).toBe(result.subtotal)
    // tax and total as before: tax on the subtotal, total = subtotal + tax
    expect(result.taxAmount).toBe(Math.round(result.subtotal * 0.2 * 100) / 100)
    expect(result.total).toBe(Math.round((result.subtotal + result.taxAmount) * 100) / 100)
  })

  it('a minimum charge still makes the lines add up to the minimum', () => {
    const { result } = price(rules({ minimumCharge: 750.5, workSteps: [wallsStep] }), [{ fieldId: 'wall_area', value: 34.6 }])
    expect(result.subtotal).toBe(750.5)
    expect(sum(result.breakdown)).toBe(750.5)
    expect(result.breakdown.map((l) => l.amount)).toEqual([622.8, 127.7])
  })

  it('amounts that were already clean are unchanged (rounding is the only change)', () => {
    const { result } = price(
      rules({ baseFee: 50, workSteps: [{ ...wallsStep, defaultCost: 25 }] }),
      [{ fieldId: 'wall_area', value: 40 }],
      vat
    )
    expect(result.breakdown.map((l) => l.amount)).toEqual([50, 1000])
    expect(result.subtotal).toBe(1050)
    expect(result.taxAmount).toBe(210)
    expect(result.total).toBe(1260)
  })

  it('the legacy calculator follows the same rule', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const legacy = calculatePricing(
      rules({
        baseFee: 10.005,
        measurementModel: { type: 'per_unit', unit: 'sqm', pricePerUnit: 18 } as never,
        multipliers: [{ when: { fieldId: 'access', equals: 'hard' }, multiplier: 1.175, label: 'Difficult access' } as never],
      }),
      signals(),
      [{ fieldId: 'access', value: 'hard' }],
      noTax,
      'GBP',
      { quantity: 34.6 }
    )
    for (const line of legacy.breakdown) expect(twoDecimals(line.amount), `${line.label}: ${line.amount}`).toBe(true)
    expect(legacy.breakdown[0]!.amount).toBe(10.01)
    expect(legacy.breakdown[1]!.amount).toBe(622.8)
    expect(sum(legacy.breakdown)).toBe(legacy.subtotal)
  })
})
