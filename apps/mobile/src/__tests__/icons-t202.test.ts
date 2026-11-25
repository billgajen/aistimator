/**
 * T-202: every icon is made from the owner's drawing (brand/qolumns-letter.png) by
 * scripts/make-icons.py, which records what it read and what it wrote.
 */
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path))
const sha = (path: string) => createHash('sha256').update(read(path)).digest('hex')
const record = JSON.parse(read('brand/icons-made.json').toString('utf8')) as { source: string; sourceSha256: string; files: Record<string, string> }
const appJson = JSON.parse(read('apps/mobile/app.json').toString('utf8')).expo as { icon: string; android: { adaptiveIcon: { foregroundImage: string; monochromeImage: string; backgroundColor: string } } }

/** Width, height and colour type of a PNG, from its header (2 = RGB, 6 = RGB with transparency) */
function png(path: string) {
  const file = read(path)
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20), colourType: file.readUInt8(25) }
}

describe('T-202: the icons are made from the owner’s drawing', () => {
  it('the drawing is the one the icons were made from (run scripts/make-icons.py after changing it)', () => {
    expect(record.source).toBe('brand/qolumns-letter.png')
    expect(sha(record.source)).toBe(record.sourceSha256)
  })

  it('every icon is the file the script wrote, none changed by hand', () => {
    expect(Object.keys(record.files).sort()).toEqual([
      'Docs/store/google-play/icon-512.png',
      'apps/mobile/assets/adaptive-icon-monochrome.png',
      'apps/mobile/assets/adaptive-icon.png',
      'apps/mobile/assets/icon.png',
      'apps/mobile/assets/notification-icon.png',
      'apps/web/src/app/apple-icon.png',
      'apps/web/src/app/favicon.ico',
      'apps/web/src/app/icon.png',
    ])
    for (const [path, hash] of Object.entries(record.files)) expect(sha(path), path).toBe(hash)
  })

  it('the app reads those files, and Android’s background is the drawing’s green', () => {
    expect(appJson.icon).toBe('./assets/icon.png')
    expect(appJson.android.adaptiveIcon).toEqual({
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: '#192822',
    })
    expect(read('apps/mobile/app.config.js').toString('utf8')).toContain("icon: './assets/notification-icon.png'")
  })

  it('sizes: iPhone 1024 and Play 512 with no transparency; the themed and status-bar marks are see-through', () => {
    expect(png('apps/mobile/assets/icon.png')).toEqual({ width: 1024, height: 1024, colourType: 2 })
    expect(png('Docs/store/google-play/icon-512.png')).toEqual({ width: 512, height: 512, colourType: 2 })
    expect(png('apps/mobile/assets/adaptive-icon.png')).toMatchObject({ width: 1024, height: 1024 })
    expect(png('apps/mobile/assets/adaptive-icon-monochrome.png')).toEqual({ width: 1024, height: 1024, colourType: 6 })
    expect(png('apps/mobile/assets/notification-icon.png')).toEqual({ width: 96, height: 96, colourType: 6 })
    expect(png('apps/web/src/app/icon.png')).toMatchObject({ width: 512, height: 512 })
    expect(png('apps/web/src/app/apple-icon.png')).toMatchObject({ width: 180, height: 180 })
  })

  it('the Android mark keeps inside the circle every launcher shows (the script’s own rule)', () => {
    const script = read('scripts/make-icons.py').toString('utf8')
    expect(script).toContain('SAFE_CIRCLE = 66 / 108')
    expect(script).toMatch(/SAFE_SPARE = 0\.\d+/)
  })

  it('the owner’s Illustrator files stay out of the repository and the deploy', () => {
    expect(read('.gitignore').toString('utf8')).toContain('brand/*.ai')
    expect(read('.vercelignore').toString('utf8')).toContain('brand/*.ai')
    expect(existsSync(join(ROOT, 'brand/qolumns-letter.png'))).toBe(true)
  })
})
