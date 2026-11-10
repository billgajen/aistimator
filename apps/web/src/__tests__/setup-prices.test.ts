/**
 * T-150: setup — the plain price list both ways, the "Check your prices"
 * screen (every number, no engine words), the server-issued test flag, and
 * the plan carried from the pricing page.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MultiplierConfig } from '@estimator/shared'
import { listPacks } from '@/lib/vertical-packs'
import { toPriceList, applyPriceList, type PricedService } from '@/lib/price-list'
import { servicePayload, applyCompile, type DraftService } from '@/lib/onboarding-service'
import { issueTestToken, verifyTestToken, TEST_TOKEN_TTL_MS } from '@/lib/test-quote-token'
import { publicSource } from '@/lib/test-quotes'
import { offeredPlanId } from '@/lib/signup-choices'
import { CheckPricesStep } from '@/components/onboarding/CheckPricesStep'

const PACK_SERVICES: DraftService[] = listPacks().flatMap((pack) =>
  pack.services.map((s) => ({
    name: s.name,
    description: s.description,
    draft: s.draft,
    addons: s.addons || [],
    multipliers: s.multipliers || [],
    selected: true,
  }))
)
const priced = (svc: DraftService): PricedService => ({ draft: svc.draft, addons: svc.addons, multipliers: svc.multipliers })

describe('T-150: price list ↔ pricing config', () => {
  it('there are pack services to check', () => {
    expect(PACK_SERVICES.length).toBeGreaterThan(5)
  })

  it.each(PACK_SERVICES.map((s) => [s.name, s] as const))('unchanged list leaves "%s" exactly as it was', (_name, svc) => {
    const back = applyPriceList(priced(svc), toPriceList(priced(svc)))
    expect(back).toEqual(priced(svc))
  })

  it('every rate, add-on, minimum and base fee of every pack service is on the list', () => {
    for (const svc of PACK_SERVICES) {
      const list = toPriceList(priced(svc))
      expect(list.items.map((i) => i.amount)).toEqual(svc.draft.pricing.workSteps.map((w) => w.defaultCost))
      expect(list.addons.map((a) => a.amount)).toEqual(svc.addons.map((a) => a.price))
      expect(list.adjustments).toHaveLength(svc.multipliers.length)
      expect(list.minimumCharge).toBe(svc.draft.pricing.minimumCharge)
      expect(list.baseFee).toBe(svc.draft.pricing.baseFee)
    }
  })

  it('editing one price changes that number only, in the config the services API receives', () => {
    const svc = PACK_SERVICES.find((s) => s.draft.pricing.workSteps.length >= 2)!
    const list = toPriceList(priced(svc))
    const target = list.items[1]!
    const edited = applyPriceList(priced(svc), { ...list, items: list.items.map((i) => (i.key === target.key ? { ...i, amount: 1234.5 } : i)) })
    const steps = edited.draft.pricing.workSteps
    expect(steps[1]!.defaultCost).toBe(1234.5)
    steps.forEach((s, i) => { if (i !== 1) expect(s).toEqual(svc.draft.pricing.workSteps[i]) })
    const payload = servicePayload({ ...svc, ...edited })
    expect(payload.pricingRules.workSteps![1]!.defaultCost).toBe(1234.5)
    expect(payload.workSteps[1]!.defaultCost).toBe(1234.5)
    expect(payload.draftConfig.pricing.workSteps[1]!.defaultCost).toBe(1234.5)
  })

  it('an add-on price edit also updates the draft’s add-on of the same name', () => {
    const svc = PACK_SERVICES.find((s) => s.addons.length > 0 && s.draft.pricing.addOns.some((a) => a.name === s.addons[0]!.label))!
    const list = toPriceList(priced(svc))
    const edited = applyPriceList(priced(svc), { ...list, addons: list.addons.map((a, i) => (i === 0 ? { ...a, amount: 99 } : a)) })
    expect(edited.addons[0]!.price).toBe(99)
    expect(edited.draft.pricing.addOns.find((a) => a.name === svc.addons[0]!.label)!.price).toBe(99)
  })

  it('percentage adjustments read and write as plain percentages', () => {
    const svc = PACK_SERVICES.find((s) => s.multipliers.length > 0)!
    const list = toPriceList(priced(svc))
    expect(list.adjustments[0]!.percent).toBe(Math.round((svc.multipliers[0]!.multiplier - 1) * 10000) / 100)
    const edited = applyPriceList(priced(svc), { ...list, adjustments: list.adjustments.map((a, i) => (i === 0 ? { ...a, percent: 12 } : a)) })
    expect(edited.multipliers[0]!.multiplier).toBe(1.12)
    const cut = applyPriceList(priced(svc), { ...list, adjustments: list.adjustments.map((a, i) => (i === 0 ? { ...a, percent: -10 } : a)) })
    expect(cut.multipliers[0]!.multiplier).toBe(0.9)
  })

  it('a bad number keeps the old value', () => {
    const svc = PACK_SERVICES[0]!
    const list = toPriceList(priced(svc))
    const bad = applyPriceList(priced(svc), {
      ...list,
      minimumCharge: -5,
      baseFee: Number.NaN,
      items: list.items.map((i) => ({ ...i, amount: -1 })),
      adjustments: list.adjustments.map((a) => ({ ...a, percent: -150 })),
    })
    expect(bad).toEqual(priced(svc))
  })

  it('names adjustments in plain words', () => {
    const base = PACK_SERVICES[0]!
    const svc: PricedService = {
      ...priced(base),
      draft: { ...base.draft, suggestedFields: [{ label: 'Weekend job', fieldId: 'weekend', type: 'boolean', required: false, criticalForPricing: true }] },
      multipliers: [
        { when: { fieldId: 'location', operator: 'equals', equals: 'Attic' }, multiplier: 1.12 },
        { when: { fieldId: 'weekend', operator: 'equals', equals: true }, multiplier: 1.2 },
        { when: { subject: 'subtotal', operator: 'gt', value: 5000 }, multiplier: 0.9 },
      ] as MultiplierConfig[],
    }
    const list = toPriceList(svc, (n) => `$${n.toLocaleString('en-US')}`)
    expect(list.adjustments.map((a) => `${a.name}: ${a.percent > 0 ? '+' : ''}${a.percent}%`)).toEqual([
      'Attic: +12%',
      'Weekend job: +20%',
      'Jobs over $5,000: -10%',
    ])
  })

  it('a plain-English change never wipes add-ons or adjustments it didn’t mention', () => {
    const svc = PACK_SERVICES.find((s) => s.addons.length > 0 && s.multipliers.length > 0)!
    const next = applyCompile(svc, { updatedConfig: svc.draft, addons: [], multipliers: [] })
    expect(next.addons).toEqual(svc.addons)
    expect(next.multipliers).toEqual(svc.multipliers)
  })
})

describe('T-150: "Check your prices" screen', () => {
  const svc = PACK_SERVICES.find((s) => s.addons.length > 0 && s.multipliers.length > 0)!
  const html = renderToStaticMarkup(
    createElement(CheckPricesStep, {
      services: [{ index: 0, svc }],
      fromTemplate: true,
      currency: 'USD',
      locale: 'en-US',
      currencySymbol: '$',
      onChange: () => undefined,
      onConfirm: () => undefined,
      onBack: () => undefined,
    })
  )
  const text = html.replace(/<[^>]+>/g, ' ')

  it('shows every price as an editable number', () => {
    const values = [...html.matchAll(/value="([^"]*)"/g)].map((m) => m[1])
    for (const step of svc.draft.pricing.workSteps) expect(values).toContain(String(step.defaultCost))
    for (const addon of svc.addons) expect(values).toContain(String(addon.price))
    expect(values).toContain(String(svc.draft.pricing.minimumCharge))
    expect(values).toContain(String(svc.draft.pricing.baseFee))
  })

  it('carries the template note and the confirm button', () => {
    expect(text).toContain('These are typical starting prices. Change them to yours.')
    expect(text).toContain('These are my prices')
    expect(text).toContain('Describe a change in plain English')
  })

  it('uses no engine terms', () => {
    expect(text).not.toMatch(/work ?step|signal|multiplier/i)
  })
})

describe('T-150: the test flag is server-issued', () => {
  const key = 'test-secret'
  const now = 1_800_000_000_000

  it('a token issued for a tenant verifies for that tenant', () => {
    const { token, expiresAt } = issueTestToken('tnt_a', now, key)
    expect(verifyTestToken(token, 'tnt_a', now + 1000, key)).toEqual({ ok: true, tenantId: 'tnt_a' })
    expect(Date.parse(expiresAt)).toBe(now + TEST_TOKEN_TTL_MS)
  })

  it('refuses another tenant, an expired token, a changed body, a changed signature and junk', () => {
    const { token } = issueTestToken('tnt_a', now, key)
    const [body, sig] = token.split('.') as [string, string]
    const forgedBody = Buffer.from(JSON.stringify({ t: 'tnt_b', e: now + 9e9, n: 'x' })).toString('base64url')
    expect(verifyTestToken(token, 'tnt_b', now, key)).toEqual({ ok: false, reason: 'wrong_tenant' })
    expect(verifyTestToken(token, 'tnt_a', now + TEST_TOKEN_TTL_MS + 1, key)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyTestToken(`${forgedBody}.${sig}`, 'tnt_b', now, key).ok).toBe(false)
    expect(verifyTestToken(`${body}.${sig.slice(0, -2)}xx`, 'tnt_a', now, key).ok).toBe(false)
    expect(verifyTestToken(token, 'tnt_a', now, 'another-secret').ok).toBe(false)
    for (const junk of ['', 'abc', 'a.b.c', 'true', '1']) expect(verifyTestToken(junk, 'tnt_a', now, key).ok).toBe(false)
  })

  it('a client can’t mark its own request as a test through `source`', () => {
    expect(publicSource({ type: 'widget', test: true, isTest: true, is_test: true, pageUrl: 'x' })).toEqual({ type: 'widget', pageUrl: 'x' })
    expect(publicSource(undefined)).toEqual({ type: 'widget' })
    expect(publicSource({ test: true })).toEqual({ type: 'widget' })
  })
})

describe('T-150: the plan from the pricing page', () => {
  it('keeps only plans we offer', () => {
    expect(offeredPlanId('plan_us_pro')).toBe('plan_us_pro')
    expect(offeredPlanId('plan_made_up')).toBeNull()
    expect(offeredPlanId(42)).toBeNull()
    expect(offeredPlanId(undefined)).toBeNull()
  })
})
