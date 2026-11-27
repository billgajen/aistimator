import { useSyncExternalStore } from 'react'

/**
 * T-207: what this browser remembers about the guides (a watched guide, a
 * hidden "Getting started" card). It is a convenience kept in localStorage:
 * a browser that refuses storage (a private window, blocked site data) still
 * works, and remembers for as long as the page is open.
 */
const CHANGED = 'qolumns:guide-memory'
const thisPage = new Set<string>()

export function remembered(key: string): boolean {
  if (thisPage.has(key)) return true
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function remember(key: string): void {
  if (remembered(key)) return
  thisPage.add(key)
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // storage is refused: remembered for this page only
  }
  try {
    window.dispatchEvent(new Event(CHANGED))
  } catch {
    // nothing is listening
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange)
  // another tab of the same browser
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** True once `key` is remembered. The server, and the first paint, always say "not yet". */
export function useRemembered(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => remembered(key),
    () => false
  )
}
