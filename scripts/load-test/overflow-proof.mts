// T-203, item 2: the proof a task needs before its overflow model is switched on.
//
//   npx tsx scripts/load-test/overflow-proof.mts                  every task, both models
//   npx tsx scripts/load-test/overflow-proof.mts --task wording   one task
//   npx tsx scripts/load-test/overflow-proof.mts --primary-only   the task's own model only (shows the harness works)
//   … --case <id>      one case (ids are in the table)     … --repeats <n>   each case n times (default 1)
//
// For each task the worker's quote pipeline uses, a small fixed set of inputs goes through the
// SAME worker function the pipeline calls, with the pipeline's own time limit, once on the task's
// own model and once on the overflow candidate. A task passes when, on the overflow model:
//   shape      the function returned a real result, not the fallback it uses when a call fails
//              (most of these functions swallow an error and return a default, so this is checked
//              explicitly: by the result, and by counting the calls that failed)
//   tolerance  the result is inside the tolerance an existing check already uses for it.
//              No tolerance is invented here; each case names the check it comes from.
//
// Models: the task's own from the registry (resolveModelRoute), the candidate from the registry's
// `overflowCandidate`, or from AI_OVERFLOW_<TASK> when that is set. No model name is typed here.
// Keys: GEMINI_API_KEY and ANTHROPIC_API_KEY from the environment, else apps/worker/.dev.vars.
// With no key for the overflow provider nothing is run on that side and every task is
// "not proven: no key" (exit 2).
//
// It asks real models, so it costs money: a full run is about 16 calls on each model.
// It sends no email, writes nothing to a database and touches no environment.
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as aiModels from '../../packages/shared/src/ai-models'
import { AiUsageMeter, resolveModelRoute, resolveThinkingLevel, parseModelSpec, type AiTask, type ModelRoute, type AiUsageSummary } from '../../packages/shared/src/ai-models'
import type { AiClient, GenerationOptions, ImageInput } from '../../apps/worker/src/ai/client'
import { usageSinkFor } from '../../apps/worker/src/ai/client'
import { GeminiClient } from '../../apps/worker/src/ai/gemini'
import { AnthropicClient } from '../../apps/worker/src/ai/anthropic'
import { extractStructuredSignals } from '../../apps/worker/src/ai/signals'
import { measureQuantities, adjudicateMeasurement, type MeasuredQuantity, type MeasurementTarget } from '../../apps/worker/src/ai/measurement'
import { identificationTargets, identifyFromLabels } from '../../apps/worker/src/ai/identification'
import { generateWording, getDefaultContent, type WordingContext } from '../../apps/worker/src/ai/wording'
import { getSignalsWithoutImagesPhotoOptional } from '../../apps/worker/src/ai/signals'
import { createSentenceRewriter } from '../../apps/worker/src/ai/wording-repair'
import { validateQuote, type GeneratedQuoteForValidation, type ServiceConfigForValidation } from '../../apps/worker/src/ai/quote-validator'
import { withAiTimeout, aiCallTimeoutMs, AiCallTimeoutError } from '../../apps/worker/src/ai/timeouts'
import { repairCustomerWording, businessPhrasesFrom, maskBusinessText } from '../../packages/shared/src/wording-repair'
import { findConfidenceLanguageInPayload } from '../../packages/shared/src/customer-language'
import { computeEnvelope, type QuantityEnvelopeRule } from '../../packages/shared/src/envelopes'
import { getRegion } from '../../packages/shared/src/regions/index'
import { paintingPack } from '../../apps/web/src/lib/vertical-packs/painting'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'
import { waterHeaterPackUS } from '../../apps/web/src/lib/vertical-packs/water-heater-us'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { isSettingsFlag } from '../hardcore-test/t172-checker-cases.mts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ───────────────────────────── arguments, keys, models ─────────────────────────────

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const valueOf = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const PRIMARY_ONLY = flag('--primary-only')
const ONLY_TASK = valueOf('--task')
const ONLY_CASE = valueOf('--case')
const REPEATS = Math.max(1, Math.floor(Number(valueOf('--repeats') ?? 1)) || 1)

/** The tasks the worker's quote pipeline asks a model for (quote-processor.ts: four createAiClient calls) */
const PIPELINE_TASKS: AiTask[] = ['extraction_pass', 'wording', 'identification', 'adjudication']

function devVars(): Record<string, string> {
  const file = path.join(ROOT, 'apps/worker/.dev.vars')
  const out: Record<string, string> = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match) out[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}
const fileVars = devVars()
const setting = (name: string): string | undefined => process.env[name]?.trim() || fileVars[name]?.trim() || undefined
const KEYS: Record<ModelRoute['provider'], string | undefined> = { gemini: setting('GEMINI_API_KEY'), anthropic: setting('ANTHROPIC_API_KEY') }
const KEY_NAME: Record<ModelRoute['provider'], string> = { gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }

/** The model overrides a deployment may set, read the way the worker reads them */
const routeEnv: Record<string, string | undefined> = {}
for (const name of [...Object.keys(fileVars), ...Object.keys(process.env)]) if (/^AI_(MODEL|THINKING|OVERFLOW)_/.test(name) || name === 'ADJUDICATION_MODEL') routeEnv[name] = setting(name)

/** The overflow model to prove for a task: AI_OVERFLOW_<TASK>, else the task's registry entry, else the registry's candidate */
function candidateFor(task: AiTask): { route: ModelRoute | null; from: string } {
  const own = resolveModelRoute(task, routeEnv)
  const envName = `AI_OVERFLOW_${task.toUpperCase()}`
  const override = routeEnv[envName]
  if (override && override.toLowerCase() !== 'none') {
    const parsed = parseModelSpec(override, own.provider === 'gemini' ? 'anthropic' : 'gemini')
    if (parsed) return { route: parsed, from: envName }
  }
  // the registry's helpers were added with this ticket: read them without assuming they are there
  const helpers = ((aiModels as { default?: unknown }).default ?? aiModels) as unknown as { resolveOverflowRoute?: (task: AiTask, env?: Record<string, string | undefined>) => ModelRoute | null; overflowCandidate?: () => ModelRoute | null }
  const switchedOn = helpers.resolveOverflowRoute?.(task, {}) ?? null
  if (switchedOn) return { route: switchedOn, from: `the registry (tasks.${task}.overflow)` }
  let candidate = helpers.overflowCandidate?.() ?? null
  if (!candidate) {
    const registry = JSON.parse(readFileSync(path.join(ROOT, 'packages/shared/src/ai-models.json'), 'utf8')) as { overflowCandidate?: Partial<ModelRoute> }
    const entry = registry.overflowCandidate
    if (entry?.model && (entry.provider === 'gemini' || entry.provider === 'anthropic')) candidate = { provider: entry.provider, model: entry.model }
  }
  return { route: candidate, from: 'the registry (overflowCandidate)' }
}

