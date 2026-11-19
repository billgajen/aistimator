/**
 * T-184: a second identity for a build made to try the app on a phone.
 *
 * The App Store app will be `com.qolumns.app`. A build installed from a Mac
 * with a free Apple ID registers its identifier to that personal team, and an
 * identifier can belong to one team only. So such a build is made with
 * APP_VARIANT=dev, which gives it its own identifier and name ("Qolumns Dev")
 * and leaves the real one free for the Apple Developer account later. Both
 * can sit on the same phone.
 *
 * Without APP_VARIANT this changes nothing: app.json is used as it is.
 */
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'dev') return config
  return {
    ...config,
    name: `${config.name} Dev`,
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.dev` },
    android: { ...config.android, package: `${config.android.package}.dev` },
  }
}
