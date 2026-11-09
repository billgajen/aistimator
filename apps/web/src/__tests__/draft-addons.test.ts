import { describe, it, expect } from 'vitest'
import { draftAddonsToConfig } from '@/lib/draft-addons'

describe('draftAddonsToConfig (production test 2026-11-09)', () => {
  let n = 0
  const id = () => `addon_${++n}`

  it('keeps every named, priced add-on from the AI draft', () => {
    const out = draftAddonsToConfig(
      [
        { name: 'Attic or Crawlspace Access Surcharge', price: 450, description: 'Difficult access' },
        { name: 'Smart Wi-Fi Thermostat Installation', price: 325, description: '' },
      ],
      id
    )
    expect(out.map((a) => [a.label, a.price])).toEqual([
      ['Attic or Crawlspace Access Surcharge', 450],
      ['Smart Wi-Fi Thermostat Installation', 325],
    ])
    expect(new Set(out.map((a) => a.id)).size).toBe(2)
  })

  it('skips unnamed or unpriced entries and tolerates a missing list', () => {
    expect(draftAddonsToConfig([{ name: ' ', price: 100, description: '' }, { name: 'Free', price: 0, description: '' }], id)).toEqual([])
    expect(draftAddonsToConfig(undefined, id)).toEqual([])
  })
})
