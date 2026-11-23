/**
 * T-200: the app on Android, for Google Play.
 *
 * What can be held without an Android phone: the build's settings (what it asks the phone for, its icon,
 * its version), the rules that are plain functions (notifications are off without Firebase's file; room
 * scan is "not an iPhone"), and what each screen's source must hold (the keyboard, the back button, a
 * scanned quote shown read-only). The app running on a phone is the owner's test (OWNER-TODO, T-200).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'
import { PUSH_ANDROID_CHANNEL, PUSH_ANDROID_COLOR, PUSH_COPY, onsiteNotInPlan } from '@qolumns/shared'
import { pushAvailable, pushSection } from '../lib/push'

const root = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const app = JSON.parse(read('app.json')).expo
const eas = JSON.parse(read('eas.json'))

/** app.config.js as Expo reads it for the store build, with or without Firebase's file */
function storeConfig(firebaseFile?: string): { android: { package: string; googleServicesFile?: string }; plugins: unknown[]; extra: { push?: boolean; pushAndroid?: boolean } } {
  const before = { variant: process.env.APP_VARIANT, file: process.env.GOOGLE_SERVICES_JSON }
  delete process.env.APP_VARIANT
  if (firebaseFile) process.env.GOOGLE_SERVICES_JSON = firebaseFile
  else delete process.env.GOOGLE_SERVICES_JSON
  try {
    const require = createRequire(import.meta.url)
    const path = join(root, 'app.config.js')
    delete require.cache[require.resolve(path)]
    const build = require(path) as (input: { config: unknown }) => never
    return build({ config: JSON.parse(read('app.json')).expo })
  } finally {
    if (before.variant === undefined) delete process.env.APP_VARIANT
    else process.env.APP_VARIANT = before.variant
    if (before.file === undefined) delete process.env.GOOGLE_SERVICES_JSON
    else process.env.GOOGLE_SERVICES_JSON = before.file
  }
}

