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
 * nothing extra. Reference dimensions are REGION DATA (T-133, AD-025): the
 * tenant's region supplies the table (a US door is 80 in, a UK door 1.98 m)
 * and packs can override entries. Geometry is computed in metres and only
 * converted into the target's unit at the end.
 */

import type { GeminiClient } from './gemini'
import { normalizeUnit, unitKind, fromCanonical, getRegion, type ReferenceObject } from '@estimator/shared'

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
  /** Raw pass entries retained for adjudication (T-119) */
  rawPasses: Array<{ value: number; entry: PassMeasurement }>
  /** T-120: plausible band for interval pricing */
  band: { low: number; high: number }
  /** T-120: how this quantity was established */
  basis: 'measured' | 'adjudicated'
}

/**
 * M2 geometry: prefer the anchored computation (reference units × reference
 * size) over the model's direct guess. Pure function — testable.
 *
 * The anchored area is computed in square metres (canonical) and converted
 * into the target unit, so a 'sqft' target receives square feet.
 */
export function computeAnchoredValue(unit: string, pass: PassMeasurement): number | null {
  const isArea = unitKind(unit) === 'area'

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
    const areaSqm = widthM * heightM
    const inTarget = fromCanonical(areaSqm, 'area', normalizeUnit(unit) ?? 'sqm') ?? areaSqm
    return Math.round(inTarget * 10) / 10
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

/** System prompt for one measurement pass; the reference table comes from region data. */
export function buildMeasurementSystemPrompt(referenceObjects: ReferenceObject[]): string {
  return `You are a professional quantity surveyor performing a photo-based takeoff.

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
${referenceObjects.map((r) => `- ${r.id}: ${r.label} ≈ ${r.metres} m (${r.dimension})`).join('\n')}`
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Measurement memory (T-123) — learn from confirmed jobs
// ─────────────────────────────────────────────────────────────────────────────

export interface CalibrationExample {
  measured: number
  confirmed: number
}

/**
 * Deterministic calibration from confirmed jobs: the median ratio of
 * confirmed/measured across at least 3 examples, clamped to [0.5, 2] for
 * safety. Code applies the learned correction — AD-024, not prompt vibes.
 */
export function computeCalibrationFactor(
  examples: CalibrationExample[]
): { factor: number; sample: number } | null {
  const ratios = examples
    .filter((e) => e.measured > 0 && e.confirmed > 0)
    .map((e) => e.confirmed / e.measured)
  if (ratios.length < 3) return null

  const sorted = [...ratios].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  const factor = Math.min(2, Math.max(0.5, median))

  // A factor within 3% of 1.0 is noise — no correction
  if (Math.abs(factor - 1) < 0.03) return null
  return { factor: Math.round(factor * 100) / 100, sample: ratios.length }
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
  /** T-123: calibration lines from this business's confirmed jobs */
  calibrationHints?: string[]
  /**
   * T-133: reference objects from the tenant's region (+ pack overrides).
   * Defaults to the legacy region's table so callers that predate regions
   * keep their exact behaviour.
   */
  referenceObjects?: ReferenceObject[]
}): Promise<MeasuredQuantity[]> {
  const { gemini, images, targets } = opts
  const referenceTable =
    opts.referenceObjects && opts.referenceObjects.length > 0
      ? opts.referenceObjects
      : getRegion(null).referenceObjects
  const systemPrompt = buildMeasurementSystemPrompt(referenceTable)
  const passes = opts.passes ?? 3
  if (targets.length === 0 || images.length === 0) return []

  const defaultRunPass: RunPass = async () => {
    if (!gemini) return []
    const calibrationBlock =
      opts.calibrationHints && opts.calibrationHints.length > 0
        ? `\n\nCalibration from this business's previously CONFIRMED jobs:\n${opts.calibrationHints.join('\n')}\nAccount for any systematic bias these reveal.`
        : ''
    const prompt = `Measure these targets from the photos, using the reference-anchored protocol:
${targets
  .map((t) => `- targetKey "${t.signalKey}" (unit: ${t.unit}): ${t.description}`)
  .join('\n')}${calibrationBlock}

Return one measurement entry per targetKey.`
    const result = await gemini.generateWithImagesAndSchema<{ measurements: PassMeasurement[] }>(
      prompt,
      images,
      MEASUREMENT_SCHEMA,
      systemPrompt,
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
    const rawPasses: Array<{ value: number; entry: PassMeasurement }> = []
    const referencesUsed: string[] = []

    for (const pass of allPasses) {
      const entry = pass.find((m) => m.targetKey === target.signalKey)
      if (!entry || entry.feasible === false) continue
      // AD-024: the region table, not the model, owns the reference size.
      // When the model names a known reference, code supplies its dimension.
      const known = entry.referenceObject
        ? referenceTable.find((r) => r.id === entry.referenceObject)
        : undefined
      const anchoredEntry = known ? { ...entry, referenceDimensionM: known.metres } : entry
      const value = computeAnchoredValue(target.unit, anchoredEntry)
      if (value !== null && value > 0) {
        rawPasses.push({ value, entry })
        if (entry.referenceObject) referencesUsed.push(entry.referenceObject)
      }
    }

    if (rawPasses.length === 0) continue // leave to the envelope fallback

    const values = rawPasses.map((p) => p.value)
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
      rawPasses,
      band: {
        low: Math.round(stats.median * (1 - stats.cov) * 10) / 10,
        high: Math.round(stats.median * (1 + stats.cov) * 10) / 10,
      },
      basis: 'measured',
    })
  }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// M4 — Adjudication (T-119)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdjudicationResult {
  finalValue: number
  lowValue: number
  highValue: number
  /** One-sentence resolution of what the passes included/excluded */
  scopeResolution: string
}