/** The longest one overflow request may take in the worker (apps/worker/src/ai/factory.ts, OVERFLOW_TIMEOUT_MS) */
const OVERFLOW_TIMEOUT_MS = 120_000

/** A provider client built as the worker's factory builds it (no busy retry around it: one call is one call here) */
function clientFor(task: AiTask, route: ModelRoute, meter: AiUsageMeter, overflow: boolean): AiClient | null {
  const apiKey = KEYS[route.provider]
  if (!apiKey) return null
  const usage = usageSinkFor(meter, task, route)
  if (route.provider === 'anthropic') {
    return new AnthropicClient({ apiKey, model: route.model, usage, ...(overflow && { maxRetries: 0, timeoutMs: OVERFLOW_TIMEOUT_MS }) } as ConstructorParameters<typeof AnthropicClient>[0])
  }
  return new GeminiClient({ apiKey, model: route.model, thinkingLevel: resolveThinkingLevel(task, route.model, routeEnv), usage })
}

// ───────────────────────────── a client that counts what happened ─────────────────────────────

interface CallRecord { ok: boolean; ms: number; error?: string }

/** Wraps a client and records every call, so an error a worker function swallowed is still seen */
class Probe implements AiClient {
  readonly calls: CallRecord[] = []
  constructor(private readonly inner: AiClient) {}
  get route() { return this.inner.route }
  private async run<T>(call: () => Promise<T>): Promise<T> {
    const started = Date.now()
    try {
      const result = await call()
      this.calls.push({ ok: true, ms: Date.now() - started })
      return result
    } catch (error) {
      // the provider's own words, clipped: they say why a request shape was refused
      this.calls.push({ ok: false, ms: Date.now() - started, error: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300) })
      throw error
    }
  }
  generateText(prompt: string, systemPrompt?: string) { return this.run(() => this.inner.generateText(prompt, systemPrompt)) }
  generateWithImages(prompt: string, images: ImageInput[], systemPrompt?: string) { return this.run(() => this.inner.generateWithImages(prompt, images, systemPrompt)) }
  generateWithSchema<T>(prompt: string, schema: Record<string, unknown>, systemPrompt?: string) { return this.run(() => this.inner.generateWithSchema<T>(prompt, schema, systemPrompt)) }
  generateWithImagesAndSchema<T>(prompt: string, images: ImageInput[], schema: Record<string, unknown>, systemPrompt?: string, options?: GenerationOptions) {
    return this.run(() => this.inner.generateWithImagesAndSchema<T>(prompt, images, schema, systemPrompt, options))
  }
}

// ───────────────────────────── fixed inputs ─────────────────────────────

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
function photo(relative: string): ImageInput {
  const file = path.join(ROOT, relative)
  return { mimeType: MIME[path.extname(file).toLowerCase()] ?? 'image/jpeg', base64: readFileSync(file).toString('base64') }
}
function photosIn(relativeDir: string): ImageInput[] {
  const dir = path.join(ROOT, relativeDir)
  return readdirSync(dir).filter((name) => MIME[path.extname(name).toLowerCase()]).sort().map((name) => photo(path.join(relativeDir, name)))
}

// The demo's sample photos are in the repository; the scenario and label photos are local only (git-ignored)
const SAMPLE_LABEL = 'apps/web/public/demo/sample-water-heater-label.png'
const SAMPLE_ROOM = 'apps/web/public/demo/sample-room-to-paint.webp'
const S01_DIR = 'test-assets/hardcore/S01-painting'
const T139_SHARP = 'test-assets/hardcore2/T139-labels/label-sharp.jpg'
const T139_BLURRED = 'test-assets/hardcore2/T139-labels/label-blurred.jpg'

type ExpectedSignals = Parameters<typeof identificationTargets>[0]
const serviceOf = <P extends { services: Array<{ name: string }> }>(pack: P, name: string) => pack.services.find((s) => s.name === name)! as P['services'][number]

const HEATER = waterHeaterPackUS.services[0]!
const INTERIOR_US = serviceOf(paintingPackUS, 'Interior Painting')
const EXTERIOR_GB = serviceOf(paintingPack, 'Exterior Painting')
const SPRING = serviceOf(garageDoorsPackUS, 'Garage Door Spring Replacement')

/** verify-t139's test-only service: the size is in the model number, and the pack rule decodes it */
const T139_SIGNALS = [
  {
    signalKey: 'unit_size',
    type: 'enum',
    possibleValues: ['Small', 'Medium', 'Large'],
    description: 'size of the existing unit',
    identify: {
      readFrom: "the unit's rating plate",
      transcribe: 'the model number (after "MODEL NO.")',
      decode: [{ pattern: '[A-Z]{2}(\\d{2})-', map: { '24': 'Small', '36': 'Medium', '48': 'Large' }, label: 'size digits in the model number' }],
    },
  },
] as unknown as ExpectedSignals

