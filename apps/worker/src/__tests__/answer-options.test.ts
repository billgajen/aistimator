import { describe, it, expect } from 'vitest'
import { fieldOptions, snapToOption, answersOutsideOptions } from '../answer-options'
import { evaluateQualityGate } from '../agents/quality-gate'
import type { PricingResult } from '../pricing/rules-engine'

const widget = [
  { fieldId: 'model', label: 'Water heater type', options: [{ value: '40_gallon_gas', label: '40 gallon gas' }, { value: '50_gallon_electric', label: '50 gallon electric' }] },
  { fieldId: 'supply', label: 'Who supplies?', options: ['I will supply them', 'Please supply standard ones'] },
  { fieldId: 'notes', label: 'Notes' },
]

describe('option answers (US gauntlet S39)', () => {
  it('snaps by value or label, ignoring case and punctuation', () => {
    const opts = fieldOptions('model', widget)
    expect(snapToOption('50 Gallon Electric', opts)).toBe('50_gallon_electric')
    expect(snapToOption('40_gallon_gas', opts)).toBe('40_gallon_gas')
    expect(snapToOption('please_supply_standard_ones', fieldOptions('supply', widget))).toBe('Please supply standard ones')
  })

  it('prose names no option', () => {
    expect(snapToOption("I'm pretty sure it's 40 gallons, please quote that", fieldOptions('model', widget))).toBeNull()
  })

  it('falls back to the suggested fields when the widget has none', () => {
    expect(fieldOptions('model', [], [{ fieldId: 'model', options: ['A', 'B'] }])).toEqual([{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }])
  })

  it('lists option fields answered outside their options', () => {
    expect(
      answersOutsideOptions(
        [
          { fieldId: '_project_description', value: 'anything' },
          { fieldId: 'model', value: 'I think 40 gallons' },
          { fieldId: 'supply', value: 'please supply standard ones' },
          { fieldId: 'notes', value: 'free text is fine' },
          { fieldId: 'flag', value: true },
        ],
        widget
      )
    ).toEqual(['Water heater type'])
  })

  it('a doubt question about an option field offers the options', async () => {
    const pricing = { currency: 'USD', subtotal: 1500, taxLabel: 'Tax', taxRate: 0, taxAmount: 0, total: 1500, breakdown: [{ label: 'x', amount: 1500 }], confidence: 0.8, notes: [] } as unknown as PricingResult
    const result = await evaluateQualityGate(
      {
        structuredSignals: { extractedAt: '', overallConfidence: 0.8, signals: [], siteVisitRecommended: false, lowConfidenceSignals: [] },
        fusionResult: null,
        pricing,
        clarificationCount: 0,
        serviceName: 'Water heater',
        hasPhotos: false,
        quantityConcern: { reason: 'You described 40 gallons but picked 50.', fieldId: 'model', options: ['40 gallon gas', '50 gallon electric'] },
      },
      null
    )
    expect(result.questions?.[0]).toMatchObject({ targetSignalKey: 'model', options: ['40 gallon gas', '50 gallon electric'] })
  })
})
