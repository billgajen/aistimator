/**
 * Locale-aware formatting (T-133). Every place that renders money, a
 * quantity or a date for a person goes through these, with the locale and
 * currency resolved from the tenant's region.
 */

import { unitDisplayLabel } from './units'

/** Format an amount of money, e.g. formatMoney(1234.5, 'USD', 'en-US') → "$1,234.50". */
export function formatMoney(
  amount: number,
  currency: string,
  locale: string = 'en-US',
  opts: { decimals?: number } = {}
): string {
  const decimals = opts.decimals ?? 2
  const value = Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  } catch {
    // Unknown currency code or locale — never throw while rendering a quote
    return `${currency} ${value.toFixed(decimals)}`
  }
}

/** The bare currency symbol for a currency in a locale, e.g. "$" / "£". */
export function currencySymbol(currency: string, locale: string = 'en-US'): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')
    return part?.value ?? currency
  } catch {
    return currency
  }
}

/** Plain number with grouping, e.g. 1234.5 → "1,234.5". */
export function formatNumber(value: number, locale: string = 'en-US', maxDecimals = 2): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDecimals }).format(value)
  } catch {
    return String(value)
  }
}

/** Quantity with its unit label, e.g. formatQuantity(412, 'sqft') → "412 sq ft". */
export function formatQuantity(value: number, unit: string, locale: string = 'en-US'): string {
  return `${formatNumber(value, locale)} ${unitDisplayLabel(unit)}`
}

/** Medium date in the locale's order, e.g. "Nov 7, 2026" / "7 Nov 2026". */
export function formatDate(date: string | Date, locale: string = 'en-US'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}
