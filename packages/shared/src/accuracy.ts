/**
 * Estimate accuracy against final invoices (T-143) — pure statistics.
 *
 * Beta success metric (Docs/09): median |final invoice − quoted| / quoted
 * < 10% per trade, and the rule for adding a trade: ≥ 80% of the previous
 * wave's quotes within ±10%. This module computes exactly those numbers, per
 * service and per estimate grade, from quotes the business has invoiced.
 */

export interface InvoicedQuote {
  serviceName: string
  /** The total the customer was quoted */
  quoted: number
  /** What the business finally invoiced */
  invoiced: number
  grade?: 'A' | 'B' | 'C' | null
}

export interface AccuracyGroup {
  key: string
  count: number
  /** Median of |invoiced − quoted| / quoted, as a fraction (0.08 = 8%) */
  medianAbsError: number
  /** Share of quotes within ±10% of the invoice, 0–1 */
  withinTenPct: number
  /** Median signed error (invoiced − quoted) / quoted: > 0 means quotes run low */
  medianBias: number
}

export interface AccuracyReport {
  overall: AccuracyGroup | null
  byService: AccuracyGroup[]
  byGrade: AccuracyGroup[]
  /** The Docs/09 targets, for display */
  targets: { medianAbsError: number; withinTenPct: number }
}

export const ACCURACY_TARGETS = { medianAbsError: 0.1, withinTenPct: 0.8 }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

const round = (n: number) => Math.round(n * 1000) / 1000

function group(key: string, quotes: InvoicedQuote[]): AccuracyGroup {
  const signed = quotes.map((q) => (q.invoiced - q.quoted) / q.quoted)
  const abs = signed.map(Math.abs)
  return {
    key,
    count: quotes.length,
    medianAbsError: round(median(abs)),
    withinTenPct: round(abs.filter((e) => e <= 0.1 + 1e-9).length / quotes.length),
    medianBias: round(median(signed)),
  }
}

/** Only quotes with a positive quoted total and a recorded invoice count. */
export function computeAccuracy(quotes: InvoicedQuote[]): AccuracyReport {
  const usable = quotes.filter(
    (q) => Number.isFinite(q.quoted) && q.quoted > 0 && Number.isFinite(q.invoiced) && q.invoiced >= 0
  )
  const by = (keyOf: (q: InvoicedQuote) => string | null) => {
    const map = new Map<string, InvoicedQuote[]>()
    for (const q of usable) {
      const k = keyOf(q)
      if (!k) continue
      map.set(k, [...(map.get(k) || []), q])
    }
    return [...map.entries()].map(([k, qs]) => group(k, qs)).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  }
  return {
    overall: usable.length > 0 ? group('All quotes', usable) : null,
    byService: by((q) => q.serviceName || 'Unknown service'),
    byGrade: by((q) => (q.grade ? `Grade ${q.grade}` : null)).sort((a, b) => a.key.localeCompare(b.key)),
    targets: ACCURACY_TARGETS,
  }
}

/** Parse a money amount typed by a person ("$1,234.50", "1234") → number or null. */
export function parseMoneyInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return n >= 0 && n < 100_000_000 ? n : null
}