describe('T-200: the Android build', () => {
  it('is com.qolumns.app, version code 1, and opens qolumns:// links', () => {
    expect(app.android.package).toBe('com.qolumns.app')
    expect(app.android.versionCode).toBe(1)
    expect(app.scheme).toBe('qolumns')
  })

  it('asks the phone only for what the app uses: the camera, notifications and a tap you can feel', () => {
    expect(app.android.permissions).toEqual(['CAMERA', 'POST_NOTIFICATIONS', 'VIBRATE'])
    // what Expo's packages would add and the app never uses is taken out by name
    const blocked: string[] = app.android.blockedPermissions
    for (const name of ['RECORD_AUDIO', 'READ_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW', 'RECEIVE_BOOT_COMPLETED', 'USE_BIOMETRIC', 'USE_FINGERPRINT', 'READ_APP_BADGE']) expect(blocked, name).toContain(`android.permission.${name}`)
    // found by reading the first built bundle's manifest: the sign-in store's fingerprint permissions (the app
    // never asks for a fingerprint), the launchers' badge permissions (the app never sets a badge:
    // shouldSetBadge is false) and Play's install referrer
    expect(blocked.filter((name) => /badge|launcher|badger/i.test(name)).length).toBeGreaterThanOrEqual(15)
    expect(blocked).toContain('com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE')
    expect(read('src/lib/notifications.ts')).toContain('shouldSetBadge: false')
    for (const file of ['src/lib/supabase.ts', 'src/lib/chunked-store.ts', 'src/lib/notifications.ts']) expect(read(file), file).not.toMatch(/requireAuthentication/)
    // what notifications and the network need is never blocked
    for (const needed of ['android.permission.WAKE_LOCK', 'android.permission.ACCESS_NETWORK_STATE', 'com.google.android.c2dm.permission.RECEIVE', 'android.permission.INTERNET']) expect(blocked, needed).not.toContain(needed)
    // WRITE_EXTERNAL_STORAGE stays (not blocked): Android 9 and older will not open the camera without it
    expect(app.android.blockedPermissions).not.toContain('android.permission.WRITE_EXTERNAL_STORAGE')
    // photos are chosen in Android's own picker, which needs no permission; the wording matches the iPhone's
    const picker = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-image-picker')[1]
    expect(picker.cameraPermission).toBe(app.ios.infoPlist.NSCameraUsageDescription)
    expect(picker.photosPermission).toBe(app.ios.infoPlist.NSPhotoLibraryUsageDescription)
    expect(picker.microphonePermission).toBe(false)
  })

  it('its icon is made for Android’s round and squircle masks, on the icon’s own background colour', () => {
    const icon = app.android.adaptiveIcon
    // the colour of icon.png as it was exported (measured: 25, 40, 34), so no seam shows at the edge
    expect(icon.backgroundColor).toBe('#192822')
    // not icon.png itself: its mark is wider than the part of an adaptive icon Android shows
    expect(icon.foregroundImage).toBe('./assets/adaptive-icon.png')
    expect(icon.monochromeImage).toBe('./assets/adaptive-icon-monochrome.png')
    for (const file of [icon.foregroundImage, icon.monochromeImage]) expect(existsSync(join(root, file)), file).toBe(true)
  })

  it('the splash and the status bar are for a light background', () => {
    const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1]
    expect(splash.backgroundColor).toBe('#FAF9F6')
    expect(app.backgroundColor).toBe('#FAF9F6')
    expect(read('app/_layout.tsx')).toContain('<StatusBar style="dark" />')
    // the app is light only. On Android that setting does nothing without expo-system-ui: a phone in dark
    // mode would give unstyled text the dark theme's white, on the app's light paper
    expect(app.userInterfaceStyle).toBe('light')
    expect(JSON.parse(read('package.json')).dependencies['expo-system-ui']).toBeDefined()
    // Expo SDK 58 draws edge to edge by itself: the old switch is not a setting any more
    expect(app.android.edgeToEdgeEnabled).toBeUndefined()
  })

  it('the brand faces are loaded the same way on both phones, and no style sets a weight beside them', () => {
    const layout = read('app/_layout.tsx')
    for (const face of ['BricolageGrotesque_700Bold', 'BricolageGrotesque_800ExtraBold', 'InstrumentSans_400Regular', 'InstrumentSans_600SemiBold', 'InstrumentSans_700Bold']) expect(layout).toContain(face)
    expect(layout).not.toMatch(/Platform\.OS/)
  })

  it('the store build is an app bundle with the server’s addresses, and no key is written in the settings', () => {
    const production = eas.build.production
    expect(production.android.buildType).toBe('app-bundle')
    expect(production.env.EXPO_PUBLIC_API_URL).toBe('https://qolumns.com')
    expect(production.env.EXPO_PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/)
    // the third setting lives with the build service (its "production" environment), not in the repository
    expect(production.environment).toBe('production')
    expect(Object.keys(production.env)).not.toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY')
    expect(read('eas.json')).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    // the dev build keeps its own identity, so both can sit on one phone
    expect(eas.build.development.env.APP_VARIANT).toBe('dev')
  })

  it('the downloaded bundle and the emulator’s pictures are never committed or uploaded', () => {
    for (const file of ['../../.gitignore', '../../.vercelignore']) {
      expect(read(file), file).toContain('apps/mobile/build/')
      expect(read(file), file).toContain('scripts/android-check/')
    }
  })
})

