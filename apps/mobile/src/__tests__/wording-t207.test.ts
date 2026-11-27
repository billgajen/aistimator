/**
 * T-207 item 13: the app runs on an iPad too, so it does not call the thing it runs on "this phone".
 *
 * A line about where something is kept says "this device". A line about what the device is (the room
 * scan needs LiDAR) says "iPhone or iPad". The Quotes screen is the one place that names the device
 * itself ("On this iPad" / "On this phone", T-206): it says the same neutral lines for its device.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PUSH_COPY } from '@qolumns/shared'
import { forDevice } from '../lib/device'
import { OUTBOX_COPY } from '../lib/outbox'

const APP = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(APP, path), 'utf8')

/** Every source file of the app (its screens, its own code, its room-scan module), tests left out */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(APP, dir))) {
    const path = `${dir}/${name}`
    if (name === 'node_modules' || name === '__tests__' || name === 'ios' || name === 'android') continue
    if (statSync(join(APP, path)).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(name)) out.push(path)
  }
  return out
}
const FILES = [...sources('app'), ...sources('src'), ...sources('modules')]

describe('T-207 item 13: device-neutral wording', () => {
  it('no file of the app says "this phone" (the one that turns a line into the device’s own name aside)', () => {
    expect(FILES.length).toBeGreaterThan(40)
    const hits = FILES.filter((f) => f !== 'src/lib/device.ts' && /this phone/i.test(read(f)))
    expect(hits).toEqual([])
  })

  it('the files the ticket named each say "this device" where they said "this phone"', () => {
    expect(read('app/(tabs)/account.tsx')).toContain("'A quote on this device has not been sent yet. It stays saved and is sent when you sign in again.'")
    const newQuote = read('app/(tabs)/new.tsx')
    expect(newQuote).toContain("'No signal, and this device has not loaded your services yet. Find a signal and open this again.'")
    expect(newQuote).toContain("'That photo could not be saved on this device. Try again.'")
    expect(newQuote).toContain("'The photos and answers on this device are removed. Nothing has been sent.'")
    expect(newQuote).toContain("'No signal. Using your services as this device last saw them.'")
    expect(newQuote).toContain("{stuck ? 'Saved on this device' : 'Pricing this job'}")
    expect(read('app/quote/[id].tsx')).toContain("'That could not be opened on this device.'")
    expect(read('src/components/ErrorBoundary.tsx')).toContain('text="Nothing was lost. A quote you were writing is saved on this device."')
    expect(OUTBOX_COPY.offline).toBe('No signal. Saved on this device. It sends by itself when you are back online.')
    expect(OUTBOX_COPY.signin).toBe('Sign in again to send this quote. It is saved on this device.')
  })

  it('a line about what the device is names both: the room scan needs an iPhone or iPad with LiDAR', () => {
    const scan = read('modules/room-scan/index.ts')
    expect(scan).toContain("'Your iPhone or iPad has no LiDAR sensor (it is on Pro models)'")
    expect(scan).toContain("'Room scan needs an iPhone or iPad with LiDAR'")
    expect(scan).not.toMatch(/'[^'\n]*\biPhone\b(?! or iPad)[^'\n]*'/)
  })

  it('two lines outside the ticket’s list said "phone" on an iPad too, and no longer do', () => {
    expect(read('src/lib/device-files.ts')).toContain("'This photo is no longer on this device. Take it again.'")
    expect(PUSH_COPY.refused).toBe("Turned off in your device's settings")
    expect(PUSH_COPY.openSettings).toBe("Open your device's settings")
  })

  it('the Quotes screen still names the device: a neutral line is said for it, under "On this iPad" or "On this phone"', () => {
    expect(forDevice(OUTBOX_COPY.offline, 'iPad')).toBe('No signal. Saved on this iPad. It sends by itself when you are back online.')
    expect(forDevice(OUTBOX_COPY.offline, 'phone')).toBe('No signal. Saved on this phone. It sends by itself when you are back online.')
    expect(forDevice(OUTBOX_COPY.signin, 'iPad')).toBe('Sign in again to send this quote. It is saved on this iPad.')
    // a line with neither word is left as it is
    expect(forDevice('Sending the job', 'phone')).toBe('Sending the job')
    const screen = read('app/(tabs)/index.tsx')
    expect(screen).toContain('title={`On this ${DEVICE}`}')
    expect(screen).toMatch(/const line = forDevice\(/)
  })

  it('the customer’s own phone is still a phone: the QR screen asks them to point its camera', () => {
    expect(read('app/link.tsx')).toContain('Point your phone’s camera at the code to ask for a quote.')
  })
})
