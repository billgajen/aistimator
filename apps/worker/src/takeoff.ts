/**
 * Quantity takeoff builder (T-122, Measurement Engine document layer).
 *
 * Turns the pricing trace + measurement evidence into the customer-facing
 * takeoff table — every priced line with HOW its quantity was established.
 * This is the "shows its work" layer: the senior surveyor's audit note and
 * the ensemble evidence face the customer. Pure functions, fully testable.
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
        switch (step.quantitySource) {
          case 'form_field': {
            const fieldId = config?.quantitySource?.fieldId
            method =
              fieldId && opts.scanned?.fieldIds.has(fieldId) ? opts.scanned.evidence : 'Quantity provided by you'
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
            method = signal?.evidence || 'Measured from your photos'
            break
          }
          case 'derived':
            // T-137 live run: a run-length line said "Fixed price"
            method = 'Calculated from your answers'
            break
          case 'legacy_fallback':
          case 'derived_unresolved':
            method = 'Estimated — to be confirmed'
            break
          default:
            method = 'Fixed price'
        }

        // T-139: a line chosen by WHAT the equipment is shows how that was known
        if (config?.triggerSignal && step.quantitySource !== 'ai_signal') {
          const trigger = structuredSignals?.signals.find((s) => s.key === config.triggerSignal)
          if (trigger?.basis === 'identified' && trigger.evidence) {
            method = trigger.evidence
          } else if (trigger?.source === 'form') {
            method = `Selected for ${trigger.value}, as you confirmed`
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