/** The measured quantity of scenario S01 (a house front), as the pipeline builds its target from the pack */
const WALL_SIGNAL = (EXTERIOR_GB.draft.expectedSignals ?? []).find((s) => s.signalKey === 'wall_area_sqm')!
const WALL_STEP = (EXTERIOR_GB.draft.pricing.workSteps ?? []).find((s) => (s as { quantitySource?: { signalKey?: string } }).quantitySource?.signalKey === 'wall_area_sqm') as { name: string; unitLabel?: string } | undefined
const WALL_TARGET: MeasurementTarget = {
  signalKey: 'wall_area_sqm',
  description: WALL_SIGNAL.description || `Quantity for "${WALL_STEP?.name}"`,
  unit: (WALL_SIGNAL as { unit?: string }).unit || WALL_STEP?.unitLabel || 'unit',
}
/** The pack's own plausibility envelope, computed as the pipeline computes it when the storeys are not known */
const WALL_ENVELOPE = computeEnvelope((WALL_SIGNAL as { envelope?: QuantityEnvelopeRule }).envelope!, () => undefined)
const insideEnvelope = (value: number) => value >= WALL_ENVELOPE.min && value <= WALL_ENVELOPE.max
const ENVELOPE_WORDS = `inside the pack's envelope for a house front, ${WALL_ENVELOPE.min} to ${WALL_ENVELOPE.max} ${WALL_TARGET.unit}`

/** Three junior takeoffs that disagree, for the senior review to settle (made-up, fixed; the kind of spread that routes a quantity to adjudication) */
const JUNIORS: MeasuredQuantity = {
  signalKey: 'wall_area_sqm',
  value: 52,
  confidence: 0.3,
  cov: 0.48,
  passesUsed: 3,
  evidence: 'Measured across 3 independent passes (spread ±48%)',
  rawPasses: [
    { value: 34, entry: { targetKey: 'wall_area_sqm', feasible: true, directValue: 34, reasoning: 'Front wall only, window and door openings taken out.' } },
    { value: 52, entry: { targetKey: 'wall_area_sqm', feasible: true, directValue: 52, reasoning: 'Front wall across both storeys, openings left in.' } },
    { value: 88, entry: { targetKey: 'wall_area_sqm', feasible: true, directValue: 88, reasoning: 'Front wall plus the side return that is partly in view.' } },
  ],
  band: { low: 34, high: 88 },
  basis: 'measured',
}

/** verify-t172's checker fixture: a pair of springs for a business with a $400 minimum and sales tax */
const SPRING_SERVICE: ServiceConfigForValidation = {
  serviceName: SPRING.name,
  serviceDescription: SPRING.description,
  scopeIncludes: SPRING.draft.scope.included,
  scopeExcludes: SPRING.draft.scope.excluded,
  workSteps: SPRING.draft.pricing.workSteps as ServiceConfigForValidation['workSteps'],
  addons: SPRING.addons,
  multipliers: [],
  pricingSettings: { currency: 'USD', locale: 'en-US', baseFee: 0, minimumCharge: 400, tax: { enabled: true, label: 'Sales Tax', ratePercent: 8.25 } },
} as ServiceConfigForValidation
const SPRING_CONTENT = { scopeSummary: 'Replace both torsion springs as a matched pair and tune up the door.', assumptions: [], exclusions: [], notes: '' } as unknown as GeneratedQuoteForValidation['content']
const SPRING_REQUEST = { formAnswers: [{ fieldId: 'spring_count', value: 'Two' }], customerDescription: '', photoCount: 0 }
const springPricing = (breakdown: Array<{ label: string; amount: number }>, subtotal: number): GeneratedQuoteForValidation['pricing'] =>
  ({ currency: 'USD', subtotal, taxLabel: 'Sales Tax', taxRate: 8.25, taxAmount: Math.round(subtotal * 8.25) / 100, total: Math.round(subtotal * 108.25) / 100, breakdown, confidence: 1, notes: [] }) as GeneratedQuoteForValidation['pricing']
const RIGHT_BREAKDOWN = [{ label: 'Torsion spring replacement (pair)', amount: 375 }, { label: 'Minimum charge applied', amount: 25, kind: 'minimum', minimumCharge: 400 } as { label: string; amount: number }]

const WORDING_CONTEXT: WordingContext = {
  businessName: 'Ridgeway Home Services',
  serviceName: SPRING.name,
  serviceDescription: SPRING.description,
  scopeIncludes: SPRING.draft.scope.included,
  scopeExcludes: SPRING.draft.scope.excluded,
  defaultAssumptions: SPRING.draft.scope.assumptions,
  customerName: 'Dana Whitlock',
  signals: getSignalsWithoutImagesPhotoOptional(),
  pricing: springPricing(RIGHT_BREAKDOWN, 400) as unknown as WordingContext['pricing'],
  formAnswers: [{ fieldId: 'spring_count', question: 'How many springs need replacing?', answer: 'Two' }] as unknown as WordingContext['formAnswers'],
  projectDescription: 'One of the springs on our double garage door snapped last night. The door will not open.',
  regionGuidance: undefined,
}

// ───────────────────────────── the cases ─────────────────────────────

interface Outcome {
  /** A real result, not the function's fallback */
  real: boolean
  /** Inside the existing check's tolerance; null = the existing checks have no tolerance for this, shape only */
  inTolerance: boolean | null
  /** What came back, in a few words (no customer text: the inputs here are made up) */
  shown: string
  /** Why it is not real, or not inside the tolerance */
  why?: string
  /** For your eyes: not a pass condition */
  note?: string
}
interface ProofCase {
  id: string
  task: AiTask
  what: string
  /** The tolerance, and the existing check it comes from */
  tolerance: string
  /** Files that must be on this machine (local-only photos); the case is skipped without them */
  needs: string[]
  /** About how many model calls one run makes */
  calls: number
  run(client: Probe): Promise<Outcome>
}

const okCalls = (client: Probe) => client.calls.filter((c) => c.ok).length
const failedCalls = (client: Probe) => client.calls.filter((c) => !c.ok)
const firstError = (client: Probe) => failedCalls(client)[0]?.error ?? 'no call was answered'

