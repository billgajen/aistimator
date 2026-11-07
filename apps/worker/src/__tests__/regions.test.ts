import { describe, it, expect } from 'vitest'
import {
  convertUnit,
  normalizeUnit,
  unitKind,
  fromCanonical,
  preferredUnit,
  unitDisplayLabel,
  roundQuantity,
  formatMoney,
  formatQuantity,
  formatDate,
  currencySymbol,
  getRegion,
  resolveRegionContext,
  resolveReferenceObjects,
  US_REGION,
  GB_REGION,
} from '@estimator/shared'

describe('units (T-133)', () => {
  it('normalizes free-text unit spellings', () => {
    expect(normalizeUnit('sq_ft')).toBe('sqft')
    expect(normalizeUnit('Square Metres')).toBe('sqm')
    expect(normalizeUnit('linear_m')).toBe('m')
    expect(normalizeUnit('linear_ft')).toBe('ft')
    expect(normalizeUnit('m²')).toBe('sqm')
    expect(normalizeUnit('gallons')).toBe('gal')
    expect(normalizeUnit('room')).toBeNull()
    expect(unitKind('sqft')).toBe('area')
  })

  it('converts area, length and volume both ways', () => {
    expect(convertUnit(1, 'sqm', 'sqft')).toBeCloseTo(10.7639, 3)
    expect(convertUnit(100, 'sqft', 'sqm')).toBeCloseTo(9.2903, 3)
    expect(convertUnit(10, 'ft', 'm')).toBeCloseTo(3.048, 6)
    expect(convertUnit(80, 'in', 'm')).toBeCloseTo(2.032, 6)
    expect(convertUnit(50, 'gal', 'l')).toBeCloseTo(189.27, 2)
    expect(convertUnit(1, 'cuyd', 'cuft')).toBeCloseTo(27, 6)
  })

  it('refuses to convert across kinds or unknown units', () => {
    expect(convertUnit(1, 'sqm', 'm')).toBeNull()
    expect(convertUnit(1, 'room', 'sqft')).toBeNull()
    expect(convertUnit(Number.NaN, 'm', 'ft')).toBeNull()
  })

  it('round-trips without drift', () => {
    const sqft = convertUnit(37.5, 'sqm', 'sqft')!
    expect(convertUnit(sqft, 'sqft', 'sqm')).toBeCloseTo(37.5, 9)
  })

  it('converts from canonical metric and picks preferred units', () => {
    expect(fromCanonical(10, 'area', 'sqft')).toBeCloseTo(107.639, 2)
    expect(preferredUnit('area', 'imperial')).toBe('sqft')
    expect(preferredUnit('length', 'metric')).toBe('m')
    expect(preferredUnit('volume', 'imperial')).toBe('gal')
    expect(unitDisplayLabel('sqft')).toBe('sq ft')
    expect(unitDisplayLabel('wall')).toBe('wall')
    expect(roundQuantity(412.3456)).toBe(412.3)
    expect(roundQuantity(3.14159)).toBe(3.14)
  })
})

describe('formatting (T-133)', () => {
  it('formats money per locale and currency', () => {
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50')
    expect(formatMoney(1234.5, 'GBP', 'en-GB')).toBe('£1,234.50')
    expect(formatMoney(99, 'USD', 'en-US', { decimals: 0 })).toBe('$99')
    expect(currencySymbol('GBP', 'en-GB')).toBe('£')
    expect(currencySymbol('USD', 'en-US')).toBe('$')
  })

  it('never throws on a bad currency code', () => {
    expect(formatMoney(10, 'NOTACURRENCY', 'en-US')).toContain('10.00')
  })

  it('formats quantities and dates', () => {
    expect(formatQuantity(1412, 'sqft', 'en-US')).toBe('1,412 sq ft')
    expect(formatDate('2026-11-07T12:00:00Z', 'en-US')).toBe('Nov 7, 2026')
    expect(formatDate('2026-11-07T12:00:00Z', 'en-GB')).toBe('7 Nov 2026')
    expect(formatDate('not a date', 'en-US')).toBe('')
  })
})

describe('regions (T-133, AD-025)', () => {
  it('defines US and GB with the expected defaults', () => {
    expect(US_REGION.currency).toBe('USD')
    expect(US_REGION.unitSystem).toBe('imperial')
    expect(US_REGION.copy.taxLabel).toBe('Sales tax')
    expect(US_REGION.copy.postalCodeLabel).toBe('ZIP code')
    expect(GB_REGION.copy.taxLabel).toBe('VAT')
    expect(new RegExp(US_REGION.postalCodePattern).test('90210-1234')).toBe(true)
    expect(new RegExp(GB_REGION.postalCodePattern, 'i').test('SW1A 1AA')).toBe(true)
  })

  it('keeps the pre-T-133 GB reference sizes exactly (baseline holds)', () => {
    const door = GB_REGION.referenceObjects.find((r) => r.id === 'entry_door_height')
    expect(door?.metres).toBe(1.98)
    const usDoor = US_REGION.referenceObjects.find((r) => r.id === 'entry_door_height')
    expect(usDoor?.metres).toBeCloseTo(2.032, 3)
  })

  it('treats a missing region as legacy GB, never silently US', () => {
    expect(getRegion(null).code).toBe('GB')
    expect(getRegion(undefined).code).toBe('GB')
    expect(getRegion('XX').code).toBe('GB')
    expect(getRegion('US').code).toBe('US')
  })

  it('applies tenant overrides on top of region defaults', () => {
    const ctx = resolveRegionContext({ region: 'US', currency: 'CAD', unit_system: 'metric', tax_label: 'HST' })
    expect(ctx.currency).toBe('CAD')
    expect(ctx.unitSystem).toBe('metric')
    expect(ctx.taxLabel).toBe('HST')
    const defaults = resolveRegionContext({ region: 'US', currency: null, unit_system: null, tax_label: null })
    expect(defaults.currency).toBe('USD')
    expect(defaults.unitSystem).toBe('imperial')
    expect(defaults.taxLabel).toBe('Sales tax')
    expect(defaults.locale).toBe('en-US')
  })

  it('lets packs override or add reference objects by id', () => {
    const refs = resolveReferenceObjects(US_REGION, [
      { id: 'entry_door_height', label: 'tall door', dimension: 'height', metres: 2.44 },
      { id: 'pool_tile', label: 'pool tile', dimension: 'width', metres: 0.15 },
      { id: 'bad', label: 'bad', dimension: 'width', metres: -1 },
    ])
    expect(refs.find((r) => r.id === 'entry_door_height')?.metres).toBe(2.44)
    expect(refs.find((r) => r.id === 'pool_tile')).toBeDefined()
    expect(refs.find((r) => r.id === 'bad')).toBeUndefined()
    expect(refs.length).toBe(US_REGION.referenceObjects.length + 1)
  })
})
