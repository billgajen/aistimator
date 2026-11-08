import { describe, it, expect } from 'vitest'
import { humanStatedQuantityKeys } from '../quantity-sources'

describe('humanStatedQuantityKeys', () => {
  const targets = ['wall_area_sqm', 'fence_length_m']

  it('a clarification answer (fieldId = signal key) counts as stated', () => {
    expect(humanStatedQuantityKeys(targets, [{ fieldId: 'wall_area_sqm', value: '31.5' }])).toEqual(new Set(['wall_area_sqm']))
  })

  it('an explicit mapsToSignal field counts as stated', () => {
    const keys = humanStatedQuantityKeys(targets, [{ fieldId: 'your_fence', value: 20 }], [{ fieldId: 'your_fence', mapsToSignal: 'fence_length_m' }])
    expect(keys).toEqual(new Set(['fence_length_m']))
  })

  it('comma thousands and key spelling variants are understood', () => {
    expect(humanStatedQuantityKeys(['wall_area_sqft'], [{ fieldId: 'wall-area-sqft', value: '1,250' }]).has('wall_area_sqft')).toBe(true)
  })

  it('non-numbers, zero, internal fields and unrelated fields are still measured', () => {
    const keys = humanStatedQuantityKeys(targets, [
      { fieldId: 'wall_area_sqm', value: 'not sure' },
      { fieldId: 'fence_length_m', value: 0 },
      { fieldId: '_project_description', value: 'wall_area_sqm 40' },
      { fieldId: 'storeys', value: 2 },
    ])
    expect(keys.size).toBe(0)
  })

  it('an explicit mapping elsewhere wins over a lookalike field id', () => {
    const keys = humanStatedQuantityKeys(targets, [{ fieldId: 'wall_area_sqm', value: 30 }], [{ fieldId: 'wall_area_sqm', mapsToSignal: 'other_key' }])
    expect(keys.size).toBe(0)
  })
})
