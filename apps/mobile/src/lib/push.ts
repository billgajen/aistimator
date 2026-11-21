/**
 * T-196: the phone's notifications — the rules that are plain functions.
 * No React Native here (testable); the calls to the phone are in
 * notifications.ts.
 *
 * Three notifications only (a new request, an accepted estimate, a customer's
 * question): which, and what they say, is the server's rule
 * (packages/shared/src/push.ts). This file decides what the app shows:
 *
 *   - a build that cannot receive notifications (the dev build installed from
 *     a Mac, or one with no project id) says "Available in the App Store
 *     version" and never asks the phone for anything;
 *   - permission is asked once, the first time the user reaches the home tab
 *     after signing in, after one plain line saying what they will get;
 *   - when the phone refuses, the switches say "Turned off in your phone's
 *     settings".
 */
import { DEFAULT_PUSH_PREFS, PUSH_COPY, quoteIdFromPushData, type PushPrefs } from '@qolumns/shared'

/** What the phone says about notifications for this app */
export type PushPermission = 'granted' | 'denied' | 'undetermined'

/**
 * Can this build receive notifications at all? Only the App Store variant
 * (`extra.push`, set in app.config.js), on a phone, with the Expo project id
 * a push token is made for.
 */
export function pushAvailable(build: { extra?: unknown; projectId?: unknown; platform?: unknown }): boolean {
  const push = typeof build.extra === 'object' && build.extra !== null ? (build.extra as { push?: unknown }).push : undefined
  const platform = build.platform
  return push === true && typeof build.projectId === 'string' && build.projectId.length > 0 && (platform === 'ios' || platform === 'android')
}

/** Ask now? Only where notifications can work, the phone has not been asked, and we have not asked since this sign-in. */
export function shouldAsk(state: { available: boolean; permission: PushPermission; askedThisSignIn: boolean }): boolean {
  return state.available && state.permission === 'undetermined' && !state.askedThisSignIn
}

export type PushSection =
  /** This build cannot receive notifications: one line, no switches */
  | { kind: 'unavailable'; line: string }
  /** The phone refuses: the switches are shown off and cannot be changed here */
  | { kind: 'refused'; line: string; prefs: PushPrefs }
  /** Not asked yet (the user said "Not now"): a row that asks */
  | { kind: 'ask'; prefs: PushPrefs }
  /** On: three switches */
  | { kind: 'on'; prefs: PushPrefs }

/** What the Account tab's Notifications section shows */
export function pushSection(state: { available: boolean; permission: PushPermission; prefs?: PushPrefs | null }): PushSection {
  if (!state.available) return { kind: 'unavailable', line: PUSH_COPY.unavailable }
  const prefs = state.prefs ?? { ...DEFAULT_PUSH_PREFS }
  if (state.permission === 'denied') return { kind: 'refused', line: PUSH_COPY.refused, prefs: { newRequest: false, accepted: false, question: false } }
  if (state.permission === 'undetermined') return { kind: 'ask', prefs }
  return { kind: 'on', prefs }
}

/** The switches in the order they are shown */
export const PUSH_SWITCHES: Array<keyof PushPrefs> = ['newRequest', 'accepted', 'question']

/** The screen a tapped notification opens: that quote, and nothing else */
export function pathForPush(data: unknown): string | null {
  const quoteId = quoteIdFromPushData(data)
  return quoteId ? `/quote/${quoteId}` : null
}

/** The key the "already asked since this sign-in" note is kept under (a keychain key: letters, digits, dots, dashes) */
export function askedKey(userId: string): string {
  return `push-asked.${userId.replace(/[^A-Za-z0-9._-]/g, '')}`
}
