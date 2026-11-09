/**
 * Quantity takeoff builder (T-122, Measurement Engine document layer).
 *
 * Turns the pricing trace + measurement evidence into the customer-facing
 * takeoff table — every priced line with HOW its quantity was established.
 * T-146: `method` is plain words for the customer ("From your photos",
 * "From the air conditioner's rating plate"); the technical evidence (passes,
 * spread, decoded model number) goes in `evidence`, which only the business
 * sees. Pure functions, fully testable.
 */

import type {
  PricingTrace,
  ExtractedSignalsV2,
  WorkStepConfig,
  TakeoffEntry,
} from '@estimator/shared'

/**
 * Human-facing estimate reference: EST-{year}-{last 6 of the quote id}.
 * Deterministic per quote, no counters, no migrations.
 */
export function buildReference(quoteId: string, year: number): string {
  const tail = quoteId.replace(/^qte_/, '').slice(-6).toUpperCase()
  return `EST-${year}-${tail}`
}

type Signal = ExtractedSignalsV2['signals'][number]

const PLAIN = {
  photos: 'From your photos',
  answers: 'From your answers',
  scan: 'From the on-site room scan',
  details: 'Estimated from your details',
} as const

/** The plain-words source of a signal-derived quantity or selection (T-146). */
export function plainSource(signal: Signal | undefined): string {
  if (!signal) return PLAIN.photos
  if (signal.source === 'form' || signal.confidence >= 1) return PLAIN.answers
  if (signal.basis === 'identified') {
    // identification evidence: 'Read from the X's rating plate (photo 1): "…" → 3 ton'
    const where = /^Read from (.+?)(?: \(photo \d+\))?:/.exec(signal.evidence || '')?.[1]
    return where ? `From ${where}` : PLAIN.photos
  }
  if (signal.basis === 'envelope') return PLAIN.details
  return PLAIN.photos
}

/**
 * Build the takeoff table from the trace, resolving each quantity's method
 * from its provenance (measurement evidence > customer-provided > fixed).
 */
export function buildTakeoff(opts: {
  trace: PricingTrace
  structuredSignals: ExtractedSignalsV2 | null
  workSteps: WorkStepConfig[]
  /** T-138: form fields filled by an on-site LiDAR scan, with the audit line */
  scanned?: { fieldIds: Set<string>; evidence: string }
}): TakeoffEntry[] {
  const { trace, structuredSignals, workSteps } = opts
  const entries: TakeoffEntry[] = []

  for (const step of trace.trace) {
    if (step.amount === 0 && step.type !== 'base_fee') continue

    switch (step.type) {
      case 'base_fee': {
        if (step.amount <= 0) break
        entries.push({
          item: step.description || 'Base fee',
          amount: step.amount,
          method: 'Standard charge for every job',
        })
        break
      }

      case 'work_step': {
        const config = workSteps.find((w) => w.id === step.id)
        const quantityValue = step.signalsUsed.find(
          (s) => typeof s.value === 'number'
        )?.value as number | undefined

        let method: string
        let evidence: string | undefined
        switch (step.quantitySource) {
          case 'form_field': {
            const fieldId = config?.quantitySource?.fieldId
            if (fieldId && opts.scanned?.fieldIds.has(fieldId)) {
              method = PLAIN.scan
              evidence = opts.scanned.evidence
            } else {
              method = 'Quantity provided by you'
            }
            break
          }
          case 'constant':
            method = 'Fixed quantity'
            break
          case 'ai_signal': {
            const signalKey = config?.quantitySource?.signalKey
            const signal = signalKey
              ? structuredSignals?.signals.find((s) => s.key === signalKey)
              : undefined
            method = plainSource(signal)
            evidence = signal?.evidence
            break
          }
          case 'derived':
            // T-137 live run: a run-length line said "Fixed price"
            method = 'Calculated from your answers'
            break
          case 'legacy_fallback':
          case 'derived_unresolved':
            method = PLAIN.details
            break
          default:
            method = 'Fixed price'
        }

        // T-139: a line chosen by WHAT the equipment is shows how that was known
        if (config?.triggerSignal && step.quantitySource !== 'ai_signal') {
          const trigger = structuredSignals?.signals.find((s) => s.key === config.triggerSignal)
          if (trigger?.source === 'form' || (trigger && trigger.confidence >= 1)) {
            method = `Selected for ${trigger.value}, as you confirmed`
          } else if (trigger?.basis === 'identified') {
            method = `${trigger.value} — ${plainSource(trigger).replace(/^From/, 'from')}`
            evidence = trigger.evidence
          }
        }

        entries.push({
          item: config?.name || step.description,
          ...(quantityValue !== undefined &&
            config?.costType !== 'fixed' && {
              quantity: quantityValue,
              unit: config?.unitLabel || undefined,
              rate: config?.defaultCost,
            }),
          amount: step.amount,
          method,
          ...(evidence && { evidence }),
        })
        break
      }

      case 'addon': {
        entries.push({
          item: step.description,
          amount: step.amount,
          method: step.signalsUsed.some((s) => s.key === 'auto_detected')
            ? 'Added from your description'
            : 'Selected extra',
        })
        break
      }

      case 'multiplier': {
        entries.push({
          item: step.description,
          amount: step.amount,
          method: 'Adjustment from your answers',
        })
        break
      }

      case 'minimum': {
        entries.push({
          item: step.description || 'Minimum charge',
          amount: step.amount,
          method: 'Minimum job value',
        })
        break
      }

      // tax intentionally excluded — it renders in the totals block
    }
  }

  return entries
}
