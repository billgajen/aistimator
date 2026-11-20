/**
 * T-195: four new templates, each priced by the real pricing engine (the worker's rules engine, the same
 * one a quote uses) from the template's own rates, for two sets of answers. Every expected figure below
 * is worked out by hand from the rates in the template, so a rate changed in the template is a rate
 * changed in the test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ExtractedSignalsV2 } from '@qolumns/shared'
import { calculatePricingWithTrace, type FormAnswer, type PricingRules, type TaxConfig } from '../../../worker/src/pricing/rules-engine'
import type { ExtractedSignals } from '../../../worker/src/ai/signals'
import { listPacks, getPack, type VerticalPack } from '@/lib/vertical-packs'
import { hvacPackUS } from '@/lib/vertical-packs/hvac-us'
import { junkRemovalPackUS } from '@/lib/vertical-packs/junk-removal-us'
import { pressureWashingPackUS } from '@/lib/vertical-packs/pressure-washing-us'
import { fencingPackUS } from '@/lib/vertical-packs/fencing-us'

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
const structured = (): ExtractedSignalsV2 => ({ extractedAt: new Date().toISOString(), overallConfidence: 0.95, signals: [], complexity: { level: 'medium', factors: [] }, siteVisitRecommended: false, lowConfidenceSignals: [] })
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Tax' }

type Service = VerticalPack['services'][number]
const serviceOf = (pack: VerticalPack, name: string): Service => pack.services.find((s) => s.name === name)!

/** The rules a service made from the template is saved with (lib/service-rows.ts `pricingRulesRow`) */
const rulesOf = (svc: Service): PricingRules => ({
  baseFee: svc.draft.pricing.baseFee,
  minimumCharge: svc.draft.pricing.minimumCharge,
  addons: (svc.addons ?? []) as PricingRules['addons'],
  multipliers: (svc.multipliers ?? []) as PricingRules['multipliers'],
  workSteps: svc.draft.pricing.workSteps,
})

function price(svc: Service, answers: Record<string, string | number>) {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const formAnswers: FormAnswer[] = Object.entries(answers).map(([fieldId, value]) => ({ fieldId, value }))
  const result = calculatePricingWithTrace(rulesOf(svc), signals(), structured(), formAnswers, noTax, 'USD')
  vi.restoreAllMocks()
  // the line's name, without the sum the engine writes after it ("Gate  $350 × 2 gates")
  const lines = result.trace.trace.filter((t) => t.type === 'work_step').map((t) => [t.description.split('  ')[0]!, t.amount] as [string, number])
  const labels = result.trace.trace.filter((t) => t.type === 'work_step').map((t) => t.description)
  return { lines, labels, total: result.result.total }
}

/** Every question the template asks must be one a homeowner answers on a phone: tap a choice, or type a number */
function askedOnAPhone(svc: Service) {
  for (const f of svc.draft.suggestedFields) expect(['dropdown', 'number'], f.label).toContain(f.type)
  expect(svc.draft.expectedSignals.filter((s) => s.identify), 'no new label reading').toEqual([])
  expect(svc.draft.pricing.workSteps.filter((s) => s.quantitySource?.type === 'ai_signal'), 'no photo measurement').toEqual([])
  for (const step of svc.draft.pricing.workSteps) if (step.when) expect(svc.draft.suggestedFields.map((f) => f.fieldId)).toContain(step.when.fieldId)
}

describe('T-195: Ductless Mini-Split Installation (HVAC)', () => {
  const svc = serviceOf(hvacPackUS, 'Ductless Mini-Split Installation')

  it('one room, new install, on the ground, close by: the first room only', () => {
    const { lines, total } = price(svc, { ms_rooms: 1, ms_existing: 'No, this is a new install', ms_outdoor_spot: 'On the ground', ms_close: 'Yes' })
    expect(lines).toEqual([['Outdoor unit, first room and startup', 3600]])
    expect(total).toBe(3600)
  })

  it('four rooms, two large, one upstairs, replacing, on a wall bracket, further away', () => {
    const { lines, total } = price(svc, { ms_rooms: 4, ms_large_rooms: 2, ms_upstairs_rooms: 1, ms_existing: 'Yes, replace the old one', ms_outdoor_spot: 'On a wall bracket', ms_close: 'No, it is further away' })
    // 3600 + 3 × 2400 + 2 × 400 + 250 + 350 + 180 + 300
    expect(lines).toEqual([
      ['Outdoor unit, first room and startup', 3600],
      ['Each additional room', 7200],
      ['Larger indoor unit', 800],
      ['Upstairs room', 250],
      ['Remove and dispose of the old system', 350],
      ['Wall bracket for the outdoor unit', 180],
      ['Longer line run', 300],
    ])
    expect(total).toBe(12680)
  })

  it('the roof is its own line; the questions are the ticket’s, all answered with a tap or a number', () => {
    expect(price(svc, { ms_rooms: 2, ms_existing: 'No, this is a new install', ms_outdoor_spot: 'On the roof', ms_close: 'Yes' }).total).toBe(3600 + 2400 + 550)
    expect(svc.draft.suggestedFields.map((f) => f.label)).toEqual([
      'How many rooms do you want to heat and cool?',
      'How many of those rooms are large or open plan?',
      'How many of those rooms are upstairs?',
      'Is there a mini-split there now?',
      'Where should the outdoor unit go?',
      'Can the outdoor unit sit right outside those rooms?',
    ])
    askedOnAPhone(svc)
    expect(svc.draft.media).toMatchObject({ minPhotos: 1, maxPhotos: 8 })
    expect(svc.draft.pricing.addOns.map((a) => [a.name, a.price])).toEqual([['Line set cover', 160], ['Condensate pump', 220], ['New dedicated circuit', 480]])
    expect(svc.promptContext).toContain('Never size equipment from a photo.')
    expect(hvacPackUS).toMatchObject({ id: 'hvac-replacement-us', name: 'HVAC (US)' })
    expect(hvacPackUS.description).toMatch(/mini-split/)
  })
})