async function identificationCase(client: Probe, images: ImageInput[], expectedSignals: ExpectedSignals, expected: Record<string, string>): Promise<Outcome> {
  const targets = identificationTargets(expectedSignals)
  // the pipeline's own cap (25 s): past it nothing is read and the customer is asked
  const outcome = await identifyFromLabels({ ai: client, images, targets })
  const answered = okCalls(client) > 0 && outcome.readings.length > 0 && outcome.readings.every((r) => typeof r.targetKey === 'string' && typeof r.legible === 'boolean')
  if (!answered) return { real: false, inTolerance: null, shown: 'no readings', why: okCalls(client) > 0 ? 'the answer had no usable readings' : firstError(client) }
  const got = Object.fromEntries(outcome.resolved.map((r) => [r.signalKey, String(r.value)]))
  const wrong = Object.entries(got).filter(([key, value]) => expected[key] !== undefined && value !== expected[key])
  const unexpected = Object.keys(got).filter((key) => expected[key] === undefined)
  const read = Object.keys(expected).filter((key) => got[key] === expected[key]).length
  return {
    real: true,
    inTolerance: wrong.length === 0 && unexpected.length === 0,
    shown: `${JSON.stringify(got)} (${read} of ${Object.keys(expected).length} read, the rest left to a question)`,
    ...(wrong.length + unexpected.length > 0 && { why: `read wrongly: ${[...wrong.map(([k, v]) => `${k}=${v}, expected ${expected[k]}`), ...unexpected.map((k) => `${k}=${got[k]}, expected no reading`)].join('; ')}` }),
    note: `${read} of ${Object.keys(expected).length} values read`,
  }
}

async function checkerFlags(client: Probe, quote: GeneratedQuoteForValidation, about: RegExp): Promise<Outcome> {
  // verify-t172 gives the checker two tries to name the fault
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = JSON.stringify(quote)
    const result = await withAiTimeout('checker', aiCallTimeoutMs('checker'), () => validateQuote(client, quote, SPRING_REQUEST, SPRING_SERVICE)).catch((error) => error as Error)
    if (result instanceof AiCallTimeoutError) return { real: false, inTolerance: null, shown: 'no answer', why: `slower than the checker's ${result.timeoutMs / 1000} s cap (T-172): the quote would go out unchecked` }
    if (result instanceof Error) return { real: false, inTolerance: null, shown: 'no answer', why: result.message.slice(0, 200) }
    if (okCalls(client) === 0) return { real: false, inTolerance: null, shown: 'the default "pass"', why: firstError(client) }
    if (JSON.stringify(quote) !== before) return { real: true, inTolerance: false, shown: 'the quote was changed', why: 'the checker changed the quote it was given' }
    const hit = result.issues.filter((i) => about.test(`${i.check} ${i.description} ${i.found}`))
    if (hit.length > 0) return { real: true, inTolerance: true, shown: `flagged on try ${attempt + 1}: ${hit[0]!.check}` }
  }
  return { real: true, inTolerance: false, shown: 'no finding in two tries', why: 'the wrong quote was not flagged' }
}