describe('T-200: notifications on Android', () => {
  it('without Firebase’s file the app builds, and says it cannot receive them', () => {
    const config = storeConfig()
    expect(config.android.package).toBe('com.qolumns.app')
    expect(config.android.googleServicesFile).toBeUndefined()
    expect(config.extra).toMatchObject({ push: true, pushAndroid: false })
    expect(pushAvailable({ extra: config.extra, projectId: 'project-id', platform: 'android' })).toBe(false)
    // the iPhone build is not affected by Firebase's file
    expect(pushAvailable({ extra: config.extra, projectId: 'project-id', platform: 'ios' })).toBe(true)
  })

  it('with the file (in the folder, or handed over by the build service) it can', () => {
    const file = join(mkdtempSync(join(tmpdir(), 't200-')), 'google-services.json')
    writeFileSync(file, '{}')
    const config = storeConfig(file)
    expect(config.android.googleServicesFile).toBe(file)
    expect(config.extra).toMatchObject({ push: true, pushAndroid: true })
    expect(pushAvailable({ extra: config.extra, projectId: 'project-id', platform: 'android' })).toBe(true)
    // still nothing without the Expo project id a token is made for
    expect(pushAvailable({ extra: config.extra, projectId: undefined, platform: 'android' })).toBe(false)
  })

  it('off means quietly off: one line, no switches, and no other shop is named on Android', () => {
    const section = pushSection({ available: false, permission: 'undetermined', platform: 'android' })
    expect(section).toEqual({ kind: 'unavailable', line: PUSH_COPY.unavailableAndroid })
    expect(PUSH_COPY.unavailableAndroid).not.toMatch(/app store|apple|iphone|google|play/i)
    // the iPhone keeps its own line
    expect(pushSection({ available: false, permission: 'undetermined', platform: 'ios' })).toEqual({ kind: 'unavailable', line: PUSH_COPY.unavailable })
    expect(pushSection({ available: false, permission: 'undetermined' })).toEqual({ kind: 'unavailable', line: PUSH_COPY.unavailable })
  })

  it('the channel is "quotes" in the brand colour, with the mark as its small icon', () => {
    const plugin = (storeConfig().plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as [string, Record<string, unknown>])[1]
    expect(plugin.defaultChannel).toBe(PUSH_ANDROID_CHANNEL.id)
    expect(PUSH_ANDROID_CHANNEL.id).toBe('quotes')
    expect(plugin.color).toBe(PUSH_ANDROID_COLOR)
    expect(plugin.icon).toBe('./assets/notification-icon.png')
    expect(existsSync(join(root, 'assets/notification-icon.png'))).toBe(true)
    const source = read('src/lib/notifications.ts')
    expect(source).toContain('lightColor: PUSH_ANDROID_COLOR')
    // the channel is made before anything is asked: Android 13 shows no permission question without one
    const context = read('src/lib/push-context.tsx')
    expect(context).toContain('void preparePush().then(check)')
    // and the question is asked at the same moment as on the iPhone: the same code, with no branch by phone
    expect(context.slice(context.indexOf('const askOnHome'), context.indexOf('const setPref'))).not.toMatch(/Platform\.OS/)
  })
})

describe('T-200: room scan is not on Android', () => {
  it('an Android phone is "not an iPhone", whatever is installed', () => {
    const module = read('modules/room-scan/index.ts')
    // the first thing asked, before anything about the scanner
    expect(module).toContain("export function roomScanAvailability(): RoomScanAvailability {\n  if (Platform.OS !== 'ios') return 'not_ios'")
    // and the scanner is not built into the Android app at all
    expect(JSON.parse(read('modules/room-scan/expo-module.config.json')).platforms).toEqual(['apple'])
  })

  it('a new quote shows no scan card and no line about an iPhone', () => {
    const screen = read('app/(tabs)/new.tsx')
    // the card, its "needs…" line and its buttons are all inside this one switch
    expect(screen).toContain("const showScan = scanSignals.length > 0 && scanState !== 'not_ios' && scanState !== 'no_lidar'")
    const card = screen.slice(screen.indexOf('{showScan ? ('), screen.indexOf('{fields.map('))
    expect(card.length).toBeGreaterThan(500)
    for (const piece of ['scanBlocked', 'Scan an area', 'Scan another area', 'Clear the scans', 'onScanAgain']) expect(card, piece).toContain(piece)
    // outside the switch, nothing of the scan is drawn
    const form = screen.slice(screen.indexOf('return (', screen.indexOf('const progress = draftProgress(draft)')), screen.indexOf("/** One of the service's own questions"))
    expect(form).toContain(card)
    const outside = form.replace(card, '')
    expect(outside).not.toMatch(/Room scan|scanBlocked|Scan an|Scan again|LiDAR/)
  })

  it('a quote scanned on an iPhone shows its sizes on Android, read-only: no 3D button, no "Scan again", no "Add an area"', () => {
    const screen = read('app/quote/[id].tsx')
    expect(screen).toContain('const scanHere = roomScanAvailability()')
    // the summary itself is shown whatever the phone
    expect(screen).toContain('quote.roomScan && quote.roomScan.rooms.length > 0 ? (')
    expect(screen).toContain("{...(scanHere !== 'not_ios' && { onModel: viewModel })}")
    expect(screen).toContain("quote.roomScan.canScanAgain && scanHere === 'ready' && { onScanAgain")
    // the summary draws a button only for an action it is given
    const summary = read('src/components/RoomScanSummary.tsx')
    expect(summary).toContain('{actions.onModel && hasModel?.(index) ? <Button title="View in 3D"')
    expect(summary).toContain('{actions.onScanAgain ? <Button title="Scan again"')
    expect(summary).toContain('{onAddArea ? (')
  })
})

