/**
 * Plausibility envelopes (T-116, Measurement Engine M5) — pure math, no IO.
 *
 * Deterministic bounds on AI-measured quantities, computed from facts the
 * customer already provided (e.g. storeys) plus pack-authored per-unit ranges.
 * Purpose:
 *  1. REJECT implausible measurements before they price (a 3-storey front
 *     elevation is never 1 sqm — bug #10's £480 quote dies here structurally)
 *  2. Provide a Grade-C FALLBACK quantity (envelope midpoint) when vision
 *     fails entirely — "no estimate" and "quantity 1" become impossible
 *
 * Envelope rules ship as pack DATA on ExpectedSignalConfig — never hardcoded.
 */

export interface QuantityEnvelopeRule {
  /**
   * Scale bounds by a known driver quantity (form answer or signal),
   * e.g. wall area per storey. Omit for absolute-only bounds.
   */
  driverKey?: string
  /** Minimum plausible quantity per driver unit */
  minPerUnit?: number
  /** Maximum plausible quantity per driver unit */
  maxPerUnit?: number
  /** Driver value assumed when the driver is unknown */
  defaultDriver?: number
  /** Hard floor regardless of driver */
  absoluteMin: number
  /** Hard ceiling regardless of driver */
  absoluteMax: number
}

export interface Envelope {
  min: number
  max: number
  /** Geometric midpoint — the least-wrong single fallback value */
  mid: number
}

export interface EnvelopeSignalInput {
  key: string
  value: unknown
}

export interface EnvelopeFinding {
  signalKey: string
  action: 'accepted' | 'clamped' | 'fallback_injected'
  envelope: Envelope
  /** The measurement before envelope enforcement (undefined when missing) */
  originalValue?: number
  /** The value pricing should use */
  effectiveValue: number
}

/** Coerce a signal value to a positive number, comma-aware; null if unusable */
export function coerceQuantity(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,(?=\d{3}\b)/g, '').trim())
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

/**
 * Compute concrete bounds from a rule + known driver values.
 */
export function computeEnvelope(
  rule: QuantityEnvelopeRule,
  getValue: (key: string) => unknown
): Envelope {
  let min = rule.absoluteMin
  let max = rule.absoluteMax

  if (rule.driverKey && rule.minPerUnit !== undefined && rule.maxPerUnit !== undefined) {
    const driver =
      coerceQuantity(getValue(rule.driverKey)) ?? rule.defaultDriver ?? null
    if (driver !== null) {
      min = Math.max(rule.absoluteMin, driver * rule.minPerUnit)
      max = Math.min(rule.absoluteMax, driver * rule.maxPerUnit)
      if (min > max) {
        // Degenerate configuration — fall back to absolute bounds
        min = rule.absoluteMin
        max = rule.absoluteMax
      }
    }
  }

  const mid = Math.round(Math.sqrt(min * max) * 10) / 10
  return { min, max, mid }
}

/**
 * Enforce an envelope on a measured quantity.
 * - within bounds  → accepted (measurement stands)
 * - outside bounds → clamped to the nearest bound (still flagged for clarification)
 * - missing        → envelope midpoint injected as a Grade-C fallback
 */
export function enforceEnvelope(
  signalKey: string,
  measuredValue: unknown,
  envelope: Envelope
): EnvelopeFinding {
  const numeric = coerceQuantity(measuredValue)

  if (numeric === null) {
    return {
      signalKey,
      action: 'fallback_injected',
      envelope,
      effectiveValue: envelope.mid,
    }
  }

  if (numeric < envelope.min || numeric > envelope.max) {
    const clamped = Math.min(Math.max(numeric, envelope.min), envelope.max)
    return {
      signalKey,
      action: 'clamped',
      envelope,
      originalValue: numeric,
      effectiveValue: clamped,
    }
  }

  return {
    signalKey,
    action: 'accepted',
    envelope,
    originalValue: numeric,
    effectiveValue: numeric,
  }
}
