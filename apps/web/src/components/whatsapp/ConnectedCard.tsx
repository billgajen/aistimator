'use client'

import { useEffect, useRef, useState } from 'react'
import { PRODUCT_NAME } from '@qolumns/shared'
import { PAYMENT_HELP_URL, nameReview, type ConnectionView, type LiveStatus } from '@/lib/whatsapp-state'
import { NAME_REVIEW_DAYS, PAYMENT_NOTE, PAYMENT_NOTE_TITLE, isMetaIssuedNumber } from '@/lib/whatsapp-copy'
import { ConnectWhatsApp, type ConnectSettings } from './ConnectWhatsApp'
import { MessageTemplates } from './MessageTemplates'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50'
const quiet = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50'

/** How long, and how often, the page asks what became of a test message */
const DELIVERY_CHECKS = 8
const DELIVERY_CHECK_MS = 2500

/**
 * T-175: a connection made through Meta. The number, what happens next, what
 * is still to do (finish registering), the 60-day renewal, a test message,
 * and disconnect.
 * T-176: a payment method is a note, not a step; Meta's review of the display
 * name is said plainly; the message template; and a test message says what
 * really became of it.
 */
export function ConnectedCard({
  config,
  settings,
  registrationProblem,
  onChanged,
  onDisconnected,
}: {
  config: ConnectionView
  settings: ConnectSettings
  registrationProblem: string | null
  onChanged: (config: ConnectionView, registrationProblem?: string | null) => void
  onDisconnected: () => void
}) {
  const [checking, setChecking] = useState(false)
  const [checkNote, setCheckNote] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registerNote, setRegisterNote] = useState<string | null>(registrationProblem)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testNote, setTestNote] = useState<{ tone: 'ok' | 'info' | 'error'; text: string } | null>(null)
  // what Meta says right now (the display name's review, a card on the account): asked once the page is open
  const [live, setLive] = useState<LiveStatus | null>(null)
  const alive = useRef(true)
  // the test message whose outcome the page is waiting for: a newer one takes over
  const latestTest = useRef('')
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  const expiring = config.token.state === 'expiring'
  const expired = config.token.state === 'expired'
  const stepsLeft = config.registered ? 0 : 1
  const review = nameReview(live?.nameStatus ?? null)
  const hasCard = live?.hasPaymentMethod === true
  // one of Meta's own 555 numbers sends nothing until Meta approves its name
  const heldForName = review === 'in_review' && isMetaIssuedNumber(config.displayPhoneNumber)

  useEffect(() => {
    alive.current = true
    fetch('/api/whatsapp/status', { method: 'POST' })
      .then(async (res) => (res.ok ? ((await res.json()) as { config: ConnectionView; live?: LiveStatus }) : null))
      .then((json) => {
        if (!alive.current || !json) return
        if (json.live) setLive(json.live)
        onChanged(json.config)
      })
      .catch(() => undefined)
    return () => {
      alive.current = false
    }
    // once, when the card opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkAgain() {
    setChecking(true)
    setCheckNote(null)
    try {
      const res = await fetch('/api/whatsapp/status', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setCheckNote(json?.error?.message || 'Could not check. Try again.')
        return
      }
      onChanged(json.config as ConnectionView)
      const now = (json.live as LiveStatus | undefined) ?? null
      if (now) setLive(now)
      setCheckNote(json.problem || (now?.hasPaymentMethod === true ? null : 'Meta doesn’t show a card on this account. That is fine until you need one.'))
    } catch {
      setCheckNote('Could not check. Try again.')
    } finally {
      setChecking(false)
    }
  }

  async function register() {
    setRegistering(true)
    setRegisterNote(null)
    try {
      const res = await fetch('/api/whatsapp/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin || undefined }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setRegisterNote(json?.error?.message || 'Meta has not accepted the number yet. Try again in a few minutes.')
        return
      }
      setPin('')
      onChanged(json.config as ConnectionView, null)
    } catch {
      setRegisterNote('Could not reach the server. Try again.')
    } finally {
      setRegistering(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setTestNote(null)
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toPhone: testTo, message: `This is a test message from your ${PRODUCT_NAME} connection. It is working.` }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setTestNote({ tone: 'error', text: json?.error?.message || 'The test message was not sent.' })
        return
      }
      // Meta accepts a message it will not deliver: only a phone that wrote in the last 24 hours gets it
      const notDelivered = heldForName
        ? 'Meta does not let this number send until it has approved the display name. Try again once the name is approved.'
        : `WhatsApp only delivers this to a phone that has messaged your number in the last 24 hours. Send “Hi” from that phone to ${config.displayPhoneNumber}, then press the button again.`
      const expected = json.windowOpen !== false && !heldForName
      setTestNote(
        expected
          ? { tone: 'ok', text: 'Sent. It should arrive on that phone in a few seconds.' }
          : heldForName
            ? { tone: 'info', text: `Meta accepted the message, but it will not arrive yet. ${notDelivered}` }
            : { tone: 'info', text: `Meta accepted the message, but it will probably not arrive: no message from that phone has reached ${PRODUCT_NAME} in the last 24 hours. ${notDelivered}` }
      )
      if (!config.messagesReady) onChanged({ ...config, messagesReady: true })
      // the send is done: the button is free again while the page asks what Meta reported (delivered, or not)
      setTesting(false)
      const messageId = typeof json.messageId === 'string' ? json.messageId : ''
      latestTest.current = messageId
      for (let i = 0; messageId && i < DELIVERY_CHECKS; i++) {
        await new Promise((resolve) => setTimeout(resolve, DELIVERY_CHECK_MS))
        if (!alive.current || latestTest.current !== messageId) return
        const seen = await fetch(`/api/whatsapp/send?messageId=${encodeURIComponent(messageId)}`)
          .then(async (r) => (r.ok ? ((await r.json()) as { status?: string }) : null))
          .catch(() => null)
        if (seen?.status === 'delivered' || seen?.status === 'read') {
          setTestNote({ tone: 'ok', text: 'Delivered. The test message has arrived on that phone.' })
          return
        }
        if (seen?.status === 'failed') {
          setTestNote({ tone: 'error', text: `Meta did not deliver the message. ${notDelivered}` })
          return
        }
      }
    } catch {
      setTestNote({ tone: 'error', text: 'Could not reach the server. Try again.' })
    } finally {
      setTesting(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      onDisconnected()
    } catch {
      setDisconnectError('Could not disconnect. Try again.')
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="whatsapp-connected">
      <section className="rounded-xl bg-surface p-6 shadow-warm">
        <p className="text-sm font-semibold text-secondary">Connected</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-text-primary" data-testid="connected-number">
          {config.displayPhoneNumber}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {config.verifiedName ? `${config.verifiedName} · ` : ''}Connected with Meta on {day(config.connectedAt)}
          {config.token.state === 'ok' && config.token.expiresAt ? ` · good until ${day(config.token.expiresAt)}` : ''}
        </p>

        {review === 'in_review' && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4" role="status" data-testid="name-in-review">
            <h3 className="text-sm font-semibold text-text-primary">Meta is reviewing the name on this number</h3>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              {config.verifiedName ? `“${config.verifiedName}” is` : 'The display name is'} with Meta for approval. That takes {NAME_REVIEW_DAYS}. Nothing is broken and there is
              nothing for you to do: the number is connected, and this note goes away when Meta approves the name.
            </p>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary" data-testid="name-review-effect">
              {heldForName
                ? `Until then this number cannot send messages. It is one of Meta’s own 555 numbers, and Meta holds those back until the name is approved. So ${PRODUCT_NAME} cannot answer customers on it yet, and a test message will not arrive.`
                : `In the meantime the number works: ${PRODUCT_NAME} answers the customers who message it. Meta shows them your name once it is approved.`}
            </p>
          </div>
        )}
        {review === 'declined' && (
          <div className="mt-4 rounded-lg border border-tertiary-line bg-surface p-4" role="status" data-testid="name-declined">
            <h3 className="text-sm font-semibold text-tertiary">Meta did not approve the name on this number</h3>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Change the display name in WhatsApp Manager, under Phone numbers. It should be the name your customers know your business by.
            </p>
          </div>
        )}

        <h3 className="mt-6 text-sm font-semibold text-text-primary">What happens next</h3>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary" data-testid="what-happens-next">
          {config.alsoOnBusinessApp
            ? `This number is still on your WhatsApp Business app, so your other chats arrive on it too. ${PRODUCT_NAME} only steps in when a message asks for a quote, an estimate or a price; everything else is left for you to answer in the app. When it does step in, it asks about the job, collects photos and sends the customer a link to their estimate.`
            : `When a customer messages this number, ${PRODUCT_NAME} asks about the job, collects photos and sends them a link to their estimate.`}{' '}
          The request then shows in Quotes like any other, priced from your own price list.
        </p>
      </section>

      {(expiring || expired) && (
        <section className={`rounded-xl border p-6 ${expired ? 'border-danger-line bg-danger-light' : 'border-border bg-surface'}`} data-testid="token-warning" role="status">
          <h3 className="text-sm font-semibold text-text-primary">
            {expired
              ? 'This connection has run out'
              : `This connection runs out ${config.token.daysLeft === 0 ? 'today' : `in ${config.token.daysLeft} day${config.token.daysLeft === 1 ? '' : 's'}`}`}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Meta gives each connection 60 days ({expired ? 'this one ended on' : 'this one ends on'} {day(config.token.expiresAt)}).{' '}
            {expired ? `${PRODUCT_NAME} can’t answer on this number until you reconnect.` : `After that ${PRODUCT_NAME} can’t answer on this number.`} Reconnecting takes one click
            and keeps the same number.
          </p>
          <div className="mt-4">
            <ConnectWhatsApp settings={settings} label="Reconnect WhatsApp" onConnected={(next, problem) => onChanged(next, problem)} />
          </div>
        </section>
      )}

      <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="steps-left">
        <h3 className="text-lg font-medium text-text-primary">{stepsLeft === 0 ? 'Nothing left to do' : 'One step left'}</h3>

        {!config.registered && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4" data-testid="register-step">
            <h4 className="text-sm font-semibold text-text-primary">Finish registering the number</h4>
            <p className="mt-1 text-sm text-text-secondary">
              {registerNote || 'Meta has not accepted the number yet.'} If the number already has a two-step PIN, enter it; otherwise leave the box empty.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div>
                <label htmlFor="wa-pin" className="block text-sm font-medium text-text-primary">
                  Two-step PIN (if it has one)
                </label>
                <input
                  id="wa-pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="off"
                  className="mt-1 min-h-[44px] w-40 rounded-lg border border-field bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                />
              </div>
              <button type="button" onClick={register} disabled={registering} className={primary}>
                {registering ? 'Registering…' : 'Register the number'}
              </button>
            </div>
          </div>
        )}

        {stepsLeft === 0 && (
          <p className="mt-1 text-sm text-text-secondary" data-testid="all-done">
            {heldForName
              ? `The number is registered. ${PRODUCT_NAME} starts answering customers on it once Meta approves its name.`
              : `The number is registered, and ${PRODUCT_NAME} answers the customers who message it.`}
          </p>
        )}

        <div className="mt-4 rounded-lg border border-border bg-background p-4" data-testid="payment-note">
          <h4 className="text-sm font-semibold text-text-primary">{hasCard ? 'Meta has a card for this account' : PAYMENT_NOTE_TITLE}</h4>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            {hasCard ? `Meta bills you directly for WhatsApp; the card is never shared with ${PRODUCT_NAME}.` : PAYMENT_NOTE}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {config.paymentUrl && !hasCard && (
              <a href={config.paymentUrl} target="_blank" rel="noopener noreferrer" className={quiet} data-testid="payment-link">
                Add a card in WhatsApp Manager
              </a>
            )}
            <button type="button" onClick={checkAgain} disabled={checking} className={quiet}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
            {!hasCard && (
              <a href={PAYMENT_HELP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-sm text-text-secondary underline underline-offset-2">
                Meta’s instructions
              </a>
            )}
          </div>
          {checkNote && (
            <p className="mt-2 text-sm text-text-secondary" role="status" data-testid="check-note">
              {checkNote}
            </p>
          )}
        </div>
      </section>

      <MessageTemplates connection={config} />

      <section className="rounded-xl bg-surface p-6 shadow-warm">
        <h3 className="text-lg font-medium text-text-primary">Try it</h3>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          From your own phone, send “Hi, I need a quote” to {config.displayPhoneNumber}. {PRODUCT_NAME} should answer within a few seconds. Then you can send that
          phone a test message from here.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div>
            <label htmlFor="wa-test-to" className="block text-sm font-medium text-text-primary">
              Your own mobile number, with country code
            </label>
            <input
              id="wa-test-to"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              className="mt-1 min-h-[44px] w-full rounded-lg border border-field bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 sm:w-64"
            />
          </div>
          <button type="button" onClick={sendTest} disabled={testing || testTo.replace(/\D/g, '').length < 7} className={quiet} data-testid="send-test">
            {testing ? 'Sending…' : 'Send a test message'}
          </button>
        </div>
        {testNote && (
          <p
            className={`mt-2 max-w-2xl text-sm ${testNote.tone === 'ok' ? 'text-secondary' : testNote.tone === 'error' ? 'text-danger' : 'text-text-secondary'}`}
            role={testNote.tone === 'error' ? 'alert' : 'status'}
            data-testid="test-note"
            data-tone={testNote.tone}
          >
            {testNote.text}
          </p>
        )}
      </section>

      <section className="rounded-xl bg-surface p-6 shadow-warm">
        <h3 className="text-lg font-medium text-text-primary">Disconnect</h3>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          {PRODUCT_NAME} stops answering on this number and deletes its access to your WhatsApp account. Your number, your chats and your WhatsApp account stay as
          they are.
        </p>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className={`mt-3 ${quiet}`} data-testid="disconnect">
            Disconnect WhatsApp
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="disconnect-confirm">
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={disconnecting} className={quiet}>
              Keep it connected
            </button>
          </div>
        )}
        {disconnectError && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {disconnectError}
          </p>
        )}
      </section>
    </div>
  )
}
