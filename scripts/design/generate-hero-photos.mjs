// T-168, T-170: generate candidate photographs with Google's Gemini image API.
//
//   node scripts/design/generate-hero-photos.mjs --scene a            one attempt at scene a
//   node scripts/design/generate-hero-photos.mjs --scene a --dry      print the prompt, call nothing
//   node scripts/design/generate-hero-photos.mjs --list               the scenes and the calls made so far
//
// T-168 made Home's hero (scenes a to d). T-170 added the scenes for the six
// trade pages' heroes, Home's closing band, the van that carries the QR code
// and the demo's two sample photos (`trade-*`, `closing`, `van`, `demo-*`).
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
// Limits it enforces itself (the tickets'): three attempts per scene. The
// count is kept in OUT/ledger.json, so each ticket uses its own OUT folder; a
// call that returns no image is recorded as failed and does not count as an
// attempt.
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

/** One art direction for every photograph (system.md, Imagery) */
const ART = {
  style: 'A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest.',
  daylight: 'Natural daylight only. An ordinary American home or residential street. Calm and warm.',
  // T-170: the closing band is an evening picture, the one exception to daylight
  evening: 'Evening: the last blue daylight of dusk in the window and one warm lamp in the room, nothing else. An ordinary American home. Calm and warm.',
  colour: 'Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture.',
  person: 'The person is absorbed in what they are doing and is not looking at the camera. No posed smile. An ordinary working adult, not a model.',
  hands: 'Hands are natural and correct, with five fingers each.',
  nobody: 'There are no people in the picture, and no part of a person.',
  plain: 'Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.',
}
/** As T-168 wrote it: a scene with a person, in daylight */
export const ART_DIRECTION = [ART.style, ART.daylight, ART.colour, ART.person, ART.hands, ART.plain].join(' ')
/** T-170: the same direction for a scene with nobody in it, and for the evening scene */
export const ART_DIRECTION_NOBODY = [ART.style, ART.daylight, ART.colour, ART.nobody, ART.plain].join(' ')
export const ART_DIRECTION_EVENING = [ART.style, ART.evening, ART.colour, ART.person, ART.hands, ART.plain].join(' ')

/** The same frame for every hero: where the subject sits, and the calm side the words go on */
export const COMPOSITION = [
  'A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field.',
  'The subject stands entirely in the right third of the frame, seen from the knees or waist up, with their whole head inside the frame and clear space above it.',
  'The left 55 percent of the frame is calm, light and nearly empty: PLACEHOLDER. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.',
].join(' ')

/** T-170: a hero whose subject is a thing, not a person (a house front, a unit, a tank, a door) */
export const COMPOSITION_OBJECT = [
  'A wide 16:9 frame, photographed with a 35mm lens and a shallow depth of field.',
  'The subject is entirely in the right 40 percent of the frame, large and sharp, with its top inside the frame and clear space above it.',
  'The left 55 percent of the frame is calm, light and nearly empty: PLACEHOLDER. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.',
].join(' ')

