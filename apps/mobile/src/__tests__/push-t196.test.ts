/**
 * T-196: notifications in the app, and the home tab's "Won this month" line.
 * The rules that are plain functions are held here, with what each screen's
 * source must hold; a notification arriving on a real phone needs the App
 * Store build (a paid Apple account), which is the owner's test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { DEFAULT_PUSH_PREFS, PUSH_ANDROID_CHANNEL, PUSH_COPY } from '@qolumns/shared'
import { createApi } from '../lib/api'
import { PUSH_SWITCHES, askedKey, pathForPush, pushAvailable, pushSection, shouldAsk } from '../lib/push'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')

/** app.config.js as Expo reads it, for one variant */
function appConfig(variant: string | undefined): { name: string; plugins: unknown[]; extra: { push?: boolean }; ios: { bundleIdentifier: string }; android: { package: string } } {
  const before = process.env.APP_VARIANT
  if (variant) process.env.APP_VARIANT = variant
  else delete process.env.APP_VARIANT
  try {
    const require = createRequire(import.meta.url)
    const path = join(__dirname, '../../app.config.js')
    delete require.cache[require.resolve(path)]
    const build = require(path) as (input: { config: unknown }) => never
    return build({ config: JSON.parse(read('app.json')).expo })
  } finally {
    if (before === undefined) delete process.env.APP_VARIANT
    else process.env.APP_VARIANT = before
  }
}
const pluginNamed = (plugins: unknown[], name: string) => plugins.find((p) => p === name || (Array.isArray(p) && p[0] === name)) as [string, Record<string, unknown>] | string | undefined

describe('T-196: push belongs to the App Store build only', () => {
  it('the App Store variant has the notifications plugin and says it can receive them', () => {
    const config = appConfig(undefined)
    expect(config.name).toBe('Qolumns')
    expect(config.ios.bundleIdentifier).toBe('com.qolumns.app')
    expect(config.extra.push).toBe(true)
    const plugin = pluginNamed(config.plugins, 'expo-notifications') as [string, Record<string, unknown>]
    expect(plugin).toBeDefined()
    expect(plugin[1].enableRemoteNotifications).toBeUndefined()
    // Android: the channel the server posts to, set up now
    expect(plugin[1].defaultChannel).toBe(PUSH_ANDROID_CHANNEL.id)
  })

  it('the dev variant keeps its own identity and has remote notifications turned off (no push entitlement)', () => {
    const config = appConfig('dev')
    expect(config.name).toBe('Qolumns Dev')
    expect(config.ios.bundleIdentifier).toBe('com.qolumns.app.dev')
    expect(config.android.package).toBe('com.qolumns.app.dev')
    expect(config.extra.push).toBe(false)
    // named, with remote notifications off: left out, Expo would add the plugin itself with the entitlement
    expect((pluginNamed(config.plugins, 'expo-notifications') as [string, Record<string, unknown>])[1]).toEqual({ enableRemoteNotifications: false })
    // every plugin the build had before T-196 is still there, in the same order
    const names = (plugins: unknown[]) => plugins.map((p) => (Array.isArray(p) ? p[0] : p))
    expect(names(config.plugins).slice(0, -1)).toEqual(names(JSON.parse(read('app.json')).expo.plugins))
    // and an entitlement left in an existing ios folder is taken out
    expect(read('app.config.js')).toContain("delete mod.modResults['aps-environment']")
  })

  it('a build can receive notifications only with the flag, a project id and a phone', () => {
    expect(pushAvailable({ extra: { push: true }, projectId: 'project-id', platform: 'ios' })).toBe(true)
    expect(pushAvailable({ extra: { push: true }, projectId: 'project-id', platform: 'android' })).toBe(true)
    expect(pushAvailable({ extra: { push: false }, projectId: 'project-id', platform: 'ios' })).toBe(false)
    expect(pushAvailable({ extra: {}, projectId: 'project-id', platform: 'ios' })).toBe(false)
    expect(pushAvailable({ extra: undefined, projectId: 'project-id', platform: 'ios' })).toBe(false)
    expect(pushAvailable({ extra: { push: true }, projectId: undefined, platform: 'ios' })).toBe(false)
    expect(pushAvailable({ extra: { push: true }, projectId: 'project-id', platform: 'web' })).toBe(false)
    // "true" as text is not the flag
    expect(pushAvailable({ extra: { push: 'true' }, projectId: 'project-id', platform: 'ios' })).toBe(false)
  })

  it('the notifications module is loaded only inside a function that first checks the build', () => {
    const source = read('src/lib/notifications.ts')
    // the only import of the module is its types (erased when built)
    const imports = source.split('\n').filter((line) => /from 'expo-notifications'/.test(line))
    expect(imports).toEqual(["import type * as ExpoNotifications from 'expo-notifications'"])
    expect(source.match(/require\('expo-notifications'\)/g)).toHaveLength(1)
    // every function that calls load() returns first when the build cannot receive notifications
    const bodies = source.split(/\nexport (?:async )?function /).slice(1)
    const loading = bodies.filter((body) => body.includes('load()'))
    expect(loading.length).toBeGreaterThanOrEqual(5)
    for (const body of loading) expect(body.indexOf('if (!pushBuild')).toBeGreaterThan(-1)
    for (const body of loading) expect(body.indexOf('if (!pushBuild')).toBeLessThan(body.indexOf('load()'))
    // no screen and no other file touches the module
    for (const file of ['app/_layout.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/account.tsx', 'src/lib/push-context.tsx', 'src/lib/push.ts']) {
      expect(read(file), file).not.toContain('expo-notifications')
    }
  })
})

