/**
 * T-194: "When you scan on site, fill this from:" — the service editor's
 * setting on a line charged by a quantity. It is stored as the scan spec of
 * the signal that line's quantity reads (`ExpectedSignalConfig.scan`, T-138),
 * so the scan is one more source of the same quantity, never a new
 * requirement: the customer's website form is unchanged, and the business can
 * still type the number on site (the typed number wins, AD-028).
 *
 * An area or a length is filled in the signal's unit (AD-030: converted once,
 * where the scan emits it), so the signal is given one of the right kind: the
 * line's own unit when it is one, else the one it has, else the business's
 * (sq ft and ft, or m² and m). Pure; returns new arrays.
 */
import type { ExpectedSignalConfig, SuggestedField, WorkStepConfig } from './database.types'
import type { UnitSystem } from './regions/types'
import { SCAN_MEASURE_WORDS, SCAN_MEASURES, scanMeasureKind, type ScanMeasure } from './room-scan'
import { normalizeUnit, unitKind } from './units'

/** The choices, in plain words, in the order a business thinks of them; '' is "nothing" */
export const SCAN_FILL_CHOICES: ReadonlyArray<{ value: ScanMeasure | ''; label: string }> = [
  { value: '', label: 'Nothing (type it in)' },
  ...(['wall_area_net', 'wall_area_gross', 'ceiling_area', 'floor_area', 'perimeter', 'door_count', 'window_count', 'room_count'] as const).map((m) => ({
    value: m,
    label: SCAN_MEASURE_WORDS[m],
  })),
]

/** The signal a line's quantity reads: an AI signal's key, or the signal its question maps to */
export function stepSignalKey(step: Pick<WorkStepConfig, 'quantitySource'>, fields: ReadonlyArray<Pick<SuggestedField, 'fieldId' | 'mapsToSignal'>> = []): string | null {
  const source = step.quantitySource
  if (source?.type === 'ai_signal') return source.signalKey || null
  if (source?.type === 'form_field' && source.fieldId) {
    return fields.find((f) => f.fieldId === source.fieldId)?.mapsToSignal || source.fieldId
  }
  return null
}

/** Is this a line a scan could fill? (charged per unit or per hour, from a question or a signal) */
export function stepTakesScan(step: Pick<WorkStepConfig, 'costType' | 'quantitySource'>): boolean {
  return (step.costType === 'per_unit' || step.costType === 'per_hour') && (step.quantitySource?.type === 'form_field' || step.quantitySource?.type === 'ai_signal')
}

/** What the scan fills this line's quantity from, or null */
export function stepScanMeasure(
  step: Pick<WorkStepConfig, 'quantitySource'>,
  expectedSignals: readonly ExpectedSignalConfig[],
  fields: ReadonlyArray<Pick<SuggestedField, 'fieldId' | 'mapsToSignal'>> = []
): ScanMeasure | null {
  const key = stepSignalKey(step, fields)
  const measure = key ? expectedSignals.find((s) => s.signalKey === key)?.scan?.measure : undefined
  return measure && SCAN_MEASURES.includes(measure) ? measure : null
}

function unitFor(measure: ScanMeasure, lineUnit: string | undefined, signalUnit: string | undefined, system: UnitSystem): string | undefined {
  const kind = scanMeasureKind(measure)
  if (kind === 'count') return signalUnit
  for (const candidate of [lineUnit, signalUnit]) {
    const id = normalizeUnit(candidate)
    if (id && unitKind(id) === kind) return id
  }
  if (kind === 'area') return system === 'imperial' ? 'sqft' : 'sqm'
  return system === 'imperial' ? 'ft' : 'm'
}

/** The signals with this line's scan setting changed (null: the scan fills nothing for it) */
export function withStepScanMeasure(
  step: Pick<WorkStepConfig, 'quantitySource' | 'unitLabel'>,
  measure: ScanMeasure | null,
  expectedSignals: readonly ExpectedSignalConfig[],
  fields: ReadonlyArray<Pick<SuggestedField, 'fieldId' | 'mapsToSignal'>>,
  system: UnitSystem
): ExpectedSignalConfig[] {
  const key = stepSignalKey(step, fields)
  if (!key) return [...expectedSignals]
  const existing = expectedSignals.find((s) => s.signalKey === key)
  if (!measure) {
    return expectedSignals.map((s) => {
      if (s.signalKey !== key || !s.scan) return s
      const { scan: _scan, ...rest } = s
      void _scan
      return rest
    })
  }
  const unit = unitFor(measure, step.unitLabel, existing?.unit, system)
  const updated: ExpectedSignalConfig = {
    ...(existing ?? { signalKey: key, type: 'number' as const, description: SCAN_MEASURE_WORDS[measure] }),
    ...(unit && { unit }),
    scan: { measure },
  }
  return existing ? expectedSignals.map((s) => (s.signalKey === key ? updated : s)) : [...expectedSignals, updated]
}
