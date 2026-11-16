/**
 * T-172: the checker is told the business's money settings, and the wording,
 * add-on and checker calls have a time limit.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CHECKER_SETTINGS_VERSION } from '@qolumns/shared'
import {
  buildValidationPrompt,
  validateQuote,
  type GeneratedQuoteForValidation,
  type PricingSettingsForValidation,
  type ServiceConfigForValidation,
} from '../ai/quote-validator'
import { AI_CALL_TIMEOUTS, AiCallTimeoutError, aiCallTimeoutMs, withAiTimeout } from '../ai/timeouts'
import type { AiClient } from '../ai/client'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const request = { formAnswers: [{ fieldId: 'door_count', value: 1 }], customerDescription: 'One door, the spring snapped.', photoCount: 0 }
const settings = (over: Partial<PricingSettingsForValidation> = {}): PricingSettingsForValidation => ({
  currency: 'USD',
  locale: 'en-US',
  baseFee: 0,
  minimumCharge: 0,
  tax: { enabled: false, ratePercent: 0 },
  ...over,
})
const service = (pricingSettings?: PricingSettingsForValidation): ServiceConfigForValidation => ({
  serviceName: 'Door repair',
  workSteps: [{ id: 'ws_1', name: 'Spring', description: '', costType: 'fixed', defaultCost: 245, optional: false }],
  addons: [{ id: 'ad_1', label: 'Tune-up', price: 60 }],
  multipliers: [],
  pricingSettings,
})
const quote = (pricing: Partial<GeneratedQuoteForValidation['pricing']> = {}): GeneratedQuoteForValidation => ({
  pricing: {
    currency: 'USD',
    subtotal: 245,
    taxAmount: 0,
    total: 245,
    breakdown: [{ label: 'Spring', amount: 245 }],
    confidence: 1,
    notes: [],
    ...pricing,
  },
  content: { scopeSummary: 'Replace the spring.', assumptions: [], exclusions: [], notes: '' } as unknown as GeneratedQuoteForValidation['content'],
})
const prompt = (s?: PricingSettingsForValidation, q = quote()) => buildValidationPrompt(request, service(s), q)

describe('T-172: the checker is told the business’s money settings', () => {
  it('a minimum charge: said to be a floor, and the line that tops the job up is marked', () => {
    const text = prompt(
      settings({ minimumCharge: 400 }),
      quote({ subtotal: 400, total: 400, breakdown: [{ label: 'Spring', amount: 245 }, { label: 'Minimum charge applied', amount: 155, kind: 'minimum', minimumCharge: 400 }] })
    )
    expect(text).toContain('- Minimum charge: $400.00. It is a floor, not an item')
    expect(text).toContain("- Minimum charge applied: $155.00 [this line tops the job up to the business's minimum charge]")
    expect(text).toContain('- Total: $400.00')
  })

  it('a base fee: said to be charged once and to be its own line', () => {
    const text = prompt(settings({ baseFee: 75 }), quote({ subtotal: 320, total: 320, breakdown: [{ label: 'Base service fee', amount: 75 }, { label: 'Spring', amount: 245 }] }))
    expect(text).toContain('- Base fee: $75.00, charged once on every quote. It appears in the breakdown as its own line.')
    expect(text).toContain('- Minimum charge: none.')
  })

  it('tax: its label and rate, and the subtotal, tax and total as three lines', () => {
    const text = prompt(
      settings({ tax: { enabled: true, label: 'Sales Tax', ratePercent: 8.25 } }),
      quote({ subtotal: 245, taxLabel: 'Sales Tax', taxRate: 8.25, taxAmount: 20.21, total: 265.21 })
    )
    expect(text).toContain('- Tax: Sales Tax at 8.25%, added to the subtotal. It is not a line in the breakdown.')
    expect(text).toContain('- Subtotal: $245.00\n- Sales Tax: $20.21 (8.25%)\n- Total: $265.21')
  })

  it('a setting that is off is said to be off', () => {
    const text = prompt(settings())
    expect(text).toContain('- Base fee: none.')
    expect(text).toContain('- Minimum charge: none.')
    expect(text).toContain('- Tax: not charged on this service.')
  })

  it('the currency is the business’s: no amount is written in a currency of ours', () => {
    const usd = prompt(settings())
    expect(usd).toContain('- Currency: USD. Every amount in the configuration and in the quote is in USD.')
    expect(usd).toContain('Spring: $245.00/fixed')
    expect(usd).toContain('- Tune-up: $60.00 (keywords')
    expect(usd).not.toContain('£')
    const gbp = prompt(settings({ currency: 'GBP', locale: 'en-GB' }), quote({ currency: 'GBP' }))
    expect(gbp).toContain('- Currency: GBP.')
    expect(gbp).toContain('- Total: £245.00')
    expect(gbp).not.toContain('$')
    const eur = prompt(settings({ currency: 'EUR', locale: 'de-DE' }), quote({ currency: 'EUR' }))
    expect(eur).toContain('- Total: 245,00 €')
    // no pound sign is typed into the checker's file any more
    expect(read('apps/worker/src/ai/quote-validator.ts')).not.toContain('£')
  })

  it('the checks are told what the settings explain', () => {
    const text = prompt(settings({ baseFee: 75, minimumCharge: 400 }))
    expect(text).toContain('If that comes to less than the\n     minimum charge, the subtotal is the minimum charge. Then add tax at the configured rate')
    expect(text).toContain('is CORRECT and is never an issue.')
    expect(text).toContain('or to the\n     business\'s money settings: the base fee line, and the line that tops the job up to the minimum charge')
    expect(text).toContain('- Tax at the configured rate is never an invented fee')
    expect(text).toContain('8. The base fee, the minimum charge, tax and the currency are set by the business. Never flag a quote for applying them as configured.')
    // it still checks: an underpriced quote and a line found nowhere are still issues
    expect(text).toContain('If actual < expected by >20% → ISSUE (underpriced)')
    expect(text).toContain('ISSUE if a line item is found in none of these')
  })

  it('without settings (an older caller) the prompt still builds, in the quote’s own currency', () => {
    const text = prompt(undefined, quote({ currency: 'CAD' }))
    expect(text).toContain('- (not provided)')
    expect(text).toMatch(/- Total: CA\$245\.00/)
  })

  it('the processor passes the settings the engine priced with, and nothing typed in', () => {
    const src = read('apps/worker/src/quote-processor.ts')
    const block = src.slice(src.indexOf('pricingSettings: {'), src.indexOf('// Build quote data for validation'))
    expect(block).toContain('currency: pricing.currency,')
    expect(block).toContain('baseFee: rules.baseFee || 0,')
    expect(block).toContain('minimumCharge: rules.minimumCharge || 0,')
    expect(block).toContain('enabled: Boolean(tenant.tax_enabled && !service.tax_exempt),')
    expect(block).toContain('ratePercent: (tenant.tax_rate || 0) * 100,')
    expect(block).toContain('label: regionCtx.taxLabel,')
    // the same expressions the pricing engine is given
    expect(src).toContain('enabled: tenant.tax_enabled && !service.tax_exempt,')
    expect(src).toContain('rate: (tenant.tax_rate || 0) * 100,')
  })

  it('AD-049 holds: the checker is handed a copy and returns findings only', async () => {
    const q = quote()
    const before = JSON.stringify(q)
    const client = { generateWithSchema: vi.fn(async () => ({ overallStatus: 'PASS', confidenceScore: 1, issues: [], summary: { criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0 }, calculatedExpectedTotal: 999, actualTotal: 1, pricingGapPercent: 0 })) } as unknown as AiClient
    const result = await validateQuote(client, q, request, service(settings({ minimumCharge: 400 })))
    expect(JSON.stringify(q)).toBe(before)
    expect(Object.keys(result)).not.toContain('pricing')
    const src = read('apps/worker/src/quote-processor.ts')
    expect(src).toContain('const quoteForValidation: GeneratedQuoteForValidation = structuredClone({')
  })

  it('a new check is marked, and the model is not named here', () => {
    expect(CHECKER_SETTINGS_VERSION).toBe('v2')
    const src = read('apps/worker/src/quote-processor.ts')
    expect(src).toContain('serviceConfigVersion: CHECKER_SETTINGS_VERSION,')
    expect(src).not.toContain("serviceConfigVersion: 'v1'")
    for (const file of ['apps/worker/src/ai/quote-validator.ts', 'apps/worker/src/ai/timeouts.ts']) {
      expect(read(file)).not.toMatch(/gemini-[0-9]|claude-[a-z]+-[0-9]|gpt-[0-9]/i)
    }
  })
})

describe('T-172: a time limit on the wording, add-on and checker calls', () => {
  it('the three limits are set in one place, each with an env var', () => {
    expect(Object.keys(AI_CALL_TIMEOUTS).sort()).toEqual(['addons', 'checker', 'wording'])
    expect(aiCallTimeoutMs('wording')).toBe(30_000)
    expect(aiCallTimeoutMs('addons')).toBe(20_000)
    expect(aiCallTimeoutMs('checker')).toBe(30_000)
    expect(aiCallTimeoutMs('wording', { AI_TIMEOUT_WORDING_MS: '5000' })).toBe(5000)
    expect(aiCallTimeoutMs('checker', { AI_TIMEOUT_CHECKER_MS: '0' })).toBe(0)
    // nonsense falls back to the default; another call's var changes nothing
    for (const bad of ['', '  ', 'soon', '-1', 'NaN']) expect(aiCallTimeoutMs('addons', { AI_TIMEOUT_ADDONS_MS: bad })).toBe(20_000)
    expect(aiCallTimeoutMs('addons', { AI_TIMEOUT_WORDING_MS: '1' })).toBe(20_000)
    // nowhere else: the processor holds no number of its own for these
    const src = read('apps/worker/src/quote-processor.ts')
    expect(src.match(/withAiTimeout\('(wording|addons|checker)', aiCallTimeoutMs\('\1', env\)/g)).toHaveLength(4)
  })

  it('a call that answers in time is returned as it is', async () => {
    await expect(withAiTimeout('wording', 1000, async () => 'done')).resolves.toBe('done')
    await expect(withAiTimeout('wording', 1000, async () => { throw new Error('provider said no') })).rejects.toThrow('provider said no')
  })

  it('a call that does not answer is given up on, and the error says only which call and how long', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const never = new Promise<string>(() => {})
      const pending = withAiTimeout('checker', 30_000, () => never)
      const caught = pending.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(30_000)
      const error = await caught
      expect(error).toBeInstanceOf(AiCallTimeoutError)
      expect((error as AiCallTimeoutError).call).toBe('checker')
      expect((error as AiCallTimeoutError).message).toBe('AI call "checker" timed out after 30000 ms')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]).toEqual(['[AI] checker timed out after 30000 ms; continuing with the fallback'])
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('no timer is left running after an answer, and 0 means no limit', async () => {
    vi.useFakeTimers()
    try {
      await withAiTimeout('addons', 20_000, async () => [])
      expect(vi.getTimerCount()).toBe(0)
      let finish: (v: string) => void = () => {}
      const slow = new Promise<string>((resolve) => { finish = resolve })
      const unlimited = withAiTimeout('wording', 0, () => slow)
      await vi.advanceTimersByTimeAsync(600_000)
      finish('late but allowed')
      await expect(unlimited).resolves.toBe('late but allowed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a timed-out call lands where a failed call already lands, and none of them is near a price', () => {
    const src = read('apps/worker/src/quote-processor.ts')
    // wording: the template wording
    const wording = src.slice(src.indexOf("withAiTimeout('wording'"), src.indexOf("withAiTimeout('wording'") + 420)
    expect(wording).toMatch(/\} catch \(error\) \{\s*console\.error\('\[Processor\] Wording generation failed, using fallback:', error\)\s*content = generateWordingFallback\(wordingContext\)/)
    // add-ons from the description: no AI add-ons
    const first = src.indexOf("withAiTimeout('addons'")
    expect(src.slice(first, first + 700)).toMatch(/\.catch\(\(error\) => \{\s*console\.error\('\[Processor\] AI addon detection failed:', error\)\s*return null/)
    // add-ons from the photos: carries on without them
    const second = src.indexOf("withAiTimeout('addons'", first + 10)
    expect(src.slice(second, src.indexOf('// Continue without AI addon detection', second) + 10)).toContain("console.error('[Processor] AI image addon detection failed:', error)")
    // the checker: the quote goes on as priced, and nothing is logged for a check that did not finish
    const checker = src.indexOf("withAiTimeout('checker'")
    const afterChecker = src.slice(checker, src.indexOf('// Continue without validation', checker) + 60)
    expect(afterChecker).toContain("console.error('[Processor] Quote validation failed:', error instanceof Error ? error.message : 'unknown error')")
    expect(afterChecker.indexOf('logValidationResult(')).toBeGreaterThan(0)
    expect(afterChecker.indexOf('logValidationResult(')).toBeLessThan(afterChecker.indexOf('} catch (error) {'))
    // the helper touches nothing but the promise and a timer
    const helper = read('apps/worker/src/ai/timeouts.ts')
    expect(helper).not.toMatch(/pricing|total|breakdown|supabase/i)
    expect(helper.match(/^import /gm)).toBeNull()
  })
})
