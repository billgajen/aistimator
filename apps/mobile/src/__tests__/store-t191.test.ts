/**
 * T-191: App Store readiness of what we control: account deletion, no purchase wording, plain permission reasons.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { QUOTE_TURN_COPY, quoteTurn } from '@qolumns/shared'
import { deleteAccountUrl } from '../lib/account'
import { ApiError } from '../lib/api'
import { plainError, PLAIN } from '../lib/errors'
import { turnOfListItem } from '../lib/status'

const root = join(__dirname, '../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const app = JSON.parse(read('app.json')).expo

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.(tsx?|json)$/.test(name) ? [p] : []
  })
}

describe('T-191: delete your account', () => {
  it('the app only signs in, so a clear link to the web page that closes an account is what Apple asks for', () => {
    const screens = files('app').map(read).join('\n')
    expect(screens).not.toMatch(/auth\.signUp|signUp\(/)
    expect(read('app/(tabs)/account.tsx')).toContain('title="Delete your account"')
    expect(deleteAccountUrl('https://qolumns.com/')).toBe('https://qolumns.com/data-deletion')
  })
})

describe('T-191: nothing in the app points at a purchase', () => {
  it('no price of a plan, no "upgrade", no billing link in the app’s own code', () => {
    // errors.ts holds the filter for these words, so it names them
    for (const f of [...files('app'), ...files('src')].filter((f) => !f.endsWith('lib/errors.ts'))) {
      const code = read(f)
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)) // comments may name the rule
        .join('\n')
      expect(code, f).not.toMatch(/upgrade|\/settings\/billing|checkout|per month|\/mo\b|choose a plan|pick a plan/i)
    }
  })

  it('the plan-limit sentence the app shows has no "upgrade"; the dashboard keeps its own', () => {
    const held = { status: 'pending_review', customerName: 'Megan Grant', hasEmail: true, total: 0, held: true, createdAt: new Date().toISOString() } as const
    expect(turnOfListItem({ ...held, id: 'q', serviceName: 'S', customerEmail: 'm@example.com' } as never).sentence).not.toMatch(/upgrade/i)
    expect(quoteTurn(held as never).sentence).toMatch(/Upgrade your plan/)
    expect(QUOTE_TURN_COPY).toBeDefined()
  })

  it('the server’s plan-limit message (it names a plan to buy) is replaced by the app’s own line', () => {
    expect(plainError(new ApiError(402, 'PLAN_LIMIT_REACHED', 'Monthly limit reached (10/10). Upgrade to price this lead.'))).toBe(PLAIN.planLimit)
    expect(plainError(new ApiError(400, 'X', 'Pick a plan to price this lead.'))).toBe(PLAIN.unknown)
    expect(PLAIN.planLimit).not.toMatch(/upgrade|buy|plan to/i)
  })
})

describe('T-191: every permission prompt has a plain reason, and only the ones used are asked', () => {
  const CAM = 'Take photos of the job so it can be priced, and scan a room to measure it.'
  it('camera (photos and the room scan) and photos only; no microphone, no Face ID', () => {
    expect(app.ios.infoPlist.NSCameraUsageDescription).toBe(CAM)
    const picker = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker')[1]
    expect(picker).toEqual({ cameraPermission: CAM, photosPermission: 'Choose photos of the job so it can be priced.', microphonePermission: false })
    expect(app.plugins).toContainEqual(['expo-secure-store', { faceIDPermission: false }])
  })
})
