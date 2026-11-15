// T-168: generate candidate hero photographs with Google's Gemini image API.
//
//   node scripts/design/generate-hero-photos.mjs --scene a            one attempt at scene a
//   node scripts/design/generate-hero-photos.mjs --scene a --dry      print the prompt, call nothing
//   node scripts/design/generate-hero-photos.mjs --list               the scenes and the calls made so far
//
// What it does: one call per run. It sends one prompt and saves the image it
// gets back into an OUT folder OUTSIDE the repo (candidates are never
// committed; the chosen ones are converted by photos-to-webp.mjs).
//
// The key: GEMINI_API_KEY, the same variable the worker and the web app use.
// It is read from the environment, or from apps/web/.env.local when the
// environment has none. It is sent only to Google and is never printed.
//
// The model: HERO_IMAGE_MODEL, default `gemini-3-pro-image` ("Nano Banana
// Pro"), which Google's image-generation guide describes as the premium
// choice for professional assets (checked 2026-11-15; the other current ids
// are gemini-nano-banana-2.1, gemini-3.1-flash-image and
// gemini-3.1-flash-lite-image). The endpoint, the request shape and the
// sizes are the guide's: POST /v1beta/interactions, response_format
// { type: "image", aspect_ratio, image_size }.
//
// Limits it enforces itself (the ticket's): three attempts per scene, twelve
// calls in all. The count is kept in OUT/ledger.json; a call that returns no
// image is recorded as failed and does not count as an attempt.
//
// Rules for the pictures (Docs/design/system.md, Imagery): a situation, never
// a named or implied customer; no brand names or logos; no text and no phone
// or tablet screen drawn by the image model; one art direction for every
// photo. Every generated image carries Google's SynthID watermark.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MODEL = process.env.HERO_IMAGE_MODEL || 'gemini-3-pro-image'
const OUT = process.env.HERO_PHOTOS_OUT || path.join(os.tmpdir(), 'qolumns-hero-photos')
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MAX_PER_SCENE = 3
const MAX_CALLS = 12

/** One art direction for every photograph (system.md, Imagery) */
export const ART_DIRECTION = [
  'A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest.',
  'Natural daylight only. An ordinary American home or residential street. Calm and warm.',
  'Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture.',
  'The person is absorbed in what they are doing and is not looking at the camera. No posed smile. An ordinary working adult, not a model.',
  'Hands are natural and correct, with five fingers each.',
  'Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.',
].join(' ')

/** The same frame for every hero: where the subject sits, and the calm side the words go on */
export const COMPOSITION = [
  'A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field.',
  'The subject stands entirely in the right third of the frame, seen from the knees or waist up, with their whole head inside the frame and clear space above it.',
  'The left 55 percent of the frame is calm, light and nearly empty: PLACEHOLDER. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.',
].join(' ')

/** What must not appear, said plainly in every prompt */
export const NEVER = [
  'There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate.',
  'No logos and no brand names on any vehicle, clothing, tool or device.',
  'Any phone or tablet is seen from behind or edge-on; its screen is not visible.',
  'No recognisable real person.',
].join(' ')

export const SCENES = {
  a: {
    title: 'A contractor beside a work van in a driveway, looking down at a phone',
    calm: 'the pale siding of a house and a soft, bright overcast sky, out of focus',
    scene:
      'A contractor in their forties in a plain dark green work jacket stands beside a plain white work van parked in a suburban driveway, looking down at a phone held in one hand. The van has no lettering, no stripes and no logo. A small plain yellow tape measure is clipped to their belt; it is a plain yellow case with no label, no sticker and no markings of any kind.',
  },
  b: {
    title: 'A painter on a porch with a roller set down, checking a phone',
    calm: 'a freshly painted pale off-white porch wall in soft even light',
    scene:
      'A house painter in paint-flecked white overalls stands on the wooden front porch of an American house, checking a phone held in one hand. A paint roller rests in a tray on the porch boards beside them, and a deep juniper green front door is behind them. The only yellow is the handle of a small tape measure on the porch rail.',
  },
  c: {
    title: 'A homeowner in a garage photographing the label on a water heater',
    calm: 'a plain pale painted garage wall lit by daylight from the open garage door',
    scene:
      'A homeowner in their thirties in a casual juniper green sweater stands in a tidy residential garage, holding a phone up with both hands to photograph a tall white water heater tank that stands at the far right edge of the frame. The camera faces the homeowner from the front and slightly to one side, so we see their face in three-quarter view and the plain dark back of the phone; the phone screen faces away from the camera and is never seen. The homeowner and the tank are both pushed to the far right of the picture, with the homeowner no further left than two thirds of the way across. The tank is plain white with no label, no sticker and no markings. A small plain yellow tape measure sits on a shelf.',
  },
  d: {
    title: 'A tradesperson at a kitchen table with a tablet and a tape measure, morning light',
    calm: 'a pale kitchen wall and a window with soft morning light, out of focus',
    scene:
      'A tradesperson in a plain juniper green work shirt sits at a wooden kitchen table in morning light, photographed from across the room so that their whole head, shoulders and the table are well inside the frame and they appear small in the picture. They are looking down at a tablet propped up in a plain grey folding case; the camera sees only the grey back of the case, never the screen. A yellow tape measure lies on the table. A plain mug stands beside it.',
  },
}

