// T-168, T-170: turn the chosen photographs into the files the site serves.
//
//   PLAYWRIGHT_DIR=<folder with playwright> node scripts/design/photos-to-webp.mjs            the T-170 photographs
//   PLAYWRIGHT_DIR=<folder with playwright> node scripts/design/photos-to-webp.mjs --set t168 Home's hero
//
// For each chosen candidate (made by generate-hero-photos.mjs, kept outside
// the repo in HERO_PHOTOS_OUT) it writes WebP files: 2400 px wide, under
// 300 KB, and 1200 px wide (a picture that is only ever shown small gets the
// widths its entry names). A candidate may be cropped first (`crop`:
// [x, y, width, height] in the candidate's own pixels; `keepTop` and
// `keepLeft`: the share of its height or width that is kept), which is how a
// strip that must not be shown is left out. A small mark that must not be
// shown and cannot be cropped away is painted out, in the candidate's own
// pixels:
//   mirrorDown [x, y, w, h]           the strip of that height just above y is copied, upside down, over the strip below it
//   clone      [sx, sy, w, h, dx, dy] the patch at (sx, sy) is copied to (dx, dy)
//   blur       [x, y, w, h, radius]   that patch is blurred where it is
// Docs/design/photos.md records every crop and every patch. No image model is
// used here.
//
// Encoding uses the browser's own WebP encoder, in the Chromium that the
// verify scripts already use (it lives outside the repo: see
// scripts/hardcore-test/browser.mjs). Nothing is installed and nothing is
// sent anywhere: the page is a blank local document.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { browserDeps } from '../hardcore-test/browser.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IN = process.env.HERO_PHOTOS_OUT || path.join(os.tmpdir(), 'qolumns-hero-photos')
const PHOTOS = path.join(ROOT, 'apps/web/public/photos')
const DEMO = path.join(ROOT, 'apps/web/public/demo')
const MAX_BYTES = 300 * 1024

/** The chosen attempt of each T-168 scene (Docs/design/photos.md says why, and what was rejected) */
export const CHOSEN = {
  // b is the hero (the owner's choice). Its right-hand 7.7% is cut off: a tape measure there had a label with
  // garbled lettering.
  b: { file: 'hero-b-1.jpg', keepTop: 1, keepLeft: 0.923 },
  // The three options that were not chosen, as they were prepared for the preview (their files are not in the repo):
  //   a: { file: 'hero-a-3.jpg', keepTop: 0.78, keepLeft: 1 }
  //   c: { file: 'hero-c-3.jpg', keepTop: 1, keepLeft: 1, mirrorDown: [2166, 1033, 56, 25] }
  //   d: { file: 'hero-d-2.jpg', keepTop: 1, keepLeft: 1 }
}
export const WIDTHS = [2400, 1200]

/**
 * T-170: the chosen attempt of each scene, the file it becomes, and what was
 * done to it in code. `out` is the file name without its width.
 */
export const CHOSEN_T170 = {
  'trade-hvac': { file: 'trade-hvac-1.jpg', out: 'trade-hvac' },
  // a second small yellow thing (a sponge on a tap by the downpipe) is covered with the siding beside it:
  // the art direction allows one yellow object, and the gloves on the porch are it
  'trade-painting': { file: 'trade-painting-1.jpg', out: 'trade-painting', ops: [{ clone: [1644, 1404, 64, 82, 1710, 1404] }] },
  'trade-water-heaters': { file: 'trade-water-heaters-1.jpg', out: 'trade-water-heaters' },
  // a stamp on the wrench's handle read as made-up lettering: it is blurred where it is
  'trade-plumbing': { file: 'trade-plumbing-2.jpg', out: 'trade-plumbing', ops: [{ blur: [2276, 1110, 62, 48, 6] }] },
  // the tester on the electrician's belt carried made-up lettering: the picture is cut above the belt
  'trade-electrical': { file: 'trade-electrical-1.jpg', out: 'trade-electrical', keepTop: 0.77 },
  'trade-garage-doors': { file: 'trade-garage-doors-1.jpg', out: 'trade-garage-doors' },
  closing: { file: 'closing-2.jpg', out: 'closing' },
  // cut to the 5:8 picture "Add it anywhere" shows, with the flat panel our QR code is placed on in its upper part.
  // It is never shown wider than a column (about 360 px), so it has no 2400 px file: the part kept is 1103 px wide
  van: { file: 'van-2.jpg', out: 'van', crop: [345, 352, 1103, 1765], widths: [1000, 500] },
  // the demo's sample photos: 1200 px only, beside the other demo files. A small warning tag on the door's edge
  // (fine lines, nothing readable) is covered with the plain edge above it
  'demo-springs': { file: 'demo-springs-1.jpg', out: 'sample-garage-door-springs', dir: DEMO, widths: [1200], bare: true, ops: [{ clone: [1040, 740, 20, 21, 1040, 762] }, { clone: [1040, 740, 20, 21, 1040, 783] }] },
  'demo-room': { file: 'demo-room-2.jpg', out: 'sample-room-to-paint', dir: DEMO, widths: [1200], bare: true },
}

