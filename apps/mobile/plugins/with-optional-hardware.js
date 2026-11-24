/**
 * T-201: hardware the Android app can do without, said so in the manifest.
 *
 * Google Play reads what an app "needs" from its manifest, and hides the app
 * from every device without it. Two things are read as needs although the app
 * works without them:
 *
 *  - a portrait screen. The app is portrait-only on a phone (`orientation` in
 *    app.json), and Play takes that to mean the device must have a portrait
 *    screen, which leaves out tablets, Chromebooks and headsets.
 *  - a back camera with autofocus. Asking for the camera permission implies
 *    both, and a Chromebook often has a front camera only. A quote's photos
 *    can be chosen from the gallery, so no camera is needed.
 *
 * Each is declared with required="false": the app still uses it where it is
 * there, and Play stops leaving those devices out. Nothing changes on a phone.
 */
const { withAndroidManifest } = require('expo/config-plugins')

const OPTIONAL = ['android.hardware.screen.portrait', 'android.hardware.camera', 'android.hardware.camera.autofocus']

/** The change itself, on the manifest as Expo hands it over (kept apart so a test can run it) */
function declareOptional(androidManifest) {
  const manifest = androidManifest.manifest
  const others = (manifest['uses-feature'] ?? []).filter((feature) => !OPTIONAL.includes(feature.$?.['android:name']))
  manifest['uses-feature'] = [...others, ...OPTIONAL.map((name) => ({ $: { 'android:name': name, 'android:required': 'false' } }))]
  return androidManifest
}

module.exports = function withOptionalHardware(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = declareOptional(mod.modResults)
    return mod
  })
}

module.exports.OPTIONAL = OPTIONAL
module.exports.declareOptional = declareOptional