describe('T-196: the Notifications section', () => {
  it('the dev build says "Available in the App Store version", whatever the phone says', () => {
    for (const permission of ['granted', 'denied', 'undetermined'] as const) {
      expect(pushSection({ available: false, permission, prefs: DEFAULT_PUSH_PREFS })).toEqual({ kind: 'unavailable', line: 'Available in the App Store version' })
    }
  })

  it('three switches, all on by default', () => {
    expect(PUSH_SWITCHES).toEqual(['newRequest', 'accepted', 'question'])
    expect(pushSection({ available: true, permission: 'granted' })).toEqual({ kind: 'on', prefs: { newRequest: true, accepted: true, question: true } })
    expect(pushSection({ available: true, permission: 'granted', prefs: { newRequest: true, accepted: false, question: true } })).toEqual({
      kind: 'on',
      prefs: { newRequest: true, accepted: false, question: true },
    })
    for (const key of PUSH_SWITCHES) expect(PUSH_COPY.switches[key].title.length).toBeGreaterThan(3)
  })

  it('refused on the phone: the switches show off and say where to change it', () => {
    expect(pushSection({ available: true, permission: 'denied', prefs: DEFAULT_PUSH_PREFS })).toEqual({
      kind: 'refused',
      line: "Turned off in your phone's settings",
      prefs: { newRequest: false, accepted: false, question: false },
    })
  })

  it('not asked yet ("Not now"): a row that asks, with the one plain line', () => {
    expect(pushSection({ available: true, permission: 'undetermined' }).kind).toBe('ask')
    const account = read('app/(tabs)/account.tsx')
    expect(account).toContain('PUSH_COPY.section')
    expect(account).toContain('note={PUSH_COPY.ask}')
    expect(account).toContain("notifications.kind === 'unavailable'")
    expect(account).toContain("disabled={notifications.kind === 'refused'}")
    expect(account).toContain('Linking.openSettings()')
    // signing out forgets the phone first; the screen no longer signs out by itself
    expect(account).toContain('push.signOut()')
    expect(account).not.toContain('supabase.auth.signOut()')
  })
})