describe('T-200: the keyboard, the back button and the bars', () => {
  it('fields stay above the keyboard on both phones: the same padding, with no "iPhone only"', () => {
    const ui = read('src/components/ui.tsx')
    expect(ui).toContain('<KeyboardAvoidingView style={[styles.keyboardSpace, style]} behavior="padding" keyboardVerticalOffset={top}>')
    for (const file of ['app/login.tsx', 'app/(tabs)/new.tsx', 'app/quote/[id].tsx']) {
      const screen = read(file)
      expect(screen, file).toContain('<KeyboardSpace')
      expect(screen, file).not.toContain('KeyboardAvoidingView')
    }
    // nowhere in the app is the keyboard left to the iPhone alone
    for (const file of ['app/login.tsx', 'app/(tabs)/new.tsx', 'app/quote/[id].tsx', 'src/components/ui.tsx']) expect(read(file), file).not.toMatch(/behavior=\{Platform/)
  })

  it('Android’s back button in a new quote goes back a step and never closes the app', () => {
    const screen = read('app/(tabs)/new.tsx')
    const listener = screen.slice(screen.indexOf("BackHandler.addEventListener('hardwareBackPress'"), screen.indexOf('return () => listening.remove()'))
    expect(listener).toContain('if (stepBack.current) stepBack.current()')
    expect(listener).toContain("else router.navigate('/')")
    // "true" tells Android the app has dealt with it: the app is not closed
    expect(listener).toContain('return true')
    // in the form it is the form's own "Back": the step before, or the Quotes tab from the first step
    expect(screen).toContain('<StepBack onBack={back} />')
    const back = screen.slice(screen.indexOf('function back() {'), screen.indexOf('function priceThisJob() {'))
    expect(back).toContain('if (previous) goTo(previous)')
    expect(back).toContain("else router.navigate('/')")
    // going back deletes nothing: only "Delete this quote" does
    expect(back).not.toMatch(/discard|remove/)
  })

  it('the tab bar clears Android’s navigation bar, gestures or three buttons', () => {
    const tabs = read('app/(tabs)/_layout.tsx')
    expect(tabs).toContain('height: 62 + insets.bottom')
    expect(tabs).toContain('paddingBottom: Math.max(insets.bottom, 8)')
    // the bar's own bottom button bar does the same when it is not inside the tabs
    expect(read('src/components/ui.tsx')).toContain('Math.max(insets.bottom, space.md)')
  })

  it('the "part of Pro" screen is the same one on both phones: the server’s words, one button, nothing to buy', () => {
    const screen = read('app/(tabs)/new.tsx')
    const closed = screen.slice(screen.indexOf("gate.state === 'closed'"), screen.indexOf('return <NewQuote />'))
    expect(closed).not.toMatch(/Platform\.OS/)
    const words = onsiteNotInPlan()
    expect(`${words.heading} ${words.text} ${words.button}`).not.toMatch(/upgrade|buy|\$|£|price|https?:|play|app store/i)
  })
})
