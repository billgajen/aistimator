/**
 * T-196: the calls to the phone for notifications.
 *
 * `expo-notifications` is loaded only inside these functions, and every one
 * of them returns at once in a build that cannot receive notifications
 * (`pushBuild` false: the dev build has no push entitlement). So that build
 * never runs a line of the notifications module and behaves as it did before
 * this ticket.
 */
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
// types only: nothing of the module is loaded by this line
import type * as ExpoNotifications from 'expo-notifications'
import { PUSH_ANDROID_CHANNEL, PUSH_ANDROID_COLOR, isExpoPushToken, type PushPlatform } from '@qolumns/shared'
import { askedKey, pathForPush, pushAvailable, type PushPermission } from './push'

const projectId: string | undefined =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined

/** Can this build receive notifications? False in the dev build, and (T-200) in an Android build made without Firebase's file. */
export const pushBuild: boolean = pushAvailable({ extra: Constants.expoConfig?.extra, projectId, platform: Platform.OS })

export const pushPlatform: PushPlatform = Platform.OS === 'android' ? 'android' : 'ios'

type Notifications = typeof ExpoNotifications

/** The module, loaded when first needed. Never called when `pushBuild` is false. */
function load(): Notifications {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as Notifications
}

function permissionOf(status: { granted?: boolean; canAskAgain?: boolean; status?: string } | null | undefined): PushPermission {
  if (status?.granted) return 'granted'
  if (status?.status === 'undetermined') return 'undetermined'
  return 'denied'
}

/** What the phone says now. "denied" in a build that cannot receive notifications is never shown: the section says so itself. */
export async function pushPermission(): Promise<PushPermission> {
  if (!pushBuild) return 'denied'
  try {
    return permissionOf(await load().getPermissionsAsync())
  } catch {
    return 'denied'
  }
}

/** The phone's own question. Asked once by the phone; afterwards it answers without showing anything. */
export async function askPushPermission(): Promise<PushPermission> {
  if (!pushBuild) return 'denied'
  try {
    return permissionOf(await load().requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }))
  } catch {
    return 'denied'
  }
}

let prepared = false

/**
 * Once per launch: the Android channel every notification is posted to
 * (Android shows nothing without one, and Android 13 and later will not even
 * show its permission question until the app has a channel), and a
 * notification that arrives while the app is open is shown as a banner like
 * any other. T-200: the channel carries the brand colour.
 */
export async function preparePush(): Promise<void> {
  if (!pushBuild || prepared) return
  prepared = true
  try {
    const N = load()
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    })
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL.id, { name: PUSH_ANDROID_CHANNEL.name, importance: N.AndroidImportance.HIGH, lightColor: PUSH_ANDROID_COLOR })
    }
  } catch {
    // a phone that will not take the channel still runs the app
  }
}

let lastToken: string | null = null

/** This device's Expo push token, or null when it has none (no permission, a simulator, no signal) */
export async function pushToken(): Promise<string | null> {
  if (!pushBuild) return null
  try {
    const N = load()
    if (!(await N.getPermissionsAsync()).granted) return null
    const token = (await N.getExpoPushTokenAsync({ projectId })).data
    lastToken = isExpoPushToken(token) ? token : null
    return lastToken
  } catch {
    return null
  }
}

/** The token last read in this launch (for sign-out, which must not wait on the network for a new one) */
export function knownPushToken(): string | null {
  return lastToken
}

/**
 * A tapped notification opens its quote. `open` gets the path; the caller
 * decides whether anyone is signed in. Covers a tap that started the app.
 * Returns how to stop listening.
 */
export function onPushTap(open: (path: string) => void): () => void {
  if (!pushBuild) return () => undefined
  try {
    const N = load()
    const handled = new Set<string>()
    const handle = (response: { notification: { request: { identifier: string; content: { data?: unknown } } } } | null) => {
      if (!response) return
      const id = response.notification.request.identifier
      if (handled.has(id)) return
      handled.add(id)
      const path = pathForPush(response.notification.request.content.data)
      if (path) open(path)
    }
    const subscription = N.addNotificationResponseReceivedListener(handle)
    // a tap that started the app
    handle(N.getLastNotificationResponse())
    return () => subscription.remove()
  } catch {
    return () => undefined
  }
}

/** Have we asked since this sign-in? Kept in the keychain so closing the app does not ask again. */
export async function askedThisSignIn(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(askedKey(userId))) === '1'
  } catch {
    return true
  }
}

export async function rememberAsked(userId: string): Promise<void> {
  await SecureStore.setItemAsync(askedKey(userId), '1').catch(() => undefined)
}

export async function forgetAsked(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(askedKey(userId)).catch(() => undefined)
}
