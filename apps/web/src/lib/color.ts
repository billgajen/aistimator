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

/** "#205E56" as the three numbers CSS takes in rgb(): "32 94 86" */
export function rgbTriple(hex: string): string {
  const digits = HEX_PATTERN.exec(hex)?.[1]
  if (!digits) return '0 0 0'
  const value = parseInt(digits, 16)
  return `${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff}`
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

/** WCAG contrast ratio between two hex colours (1 to 21) */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const WHITE = '#ffffff'
const INK = '#1B2823'
const BLACK = '#000000'

/**
 * The readable text colour to place on a given background: white on dark
 * brands, dark on light ones.
 *
 * T-171: chosen by contrast, so text on a business's colour reaches 4.5:1
 * whatever the colour is. White where white reaches it; otherwise ink where
 * ink reaches it; otherwise black, for the narrow band of mid-tone colours
 * (a bright blue, a bright red) on which neither does. It was "white unless
 * the colour is lighter than 0.45", which put white on orange at 2.8:1.
 */
export function readableTextOn(hex: string): string {
  if (contrastRatio(hex, WHITE) >= 4.5) return WHITE
  if (contrastRatio(hex, INK) >= 4.5) return INK
  return BLACK
}

/**
 * Build the CSS-variable override object for a tenant primary colour.
 * Returns an empty object when the colour is missing/invalid so the
 * design-system default (juniper) applies untouched.
 */
export function brandStyleVars(primaryColor: string | undefined | null): CSSProperties {
  if (!isValidHexColor(primaryColor)) return {}
  const onPrimary = readableTextOn(primaryColor)
  const hover = darkenHex(primaryColor, 0.18)
  return {
    '--color-primary': primaryColor,
    '--color-primary-hover': hover,
    // T-172: Tailwind's colour classes read the triples (tailwind.config.ts), so the business's colour is set
    // in both forms; without these the classes would stay our juniper
    '--color-primary-rgb': rgbTriple(primaryColor),
    '--color-primary-hover-rgb': rgbTriple(hover),
    '--color-on-primary': onPrimary,
    // RGB triple for Tailwind opacity modifiers (text-on-primary/60)
    '--color-on-primary-rgb': onPrimary === WHITE ? '255 255 255' : onPrimary === INK ? '27 40 35' : '0 0 0',
  } as CSSProperties
}