const CASES: ProofCase[] = [
  // ── extraction_pass: the vision client (signals, measurement) ──
  {
    id: 'signals-room',
    task: 'extraction_pass',
    what: 'signals from the demo’s sample room photo, for the US interior painting service',
    tolerance: 'shape only: the existing checks have no tolerance for general signals. Every value for a choice signal must be one of the service’s own choices.',
    needs: [SAMPLE_ROOM],
    calls: 1,
    async run(client) {
      const expectedSignals = INTERIOR_US.draft.expectedSignals ?? []
      const result = await extractStructuredSignals(client, [photo(SAMPLE_ROOM)], {
        serviceName: INTERIOR_US.name,
        serviceDescription: INTERIOR_US.description,
        scopeIncludes: INTERIOR_US.draft.scope.included,
        scopeExcludes: INTERIOR_US.draft.scope.excluded,
        promptContext: INTERIOR_US.promptContext,
        expectedSignals,
      })
      const signals = result.structured.signals
      // the function's two fallbacks: no signals at all, with one of these reasons
      const fallback = signals.length === 0 || result.structured.siteVisitReason === 'Failed to parse AI response'
      if (fallback || okCalls(client) === 0) return { real: false, inTolerance: null, shown: 'the default signals', why: okCalls(client) > 0 ? 'the answer could not be read as signals' : firstError(client) }
      const known = new Map(expectedSignals.map((s) => [s.signalKey, s]))
      const offList = signals.filter((s) => {
        const config = known.get(s.key)
        return config?.type === 'enum' && Array.isArray(config.possibleValues) && !config.possibleValues.includes(String(s.value))
      })
      const strangers = signals.filter((s) => !known.has(s.key))
      const badShape = signals.filter((s) => typeof s.key !== 'string' || !(s.confidence >= 0 && s.confidence <= 1))
      const real = offList.length === 0 && badShape.length === 0
      return {
        real,
        inTolerance: null,
        shown: `${signals.length} signals: ${signals.map((s) => `${s.key}=${String(s.value)}`).join(', ').slice(0, 200)}`,
        ...(!real && { why: offList.length > 0 ? `a value outside the service’s choices: ${offList.map((s) => `${s.key}=${String(s.value)}`).join(', ')}` : 'a signal with no key or no confidence' }),
        ...((strangers.length > 0 || failedCalls(client).length > 0) && { note: [strangers.length > 0 ? `${strangers.length} signals the service did not ask for` : '', failedCalls(client).length > 0 ? `the structured call failed first (${firstError(client).slice(0, 80)}); the text fallback answered` : ''].filter(Boolean).join('; ') }),
      }
    },
  },
  {
    id: 'measure-s01',
    task: 'extraction_pass',
    what: 'the measured wall area of scenario S01’s house front (the pipeline’s three passes, early stop at two that agree)',
    tolerance: `${ENVELOPE_WORDS} (scenario S01’s rule in scripts/hardcore-test/scenarios.mjs: “quantity (sqm) must sit inside the plausibility envelope for a house front”; the envelope is the GB painting pack’s, through computeEnvelope)`,
    needs: [S01_DIR],
    calls: 3,
    async run(client) {
      const passTimingsMs: number[] = []
      const measured = await measureQuantities({ gemini: client, images: photosIn(S01_DIR), targets: [WALL_TARGET], passes: 3, referenceObjects: getRegion('GB').referenceObjects, passTimingsMs })
      const quantity = measured.find((m) => m.signalKey === WALL_TARGET.signalKey)
      // no usable pass: the pipeline leaves the quantity to the envelope's midpoint (its fallback)
      if (!quantity || !(quantity.value > 0)) return { real: false, inTolerance: null, shown: 'no usable pass', why: okCalls(client) > 0 ? 'no pass gave a usable measurement' : firstError(client) }
      const inside = insideEnvelope(quantity.value)
      return {
        real: true,
        inTolerance: inside,
        shown: `${quantity.value} ${WALL_TARGET.unit} from ${quantity.passesUsed} passes (spread ${Math.round(quantity.cov * 100)}%)`,
        ...(!inside && { why: `${quantity.value} ${WALL_TARGET.unit} is outside ${WALL_ENVELOPE.min} to ${WALL_ENVELOPE.max}` }),
        note: [`passes agree within the pipeline's 15%: ${quantity.passesUsed >= 2 && quantity.cov <= 0.15 ? 'yes' : 'no (the pipeline would send it to the senior review)'}`, failedCalls(client).length > 0 ? `${failedCalls(client).length} of ${client.calls.length} passes failed (${firstError(client).slice(0, 80)})` : ''].filter(Boolean).join('; '),
      }
    },
  },
  // ── identification: reading a label ──
  {
    id: 'label-sample',
    task: 'identification',
    what: 'the demo’s sample water heater label: tank size and fuel',
    tolerance: 'exact, or left to a question: “50 gal” and “Natural gas”, never another value (verify-t153, t169, t171: “the sample label is read and priced (50 gal, natural gas: $2,150), or a range around it with a question”)',
    needs: [SAMPLE_LABEL],
    calls: 1,
    run: (client) => identificationCase(client, [photo(SAMPLE_LABEL)], HEATER.draft.expectedSignals as ExpectedSignals, { tank_capacity: '50 gal', water_heater_fuel: 'Natural gas' }),
  },
  {
    id: 'label-t139-sharp',
    task: 'identification',
    what: 'verify-t139’s sharp label: the size decoded from the model number',
    tolerance: 'exact, or left to a question: “Medium” (verify-t139: “legible label → decoded Medium”)',
    needs: [T139_SHARP],
    calls: 1,
    run: (client) => identificationCase(client, [photo(T139_SHARP)], T139_SIGNALS, { unit_size: 'Medium' }),
  },
  {
    id: 'label-t139-blurred',
    task: 'identification',
    what: 'verify-t139’s blurred label: nothing can be read',
    tolerance: 'no value at all (verify-t139: “unreadable label → direct question with the options”)',
    needs: [T139_BLURRED],
    calls: 1,
    run: (client) => identificationCase(client, [photo(T139_BLURRED)], T139_SIGNALS, {}),
  },
  // ── adjudication: the senior review of a measured quantity ──
  {
    id: 'adjudicate-s01',
    task: 'adjudication',
    what: 'the senior review of three disagreeing takeoffs (34, 52, 88) of scenario S01’s house front',
    tolerance: `${ENVELOPE_WORDS} (the same S01 rule), and its own low and high around its value`,
    needs: [S01_DIR],
    calls: 1,
    async run(client) {
      // the pipeline's own cap (30 s): past it the pass median is kept
      const result = await adjudicateMeasurement({ adjudicator: client, images: photosIn(S01_DIR), target: WALL_TARGET, measured: JUNIORS, customerScope: [] })
      if (!result) {
        const answered = okCalls(client) > 0
        return { real: false, inTolerance: null, shown: 'no review: the pass median is kept', why: answered ? 'the answer had no usable final value' : client.calls.length === 0 || failedCalls(client).every((c) => /abort/i.test(c.error ?? '')) ? 'slower than the review’s 30 s cap' : firstError(client) }
      }
      const ordered = result.band.low <= result.value && result.value <= result.band.high
      const inside = insideEnvelope(result.value) && ordered
      return {
        real: result.basis === 'adjudicated',
        inTolerance: inside,
        shown: `${result.value} ${WALL_TARGET.unit} (${result.band.low} to ${result.band.high})`,
        ...(!inside && { why: ordered ? `${result.value} ${WALL_TARGET.unit} is outside ${WALL_ENVELOPE.min} to ${WALL_ENVELOPE.max}` : 'its low and high do not sit around its value' }),
      }
    },
  },
  // ── wording: the text client (wording, the rewriter, the checker; also add-ons, the gate and cross-service) ──
  {
    id: 'wording-springs',
    task: 'wording',
    what: 'the wording of a spring-pair quote (verify-t172’s business: $400 minimum, sales tax), then the pipeline’s own repair of banned words',
    tolerance: 'no banned customer word is left after the pipeline’s repair, and nothing is left unrepaired (the guard of verify-t148 step a and T-147: findConfidenceLanguageInPayload)',
    needs: [],
    calls: 2,
    async run(client) {
      const written = await withAiTimeout('wording', aiCallTimeoutMs('wording'), () => generateWording(client, WORDING_CONTEXT)).catch((error) => error as Error)
      if (written instanceof AiCallTimeoutError) return { real: false, inTolerance: null, shown: 'no wording', why: `slower than the wording’s ${written.timeoutMs / 1000} s cap (T-172): the quote would get the template wording` }
      if (written instanceof Error) return { real: false, inTolerance: null, shown: 'no wording', why: written.message.slice(0, 200) }
      const fallback = JSON.stringify(written) === JSON.stringify(getDefaultContent(WORDING_CONTEXT))
      const shaped = typeof written.scopeSummary === 'string' && written.scopeSummary.trim().length > 0 && Array.isArray(written.assumptions) && Array.isArray(written.exclusions)
      if (fallback || !shaped || okCalls(client) === 0) return { real: false, inTolerance: null, shown: 'the default wording', why: okCalls(client) > 0 ? 'the answer could not be read as wording' : firstError(client) }
      // the pipeline's own repair (quote-processor.ts, step 4.7): the business's own text is masked and left as typed
      const businessPhrases = businessPhrasesFrom({
        serviceName: SPRING.name,
        serviceDescription: SPRING.description,
        scopeIncludes: SPRING.draft.scope.included,
        scopeExcludes: SPRING.draft.scope.excluded,
        defaultAssumptions: SPRING.draft.scope.assumptions,
        addonLabels: (SPRING.addons ?? []).map((a) => (a as { label: string }).label),
        workStepNames: (SPRING.draft.pricing.workSteps ?? []).map((ws) => ws.name),
      })
      const repaired = await repairCustomerWording(
        { scopeSummary: written.scopeSummary, assumptions: written.assumptions, exclusions: written.exclusions, notes: written.notes },
        { businessPhrases, path: 'generation', rewrite: createSentenceRewriter(client) }
      )
      const masked = (text: unknown) => (typeof text === 'string' ? maskBusinessText(text, businessPhrases) : '')
      const left = findConfidenceLanguageInPayload({
        scopeSummary: masked(repaired.wording.scopeSummary),
        assumptions: (repaired.wording.assumptions ?? []).map(masked),
        exclusions: (repaired.wording.exclusions ?? []).map(masked),
        notes: masked(repaired.wording.notes),
      })
      const clean = repaired.unresolved.length === 0 && left.length === 0
      return {
        real: true,
        inTolerance: clean,
        shown: `${written.scopeSummary.length} characters of scope, ${written.assumptions.length} assumptions, ${written.exclusions.length} exclusions; ${repaired.record.rewritten.length} sentences rewritten, ${repaired.record.removed.length} removed`,
        ...(!clean && { why: `banned words left: ${[...repaired.unresolved.map(String), ...left].join('; ').slice(0, 200)}` }),
        ...(failedCalls(client).length > 0 && { note: `the structured call failed first (${firstError(client).slice(0, 80)}); the text fallback answered` }),
      }
    },
  },
  {
    id: 'rewrite-t148',
    task: 'wording',
    what: 'verify-t148 step a: three sentences with a banned word, through the worker’s rewriter',
    tolerance: 'all three rewritten, none removed, the guard passes, one call inside 15 s (verify-t148 step a)',
    needs: [],
    calls: 1,
    async run(client) {
      const started = Date.now()
      const live = await repairCustomerWording(
        {
          scopeSummary: 'Replace your single garage door with a new steel sectional door. We will confirm the exact dimensions before ordering.',
          assumptions: ['This firm price assumes the opening is a standard size.'],
          notes: 'Thanks for your request. This is a preliminary figure based on your photos.',
        },
        { businessPhrases: [], path: 'generation', rewrite: createSentenceRewriter(client) }
      )
      const ms = Date.now() - started
      if (okCalls(client) === 0) return { real: false, inTolerance: null, shown: 'no rewrite: the sentences were removed in code', why: client.calls.length === 0 ? 'the rewriter was never called' : firstError(client) }
      const clean = live.record.rewritten.length === 3 && live.record.removed.length === 0 && findConfidenceLanguageInPayload(live.wording).length === 0 && live.unresolved.length === 0 && ms < 15_000
      return {
        real: true,
        inTolerance: clean,
        shown: `${live.record.rewritten.length} rewritten, ${live.record.removed.length} removed, ${ms} ms`,
        ...(!clean && { why: ms >= 15_000 ? 'slower than the rewriter’s 15 s' : `${live.record.rewritten.length} of 3 rewritten, ${live.record.removed.length} removed, ${findConfidenceLanguageInPayload(live.wording).length} banned words left` }),
      }
    },
  },
  {
    id: 'checker-right',
    task: 'wording',
    what: 'the quote checker on a correct quote (the minimum applied, tax added)',
    tolerance: 'no finding about the minimum, tax, currency or total (verify-t172’s control, isSettingsFlag)',
    needs: [],
    calls: 1,
    async run(client) {
      const quote = { pricing: springPricing(RIGHT_BREAKDOWN, 400), content: SPRING_CONTENT }
      const result = await withAiTimeout('checker', aiCallTimeoutMs('checker'), () => validateQuote(client, quote, SPRING_REQUEST, SPRING_SERVICE)).catch((error) => error as Error)
      if (result instanceof AiCallTimeoutError) return { real: false, inTolerance: null, shown: 'no answer', why: `slower than the checker’s ${result.timeoutMs / 1000} s cap (T-172): the quote would go out unchecked` }
      if (result instanceof Error) return { real: false, inTolerance: null, shown: 'no answer', why: result.message.slice(0, 200) }
      if (okCalls(client) === 0) return { real: false, inTolerance: null, shown: 'the default “pass”', why: firstError(client) }
      const falseFlags = result.issues.filter((i) => isSettingsFlag({ check: i.check, category: i.category, severity: i.severity, description: i.description }))
      return {
        real: typeof result.overallStatus === 'string' && Array.isArray(result.issues),
        inTolerance: falseFlags.length === 0,
        shown: `${result.overallStatus}, ${result.issues.length} findings`,
        ...(falseFlags.length > 0 && { why: `a false finding about money: ${falseFlags.map((f) => f.check).join('; ').slice(0, 160)}` }),
      }
    },
  },
  {
    id: 'checker-invented-line',
    task: 'wording',
    what: 'the quote checker on a quote with a line the business never configured (“Administration fee”)',
    tolerance: 'flagged within two tries (verify-t172: “the checker still flags a line the business never configured”)',
    needs: [],
    calls: 1,
    run: (client) => checkerFlags(client, { pricing: springPricing([{ label: 'Torsion spring replacement (pair)', amount: 375 }, { label: 'Administration fee', amount: 60 }], 435), content: SPRING_CONTENT }, /administration fee|invented|not (found )?in (the )?config|unconfigured|unauthori[sz]ed/i),
  },
  {
    id: 'checker-under-minimum',
    task: 'wording',
    what: 'the quote checker on a $200 pair of springs, under the $400 minimum',
    tolerance: 'flagged within two tries (verify-t172: “the checker still flags a quote priced under the configuration”)',
    needs: [],
    calls: 1,
    run: (client) => checkerFlags(client, { pricing: springPricing([{ label: 'Torsion spring replacement (pair)', amount: 200 }], 200), content: SPRING_CONTENT }, /minimum|underpric|expected|less than|below|375|400/i),
  },
]

