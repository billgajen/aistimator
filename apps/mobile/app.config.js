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
 * T-196: notifications belong to the App Store app only. A free Personal
 * Team cannot sign an app that asks for the push entitlement, so the dev
 * build is made without that entitlement (see the two notes below), and
 * `extra.push` tells the app which build it is: with it false the
 * app never touches the notifications code and the Account tab says
 * "Available in the App Store version". Everything else in the dev build is
 * as it was.
 */
const { withEntitlementsPlist } = require('expo/config-plugins')

const NOTIFICATIONS_PLUGIN = ['expo-notifications', { defaultChannel: 'quotes', color: '#205E56' }]

/**
 * The dev build names the plugin too, with remote notifications off. Leaving
 * it out is not enough: Expo applies the plugin of an installed package by
 * itself, with its defaults, and that adds the push entitlement.
 */
const NOTIFICATIONS_PLUGIN_WITHOUT_PUSH = ['expo-notifications', { enableRemoteNotifications: false }]

/** And an entitlement already written into an existing ios folder is taken out again */
const withoutPushEntitlement = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment']
    return mod
  })

module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'dev') {
    return {
      ...config,
      plugins: [...(config.plugins ?? []), NOTIFICATIONS_PLUGIN],
      extra: { ...config.extra, push: true },
    }
  }
  return withoutPushEntitlement({
    ...config,
    name: `${config.name} Dev`,
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.dev` },
    android: { ...config.android, package: `${config.android.package}.dev` },
    plugins: [...(config.plugins ?? []), NOTIFICATIONS_PLUGIN_WITHOUT_PUSH],
    extra: { ...config.extra, push: false },
  })
}
