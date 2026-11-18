// T-179, OPTIONAL: what the REAL AI model finds when a customer explicitly asks for another of the
// business's services in their note, and what the checks in code then keep.
//
// This is not part of the regression set and is never a gate. A live model's answers vary a
// little from run to run, so a check on them cannot be pass-or-fail: this script reports what the
// model did and what was kept, and always exits 0 once it has run. The rules themselves are pinned
// by the worker's unit tests (model stood in for) and by verify-t179.mts (model stood in for).
//
// Why it exists: on 18 November 2026 a customer of a business with three services chose one and
// wrote "I also want painting for skirting and ceilings." The model named the right other service
// with high confidence, and a check in code threw the answer away (AD-064 in Docs/CHANGELOG.md).
// The stand-in in verify-t179 could not show that: the mistake was in what code did with a real
// answer. So the first case below is that note, word for word, and the rest are other ways a
// customer explicitly asks for something extra.
//
// Nothing is needed running: it calls the worker's own detection code with the worker's own model
// for that step, using the key in apps/worker/.dev.vars. It makes about 8 small text calls. No
// request is made, nothing is stored, nothing is sent to anyone.
//
// The business is the painting pack as it ships (apps/web/src/lib/vertical-packs/painting-us.ts):
// three services, the customer chooses the wallpaper one.
//
// Run:  npx tsx scripts/hardcore-test/verify-t179-live.mts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib.mjs'
import { createAiClient } from '../../apps/worker/src/ai/factory'
import { buildDetectionPrompt, validateDetection } from '../../apps/worker/src/ai/service-detection'
import type { MainServiceContext, ServiceForMatching } from '../../apps/worker/src/ai/service-detection'
import { GeminiClient } from '../../apps/worker/src/ai/gemini'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'

const vars = readFileSync(path.join(ROOT, 'apps/worker/.dev.vars'), 'utf8')
const setting = (name: string) => vars.match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'))?.[1]?.trim()
const env = { GEMINI_API_KEY: setting('GEMINI_API_KEY'), ANTHROPIC_API_KEY: setting('ANTHROPIC_API_KEY'), AI_MODEL_WORDING: setting('AI_MODEL_WORDING') }
// the same client the worker gives the detection step (the text model)
const client = createAiClient('wording', env as never)
if (!client) {
  console.error('No AI key in apps/worker/.dev.vars, so there is no live model to ask. Nothing was checked.')
  process.exit(2)
}

// ---------- the business: the painting pack as it ships ----------
const [interior, exterior, wallpaper] = paintingPackUS.services
if (!interior || !exterior || !wallpaper) throw new Error('the painting pack no longer has three services')
const main: MainServiceContext = {
  name: wallpaper.name,
  description: wallpaper.description,
  scopeIncludes: wallpaper.draft.scope.included,
  scopeExcludes: wallpaper.draft.scope.excluded,
  addons: (wallpaper.addons ?? []).map((a) => a.label),
}
const others: ServiceForMatching[] = [interior, exterior].map((s, i) => ({
  id: `svc_live_${i + 1}`,
  name: s.name,
  description: s.description,
  scopeIncludes: s.draft.scope.included,
  scopeExcludes: s.draft.scope.excluded,
  addons: (s.addons ?? []).map((a) => a.label),
}))
const idOf = (service: { name: string }) => others.find((o) => o.name === service.name)!.id

// ---------- the notes ----------
/** [the customer's note, the service a card is expected for] */
const EXPLICIT: Array<[string, string]> = [
  // the note from production, exactly as stored (the two spaces are the customer's)
  ['I also want painting for skirting and ceilings.  Brilliant White paint.', idOf(interior)],
  // the same request as the owner retyped it
  ['I also want painting for skirtings and ceilings. I want Brilliant White Paint.', idOf(interior)],
  // asked as a question: still asking for it
  ['Seven walls to paper in the hall and stairs. Could you also paint the ceilings while you are here?', idOf(interior)],
  // the customer's own word for it, which is in no service's name
  ['Paper for the lounge please. We would like the skirting boards done in white too.', idOf(interior)],
  // the other of the two services
  ['Wallpaper for the dining room. I also need the outside of the house painted this spring.', idOf(exterior)],
  // names the service outright
  ['Two feature walls to paper. Please add interior painting for the hallway as well.', idOf(interior)],
]
/** Notes that must NOT produce a card for another service */
const NOT_A_REQUEST: string[] = [
  'Seven walls to paper. The ceilings were painted last month, so no painting needed.',
  'Is painting the ceilings included in the wallpaper price?',
]

async function ask(note: string) {
  const raw = await client!.generateText(buildDetectionPrompt(main, note, others))
  const parsed = GeminiClient.parseJSON<{ requests?: Array<{ serviceId?: string | null; confidence?: number; matchedPhrase?: string }> }>(raw)
  // the checks in code print one line per answer they drop: collect them, so the report says which
  const dropped: string[] = []
  const log = console.log
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ')
    if (/REJECTING|Skipping/.test(line)) dropped.push(line.replace('[ServiceDetection] ', ''))
  }
  let kept
  try {
    kept = validateDetection(parsed, main, note, others)
  } finally {
    console.log = log
  }
  return { model: parsed?.requests ?? [], kept, dropped }
}
const nameOf = (id: string | null | undefined) => others.find((o) => o.id === id)?.name ?? (id === null || id === undefined ? 'none of the services' : String(id))
const said = (requests: Array<{ serviceId?: string | null; confidence?: number; matchedPhrase?: string }>) =>
  requests.length === 0 ? 'nothing' : requests.map((r) => `${nameOf(r.serviceId)} (${r.confidence}) for "${r.matchedPhrase}"`).join('; ')

console.log(`The customer chose "${main.name}". The business also offers: ${others.map((o) => o.name).join(', ')}.`)
console.log('\n== An explicit request for another offered service: a card is expected')
let cards = 0
let droppedByCode = 0
for (const [note, expected] of EXPLICIT) {
  const result = await ask(note)
  const card = result.kept.services.some((s) => s.serviceId === expected)
  if (card) cards++
  const modelFound = result.model.some((r) => r.serviceId === expected)
  if (modelFound && !card) droppedByCode++
  console.log(`${card ? 'card   ' : 'NO CARD'}  ${note}`)
  console.log(`         the model: ${said(result.model)}`)
  if (!card) console.log(`         ${modelFound ? `DROPPED BY A CHECK IN CODE: ${result.dropped.join(' | ') || '(no reason logged)'}` : `the model did not name ${nameOf(expected)}`}`)
}
console.log('\n== Not a request for extra work: no card is expected')
let quiet = 0
for (const note of NOT_A_REQUEST) {
  const result = await ask(note)
  const ok = result.kept.services.length === 0
  if (ok) quiet++
  console.log(`${ok ? 'no card' : 'CARD   '}  ${note}`)
  console.log(`         the model: ${said(result.model)}${result.dropped.length ? `\n         checks in code: ${result.dropped.join(' | ')}` : ''}`)
}

console.log(`\nLive model, this run: ${cards} of ${EXPLICIT.length} explicit requests got a card; ${quiet} of ${NOT_A_REQUEST.length} notes that ask for nothing extra got none.`)
if (droppedByCode > 0) console.log(`${droppedByCode} right answer(s) of the model were dropped by a check in code. That is the kind of miss this script exists to show: it is a bug in the checks, not in the model.`)
console.log('This is a report, not a gate: answers vary between runs.')
process.exit(0)
