/**
 * T-201, Part A: the Android app on tablets and Chromebooks, and "View in 3D" on Android.
 *
 * No Android phone or emulator runs here, so these read the app's settings, run the manifest plugin on a
 * manifest, and read the screens' source. The owner's phone is the real check (OWNER-TODO, T-201).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { viewerAddress } from '../lib/model-viewer'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const app = JSON.parse(read('app.json')).expo
const require = createRequire(import.meta.url)

interface Feature {
  $: Record<string, string>
}
interface Manifest {
  manifest: { 'uses-feature'?: Feature[] }
}

/** The plugin's own change, without Expo around it: what it does to a manifest */
const applyPlugin = (manifest: Manifest): Manifest =>
  (require(path.join(root, 'plugins/with-optional-hardware.js')) as { declareOptional: (manifest: Manifest) => Manifest }).declareOptional(manifest)

describe('T-201: Google Play stops leaving out tablets, Chromebooks and headsets', () => {
  it('the app is still portrait-only on a phone', () => {
    expect(app.orientation).toBe('portrait')
  })

  it('the plugin is applied to every build', () => {
    expect(app.plugins).toContain('./plugins/with-optional-hardware')
  })

  it('a portrait screen is declared as not required, and so are the back camera and its autofocus', () => {
    const out = applyPlugin({ manifest: {} })
    expect(out.manifest['uses-feature']).toEqual([
      { $: { 'android:name': 'android.hardware.screen.portrait', 'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.camera.autofocus', 'android:required': 'false' } },
    ])
  })

  it('a line that said "required" is replaced, not doubled, and other features are left alone', () => {
    const out = applyPlugin({
      manifest: {
        'uses-feature': [
          { $: { 'android:name': 'android.hardware.screen.portrait', 'android:required': 'true' } },
          { $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'false' } },
        ],
      },
    })
    const features = out.manifest['uses-feature'] ?? []
    expect(features.filter((f) => f.$['android:name'] === 'android.hardware.screen.portrait')).toEqual([{ $: { 'android:name': 'android.hardware.screen.portrait', 'android:required': 'false' } }])
    expect(features[0]).toEqual({ $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'false' } })
    expect(features).toHaveLength(4)
  })

  it('a device with no camera goes to the gallery instead of doing nothing', () => {
    const screen = read('app/(tabs)/new.tsx')
    expect(screen).toContain('const result = await ImagePicker.launchCameraAsync({ quality: 0.9, exif: false }).catch(() => null)')
    expect(screen).toContain('if (!result) return choosePhotos(angleId)')
  })
})

describe('T-201: "View in 3D" on Android', () => {
  const module = read('modules/room-scan/index.ts')
  const screen = read('app/quote/[id].tsx')

  it('an iPhone can always open the viewer; Android asks the phone whether anything opens a web address', () => {
    expect(module).toContain("export async function canOpenPage(url: string): Promise<boolean> {\n  if (Platform.OS === 'ios') return true\n  try {\n    return await Linking.canOpenURL(url)\n  } catch {\n    return false\n  }\n}")
  })

  it('the button is given to the scan card only where the viewer can open', () => {
    expect(screen).toContain("const [modelOpens, setModelOpens] = useState(Platform.OS === 'ios')")
    expect(screen).toContain('void canOpenPage(config.apiUrl).then((can) => live && setModelOpens(can))')
    expect(screen).toContain('{...(modelOpens && { onModel: viewModel })}')
    // it is no longer tied to "this is an iPhone"
    expect(screen).not.toContain("scanHere !== 'not_ios' && { onModel")
  })

  it('the hook sits with the screen’s other state, before the screen can return early', () => {
    expect(screen.indexOf('const [modelOpens, setModelOpens]')).toBeGreaterThan(0)
    expect(screen.indexOf('const [modelOpens, setModelOpens]')).toBeLessThan(screen.indexOf('if (!quote) {'))
  })

  it('without the iPhone’s in-app browser, the phone’s own browser opens the page', () => {
    expect(module).toContain('if (native?.openPage) return native.openPage(url)\n  await Linking.openURL(url)')
  })

  it('scanning stays off on Android: only looking at a model is new', () => {
    expect(module).toContain("if (Platform.OS !== 'ios') return 'not_ios'")
    expect(screen).toContain("quote.roomScan.canScanAgain && scanHere === 'ready' && { onScanAgain")
  })

  it('the page opened is the web’s viewer, with the model’s address after "#" (never sent to a server)', () => {
    const url = viewerAddress('https://example.test/', 'https://files.example.test/m.usdz?sig=a&b=1', 'Living room')
    expect(url).toBe('https://example.test/room-model#src=https%3A%2F%2Ffiles.example.test%2Fm.usdz%3Fsig%3Da%26b%3D1&name=Living%20room')
  })

  it('Android may ask what opens a web address: the manifest says so (Expo’s own template, checked in the bundle)', () => {
    // nothing to set in app.json: the <queries> block for https links comes with Expo's Android template.
    // This test only records where the answer comes from, so nobody adds a second block.
    expect(JSON.stringify(app.android)).not.toContain('queries')
  })
})
