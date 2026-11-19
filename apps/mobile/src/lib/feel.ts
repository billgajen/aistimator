/**
 * How the app feels in the hand (T-184): a light tap on main actions, and
 * respect for the phone's Reduce Motion setting.
 *
 * A tap that cannot be given (an older phone, a setting, the simulator) is
 * simply not given: nothing here can fail an action.
 */
import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import * as Haptics from 'expo-haptics'

/** A light tap: a main button was pressed */
export function tap(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
  } catch {
    // no haptics on this phone
  }
}

/** A short "done" pattern: a quote was approved, a link copied */
export function done(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
  } catch {
    // no haptics on this phone
  }
}

/** True when the phone is set to reduce motion: nothing then moves for decoration */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => alive && setReduce(on),
      () => undefined
    )
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => {
      alive = false
      subscription.remove()
    }
  }, [])
  return reduce
}
