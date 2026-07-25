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
 * WCAG relative luminance of a hex colour (0 = black, 1 = white).
 */
export function relativeLuminance(hex: string): number {
  const digits = HEX_PATTERN.exec(hex)?.[1]
  if (!digits) return 0
  const value = parseInt(digits, 16)
  const linear = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(16) + 0.7152 * linear(8) + 0.0722 * linear(0)
}

/**
 * The readable text colour to place on a given background: white on dark
 * brands, ink on light ones. Keeps any tenant colour usable — a pale brand
 * can never produce white-on-pale buttons.
 */
export function readableTextOn(hex: string): string {
  return relativeLuminance(hex) > 0.45 ? '#1B2823' : '#ffffff'
}

/**
 * Build the CSS-variable override object for a tenant primary colour.
 * Returns an empty object when the colour is missing/invalid so the
 * design-system default (juniper) applies untouched.
 */
export function brandStyleVars(primaryColor: string | undefined | null): CSSProperties {
  if (!isValidHexColor(primaryColor)) return {}
  const onPrimary = readableTextOn(primaryColor)
  return {
    '--color-primary': primaryColor,
    '--color-primary-hover': darkenHex(primaryColor, 0.18),
    '--color-on-primary': onPrimary,
    // RGB triple for Tailwind opacity modifiers (text-on-primary/60)
    '--color-on-primary-rgb': onPrimary === '#ffffff' ? '255 255 255' : '27 40 35',
  } as CSSProperties
}
