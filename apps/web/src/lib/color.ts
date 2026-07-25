/**
 * Small colour helpers for tenant branding.
 *
 * The design system runs on CSS variables, so a tenant's primary colour is
 * applied by overriding --color-primary (+ a derived hover shade) on the
 * page root. Only hex colours are accepted; anything else falls back to the
 * design-system default upstream.
 */

import type { CSSProperties } from 'react'

const HEX_PATTERN = /^#([0-9a-fA-F]{6})$/

export function isValidHexColor(value: string | undefined | null): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value)
}

/** Darken a #rrggbb colour by the given fraction (0..1). */
export function darkenHex(hex: string, amount: number): string {
  const digits = HEX_PATTERN.exec(hex)?.[1]
  if (!digits) return hex

  const value = parseInt(digits, 16)
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff
    return Math.max(0, Math.min(255, Math.round(c * (1 - amount))))
  }
  const darkened = (channel(16) << 16) | (channel(8) << 8) | channel(0)
  return `#${darkened.toString(16).padStart(6, '0')}`
}

/**
 * Build the CSS-variable override object for a tenant primary colour.
 * Returns an empty object when the colour is missing/invalid so the
 * design-system default (juniper) applies untouched.
 */
export function brandStyleVars(primaryColor: string | undefined | null): CSSProperties {
  if (!isValidHexColor(primaryColor)) return {}
  return {
    '--color-primary': primaryColor,
    '--color-primary-hover': darkenHex(primaryColor, 0.18),
  } as CSSProperties
}
