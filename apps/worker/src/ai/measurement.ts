/**
 * Measurement Engine M2+M3 (T-117 ensemble + T-118 anchored takeoff).
 *
 * Replaces single-shot quantity guessing for ai_signal quantities with:
 *  - M2: reference-anchored takeoff — the model measures targets AGAINST
 *    known-size objects visible in the photos ("4.2 door-widths wide"); CODE
 *    converts reference units to metres and computes areas (AD-024 for vision)
 *  - M3: an ensemble of N independent passes — agreement across passes is the
 *    confidence, MEASURED (coefficient of variation), never self-reported
 *
 * Runs ONLY for services with ai_signal quantity sources, so most quotes pay
 * nothing extra. Reference dimensions are physical constants (a UK door is a
 * UK door), not business configuration — pack-level overrides can come later.
 */

import type { GeminiClient } from './gemini'

/** Known-size reference objects commonly visible in job photos */
export const REFERENCE_OBJECTS: Array<{
  id: string
  label: string
  dimension: string
  metres: number
}> = [
  { id: 'entry_door_height', label: 'standard entry door height', dimension: 'height', metres: 1.98 },
  { id: 'entry_door_width', label: 'standard entry door width', dimension: 'width', metres: 0.76 },
  { id: 'brick_course', label: 'one brick + mortar course', dimension: 'height', metres: 0.075 },
  { id: 'fence_panel_width', label: 'standard fence panel width', dimension: 'width', metres: 1.83 },
  { id: 'fence_panel_height', label: 'standard fence panel height', dimension: 'height', metres: 1.8 },
  { id: 'wheelie_bin', label: 'wheelie bin height', dimension: 'height', metres: 1.07 },
  { id: 'car_length', label: 'typical car length', dimension: 'length', metres: 4.5 },
  { id: 'person_height', label: 'adult person height', dimension: 'height', metres: 1.7 },
  { id: 'window_casement', label: 'typical window casement height', dimension: 'height', metres: 1.05 },
]

export interface MeasurementTarget {
  signalKey: string
  description: string
  /** e.g. 'sqm', 'sqft', 'item', 'linear_m', 'wall' */
  unit: string
}

/** One pass's raw output for one target */
export interface PassMeasurement {
  targetKey: string
  feasible: boolean
  /** Reference object id used for anchoring, when one was visible */
  referenceObject?: string | null
  /** Assumed size of the reference in metres (from the table) */
  referenceDimensionM?: number | null
  /** Target width expressed in reference units */
  widthInRefUnits?: number | null
  /** Target height expressed in reference units */
  heightInRefUnits?: number | null
  /** The model's own final value in the target unit (fallback / non-area units) */
  directValue?: number | null
  reasoning?: string
}

export interface MeasuredQuantity {
  signalKey: string
  value: number
  /** Measured confidence from ensemble agreement, NOT model self-report */
  confidence: number
  /** Coefficient of variation across passes (0 = perfect agreement) */
  cov: number
  passesUsed: number
  evidence: string
}

const AREA_UNITS = new Set(['sqm', 'sq_m', 'square_metre', 'square_meter', 'm2', 'sqft', 'sq_ft'])

/**
 * M2 geometry: prefer the anchored computation (reference units × reference
 * size) over the model's direct guess. Pure function — testable.
 */
export function computeAnchoredValue(unit: string, pass: PassMeasurement): number | null {
  const isArea = AREA_UNITS.has(unit.toLowerCase().replace(/[^a-z0-9_]/g, ''))

  if (
    isArea &&
    pass.widthInRefUnits != null &&
    pass.heightInRefUnits != null &&
    pass.referenceDimensionM != null &&
    pass.widthInRefUnits > 0 &&
    pass.heightInRefUnits > 0 &&
    pass.referenceDimensionM > 0
  ) {
    const widthM = pass.widthInRefUnits * pass.referenceDimensionM
    const heightM = pass.heightInRefUnits * pass.referenceDimensionM
    return Math.round(widthM * heightM * 10) / 10
  }

  if (pass.directValue != null && pass.directValue > 0) {
    return pass.directValue
  }
  return null
}

/**
 * M3 statistics: median + coefficient of variation → measured confidence.
 * Pure function — testable.
 */
export function computeEnsembleStats(values: number[]): {
  median: number
  cov: number
  confidence: number
  spreadPct: number
} {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!

  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const cov = mean > 0 ? Math.sqrt(variance) / mean : 1

  // Agreement bands → measured confidence
  let confidence: number
  if (values.length < 2) confidence = 0.5 // single usable pass — weak evidence
  else if (cov <= 0.08) confidence = 0.9
  else if (cov <= 0.15) confidence = 0.8
  else if (cov <= 0.3) confidence = 0.6
  else confidence = 0.35

  return {
    median: Math.round(median * 10) / 10,
    cov: Math.round(cov * 1000) / 1000,
    confidence,
    spreadPct: Math.round(cov * 100),
  }
}

