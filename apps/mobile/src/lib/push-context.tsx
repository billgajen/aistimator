/**
 * T-196: notifications, for the screens. One place registers the phone
 * (on sign-in and on every launch), opens a tapped notification's quote,
 * asks for permission, keeps the three switches, and forgets the phone on
 * sign-out. In a build that cannot receive notifications every part of this
 * does nothing, and the Account tab says so.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, AppState } from 'react-native'
import { useRouter } from 'expo-router'
import { PUSH_COPY, type PushPrefs } from '@qolumns/shared'
import { useApi } from './api-context'
import {
  askPushPermission,
  askedThisSignIn,
  forgetAsked,
  knownPushToken,
  onPushTap,
  preparePush,
  pushBuild,
  pushPermission,
  pushPlatform,
  pushToken,
  rememberAsked,
} from './notifications'
import { pushSection, shouldAsk, type PushPermission, type PushSection } from './push'
import { supabase } from './supabase'

interface PushContextValue {
  /** What the Account tab's Notifications section shows */
  section: PushSection
  /** The home tab calls this each time it is shown: asks once per sign-in, after one plain line */
  askOnHome: () => void
  /** The phone's own question (the Account tab's "Turn on notifications") */
  turnOn: () => Promise<void>
  /** Set one switch. False when it could not be saved (the switch goes back). */
  setPref: (key: keyof PushPrefs, value: boolean) => Promise<boolean>
  /** Forget this phone, then sign out */
  signOut: () => Promise<void>
}

const PushContext = createContext<PushContextValue | null>(null)

/** How long sign-out waits for the server to forget the phone before signing out anyway */
const FORGET_WAIT_MS = 4000

export function PushProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const api = useApi()
  const router = useRouter()
  const [permission, setPermission] = useState<PushPermission>('undetermined')
  const [prefs, setPrefs] = useState<PushPrefs | null>(null)
  const signedIn = useRef<string | null>(userId)
  signedIn.current = userId
  const waitingPath = useRef<string | null>(null)
  const asking = useRef(false)

  /** Register this phone, or refresh it. The server answers the user's switches. */
  const register = useCallback(async () => {
    const token = await pushToken()
    if (!token || !signedIn.current) return
    try {
      setPrefs((await api.registerPush(token, pushPlatform)).prefs)
    } catch {
      // no signal: the next launch registers it
    }
  }, [api])

  const check = useCallback(async () => {
    if (!pushBuild || !signedIn.current) return
    const now = await pushPermission()
    setPermission(now)
    if (now === 'granted') await register()
  }, [register])

  // on sign-in and on every launch; and when the app comes back to the front (the phone's settings may have changed)
  useEffect(() => {
    if (!pushBuild || !userId) {
      setPrefs(null)
      return
    }
    void preparePush().then(check)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check()
    })
    return () => subscription.remove()
  }, [userId, check])

  // a tapped notification opens its quote; one tapped before the sign-in is known waits for it
  useEffect(() => {
    return onPushTap((path) => {
      if (signedIn.current) router.push(path)
      else waitingPath.current = path
    })
  }, [router])
  useEffect(() => {
    if (userId && waitingPath.current) {
      const path = waitingPath.current
      waitingPath.current = null
      router.push(path)
    }
  }, [userId, router])

  const turnOn = useCallback(async () => {
    const answer = await askPushPermission()
    setPermission(answer)
    if (answer === 'granted') await register()
  }, [register])

  const askOnHome = useCallback(() => {
    const user = signedIn.current
    if (!pushBuild || !user || asking.current) return
    asking.current = true
    void (async () => {
      try {
        const now = await pushPermission()
        setPermission(now)
        if (!shouldAsk({ available: pushBuild, permission: now, askedThisSignIn: await askedThisSignIn(user) })) return
        await rememberAsked(user)
        Alert.alert(PUSH_COPY.askTitle, PUSH_COPY.ask, [
          { text: PUSH_COPY.askNo, style: 'cancel' },
          { text: PUSH_COPY.askYes, onPress: () => void turnOn() },
        ])
      } finally {
        asking.current = false
      }
    })()
  }, [turnOn])

  const setPref = useCallback(
    async (key: keyof PushPrefs, value: boolean) => {
      const before = prefs
      setPrefs((current) => (current ? { ...current, [key]: value } : current))
      try {
        setPrefs((await api.setPushPrefs({ [key]: value })).prefs)
        return true
      } catch {
        setPrefs(before)
        return false
      }
    },
    [api, prefs]
  )

  const signOut = useCallback(async () => {
    const token = knownPushToken()
    if (token) {
      // the phone is forgotten while the sign-in can still say whose it is; a lost signal does not keep anyone signed in
      await Promise.race([api.forgetPush(token).catch(() => undefined), new Promise((done) => setTimeout(done, FORGET_WAIT_MS))])
    }
    if (signedIn.current) await forgetAsked(signedIn.current)
    await supabase.auth.signOut()
  }, [api])

  const value = useMemo<PushContextValue>(
    () => ({ section: pushSection({ available: pushBuild, permission, prefs }), askOnHome, turnOn, setPref, signOut }),
    [permission, prefs, askOnHome, turnOn, setPref, signOut]
  )
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>
}

export function usePush(): PushContextValue {
  const value = useContext(PushContext)
  if (!value) throw new Error('usePush must be used inside PushProvider')
  return value
}
