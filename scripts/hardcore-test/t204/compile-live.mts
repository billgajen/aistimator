// T-204, items 1 and 5: "Describe your pricing" asked of the REAL model, then priced by the engine.
//
//   npx tsx --tsconfig apps/web/tsconfig.json scripts/hardcore-test/t204/compile-live.mts [--repeats 3] [--thinking low|medium|high|default] [--model <id>]
//
// It compiles the AC Tune-Up description (the ticket's live example) and prices the ticket's cases
// with the worker's rules engine: 129 (1 system), 263 (2 systems, one in the attic), 323 (2 systems,
// attic, weekend), and refrigerant 0 when its box is left empty. It prints how long each compile
// took, what the code tied after the model's answer, and the flags that are left.
//
// It asks a real model, so it costs a little (about a cent a compile) and its answer varies:
// this is a check to run by hand, not a gate (see Docs/testing.md).
// The key is read from the environment or apps/web/.env.local and is never printed.
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { callGemini } from '../../../apps/web/src/app/api/services/ai-draft/shared'
import { COMPILE_SYSTEM_PROMPT, compileUserPrompt, finishCompile } from '../../../apps/web/src/lib/pricing-compile'
import { calculatePricingWithTrace, type PricingRules, type FormAnswer } from '../../../apps/worker/src/pricing/rules-engine'
import { regionPromptBlock, resolveRegionContext } from '../../../packages/shared/src/regions/index'
import { resolveModelRoute, resolveThinkingLevel } from '../../../packages/shared/src/ai-models'
import { AC_TUNE_UP_TEXT } from './ac-tune-up'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)
const valueOf = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const REPEATS = Math.max(1, Number(valueOf('--repeats') ?? 1) || 1)
if (valueOf('--thinking')) process.env.AI_THINKING_COMPILE = valueOf('--thinking')
if (valueOf('--model')) process.env.AI_MODEL_COMPILE = valueOf('--model')

function keyFromFile(): string | undefined {
  const file = path.join(ROOT, 'apps/web/.env.local')
  if (!existsSync(file)) return undefined
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('GEMINI_API_KEY='))
  return line?.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '') || undefined
}
const apiKey = process.env.GEMINI_API_KEY?.trim() || keyFromFile()
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set (environment or apps/web/.env.local).')
  process.exit(2)
}

const route = resolveModelRoute('compile', process.env)
console.log(`Model: ${route.provider}:${route.model}, thinking: ${resolveThinkingLevel('compile', route.model, process.env) ?? "the model's own default"}`)

const legacy = { category: 'test', materials: [], condition: { rating: 'good' }, complexity: { level: 'medium', factors: [] }, access: { difficulty: 'easy' }, observations: [], warnings: [], confidence: 0.9, siteVisitRecommended: false }
const structured = () => ({ extractedAt: new Date().toISOString(), overallConfidence: 0.95, signals: [], complexity: { level: 'medium', factors: [] }, siteVisitRecommended: false, lowConfidenceSignals: [] })

type Field = { fieldId: string; label: string; type: string; required?: boolean; options?: string[] }
let failures = 0
const times: number[] = []