// ───────────────────────────── running ─────────────────────────────

interface Run { outcome: Outcome; ms: number; calls: number; failedCalls: number; errors: string[] }
interface SideResult { model: string; provider: string; ran: boolean; whyNot?: string; runs: Record<string, Run[]>; usage?: AiUsageSummary }

/** The worker's functions log as they go; here that noise is kept out of the table */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const saved = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = () => undefined
  try {
    return await work()
  } finally {
    Object.assign(console, saved)
  }
}

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const money = (usd: number | undefined) => (usd === undefined ? 'n/a' : `$${usd.toFixed(4)}`)

async function runSide(task: AiTask, route: ModelRoute, cases: ProofCase[], overflow: boolean): Promise<SideResult> {
  const side: SideResult = { model: route.model, provider: route.provider, ran: false, runs: {} }
  const meter = new AiUsageMeter()
  const client = clientFor(task, route, meter, overflow)
  if (!client) return { ...side, whyNot: `no key: ${KEY_NAME[route.provider]} is not set (environment or apps/worker/.dev.vars)` }
  side.ran = true
  for (const proofCase of cases) {
    side.runs[proofCase.id] = []
    for (let repeat = 0; repeat < REPEATS; repeat++) {
      const probe = new Probe(client)
      const started = Date.now()
      let outcome: Outcome
      try {
        outcome = await quietly(() => proofCase.run(probe))
      } catch (error) {
        // a function that throws instead of falling back: the pipeline would lose the step
        outcome = { real: false, inTolerance: null, shown: 'the function threw', why: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200) }
      }
      side.runs[proofCase.id]!.push({ outcome, ms: Date.now() - started, calls: probe.calls.length, failedCalls: failedCalls(probe).length, errors: failedCalls(probe).map((c) => c.error ?? '') })
      process.stdout.write(`    ${overflow ? 'overflow' : 'own model'}  ${proofCase.id.padEnd(22)} ${outcome.real ? 'real' : 'FALLBACK'}  ${outcome.inTolerance === null ? '-' : outcome.inTolerance ? 'inside' : 'OUTSIDE'}  ${seconds(Date.now() - started)}\n`)
    }
  }
  side.usage = meter.summary()
  return side
}

