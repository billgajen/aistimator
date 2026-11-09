import { describe, it, expect } from 'vitest'
import { carryOverSignalSpecs } from '@/app/api/services/ai-draft/shared'
import type { ServiceDraftConfig } from '@estimator/shared'

type Signals = ServiceDraftConfig['expectedSignals']

describe('carryOverSignalSpecs (pack specs survive a pricing recompile)', () => {
  const previous: Signals = [
    {
      signalKey: 'unit_size',
      type: 'enum',
      possibleValues: ['Small', 'Large'],
      description: 'size',
      identify: { readFrom: 'the plate', decode: [{ pattern: 'X(\\d)', map: { '1': 'Small' } }] },
    },
    { signalKey: 'area', type: 'number', description: 'area', envelope: { absoluteMin: 1, absoluteMax: 9 } },
  ]

  it('restores identify, envelope and enum options the AI output dropped', () => {
    const next: Signals = [
      { signalKey: 'unit_size', type: 'enum', description: 'size of unit' },
      { signalKey: 'area', type: 'number', description: 'area' },
      { signalKey: 'new_one', type: 'string', description: 'n' },
    ]
    const out = carryOverSignalSpecs(previous, next)
    expect(out[0]).toMatchObject({ description: 'size of unit', identify: previous[0]!.identify, possibleValues: ['Small', 'Large'] })
    expect(out[1]!.envelope).toEqual({ absoluteMin: 1, absoluteMax: 9 })
    expect(out[2]).toEqual(next[2])
  })

  it('a removed signal stays removed; no previous config is a no-op', () => {
    expect(carryOverSignalSpecs(previous, [])).toEqual([])
    const next: Signals = [{ signalKey: 'a', type: 'number', description: 'a' }]
    expect(carryOverSignalSpecs(undefined, next)).toBe(next)
  })
})