describe('T-195: Junk Removal', () => {
  const svc = serviceOf(junkRemovalPackUS, 'Junk Removal')

  it('a few items outside: the minimum charge is the price', () => {
    const { lines, total } = price(svc, { junk_amount: 'A few items', junk_where: 'Outside or in the garage' })
    expect(lines).toEqual([['A few items', 95]])
    expect(total).toBe(95)
  })

  it('half a truck from upstairs, two mattresses and a fridge', () => {
    const { lines, total } = price(svc, { junk_amount: 'Half truck', junk_where: 'Upstairs or basement', junk_mattresses: 2, junk_appliances: 1 })
    expect(lines).toEqual([
      ['Half truck load', 280],
      ['Carry down or up stairs', 60],
      ['Mattress disposal', 80],
      ['Fridge, freezer or AC unit disposal', 60],
    ])
    expect(total).toBe(480)
    expect(price(svc, { junk_amount: 'Half truck', junk_where: 'Upstairs or basement', junk_mattresses: 2 }).labels).toContain('Mattress disposal  $40 × 2 items')
    askedOnAPhone(svc)
    expect(svc.draft.pricing.minimumCharge).toBe(95)
  })
})

describe('T-195: Pressure Washing', () => {
  const svc = serviceOf(pressureWashingPackUS, 'Pressure Washing')

  it('a 2-car driveway and walkways, the rest "None": 180 + 60', () => {
    const { lines, total } = price(svc, { pw_driveway: '2-car', pw_patio: 'None', pw_siding: 'None', pw_walkways: 'Yes', pw_water: 'Yes' })
    expect(lines).toEqual([['Driveway, 2-car', 180], ['Walkways or front steps', 60]])
    expect(total).toBe(240)
  })

  it('a small patio alone is under the minimum, so the minimum is the price; two story siding and a large deck', () => {
    expect(price(svc, { pw_patio: 'Small', pw_water: 'Not sure' }).total).toBe(150)
    const { lines, total } = price(svc, { pw_patio: 'Large', pw_siding: 'Two story', pw_water: 'Yes' })
    expect(lines).toEqual([['Patio or deck, large', 200], ['House siding, two story', 520]])
    expect(total).toBe(720)
    askedOnAPhone(svc)
    for (const f of svc.draft.suggestedFields.slice(0, 4)) expect(f.options![0], f.label).toBe('None')
  })
})

describe('T-195: Fence Installation', () => {
  const svc = serviceOf(fencingPackUS, 'Fence Installation')

  it('100 ft of 6 ft wood on flat ground, no gates, nothing to take down', () => {
    const { lines, total } = price(svc, { fence_length_ft: 100, fence_material: 'Wood', fence_height: '6 ft', fence_old: 'No', fence_ground: 'Mostly flat' })
    expect(lines).toEqual([['Wood fence', 3200]])
    expect(total).toBe(3200)
  })

  it('150 ft of 4 ft vinyl on a slope, two gates, an old fence down', () => {
    const { lines, total } = price(svc, { fence_length_ft: 150, fence_material: 'Vinyl', fence_height: '4 ft', fence_gates: 2, fence_old: 'Yes', fence_ground: 'Sloped' })
    // 150 × 42 = 6300; 4 ft: −15% of 6300 = −945; sloped: +10% of 6300 = 630; gates 700; removal 150 × 5 = 750
    expect(lines).toEqual([
      ['Vinyl fence', 6300],
      ['Gate', 700],
      ['Old fence removal', 750],
      ['4 ft height', -945],
      ['Sloped ground', 630],
    ])
    expect(total).toBe(7435)
    askedOnAPhone(svc)
    expect(svc.draft.pricing.siteVisit.estimateAbove).toBe(8000)
  })
})

describe('T-195: one order, and the templates need no extra code to be offered', () => {
  it('the registry’s order is the one every list follows; a UK business sees its own packs first', () => {
    expect(listPacks().map((p) => p.id)).toEqual([
      'water-heater-us', 'hvac-replacement-us', 'electrical-us', 'plumbing-fixtures-us', 'garage-doors-us', 'painting-decorating-us',
      'fencing-us', 'junk-removal-us', 'pressure-washing-us', 'painting-decorating',
    ])
    expect(listPacks('GB')[0]!.region).toBe('GB')
    expect(listPacks('US').filter((p) => p.region === 'US')).toHaveLength(9)
  })

  it('setup and "Add from a template" list them from the registry', () => {
    for (const id of ['fencing-us', 'junk-removal-us', 'pressure-washing-us']) expect(getPack(id)?.region).toBe('US')
    expect(readFileSync(join(__dirname, '../components/onboarding/OnboardingFlow.tsx'), 'utf8')).toContain('listPacks(region)')
    expect(readFileSync(join(__dirname, '../lib/service-templates.ts'), 'utf8')).toContain('listPacks(')
  })
})
