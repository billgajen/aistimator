import { describe, it, expect } from 'vitest'
import { brandStyleVars, darkenHex, isValidHexColor, readableTextOn } from '@/lib/color'

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

describe('readableTextOn', () => {
  it('uses white text on dark brand colours', () => {
    expect(readableTextOn('#205E56')).toBe('#ffffff') // juniper
    expect(readableTextOn('#1E3A5F')).toBe('#ffffff') // navy
    expect(readableTextOn('#000000')).toBe('#ffffff')
  })

  it('uses ink text on light brand colours (the white-on-pale footgun)', () => {
    expect(readableTextOn('#F7E9C6')).toBe('#1B2823') // butter
    expect(readableTextOn('#FFFF00')).toBe('#1B2823') // yellow
    expect(readableTextOn('#ffffff')).toBe('#1B2823')
  })
})

describe('brandStyleVars', () => {
  it('includes the on-primary text vars', () => {
    const dark = brandStyleVars('#205E56') as Record<string, string>
    expect(dark['--color-on-primary']).toBe('#ffffff')
    expect(dark['--color-on-primary-rgb']).toBe('255 255 255')

    const light = brandStyleVars('#F7E9C6') as Record<string, string>
    expect(light['--color-on-primary']).toBe('#1B2823')
    expect(light['--color-on-primary-rgb']).toBe('27 40 35')
  })

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
