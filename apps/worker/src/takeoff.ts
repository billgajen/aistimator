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

import { CUSTOMER_METHOD } from '@qolumns/shared'
import type {
  PricingTrace,
  ExtractedSignalsV2,
  WorkStepConfig,
  TakeoffEntry,
  LineSource,
  QuotePricing,
} from '@qolumns/shared'

/**
 * Human-facing estimate reference: EST-{year}-{last 6 of the quote id}.
 * Deterministic per quote, no counters, no migrations.
 */
export function buildReference(quoteId: string, year: number): string {
  const tail = quoteId.replace(/^qte_/, '').slice(-6).toUpperCase()
  return `EST-${year}-${tail}`
}

type Signal = ExtractedSignalsV2['signals'][number]

// The customer's words live in the shared package (T-183), beside the
// business's words for the same facts (quantity-source.ts).
const PLAIN = CUSTOMER_METHOD

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

/** T-183: the same fact as a code (the business is told it in its own words) */
export function signalSource(signal: Signal | undefined): LineSource {
  if (!signal) return 'photos'
  if (signal.source === 'form' || signal.confidence >= 1) return 'answer'
  if (signal.basis === 'identified') return 'label'
  if (signal.basis === 'envelope') return 'details'
  return 'photos'
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
          method: PLAIN.standardCharge,
          source: 'fixed',
        })
        break
      }

      case 'work_step': {
        const config = workSteps.find((w) => w.id === step.id)
        const quantityValue = step.signalsUsed.find(
          (s) => typeof s.value === 'number'
        )?.value as number | undefined

        let method: string
        let source: LineSource
        let evidence: string | undefined
        switch (step.quantitySource) {
          case 'form_field': {
            const fieldId = config?.quantitySource?.fieldId
            if (fieldId && opts.scanned?.fieldIds.has(fieldId)) {
              method = PLAIN.scan
              source = 'scan'
              evidence = opts.scanned.evidence
            } else {
              method = PLAIN.quantityGiven
              source = 'answer'
            }
            break
          }
          case 'constant':
            method = PLAIN.fixedQuantity
            source = 'fixed'
            break
          case 'ai_signal': {
            const signalKey = config?.quantitySource?.signalKey
            const signal = signalKey
              ? structuredSignals?.signals.find((s) => s.key === signalKey)
              : undefined
            method = plainSource(signal)
            source = signalSource(signal)
            evidence = signal?.evidence
            break
          }
          case 'derived':
            // T-137 live run: a run-length line said "Fixed price"
            method = PLAIN.calculated
            source = 'calculated'
            break
          case 'legacy_fallback':
          case 'derived_unresolved':
            method = PLAIN.details
            source = 'details'
            break
          default:
            method = PLAIN.fixedPrice
            source = 'fixed'
        }

        // T-139: a line chosen by WHAT the equipment is shows how that was known
        if (config?.triggerSignal && step.quantitySource !== 'ai_signal') {
          const trigger = structuredSignals?.signals.find((s) => s.key === config.triggerSignal)
          if (trigger?.source === 'form' || (trigger && trigger.confidence >= 1)) {
            method = `Selected for ${trigger.value}, as you confirmed`
            source = 'answer'
          } else if (trigger?.basis === 'identified') {
            method = `${trigger.value} — ${plainSource(trigger).replace(/^From/, 'from')}`
            source = 'label'
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
          source,
          ...(evidence && { evidence }),
        })
        break
      }

      case 'addon': {
        const detected = step.signalsUsed.some((s) => s.key === 'auto_detected')
        entries.push({
          item: step.description,
          amount: step.amount,
          method: detected ? PLAIN.fromDescription : PLAIN.selectedExtra,
          source: detected ? 'words' : 'choice',
        })
        break
      }

      case 'multiplier': {
        entries.push({
          item: step.description,
          amount: step.amount,
          method: PLAIN.adjustment,
          source: 'answer',
        })
        break
      }

      case 'minimum': {
        // T-165: the minimum charge is a floor, not a part of the job. It is
        // shown as a note above the total, never as a row of the takeoff.
        break
      }

      // tax intentionally excluded — it renders in the totals block
    }
  }

  return entries
}

/**
 * T-183: put each line's source on the price line itself, so a service added
 * to a quote (a section, which has no takeoff of its own) carries it too.
 *
 * The engine builds the breakdown from the trace, one line per step that is
 * not tax, and the takeoff from the same trace, leaving out zero amounts and
 * the minimum top-up. So the two are walked together: a takeoff row belongs
 * to the next line with its amount whose label starts with its item. A line
 * with no row (the minimum's own entry) gets nothing. Returns new lines; nothing is changed in place.
 */
export function withLineSources(breakdown: QuotePricing['breakdown'], takeoff: readonly TakeoffEntry[]): QuotePricing['breakdown'] {
  let next = 0
  return breakdown.map((line) => {
    if (line.kind === 'minimum') return line
    for (let i = next; i < takeoff.length; i++) {
      const row = takeoff[i]!
      const sameLine = line.label === row.item || line.label.startsWith(`${row.item} `)
      if (row.source && sameLine && Math.abs(row.amount - line.amount) < 0.005) {
        next = i + 1
        return { ...line, source: row.source }
      }
    }
    return line
  })
}
