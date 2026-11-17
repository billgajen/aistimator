'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fromMeta, readSignupMessage, signupLoginOptions, type SignupMessage } from '@/lib/whatsapp-signup'
import type { ConnectionView } from '@/lib/whatsapp-state'

export interface ConnectSettings {
  available: boolean
  appId: string | null
  configId: string | null
  graphVersion: string
}

interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(callback: (response: { authResponse?: { code?: string } | null }) => void, options: ReturnType<typeof signupLoginOptions>): void
}
declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'
/** How long to wait for Meta's message after its window hands back the code (the code itself lasts 30 seconds) */
const MESSAGE_WAIT_MS = 4000
/** How long Meta's script is given to load before the page says it has not */
const SDK_WAIT_MS = 8000

type Finished = Extract<SignupMessage, { kind: 'finished' }>

/**
 * T-175: "Connect WhatsApp". Opens Meta's Embedded Signup with our
 * configuration. Two things come back, in either order: Meta's window posts a
 * message naming the WhatsApp account and number, and the login callback hands
 * over a code. Both go to the server, which does everything else; nothing
 * secret is handled here.
 */
export function ConnectWhatsApp({
  settings,
  label = 'Connect WhatsApp',
  locked = false,
  onConnected,
}: {
  settings: ConnectSettings
  label?: string
  /** T-176: held shut until the business has said which app its number is on */
  locked?: boolean
  onConnected: (config: ConnectionView, registrationProblem: string | null) => void
}) {
  const [sdkReady, setSdkReady] = useState(false)
  // Meta's script did not load (most often a content blocker): say so, the button cannot work without it
  const [sdkBlocked, setSdkBlocked] = useState(false)
  const [busy, setBusy] = useState<'meta' | 'saving' | null>(null)
  const [note, setNote] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const finished = useRef<Finished | null>(null)
  const code = useRef<string | null>(null)
  const sent = useRef(false)
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null)
  const usable = settings.available && Boolean(settings.appId && settings.configId)

  // Load Meta's SDK once, for this page only
  useEffect(() => {
    if (!usable || !settings.appId) return
    const init = () => {
      window.FB?.init({ appId: settings.appId as string, autoLogAppEvents: true, xfbml: true, version: settings.graphVersion })
      setSdkReady(Boolean(window.FB))
      setSdkBlocked(false)
    }
    if (window.FB) {
      init()
      return
    }
    window.fbAsyncInit = init
    if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
      const script = document.createElement('script')
      script.src = SDK_URL
      script.async = true
      script.defer = true
      script.crossOrigin = 'anonymous'
      script.onerror = () => setSdkBlocked(true)
      document.body.appendChild(script)
    }
    // some blockers neither load the script nor report an error
    const slow = setTimeout(() => setSdkBlocked(!window.FB), SDK_WAIT_MS)
    return () => clearTimeout(slow)
  }, [usable, settings.appId, settings.graphVersion])

  const finish = useCallback(async () => {
    if (sent.current || !code.current) return
    sent.current = true
    if (waiting.current) clearTimeout(waiting.current)
    setBusy('saving')
    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.current,
          wabaId: finished.current?.wabaId ?? undefined,
          phoneNumberId: finished.current?.phoneNumberId ?? undefined,
          businessId: finished.current?.businessId ?? undefined,
          onBusinessApp: finished.current?.onBusinessApp ?? undefined,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setNote({ kind: 'error', text: json?.error?.message || 'Could not finish connecting. Try again.' })
        return
      }
      setNote(null)
      onConnected(json.config as ConnectionView, (json.registrationProblem as string | null) ?? null)
    } catch {
      setNote({ kind: 'error', text: 'Could not reach the server. Check your connection and try again.' })
    } finally {
      setBusy(null)
    }
  }, [onConnected])

  // Meta's window tells us which account and number were connected
  useEffect(() => {
    if (!usable) return
    const onMessage = (event: MessageEvent) => {
      if (!fromMeta(event.origin)) return
      const message = readSignupMessage(event.data)
      if (!message) return
      if (message.kind === 'finished') {
        finished.current = message
        if (code.current) void finish()
      } else if (message.kind === 'cancelled') {
        setNote({ kind: 'info', text: 'You closed Meta’s window before the end, so nothing was connected. You can start again whenever you like.' })
      } else {
        setNote({ kind: 'error', text: message.message ? `Meta reported a problem: ${message.message}` : 'Meta reported a problem. Try again.' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [usable, finish])

  function launch() {
    if (locked || !window.FB || !settings.configId) return
    finished.current = null
    code.current = null
    sent.current = false
    setNote(null)
    setBusy('meta')
    // Meta's SDK calls this back when its window closes (it must not be an async function)
    window.FB.login((response) => {
      const received = response.authResponse?.code
      if (received) {
        code.current = received
        if (finished.current) void finish()
        // the message normally arrives first; if it has not, give it a moment, then let the server work the account out
        else waiting.current = setTimeout(() => void finish(), MESSAGE_WAIT_MS)
        return
      }
      setBusy(null)
      if (finished.current) {
        setNote({ kind: 'info', text: 'Meta’s window was closed on its last screen before “Finish” was pressed, so the connection was not completed. Press the button again and choose Finish at the end.' })
      } else {
        setNote((current) => current ?? { kind: 'info', text: 'Meta’s window was closed, so nothing was connected.' })
      }
    }, signupLoginOptions(settings.configId))
  }

  return (
    <div>
      <button
        type="button"
        onClick={launch}
        disabled={locked || !usable || !sdkReady || busy !== null}
        data-testid="connect-whatsapp"
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
      >
        {busy === 'meta' ? 'Waiting for Meta…' : busy === 'saving' ? 'Connecting…' : label}
      </button>
      {!usable && (
        <p className="mt-2 text-sm text-text-secondary" data-testid="connect-unavailable">
          One-click connect isn’t switched on yet. You can still connect manually below.
        </p>
      )}
      {usable && sdkBlocked && !sdkReady && (
        <p className="mt-2 text-sm text-text-secondary" role="status" data-testid="connect-blocked">
          Meta’s sign-up has not loaded. A content blocker may be stopping it: allow connect.facebook.net on this page and reload.
        </p>
      )}
      {note && (
        <p
          className={`mt-3 rounded-lg border p-3 text-sm ${note.kind === 'error' ? 'border-danger-line bg-danger-light text-danger' : 'border-border bg-background text-text-secondary'}`}
          role={note.kind === 'error' ? 'alert' : 'status'}
          data-testid="connect-note"
        >
          {note.text}
        </p>
      )}
    </div>
  )
}