/** Runs in the browser page: crop, patch, scale, encode */
async function encode({ dataUrl, width, crop, ops, maxBytes }) {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  // the candidate at its own size first, so a patch is made in its own pixels
  const full = document.createElement('canvas')
  full.width = img.naturalWidth
  full.height = img.naturalHeight
  const fctx = full.getContext('2d')
  fctx.drawImage(img, 0, 0)
  for (const op of ops) {
    if (op.mirrorDown) {
      const [x, y, w, h] = op.mirrorDown
      fctx.save()
      fctx.translate(0, 2 * y)
      fctx.scale(1, -1)
      fctx.drawImage(img, x, y - h, w, h, x, y - h, w, h)
      fctx.restore()
    }
    if (op.clone) {
      const [sx, sy, w, h, dx, dy] = op.clone
      fctx.drawImage(img, sx, sy, w, h, dx, dy, w, h)
    }
    if (op.blur) {
      const [x, y, w, h, radius] = op.blur
      fctx.save()
      fctx.beginPath()
      fctx.rect(x, y, w, h)
      fctx.clip()
      fctx.filter = `blur(${radius}px)`
      fctx.drawImage(img, 0, 0)
      fctx.restore()
    }
  }
  const [cx, cy, cw, ch] = crop ?? [0, 0, img.naturalWidth, img.naturalHeight]
  const height = Math.round((ch / cw) * width)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, cx, cy, cw, ch, 0, 0, width, height)
  // quality steps down until the file fits; the smaller file never needs to
  let quality = 0.86
  let blob = null
  for (; quality >= 0.3; quality -= 0.04) {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (blob.size <= maxBytes) break
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return { base64: btoa(binary), width, height, quality: Math.round(quality * 100) / 100, size: blob.size, natural: [img.naturalWidth, img.naturalHeight] }
}

async function main() {
  const set = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : 't170'
  const jobs =
    set === 't168'
      ? Object.entries(CHOSEN).map(([id, pick]) => ({ ...pick, out: `hero-${id}`, ops: pick.mirrorDown ? [{ mirrorDown: pick.mirrorDown }] : [] }))
      : Object.values(CHOSEN_T170)
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const report = []
  for (const job of jobs) {
    const source = path.join(IN, job.file)
    if (!existsSync(source)) throw new Error(`Missing ${source}: generate it first, or set HERO_PHOTOS_OUT`)
    const dataUrl = `data:image/jpeg;base64,${readFileSync(source).toString('base64')}`
    const dir = job.dir ?? PHOTOS
    mkdirSync(dir, { recursive: true })
    for (const width of job.widths ?? WIDTHS) {
      const natural = await page.evaluate(async (url) => {
        const img = new Image()
        img.src = url
        await img.decode()
        return [img.naturalWidth, img.naturalHeight]
      }, dataUrl)
      const crop = job.crop ?? [0, 0, Math.round(natural[0] * (job.keepLeft ?? 1)), Math.round(natural[1] * (job.keepTop ?? 1))]
      const result = await page.evaluate(encode, { dataUrl, width, crop, ops: job.ops ?? [], maxBytes: MAX_BYTES })
      const name = job.bare ? `${job.out}.webp` : `${job.out}-${width}.webp`
      writeFileSync(path.join(dir, name), Buffer.from(result.base64, 'base64'))
      report.push({ name, width: result.width, height: result.height, kb: Math.round(result.size / 1024), quality: result.quality })
      console.log(`${name}  ${result.width}x${result.height}  ${Math.round(result.size / 1024)} KB  quality ${result.quality}`)
    }
  }
  await browser.close()
  // Home's hero keeps its own record; the T-170 files are listed beside it
  writeFileSync(path.join(PHOTOS, set === 't168' ? 'hero-sizes.json' : 'photo-sizes.json'), JSON.stringify(report, null, 1) + '\n')
  const tooBig = report.filter((r) => r.kb * 1024 > MAX_BYTES)
  if (tooBig.length) throw new Error(`Over 300 KB: ${tooBig.map((r) => r.name).join(', ')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
