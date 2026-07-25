import { describe, it, expect } from 'vitest'
import { brandStyleVars, darkenHex, isValidHexColor } from '@/lib/color'

describe('isValidHexColor', () => {
  it('accepts 6-digit hex colours', () => {
    expect(isValidHexColor('#205E56')).toBe(true)
    expect(isValidHexColor('#ffffff')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isValidHexColor('#fff')).toBe(false)
    expect(isValidHexColor('red')).toBe(false)
    expect(isValidHexColor('205E56')).toBe(false)
    expect(isValidHexColor('#205E5G')).toBe(false)
    expect(isValidHexColor(undefined)).toBe(false)
    expect(isValidHexColor(null)).toBe(false)
    expect(isValidHexColor('url(javascript:alert(1))')).toBe(false)
  })
})

describe('darkenHex', () => {
  it('darkens each channel proportionally', () => {
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080')
    expect(darkenHex('#000000', 0.5)).toBe('#000000')
  })

  it('pads channels below 0x10', () => {
    expect(darkenHex('#100000', 0.9)).toBe('#020000')
  })

  it('returns input unchanged when not valid hex', () => {
    expect(darkenHex('red', 0.5)).toBe('red')
  })
})

describe('brandStyleVars', () => {
  it('produces primary + derived hover variables', () => {
    const vars = brandStyleVars('#2563eb') as Record<string, string>
    expect(vars['--color-primary']).toBe('#2563eb')
    expect(vars['--color-primary-hover']).toMatch(/^#[0-9a-f]{6}$/)
    expect(vars['--color-primary-hover']).not.toBe('#2563eb')
  })

  it('returns empty for missing or invalid colours (design default applies)', () => {
    expect(brandStyleVars(undefined)).toEqual({})
    expect(brandStyleVars(null)).toEqual({})
    expect(brandStyleVars('not-a-colour')).toEqual({})
  })
})