export function promptFor(id) {
  const s = SCENES[id]
  if (!s) throw new Error(`No scene "${id}" (use a, b, c or d)`)
  return [s.scene, COMPOSITION.replace('PLACEHOLDER', s.calm), ART_DIRECTION, NEVER].join('\n\n')
}

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  const file = path.join(ROOT, 'apps/web/.env.local')
  if (!existsSync(file)) return ''
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('GEMINI_API_KEY='))
  return line ? line.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : ''
}

function readLedger() {
  const file = path.join(OUT, 'ledger.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { calls: [] }
}
function writeLedger(ledger) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'ledger.json'), JSON.stringify(ledger, null, 1))
}

/** The first image in a reply, wherever the API put it (interactions: steps[].content[].data) */
function findImage(node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImage(item)
      if (found) return found
    }
    return null
  }
  if (typeof node.data === 'string' && node.data.length > 2000 && (node.type === 'image' || String(node.mime_type || node.mimeType || '').startsWith('image/'))) return node.data
  for (const value of Object.values(node)) {
    const found = findImage(value)
    if (found) return found
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  const ledger = readLedger()
  const made = (id) => ledger.calls.filter((c) => c.scene === id && c.ok).length
  if (args.includes('--list')) {
    for (const [id, s] of Object.entries(SCENES)) console.log(`${id}  ${made(id)}/${MAX_PER_SCENE}  ${s.title}`)
    console.log(`calls that returned an image: ${ledger.calls.filter((c) => c.ok).length}/${MAX_CALLS}; failed: ${ledger.calls.filter((c) => !c.ok).length}; folder: ${OUT}`)
    return
  }
  const id = args[args.indexOf('--scene') + 1]
  const prompt = promptFor(id)
  if (args.includes('--dry')) {
    console.log(prompt)
    return
  }
  if (made(id) >= MAX_PER_SCENE) throw new Error(`Scene ${id} already has ${MAX_PER_SCENE} attempts`)
  if (ledger.calls.filter((c) => c.ok).length >= MAX_CALLS) throw new Error(`${MAX_CALLS} images have been generated: that is the limit`)
  const key = loadKey()
  if (!key) throw new Error('GEMINI_API_KEY is not set (environment or apps/web/.env.local)')

  const attempt = made(id) + 1
  const started = Date.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: prompt, response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' } }),
  })
  const seconds = Math.round((Date.now() - started) / 100) / 10
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON: reported below
  }
  const data = json ? findImage(json) : null
  if (!res.ok || !data) {
    // an error from the API can be shown; it never contains the key
    const why = json?.error?.message || json?.error?.status || text.slice(0, 300)
    ledger.calls.push({ scene: id, attempt, model: MODEL, ok: false, status: res.status, why: String(why).slice(0, 300), at: new Date().toISOString() })
    writeLedger(ledger)
    throw new Error(`No image came back (HTTP ${res.status}): ${String(why).slice(0, 300)}`)
  }
  const bytes = Buffer.from(data, 'base64')
  const ext = bytes[0] === 0x89 ? 'png' : bytes[0] === 0xff ? 'jpg' : 'bin'
  mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, `hero-${id}-${attempt}.${ext}`)
  writeFileSync(file, bytes)
  ledger.calls.push({ scene: id, attempt, model: MODEL, ok: true, file: path.basename(file), bytes: bytes.length, seconds, at: new Date().toISOString() })
  writeLedger(ledger)
  console.log(`scene ${id}, attempt ${attempt}: ${path.basename(file)} (${Math.round(bytes.length / 1024)} KB, ${seconds}s, ${MODEL}) in ${OUT}`)
}

// run only when called directly (photos-to-webp.mjs and the docs import the prompts)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