const allReal = (runs: Run[] | undefined) => !!runs && runs.length > 0 && runs.every((r) => r.outcome.real)
const allInside = (runs: Run[] | undefined) => !!runs && runs.length > 0 && runs.every((r) => r.outcome.inTolerance !== false)
const yesNo = (value: boolean | undefined) => (value === undefined ? '—' : value ? 'pass' : 'FAIL')

interface TaskReport {
  task: AiTask
  own: SideResult
  overflow: SideResult | null
  candidateFrom: string
  cases: Array<{ id: string; what: string; tolerance: string; skipped?: string }>
  verdict: string
  proven: boolean
  switchOn?: { registry: string; env: string }
}

async function proveTask(task: AiTask): Promise<TaskReport> {
  const own = resolveModelRoute(task, routeEnv)
  const { route: candidate, from } = candidateFor(task)
  const selected = CASES.filter((c) => c.task === task && (!ONLY_CASE || c.id === ONLY_CASE))
  const runnable = selected.filter((c) => c.needs.every((file) => existsSync(path.join(ROOT, file))))
  const cases = selected.map((c) => {
    const missing = c.needs.filter((file) => !existsSync(path.join(ROOT, file)))
    return { id: c.id, what: c.what, tolerance: c.tolerance, ...(missing.length > 0 && { skipped: `not on this machine: ${missing.join(', ')}` }) }
  })
  console.log(`\n${task}: own model ${own.provider}:${own.model}; overflow ${candidate ? `${candidate.provider}:${candidate.model}` : 'none named'} (from ${from})`)

  // With no key for the overflow model there is nothing to compare: nothing is asked of either model
  if (!PRIMARY_ONLY && candidate && !KEYS[candidate.provider]) {
    const whyNot = `no key: ${KEY_NAME[candidate.provider]} is not set (environment or apps/worker/.dev.vars)`
    return {
      task,
      own: { model: own.model, provider: own.provider, ran: false, whyNot: 'not asked: the overflow model cannot be asked', runs: {} },
      overflow: { model: candidate.model, provider: candidate.provider, ran: false, whyNot, runs: {} },
      candidateFrom: from,
      cases,
      verdict: `not proven: ${whyNot}`,
      proven: false,
    }
  }

  const ownSide = await runSide(task, own, runnable, false)
  let overflowSide: SideResult | null = null
  if (!PRIMARY_ONLY && candidate) overflowSide = await runSide(task, candidate, runnable, true)

  const report: TaskReport = { task, own: ownSide, overflow: overflowSide, candidateFrom: from, cases, verdict: '', proven: false }
  const skipped = cases.filter((c) => c.skipped).map((c) => c.id)
  const skippedWords = skipped.length > 0 ? ` (not run here, the photos are local only: ${skipped.join(', ')})` : ''

  if (PRIMARY_ONLY) {
    const good = ownSide.ran && runnable.every((c) => allReal(ownSide.runs[c.id]) && allInside(ownSide.runs[c.id]))
    report.verdict = !ownSide.ran ? `not run: ${ownSide.whyNot}` : `own model only: ${good ? 'every case passes on the task’s own model' : 'a case fails on the task’s own model (see the table)'}; the overflow model was not asked${skippedWords}`
    return report
  }
  if (!candidate) {
    report.verdict = 'not proven: no overflow model is named (the registry has no overflowCandidate and AI_OVERFLOW_' + task.toUpperCase() + ' is not set)'
    return report
  }
  if (candidate.provider === own.provider && candidate.model === own.model) {
    report.verdict = 'not proven: the overflow model is the task’s own model'
    return report
  }
  if (!overflowSide?.ran) {
    report.verdict = `not proven: ${overflowSide?.whyNot ?? 'no key'}`
    return report
  }
  if (runnable.length === 0) {
    report.verdict = `not proven: no case could run${skippedWords}`
    return report
  }
  const reasons: string[] = []
  const unsure: string[] = []
  for (const proofCase of runnable) {
    const overflowRuns = overflowSide.runs[proofCase.id]
    const ownRuns = ownSide.runs[proofCase.id]
    const overflowGood = allReal(overflowRuns) && allInside(overflowRuns)
    const ownGood = ownSide.ran && allReal(ownRuns) && allInside(ownRuns)
    if (!overflowGood) {
      const bad = overflowRuns?.find((r) => !r.outcome.real || r.outcome.inTolerance === false)
      const why = `${proofCase.id}: ${bad?.outcome.why ?? 'failed'}`
      // a case the task's own model fails too does not tell the two models apart
      if (ownGood) reasons.push(why)
      else unsure.push(`${why} (the task’s own model fails this case too)`)
    }
  }
  if (reasons.length > 0) report.verdict = `fail: keep none, because ${reasons.join(' | ')}`
  else if (unsure.length > 0) report.verdict = `not proven: keep none, because ${unsure.join(' | ')}`
  else {
    report.proven = true
    report.verdict = `pass: may be switched on${skippedWords}`
    report.switchOn = {
      registry: `packages/shared/src/ai-models.json → tasks.${task}: "overflow": { "provider": "${candidate.provider}", "model": "${candidate.model}" }`,
      env: `AI_OVERFLOW_${task.toUpperCase()}=${candidate.provider}:${candidate.model}`,
    }
  }
  return report
}

