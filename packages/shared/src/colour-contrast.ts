/**
 * WCAG contrast, pure (moved here from apps/web/src/lib/color.ts in T-191 so the worker's emails use the same
 * rule as the web pages: text on a business's colour reaches 4.5:1 whatever the colour is, T-171).
 */
const HEX_PATTERN = /^#([0-9a-fA-F]{6})$/

export function isValidHexColor(value: string | undefined | null): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value)
}

/** WCAG relative luminance of a hex colour (0 = black, 1 = white) */
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
 * The readable text colour on a background: white where white reaches 4.5:1; otherwise ink where ink does;
 * otherwise black, for the narrow band of mid-tone colours on which neither does (T-171).
 */
export function readableTextOn(hex: string): string {
  if (contrastRatio(hex, WHITE) >= 4.5) return WHITE
  if (contrastRatio(hex, INK) >= 4.5) return INK
  return BLACK
}
