/**
 * Small colour helpers for tenant branding.
 *
 * The design system runs on CSS variables, so a tenant's primary colour is
 * applied by overriding --color-primary (+ a derived hover shade) on the
 * page root. Only hex colours are accepted; anything else falls back to the
 * design-system default upstream.
 */

import type { CSSProperties } from 'react'
import { contrastRatio, isValidHexColor, readableTextOn, relativeLuminance } from '@qolumns/shared'

// T-191: the contrast rule lives in @qolumns/shared (the worker's emails use it too); kept exported from here
export { contrastRatio, isValidHexColor, readableTextOn, relativeLuminance }

const HEX_PATTERN = /^#([0-9a-fA-F]{6})$/
const WHITE = '#ffffff'
const INK = '#1B2823'


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