const MEASUREMENT_SYSTEM_PROMPT = `You are a professional quantity surveyor performing a photo-based takeoff.

Your discipline: NEVER eyeball absolute sizes. Instead:
1. Find a REFERENCE OBJECT with a known size in the photos (table provided).
2. Express the target's dimensions in MULTIPLES of that reference ("the wall is
   4.2 door-heights wide") — comparisons are reliable; absolute guesses are not.
3. Report the reference used, its assumed size in metres, and the multiples.
   The system computes the final measurement — you only compare.
4. Only include surfaces/items that are part of the requested target. State in
   your reasoning what you included and excluded (e.g. "excluded garage, included
   both visible elevations").
5. If no reference object is visible, you may give a directValue estimate, but
   say so in the reasoning.
6. If the target genuinely cannot be assessed from these photos, set feasible=false.
7. Keep "reasoning" to AT MOST two short sentences — numbers matter, prose does not.

Reference object table (assumed sizes):
${REFERENCE_OBJECTS.map((r) => `- ${r.id}: ${r.label} ≈ ${r.metres} m (${r.dimension})`).join('\n')}`

const MEASUREMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetKey: { type: 'string' },
          feasible: { type: 'boolean' },
          referenceObject: { type: 'string' },
          referenceDimensionM: { type: 'number' },
          widthInRefUnits: { type: 'number' },
          heightInRefUnits: { type: 'number' },
          directValue: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['targetKey', 'feasible'],
      },
    },
  },
  required: ['measurements'],
}

export type RunPass = (passIndex: number) => Promise<PassMeasurement[]>

/**
 * Run the anchored-takeoff ensemble for the given targets.
 * `runPass` is injectable for tests; default performs a real Gemini call.
 */
export async function measureQuantities(opts: {
  gemini: GeminiClient | null
  images: Array<{ mimeType: string; base64: string }>
  targets: MeasurementTarget[]
  passes?: number
  runPass?: RunPass
}): Promise<MeasuredQuantity[]> {
  const { gemini, images, targets } = opts
  const passes = opts.passes ?? 3
  if (targets.length === 0 || images.length === 0) return []

  const defaultRunPass: RunPass = async () => {
    if (!gemini) return []
    const prompt = `Measure these targets from the photos, using the reference-anchored protocol:
${targets
  .map((t) => `- targetKey "${t.signalKey}" (unit: ${t.unit}): ${t.description}`)
  .join('\n')}

Return one measurement entry per targetKey.`
    const result = await gemini.generateWithImagesAndSchema<{ measurements: PassMeasurement[] }>(
      prompt,
      images,
      MEASUREMENT_SCHEMA,
      MEASUREMENT_SYSTEM_PROMPT,
      // Higher temperature: pass-to-pass variation is what makes ensemble
      // agreement meaningful. Generous token budget: Gemini 2.5 thinking
      // tokens count against maxOutputTokens (truncation = invalid JSON,
      // found live)
      { temperature: 0.7, maxOutputTokens: 16384 }
    )
    return result.measurements || []
  }

  const runPass = opts.runPass ?? defaultRunPass

  // Run all passes (sequentially — worker environment, small N)
  const allPasses: PassMeasurement[][] = []
  for (let i = 0; i < passes; i++) {
    try {
      allPasses.push(await runPass(i))
    } catch (error) {
      console.error(`[Measurement] Pass ${i + 1} failed:`, error)
    }
  }

  const results: MeasuredQuantity[] = []
  for (const target of targets) {
    const values: number[] = []
    const referencesUsed: string[] = []

    for (const pass of allPasses) {
      const entry = pass.find((m) => m.targetKey === target.signalKey)
      if (!entry || entry.feasible === false) continue
      const value = computeAnchoredValue(target.unit, entry)
      if (value !== null && value > 0) {
        values.push(value)
        if (entry.referenceObject) referencesUsed.push(entry.referenceObject)
      }
    }

    if (values.length === 0) continue // leave to the envelope fallback

    const stats = computeEnsembleStats(values)
    const refNote =
      referencesUsed.length > 0
        ? `, anchored to ${mostCommon(referencesUsed).replace(/_/g, ' ')}`
        : ''

    results.push({
      signalKey: target.signalKey,
      value: stats.median,
      confidence: stats.confidence,
      cov: stats.cov,
      passesUsed: values.length,
      evidence: `Measured across ${values.length} independent pass${values.length === 1 ? '' : 'es'} (spread ±${stats.spreadPct}%)${refNote}`,
    })
  }

  return results
}

function mostCommon(items: string[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}
