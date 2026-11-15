// T-168: turn the chosen hero photographs into the files the site serves.
//
//   PLAYWRIGHT_DIR=<folder with playwright> node scripts/design/photos-to-webp.mjs
//
// For each chosen candidate (made by generate-hero-photos.mjs, kept outside
// the repo in HERO_PHOTOS_OUT) it writes two WebP files into
// apps/web/public/photos/: 2400 px wide, under 300 KB, and 1200 px wide.
// A candidate may be cropped first (`keepTop`: the share of its height kept,
// from the top; `keepLeft`: the share of its width kept, from the left),
// which is how a strip that must not be shown is left out. A small mark that
// must not be shown and cannot be cropped away is painted out (`mirrorDown`:
// [x, y, width, height] in the candidate's own pixels: the strip of that
// height just above y is copied, upside down, over the strip just below it).
// Docs/design/photos.md records every crop and every patch.
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
const OUT = path.join(ROOT, 'apps/web/public/photos')
const MAX_BYTES = 300 * 1024

/** The chosen attempt of each scene (Docs/design/photos.md says why, and what was rejected) */
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

async function main() {
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  mkdirSync(OUT, { recursive: true })
  const report = []
  for (const [id, pick] of Object.entries(CHOSEN)) {
    const source = path.join(IN, pick.file)
    if (!existsSync(source)) throw new Error(`Missing ${source}: generate it first, or set HERO_PHOTOS_OUT`)
    const dataUrl = `data:image/jpeg;base64,${readFileSync(source).toString('base64')}`
    for (const width of WIDTHS) {
      // quality steps down until the file fits; the smaller file never needs to
      const result = await page.evaluate(
        async ({ dataUrl, width, keepTop, keepLeft, mirrorDown, maxBytes }) => {
          const img = new Image()
          img.src = dataUrl
          await img.decode()
          const cropHeight = Math.round(img.naturalHeight * keepTop)
          const cropWidth = Math.round(img.naturalWidth * keepLeft)
          const height = Math.round((cropHeight / cropWidth) * width)
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.imageSmoothingQuality = 'high'
          // the candidate at its own size first, so a patch is made in its own pixels
          const full = document.createElement('canvas')
          full.width = img.naturalWidth
          full.height = img.naturalHeight
          const fctx = full.getContext('2d')
          fctx.drawImage(img, 0, 0)
          if (mirrorDown) {
            const [x, y, w, h] = mirrorDown
            fctx.save()
            fctx.translate(0, 2 * y)
            fctx.scale(1, -1)
            fctx.drawImage(img, x, y - h, w, h, x, y - h, w, h)
            fctx.restore()
          }
          ctx.drawImage(full, 0, 0, cropWidth, cropHeight, 0, 0, width, height)
          let quality = 0.86
          let blob = null
          for (; quality >= 0.3; quality -= 0.04) {
            blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
            if (blob.size <= maxBytes) break
          }
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
          return { base64: btoa(binary), width, height, quality: Math.round(quality * 100) / 100, size: blob.size }
        },
        { dataUrl, width, keepTop: pick.keepTop, keepLeft: pick.keepLeft, mirrorDown: pick.mirrorDown ?? null, maxBytes: MAX_BYTES }
      )
      const name = `hero-${id}-${width}.webp`
      writeFileSync(path.join(OUT, name), Buffer.from(result.base64, 'base64'))
      report.push({ name, width: result.width, height: result.height, kb: Math.round(result.size / 1024), quality: result.quality })
      console.log(`${name}  ${result.width}x${result.height}  ${Math.round(result.size / 1024)} KB  quality ${result.quality}`)
    }
  }
  await browser.close()
  writeFileSync(path.join(OUT, 'hero-sizes.json'), JSON.stringify(report, null, 1) + '\n')
  const tooBig = report.filter((r) => r.kb * 1024 > MAX_BYTES)
  if (tooBig.length) throw new Error(`Over 300 KB: ${tooBig.map((r) => r.name).join(', ')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