function printReport(report: TaskReport) {
  const { own, overflow } = report
  console.log(`\n── ${report.task} ──`)
  console.log(`   own model: ${own.provider}:${own.model}${own.ran ? '' : `  (${own.whyNot})`}`)
  console.log(`   overflow:  ${overflow ? `${overflow.provider}:${overflow.model}${overflow.ran ? '' : `  (${overflow.whyNot})`}` : PRIMARY_ONLY ? 'not asked (--primary-only)' : 'none'}`)
  const line = (cells: string[]) => console.log('   ' + [cells[0]!.padEnd(22), cells[1]!.padEnd(10), cells[2]!.padEnd(6), cells[3]!.padEnd(10), cells[4]!.padEnd(9), cells[5]!.padEnd(7), cells[6] ?? ''].join(' '))
  line(['case', 'model', 'shape', 'tolerance', 'median', 'calls', 'what came back'])
  for (const proofCase of report.cases) {
    if (proofCase.skipped) {
      line([proofCase.id, '—', '—', '—', '—', '—', `skipped: ${proofCase.skipped}`])
      continue
    }
    for (const [label, side] of [['own', own], ['overflow', overflow]] as Array<[string, SideResult | null]>) {
      const runs = side?.runs[proofCase.id]
      if (!side?.ran || !runs || runs.length === 0) continue
      const last = runs[runs.length - 1]!
      const tolerance = runs.every((r) => r.outcome.inTolerance === null) ? 'shape only' : yesNo(allInside(runs))
      const failed = runs.reduce((sum, r) => sum + r.failedCalls, 0)
      line([proofCase.id, label, yesNo(allReal(runs)), tolerance, seconds(median(runs.map((r) => r.ms))), `${runs.reduce((s, r) => s + r.calls, 0)}${failed > 0 ? ` (${failed}✗)` : ''}`, last.outcome.shown.slice(0, 150)])
      const bad = runs.find((r) => r.outcome.why)
      if (bad) console.log(`   ${' '.repeat(22)} ↳ ${bad.outcome.why}`)
      const noted = runs.find((r) => r.outcome.note)
      if (noted) console.log(`   ${' '.repeat(22)} · ${noted.outcome.note}`)
    }
    console.log(`   ${' '.repeat(22)} tolerance: ${proofCase.tolerance}`)
  }
  for (const [label, side] of [['own model', own], ['overflow', overflow]] as Array<[string, SideResult | null]>) {
    if (!side?.usage) continue
    const u = side.usage
    console.log(`   ${label}: ${u.calls} calls, ${u.inputTokens} tokens in, ${u.outputTokens} out, ${u.unpricedModels.length > 0 ? `no price in the registry for ${u.unpricedModels.join(', ')}` : money(u.estimatedCostUsd)}`)
  }
  console.log(`   VERDICT ${report.task}: ${report.verdict}`)
  if (report.switchOn) {
    console.log(`   to switch it on, either: ${report.switchOn.registry}`)
    console.log(`                        or: ${report.switchOn.env}  (the worker's setting; no code deploy)`)
  }
}

// ───────────────────────────── main ─────────────────────────────

const tasks = PIPELINE_TASKS.filter((task) => !ONLY_TASK || task === ONLY_TASK)
if (tasks.length === 0) {
  console.error(`No such task: ${ONLY_TASK}. The pipeline's tasks are ${PIPELINE_TASKS.join(', ')}.`)
  process.exit(1)
}
if (ONLY_CASE && !CASES.some((c) => c.id === ONLY_CASE)) {
  console.error(`No such case: ${ONLY_CASE}. The cases are ${CASES.map((c) => c.id).join(', ')}.`)
  process.exit(1)
}

console.log('Overflow proof (T-203): each task on its own model and on the overflow model, same function, same inputs, the pipeline’s own time limits.')
console.log(`Keys: ${(['gemini', 'anthropic'] as const).map((p) => `${KEY_NAME[p]} ${KEYS[p] ? 'set' : 'NOT SET'}`).join(', ')}.${PRIMARY_ONLY ? ' Own models only (--primary-only).' : ''}`)

const reports: TaskReport[] = []
for (const task of tasks) {
  if (ONLY_CASE && !CASES.some((c) => c.task === task && c.id === ONLY_CASE)) continue
  reports.push(await proveTask(task))
}
for (const report of reports) printReport(report)

console.log('\nSummary')
for (const report of reports) console.log(`   ${report.task.padEnd(16)} ${report.verdict}`)
console.log('   Not covered by any fixed set in the existing checks (same text client as “wording”): add-on detection, the question gate, cross-service notes, recommendations.')

const outDir = path.join(ROOT, 'scripts/load-test/results')
mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outFile = path.join(outDir, `overflow-proof-${stamp}.json`)
writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), primaryOnly: PRIMARY_ONLY, repeats: REPEATS, envelope: WALL_ENVELOPE, reports }, null, 2))
console.log(`\nSaved: ${outFile}`)

if (PRIMARY_ONLY) {
  const good = reports.every((r) => r.own.ran && Object.values(r.own.runs).every((runs) => allReal(runs) && allInside(runs)))
  process.exit(good ? 0 : 1)
}
const noKey = reports.some((r) => r.verdict.startsWith('not proven: no key'))
process.exit(reports.every((r) => r.proven) ? 0 : noKey ? 2 : 1)
