/**
 * T-190: the app's icon, splash and sign-in wordmark are the owner's files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { WORDMARK_FILE, WORDMARK_SIZE } from '../lib/wordmark'

const root = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
function png(path: string) {
  const b = readFileSync(join(root, path))
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25], first: [b[0], b[1], b[2], b[3]] }
}
const app = JSON.parse(read('app.json')).expo

describe('T-190: the app’s brand pictures', () => {
  it('the icon is 1024 square with no transparency (colour type 2: RGB, no alpha), as Apple requires', () => {
    expect(app.icon).toBe('./assets/icon.png')
    expect(png('assets/icon.png')).toMatchObject({ width: 1024, height: 1024, colourType: 2 })
  })

  it('the Android icon sits on the file’s own dark green', () => {
    expect(app.android.adaptiveIcon.backgroundColor).toBe('#192822')
  })

  it('the splash is the wordmark on the app’s background colour', () => {
    const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1]
    expect(splash.image).toBe('./assets/splash.png')
    expect(splash.backgroundColor).toBe(app.backgroundColor)
    expect(png('assets/splash.png')).toMatchObject({ width: 1024, height: 1024 })
  })

  it('sign-in shows the wordmark picture at a fixed size, read as the product name', () => {
    expect(png('assets/wordmark.png')).toMatchObject({ width: WORDMARK_FILE.width, height: WORDMARK_FILE.height })
    expect(WORDMARK_SIZE).toEqual({ width: 160, height: 43 })
    const login = read('app/login.tsx')
    expect(login).toContain("import WORDMARK from '../assets/wordmark.png'")
    expect(login).toContain('accessibilityLabel={PRODUCT_NAME}')
    expect(login).not.toMatch(/>\s*\{PRODUCT_NAME\}\s*</)
  })
})
