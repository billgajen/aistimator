'use client'

import { useState } from 'react'
import { PAYMENT_HELP_URL, type ConnectionView } from '@/lib/whatsapp-state'
import { ConnectWhatsApp, type ConnectSettings } from './ConnectWhatsApp'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50'
const quiet = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50'

/**
 * T-175: a connection made through Meta. The number, what happens next, what
 * is still to do (finish registering, add a payment method), the 60-day
 * renewal, a test message, and disconnect.
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
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  const expiring = config.token.state === 'expiring'
  const expired = config.token.state === 'expired'
  const stepsLeft = (config.registered ? 0 : 1) + (config.messagesReady ? 0 : 1)

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
      setCheckNote(json.problem || ((json.config as ConnectionView).messagesReady ? null : 'Meta doesn’t show a payment method on this account yet.'))
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
        body: JSON.stringify({ toPhone: testTo, message: 'This is a test message from your Qolumns connection. It is working.' }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setTestNote({ ok: false, text: json?.error?.message || 'The test message was not sent.' })
        return
      }
      setTestNote({ ok: true, text: 'Sent. It should arrive on that phone in a few seconds.' })
      if (!config.messagesReady) onChanged({ ...config, messagesReady: true })
    } catch {
      setTestNote({ ok: false, text: 'Could not reach the server. Try again.' })
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

        <h3 className="mt-6 text-sm font-semibold text-text-primary">What happens next</h3>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary" data-testid="what-happens-next">
          {config.alsoOnBusinessApp
            ? 'This number is still on your WhatsApp Business app, so your other chats arrive on it too. Qolumns only steps in when a message asks for a quote, an estimate or a price; everything else is left for you to answer in the app. When it does step in, it asks about the job, collects photos and sends the customer a link to their estimate.'
            : 'When a customer messages this number, Qolumns asks about the job, collects photos and sends them a link to their estimate.'}{' '}
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
            {expired ? 'Qolumns can’t answer on this number until you reconnect.' : 'After that Qolumns can’t answer on this number.'} Reconnecting takes one click
            and keeps the same number.
          </p>
          <div className="mt-4">
            <ConnectWhatsApp settings={settings} label="Reconnect WhatsApp" onConnected={(next, problem) => onChanged(next, problem)} />
          </div>
        </section>
      )}

      <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="steps-left">
        <h3 className="text-lg font-medium text-text-primary">
          {stepsLeft === 0 ? 'Nothing left to do' : stepsLeft === 1 ? 'One step left' : 'Two steps left'}
        </h3>

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

        {!config.messagesReady && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4" data-testid="payment-step">
            <h4 className="text-sm font-semibold text-text-primary">Add a payment method in WhatsApp Manager</h4>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              Meta asks every business for one before it will keep delivering your messages. Meta bills you directly for WhatsApp; the card is never shared with
              Qolumns. In WhatsApp Manager, open Overview and press “Add payment method”.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {config.paymentUrl && (
                <a href={config.paymentUrl} target="_blank" rel="noopener noreferrer" className={primary} data-testid="payment-link">
                  Open WhatsApp Manager
                </a>
              )}
              <button type="button" onClick={checkAgain} disabled={checking} className={quiet}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
              <a href={PAYMENT_HELP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-sm text-text-secondary underline underline-offset-2">
                Meta’s instructions
              </a>
            </div>
            {checkNote && (
              <p className="mt-2 text-sm text-text-secondary" role="status" data-testid="check-note">
                {checkNote}
              </p>
            )}
          </div>
        )}

        {stepsLeft === 0 && (
          <p className="mt-1 text-sm text-text-secondary" data-testid="all-done">
            The number is registered and messages are going out.
          </p>
        )}
      </section>

      <section className="rounded-xl bg-surface p-6 shadow-warm">
        <h3 className="text-lg font-medium text-text-primary">Try it</h3>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          From your own phone, send “Hi, I need a quote” to {config.displayPhoneNumber}. Qolumns should answer within a few seconds. Then you can send that
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
          <p className={`mt-2 text-sm ${testNote.ok ? 'text-secondary' : 'text-danger'}`} role={testNote.ok ? 'status' : 'alert'} data-testid="test-note">
            {testNote.text}
          </p>
        )}
      </section>

      <section className="rounded-xl bg-surface p-6 shadow-warm">
        <h3 className="text-lg font-medium text-text-primary">Disconnect</h3>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          Qolumns stops answering on this number and deletes its access to your WhatsApp account. Your number, your chats and your WhatsApp account stay as
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
