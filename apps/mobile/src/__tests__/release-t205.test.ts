/**
 * T-205: the app is ready for one production build at 1.0.0, and its Account screen opens the
 * support page.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { supportUrl, deleteAccountUrl } from '../lib/account'

const APP = join(__dirname, '../..')
const ROOT = join(APP, '../..')
const read = (path: string) => readFileSync(join(APP, path), 'utf8')
const app = JSON.parse(read('app.json')).expo as { version: string; ios: { supportsTablet?: boolean; buildNumber?: string; bundleIdentifier: string }; android: { package: string } }
const eas = JSON.parse(read('eas.json')) as { cli: { appVersionSource?: string }; build: { production: { autoIncrement?: boolean; android?: { buildType?: string } } } }

describe('T-205 item 1: version 1.0.0, build numbers left to EAS', () => {
  it('the version a store shows is 1.0.0, for both stores (one setting)', () => {
    expect(app.version).toBe('1.0.0')
    expect(JSON.parse(read('package.json')).version).toBe('1.0.0')
  })

  it('build numbers are kept by EAS and go up by themselves; none is typed for iOS', () => {
    expect(eas.cli.appVersionSource).toBe('remote')
    expect(eas.build.production.autoIncrement).toBe(true)
    expect(app.ios.buildNumber).toBeUndefined()
    expect(eas.build.production.android?.buildType).toBe('app-bundle')
  })

  it('the app config does not set a version of its own', () => {
    expect(read('app.config.js')).not.toMatch(/\bversion\s*:/)
  })

  it('iPad support stays on, and the store identifiers are unchanged', () => {
    expect(app.ios.supportsTablet).toBe(true)
    expect(app.ios.bundleIdentifier).toBe('com.qolumns.app')
    expect(app.android.package).toBe('com.qolumns.app')
  })
})

describe('T-205 item 1: a wide screen (seen on a 13-inch iPad in the simulator)', () => {
  it('every screen’s content is one column, centred, never wider than the theme’s limit', () => {
    const ui = read('src/components/ui.tsx')
    expect(ui).toContain("screenColumn: { flex: 1, width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },")
    expect(ui).toContain('<View style={styles.screenColumn}>{children}</View>')
    expect(read('src/theme.ts')).toContain('export const layout = { contentMaxWidth: 720 }')
  })

  it('every screen is drawn inside that frame', () => {
    for (const screen of ['app/(tabs)/index.tsx', 'app/(tabs)/new.tsx', 'app/(tabs)/account.tsx', 'app/quote/[id].tsx', 'app/login.tsx', 'app/link.tsx']) {
      expect(read(screen), screen).toContain('<Screen>')
    }
  })

  it('a tab’s label sits under its icon on every size: beside it, the round centre button covered the first letter', () => {
    expect(read('app/(tabs)/_layout.tsx')).toContain("tabBarLabelPosition: 'below-icon',")
  })
})

describe('T-205 item 2: the Account screen opens the support page', () => {
  it('its address is the website’s own support page', () => {
    expect(supportUrl('https://qolumns.com')).toBe('https://qolumns.com/support')
    expect(supportUrl('https://qolumns.com/')).toBe('https://qolumns.com/support')
    expect(deleteAccountUrl('https://qolumns.com')).toBe('https://qolumns.com/data-deletion')
  })

  it('the row is there, between "Help" and "Sign out"', () => {
    const account = read('app/(tabs)/account.tsx')
    const row = account.indexOf('title="Support page"')
    expect(row).toBeGreaterThan(account.indexOf('title="Help"'))
    expect(row).toBeLessThan(account.indexOf('title="Sign out"'))
    expect(account).toContain('Linking.openURL(supportUrl(config.apiUrl))')
  })
})

describe('T-205 item 4: the App Store pictures are in the repository', () => {
  const store = join(ROOT, 'Docs/store/app-store')
  it('the header and five screens, for a 6.3-inch iPhone and a 13-inch iPad', () => {
    expect(existsSync(join(store, 'header.png'))).toBe(true)
    for (const folder of ['iphone-6.3', 'ipad-13']) {
      expect(readdirSync(join(store, folder)).filter((f) => f.endsWith('.png')).sort(), folder).toEqual(['1-list.png', '2-detail.png', '3-progress.png', '4-onsite.png', '5-scan.png'])
    }
  })
})