for (let run = 1; run <= REPEATS; run++) {
  const body = { description: AC_TUNE_UP_TEXT, serviceName: 'AC Tune-Up', currency: 'USD' }
  const started = Date.now()
  const text = await callGemini({ apiKey, systemPrompt: COMPILE_SYSTEM_PROMPT, userPrompt: compileUserPrompt(body, regionPromptBlock(resolveRegionContext({ region: 'US', currency: 'USD' }))), temperature: 0.2, maxOutputTokens: 16384 })
  const seconds = (Date.now() - started) / 1000
  times.push(seconds)
  const compiled = finishCompile(text, body)
  const steps = compiled.updatedConfig.pricing.workSteps
  const fields = compiled.updatedConfig.suggestedFields as Field[]

  // Which question is which, from what each one is (the compile names them itself)
  const count = fields.find((f) => f.type === 'number' && /system|unit/i.test(f.label) && !/refrigerant|pound|lb/i.test(f.label))
  const place = fields.find((f) => (f.options ?? []).some((o) => /attic/i.test(o)))
  const attic = place?.options?.find((o) => /attic/i.test(o))
  const elsewhere = place?.options?.find((o) => !/attic/i.test(o))
  const atticTick = fields.find((f) => f.type === 'boolean' && /attic/i.test(f.label))
  const weekend = fields.find((f) => /weekend/i.test(f.label))
  const weekendValue = (on: boolean) => (weekend?.type === 'boolean' ? on : weekend?.options?.find((o) => /weekend/i.test(o) === on) ?? on)
  const refrigerant = fields.find((f) => f.type === 'number' && /refrigerant|pound|lb/i.test(f.label))

  const price = (systems: number, inAttic: boolean, onWeekend: boolean, pounds?: number) => {
    const answers: FormAnswer[] = []
    if (count) answers.push({ fieldId: count.fieldId, value: systems })
    if (place) answers.push({ fieldId: place.fieldId, value: (inAttic ? attic : elsewhere) ?? '' })
    if (atticTick) answers.push({ fieldId: atticTick.fieldId, value: inAttic })
    if (weekend) answers.push({ fieldId: weekend.fieldId, value: weekendValue(onWeekend) })
    if (refrigerant && pounds !== undefined) answers.push({ fieldId: refrigerant.fieldId, value: pounds })
    const rules = { baseFee: compiled.updatedConfig.pricing.baseFee, minimumCharge: compiled.updatedConfig.pricing.minimumCharge, addons: compiled.addons, multipliers: compiled.multipliers, workSteps: steps } as unknown as PricingRules
    const quiet = console.log
    console.log = console.warn = () => undefined
    try {
      return calculatePricingWithTrace(rules, legacy as never, structured() as never, answers, { enabled: false, rate: 0, label: 'Sales tax' }, 'USD', undefined, undefined, undefined, { name: 'AC Tune-Up', fields: fields as never }).result
    } finally {
      console.log = quiet
      console.warn = quiet
    }
  }

  const cases: Array<[string, number, number]> = [
    ['1 system', price(1, false, false).subtotal, 129],
    ['2 systems, one in the attic', price(2, true, false).subtotal, 263],
    ['2 systems, attic, weekend', price(2, true, true).subtotal, 323],
    ['1 system, 2 lb refrigerant', price(1, false, false, 2).subtotal, 319],
  ]
  const refrigerantEmpty = !price(1, false, false).breakdown.some((line) => /refrigerant/i.test(line.label))
  const ok = cases.every(([, got, want]) => got === want) && refrigerantEmpty
  if (!ok) failures += 1

  console.log(`\nRun ${run}: ${seconds.toFixed(1)} s, ${steps.length} lines, ${fields.length} questions, ${compiled.addons.length} add-ons, ${compiled.ambiguities.length} questions back to the business`)
  for (const step of steps) console.log(`   line  ${step.name}: ${step.costType} ${step.defaultCost}${step.when ? `  when ${step.when.fieldId} ${step.when.operator} ${String(step.when.equals ?? step.when.value)}` : ''}${step.quantitySource ? `  qty ${step.quantitySource.type}${step.quantitySource.formula ? ` ${step.quantitySource.formula}` : step.quantitySource.fieldId ? ` ${step.quantitySource.fieldId}${step.quantitySource.missingMeansZero ? ' (empty = 0)' : ''}` : ''}` : ''}`)
  for (const field of fields) console.log(`   asks  ${field.label} [${field.type}${field.required ? ', required' : ''}]`)
  for (const repair of compiled.linked) console.log(`   tied by code: ${repair.name}: ${repair.what}`)
  for (const flag of compiled.flags) console.log(`   FLAG ${flag.kind}: ${flag.kind === 'question_unused' ? `"${flag.label}"` : ''} ${flag.message}`)
  for (const [what, got, want] of cases) console.log(`   ${got === want ? 'ok  ' : 'FAIL'} ${what}: ${got} (wanted ${want})`)
  console.log(`   ${refrigerantEmpty ? 'ok  ' : 'FAIL'} refrigerant left empty: ${refrigerantEmpty ? 'no line' : 'charged'}`)
}

const sorted = [...times].sort((a, b) => a - b)
console.log(`\n${REPEATS - failures} of ${REPEATS} compiles gave the four prices. Time: median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} s, slowest ${sorted[sorted.length - 1]!.toFixed(1)} s.`)
process.exit(failures === 0 ? 0 : 1)