/** T-170: the closing band. The words are light, on the dark calm side */
export const COMPOSITION_EVENING = [
  'A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field.',
  'The subject is entirely in the right third of the frame, with their whole head inside the frame and clear space above it.',
  'The left 55 percent of the frame is calm, dim and nearly empty: PLACEHOLDER. It is dark and even enough for light text to be placed over it, with no objects, no people, no lamp and no bright patch in that part.',
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

/**
 * T-170. Each scene names its frame (`aspect`, `size`), its composition and
 * its art direction where they differ from the hero's. The wording is the
 * wording of the attempt that was kept (Docs/design/photos.md).
 */
Object.assign(SCENES, T170_SCENES())
function T170_SCENES() {
  const object = (calm) => COMPOSITION_OBJECT.replace('PLACEHOLDER', calm)
  const person = (calm) => COMPOSITION.replace('PLACEHOLDER', calm)
  return {
    'trade-painting': {
      title: 'Painting: a freshly painted house front',
      art: ART_DIRECTION_NOBODY,
      composition: object('a soft, bright overcast sky above a low, out-of-focus green hedge'),
      scene:
        'The front of an ordinary two-storey American house that has just been repainted, seen from the front lawn: fresh pale off-white clapboard siding, crisp white trim, a covered wooden porch and a deep juniper green front door. An aluminium extension ladder leans against the wall beside the porch, and a folded canvas drop cloth and a plain metal paint can with no label sit on the porch boards.',
    },
    'trade-hvac': {
      title: 'HVAC: an outdoor unit beside a house',
      art: ART_DIRECTION_NOBODY,
      composition: object('the pale clapboard side wall of the house running away from the camera, out of focus, in soft even daylight'),
      scene:
        'A residential central air conditioner outdoor unit standing on a small concrete pad beside the pale off-white clapboard side wall of an American house, photographed from a low angle near the unit’s own height so that it is large in the frame. Two insulated lines run from it up the wall. The unit is a plain grey-beige metal cabinet with a louvred grille and a round fan guard on top; it has no badge, no nameplate, no sticker and no lettering of any kind. A strip of clipped green lawn is in front of it.',
    },
    'trade-water-heaters': {
      title: 'Water heaters: a tank in a garage',
      art: ART_DIRECTION_NOBODY,
      composition: object('a plain pale painted garage wall lit by daylight from the open garage door'),
      scene:
        'A tall white residential tank water heater standing in the corner of a tidy American garage, with two copper pipes and a metal vent rising from its top to the ceiling. The tank is plain white enamel with no label, no sticker, no warning tag and no markings of any kind. A plain concrete floor.',
    },
    'trade-plumbing': {
      title: 'Plumbing: a plumber at a kitchen sink',
      composition: person('a pale kitchen wall and a window with soft daylight, out of focus'),
      scene:
        'A plumber in their forties in a plain dark juniper green work shirt stands at the sink of an ordinary American kitchen, bending slightly to tighten the base of the tap with an adjustable wrench held in one hand, the other hand steadying the tap. They are photographed from across the kitchen, so that their whole head, their shoulders and the sink are well inside the frame, with clear space above the head, and they appear fairly small in the picture. A plain open canvas tool bag sits on the counter. The wrench, the tap and the bag carry no brand and no lettering.',
    },
    'trade-electrical': {
      title: 'Electrical: an electrician at a panel',
      composition: person('a plain pale painted garage wall in soft even daylight'),
      scene:
        'An electrician in their thirties in a plain grey work shirt stands in a tidy American garage facing a grey metal electrical panel mounted on the wall, seen in profile from the side. They hold the panel’s plain grey metal door open with one hand; the open door is turned towards the camera, so the camera sees only the plain outside of the door and the inside of the panel is hidden behind it. A plain yellow voltage tester with no label is clipped to their belt. Nothing on the panel, the door or the wall carries a label, a sticker, a number or any lettering.',
    },
    'trade-garage-doors': {
      title: 'Garage doors: a door on a driveway',
      art: ART_DIRECTION_NOBODY,
      composition: object('the pale clapboard wall of the house and a soft, bright overcast sky, out of focus'),
      scene:
        'A closed white sectional garage door with plain raised panels on the front of an ordinary American suburban house, seen from its clean concrete driveway. Crisp white trim around the opening, pale off-white clapboard siding, and one small plain exterior lamp beside the door. No car. No house number and nothing with lettering.',
    },
    closing: {
      title: 'Home’s closing band: a homeowner on a sofa in the evening, with a phone',
      art: ART_DIRECTION_EVENING,
      composition: COMPOSITION_EVENING.replace('PLACEHOLDER', 'a plain wall in deep, soft evening shadow'),
      scene:
        'A homeowner in their forties in a plain cream sweater sits back in the corner of a sofa in a quiet living room at dusk, relaxed, seen from the side in three-quarter profile with their head bowed a little, looking down at a phone that rests in one hand low over their lap, well below the chin. Nothing is in front of the face. The phone is small in the picture and is seen edge-on, as a thin dark shape; its screen faces away from the camera and is never seen, and it has no camera lenses facing us. A warm table lamp glows on a side table at the far right, and a window behind the sofa shows the deep blue of early evening.',
    },
    van: {
      title: '"Add it anywhere": the flat side of a plain white work van (our QR code is placed on it in code)',
      aspect: '2:3',
      art: ART_DIRECTION_NOBODY,
      composition:
        'A vertical 2:3 frame, photographed with a 35mm lens from the pavement at door height, with everything in focus. The camera is square-on to the van and looks straight at its side, so the side of the van has no perspective.',
      scene:
        'A plain white panel van, the kind a tradesperson drives, parked at the kerb of a quiet American suburban street of single-family houses with front lawns. The frame shows the middle of the van’s side from its roof down to the road: the flat sliding side door fills the centre of the frame, the rear wheel with its black tyre is at the lower right corner, and the edge of the cab door with its dark side window is at the left edge. The sliding door is smooth, clean, plain white painted metal, evenly lit by soft overcast daylight, with nothing on it at all: no lettering, no logo, no stripe, no sticker, no sign and no window. Its handle is small, at one edge. A little pale sky is above the roof and the kerb is below the van.',
    },
    'demo-springs': {
      title: 'Demo sample, Garage Door Spring Replacement: the springs above the door, from inside',
      aspect: '4:3',
      size: '1K',
      art: [ART.daylight, ART.nobody, 'An ordinary photograph taken by a homeowner with a phone: plain, sharp, honest, not styled.', ART.plain].join(' '),
      composition: 'A 4:3 frame, slightly wide, taken straight on from inside the garage, with everything in focus.',
      scene:
        'The view from inside a residential garage, looking up at the wall above a closed white sectional garage door. A steel torsion bar runs across the wall above the door with two dark coiled torsion springs on it, a centre bracket between them and a cable drum at each end; the door’s two horizontal tracks run back along the ceiling at each side. Bare pale painted drywall. Daylight from a side window. Nothing carries a label, a sticker, a warning tag or any lettering.',
    },
    'demo-room': {
      title: 'Demo sample, Interior Painting: a room from the doorway',
      aspect: '4:3',
      size: '1K',
      art: [ART.daylight, ART.nobody, 'An ordinary photograph taken by a homeowner with a phone: plain, sharp, honest, not styled.', ART.plain].join(' '),
      composition: 'A 4:3 frame, wide, taken from the doorway at eye level so that the whole room is in the picture from the floor to the ceiling, with everything in focus.',
      scene:
        'An ordinary bedroom in an American home that is about to be repainted, seen from its doorway: plain pale beige walls with a few scuffs, a white ceiling, white baseboards, one window with daylight, a wooden floor, and a bed with a plain cover against the far wall. The room is otherwise nearly empty. No boxes, no packaging, no bags, no pictures, posters, books, clocks or screens, and nothing with lettering or a logo.',
    },
  }
}

export function promptFor(id) {
  const s = SCENES[id]
  if (!s) throw new Error(`No scene "${id}" (use one of: ${Object.keys(SCENES).join(', ')})`)
  return [s.scene, s.composition ?? COMPOSITION.replace('PLACEHOLDER', s.calm), s.art ?? ART_DIRECTION, NEVER].join('\n\n')
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
    console.log(`calls that returned an image: ${ledger.calls.filter((c) => c.ok).length}; failed: ${ledger.calls.filter((c) => !c.ok).length}; folder: ${OUT}`)
    return
  }
  const id = args[args.indexOf('--scene') + 1]
  const prompt = promptFor(id)
  if (args.includes('--dry')) {
    console.log(prompt)
    return
  }
  if (made(id) >= MAX_PER_SCENE) throw new Error(`Scene ${id} already has ${MAX_PER_SCENE} attempts`)
  const key = loadKey()
  if (!key) throw new Error('GEMINI_API_KEY is not set (environment or apps/web/.env.local)')

  const attempt = made(id) + 1
  const started = Date.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: prompt, response_format: { type: 'image', aspect_ratio: SCENES[id].aspect ?? '16:9', image_size: SCENES[id].size ?? '2K' } }),
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
  // T-168's four scenes keep their `hero-` file names
  const file = path.join(OUT, `${id.length === 1 ? 'hero-' : ''}${id}-${attempt}.${ext}`)
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