export interface AdjudicationDecision {
  shouldAdjudicate: boolean
  reason?: 'high_variance' | 'single_pass' | 'high_stakes'
}

/**
 * Stakes-based routing (pure, testable): escalate to the senior model when
 * the ensemble disagrees, evidence is thin, or real money rides on the number.
 */
export function decideAdjudication(opts: {
  cov: number
  passesUsed: number
  provisionalValue: number
  covThreshold?: number
  valueThreshold?: number
}): AdjudicationDecision {
  const covThreshold = opts.covThreshold ?? 0.15
  const valueThreshold = opts.valueThreshold ?? 1000

  if (opts.passesUsed < 2) return { shouldAdjudicate: true, reason: 'single_pass' }
  if (opts.cov > covThreshold) return { shouldAdjudicate: true, reason: 'high_variance' }
  if (opts.provisionalValue >= valueThreshold) {
    return { shouldAdjudicate: true, reason: 'high_stakes' }
  }
  return { shouldAdjudicate: false }
}

const ADJUDICATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    finalValue: { type: 'number' },
    lowValue: { type: 'number' },
    highValue: { type: 'number' },
    scopeResolution: { type: 'string' },
  },
  required: ['finalValue', 'lowValue', 'highValue', 'scopeResolution'],
}

const ADJUDICATION_SYSTEM_PROMPT = `You are a SENIOR quantity surveyor reviewing junior surveyors' photo-based takeoffs before a quote goes to a client.

Your job is NOT to average their numbers. It is to resolve WHY they differ:
- Did they measure different scopes? (one included the garage, another did not)
- Did one mis-identify the reference object or its size?
- Is part of the target simply not visible in the photos?

Protocol:
1. Re-examine the photos yourself against the target definition.
2. Determine the CORRECT scope for the target as described.
3. Produce your final measurement with an honest low–high band
   (what the value could plausibly be given what the photos show).
4. scopeResolution: ONE sentence stating what you included/excluded and why
   the juniors differed. This appears in the audit trail.
Keep all prose minimal — the numbers and the scope sentence are what matter.`

/**
 * Run senior-model adjudication over disagreeing/thin/high-stakes measurements.
 * `run` is injectable for tests. Failure returns null — never blocks the quote.
 */
export async function adjudicateMeasurement(opts: {
  adjudicator: GeminiClient | null
  images: Array<{ mimeType: string; base64: string }>
  target: MeasurementTarget
  measured: MeasuredQuantity
  run?: () => Promise<AdjudicationResult>
}): Promise<MeasuredQuantity | null> {
  const { adjudicator, images, target, measured } = opts

  const defaultRun = async (): Promise<AdjudicationResult> => {
    if (!adjudicator) throw new Error('No adjudicator model configured')
    const passSummaries = measured.rawPasses
      .map(
        (p, i) =>
          `Junior ${i + 1}: ${p.value} ${target.unit}` +
          (p.entry.referenceObject
            ? ` (anchored to ${p.entry.referenceObject}, ${p.entry.widthInRefUnits ?? '?'}×${p.entry.heightInRefUnits ?? '?'} ref units)`
            : ' (direct estimate)') +
          (p.entry.reasoning ? ` — "${p.entry.reasoning}"` : '')
      )
      .join('\n')

    return adjudicator.generateWithImagesAndSchema<AdjudicationResult>(
      `Target: "${target.signalKey}" (unit: ${target.unit}) — ${target.description}

Junior takeoffs to review:
${passSummaries}

Re-examine the photos, resolve the scope, and produce your final measurement.`,
      images,
      ADJUDICATION_SCHEMA,
      ADJUDICATION_SYSTEM_PROMPT,
      { temperature: 0.2, maxOutputTokens: 16384 }
    )
  }

  try {
    const run = opts.run ?? defaultRun
    const result = await run()
    if (!Number.isFinite(result.finalValue) || result.finalValue <= 0) return null

    // Measured semantics preserved: confidence derives from the adjudicator's
    // own band width, not a self-reported score
    const low = Math.min(result.lowValue, result.finalValue)
    const high = Math.max(result.highValue, result.finalValue)
    const halfSpread = result.finalValue > 0 ? (high - low) / 2 / result.finalValue : 1
    const confidence =
      halfSpread <= 0.08 ? 0.9 : halfSpread <= 0.15 ? 0.8 : halfSpread <= 0.3 ? 0.65 : 0.45

    return {
      signalKey: target.signalKey,
      value: Math.round(result.finalValue * 10) / 10,
      confidence,
      cov: Math.round(halfSpread * 1000) / 1000,
      passesUsed: measured.passesUsed,
      evidence: `Senior review of ${measured.passesUsed} takeoff${measured.passesUsed === 1 ? '' : 's'}: ${result.scopeResolution} (plausible ${low}-${high} ${target.unit})`,
      rawPasses: measured.rawPasses,
      band: { low: Math.round(low * 10) / 10, high: Math.round(high * 10) / 10 },
      basis: 'adjudicated',
    }
  } catch (error) {
    console.error('[Measurement] Adjudication failed:', error)
    return null
  }
}

function mostCommon(items: string[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}