describe('T-196: asking, registering, tapping', () => {
  it('permission is asked once per sign-in, on the home tab, and never in a build that cannot receive notifications', () => {
    expect(shouldAsk({ available: true, permission: 'undetermined', askedThisSignIn: false })).toBe(true)
    expect(shouldAsk({ available: true, permission: 'undetermined', askedThisSignIn: true })).toBe(false)
    expect(shouldAsk({ available: true, permission: 'granted', askedThisSignIn: false })).toBe(false)
    expect(shouldAsk({ available: true, permission: 'denied', askedThisSignIn: false })).toBe(false)
    expect(shouldAsk({ available: false, permission: 'undetermined', askedThisSignIn: false })).toBe(false)
    expect(read('app/(tabs)/index.tsx')).toContain('push.askOnHome()')
    const context = read('src/lib/push-context.tsx')
    // one plain line saying what they will get, before the phone's own question
    expect(context).toContain('Alert.alert(PUSH_COPY.askTitle, PUSH_COPY.ask')
    expect(PUSH_COPY.ask).toBe('We will tell you when a customer sends a request, accepts an estimate or asks a question. Nothing else.')
    expect(askedKey('0b0f4f2e-6a4d-4c1e-9d1b-1f0a5c3e7a11')).toBe('push-asked.0b0f4f2e-6a4d-4c1e-9d1b-1f0a5c3e7a11')
    expect(askedKey('a/b c')).toBe('push-asked.abc')
  })

  it('the token is registered on sign-in and on every launch, and deleted on sign-out', () => {
    const context = read('src/lib/push-context.tsx')
    expect(context).toContain('api.registerPush(token, pushPlatform)')
    // on sign-in and launch (the effect on the user), and when the app comes back to the front
    expect(context).toMatch(/void preparePush\(\)\.then\(check\)/)
    expect(context).toMatch(/if \(state === 'active'\) void check\(\)/)
    // sign-out: forget the phone, then sign out, and a lost signal does not block it
    expect(context.indexOf('api.forgetPush(token)')).toBeGreaterThan(-1)
    expect(context.indexOf('api.forgetPush(token)')).toBeLessThan(context.indexOf('supabase.auth.signOut()'))
    expect(context).toContain('Promise.race')
  })

  it('tapping a notification opens that quote, and only a quote', () => {
    expect(pathForPush({ quoteId: 'qte_715b602154d77fc7a4ccdd69', event: 'accepted' })).toBe('/quote/qte_715b602154d77fc7a4ccdd69')
    expect(pathForPush({ quoteId: '../account' })).toBeNull()
    expect(pathForPush({ url: 'https://example.test' })).toBeNull()
    expect(pathForPush(undefined)).toBeNull()
    // a tap before the sign-in is known waits for it
    expect(read('src/lib/push-context.tsx')).toContain('waitingPath.current = path')
  })

  it('the Android channel is made before anything is shown', () => {
    const source = read('src/lib/notifications.ts')
    expect(source).toContain('setNotificationChannelAsync(PUSH_ANDROID_CHANNEL.id')
    expect(PUSH_ANDROID_CHANNEL).toEqual({ id: 'quotes', name: 'Requests and estimates' })
  })

  it('the API calls: the user\'s own token and switches, with the sign-in', async () => {
    const calls: Array<{ url: string; method: string; body: unknown; auth: string | undefined }> = []
    const api = createApi({
      baseUrl: 'https://app.example.test/',
      getAccessToken: async () => 'access-token',
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, auth: (init?.headers as Record<string, string>).Authorization })
        return new Response(JSON.stringify({ prefs: DEFAULT_PUSH_PREFS, registered: true, ok: true }), { status: 200 })
      },
    })
    await api.registerPush('ExponentPushToken[abc]', 'ios')
    await api.setPushPrefs({ question: false })
    await api.pushPrefs()
    await api.forgetPush('ExponentPushToken[abc]')
    await api.bootstrap('Europe/London')
    await api.bootstrap()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT https://app.example.test/api/app/push-token',
      'PATCH https://app.example.test/api/app/push-token',
      'GET https://app.example.test/api/app/push-token',
      'DELETE https://app.example.test/api/app/push-token',
      'GET https://app.example.test/api/app/bootstrap?tz=Europe%2FLondon',
      'GET https://app.example.test/api/app/bootstrap',
    ])
    expect(calls[0]?.body).toEqual({ token: 'ExponentPushToken[abc]', platform: 'ios' })
    expect(calls[1]?.body).toEqual({ question: false })
    expect(calls[3]?.body).toEqual({ token: 'ExponentPushToken[abc]' })
    for (const call of calls) expect(call.auth).toBe('Bearer access-token')
  })
})

describe('T-196: the home tab', () => {
  const home = read('app/(tabs)/index.tsx')

  it('one line at the top, served by the bootstrap route, and nothing before the first accepted estimate', () => {
    expect(home).toContain('api.bootstrap(phoneTimeZone())')
    expect(home).toContain('setWon(start.won ?? null)')
    expect(home).toContain('won && (won.headline || won.onSite)')
    expect(home).toContain('{won.headline}')
    expect(home).toContain('{won.onSite}')
    // above the account line and the quotes
    expect(home.indexOf('{won.headline}')).toBeLessThan(home.indexOf('{notice ?'))
  })

  it('a question\'s hint is shown once in the app too', () => {
    const form = read('app/(tabs)/new.tsx')
    expect(form).toContain('placeholder={fieldExample(field)}')
    expect(form).not.toContain('placeholder={field.placeholder}')
  })
})
