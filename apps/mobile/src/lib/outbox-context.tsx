/**
 * T-182: the sending queue (outbox.ts) wired to the phone.
 *
 * While anything is waiting on the network the queue is tried every few
 * seconds, and at once when the app comes back to the front. The queue itself
 * decides whether it is time (it waits out a lost signal and a rate limit).
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { useApi } from './api-context'
import { outboxStore, putPhoto, removePhoto } from './device-files'
import { createOutbox, type Outbox, type OutboxState } from './outbox'
import { saveQuoteToken } from './quote-tokens'
import { currentUserId } from './supabase'

const OutboxContext = createContext<Outbox | null>(null)
/** False until what was saved on the phone has been read back */
const ReadyContext = createContext(false)

/** How often the queue is tried while it has work */
const TICK_MS = 4000

const newId = () => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

export function OutboxProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const outbox = useMemo(() => {
    // the business's form key: asked for once, then remembered while the app runs
    let tenantKey: Promise<string> | null = null
    return createOutbox({
      api,
      tenantKey: () => {
        tenantKey ??= api.bootstrap().then(
          (boot) => boot.tenantKey,
          (error) => {
            tenantKey = null
            throw error
          }
        )
        return tenantKey
      },
      store: outboxStore,
      files: { put: putPhoto, remove: removePhoto },
      saveQuoteLink: saveQuoteToken,
      owner: currentUserId,
      now: () => Date.now(),
      newId,
    })
  }, [api])

  const [ready, setReady] = useState(false)
  useEffect(() => {
    void outbox.load().then(() => {
      setReady(true)
      void outbox.pump()
    })
    const timer = setInterval(() => {
      if (outbox.hasWork() && AppState.currentState === 'active') void outbox.pump()
    }, TICK_MS)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') outbox.retryNow()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [outbox])

  return (
    <OutboxContext.Provider value={outbox}>
      <ReadyContext.Provider value={ready}>{children}</ReadyContext.Provider>
    </OutboxContext.Provider>
  )
}

export function useOutbox(): Outbox {
  const outbox = useContext(OutboxContext)
  if (!outbox) throw new Error('useOutbox must be used inside OutboxProvider')
  return outbox
}

export function useOutboxState(): OutboxState {
  const outbox = useOutbox()
  return useSyncExternalStore(outbox.subscribe, outbox.getState, outbox.getState)
}

/** Has the phone's saved work been read back? A new quote waits for it, so an unfinished one is carried on, not doubled. */
export function useOutboxReady(): boolean {
  return useContext(ReadyContext)
}
