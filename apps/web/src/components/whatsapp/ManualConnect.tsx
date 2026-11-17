'use client'

import { useState } from 'react'
import type { ConnectionView } from '@/lib/whatsapp-state'
import { PERSONAL_NUMBER_WARNING, PERSONAL_NUMBER_WAY_ROUND } from '@/lib/whatsapp-copy'

const field = 'mt-1 block min-h-[44px] w-full rounded-lg border border-field bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2'
const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50'
const quiet = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50'
const copyButton = 'inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-border px-3 text-sm font-medium text-text-secondary hover:bg-surface'

/**
 * The manual method (T-112): the business has its own Meta app and pastes its
 * credentials. T-175: kept working, under "Connect manually"; the form now
 * also takes the app's secret (each message is checked against it), and the
 * token is checked with Meta on the server when it is saved.
 */
export function ManualConnect({
  config,
  setup,
  needsSecret,
  onSaved,
  onDisconnected,
}: {
  /** the business's manual connection, when it has one */
  config: ConnectionView | null
  setup: { webhookUrl: string; verifyToken: string | null } | null
  needsSecret: boolean
  onSaved: (config: ConnectionView) => void
  onDisconnected: () => void
}) {
  const connected = Boolean(config)
  const [phoneNumberId, setPhoneNumberId] = useState(config?.phoneNumberId ?? '')
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState(config?.displayPhoneNumber ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [isActive, setIsActive] = useState(config?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setNote(null)
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // an empty token or secret keeps the stored one
        body: JSON.stringify({ phoneNumberId, displayPhoneNumber, accessToken: accessToken || undefined, appSecret: appSecret || undefined, isActive }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setNote({ ok: false, text: json?.error?.message || 'Could not save.' })
        return
      }
      setAccessToken('')
      setAppSecret('')
      setNote({ ok: true, text: 'Saved. The details were checked with Meta.' })
      onSaved(json.config as ConnectionView)
    } catch {
      setNote({ ok: false, text: 'Could not reach the server. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setNote(null)
    try {
      const res = await fetch('/api/whatsapp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useStored: true }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setNote({ ok: false, text: json?.error?.message || 'The connection test failed.' })
        return
      }
      setNote({ ok: true, text: `The connection is working: ${json.verifiedName || 'verified'} (${json.displayPhoneNumber || ''})${json.qualityRating ? `, quality ${json.qualityRating}` : ''}.` })
    } catch {
      setNote({ ok: false, text: 'Could not reach the server. Try again.' })
    } finally {
      setTesting(false)
    }
  }

  async function disconnect() {
    const res = await fetch('/api/whatsapp/config', { method: 'DELETE' })
    if (res.ok) onDisconnected()
    else setNote({ ok: false, text: 'Could not disconnect. Try again.' })
  }

  return (
    <div className="space-y-6" data-testid="manual-connect">
      {connected && needsSecret && (
        <p className="rounded-lg border border-danger-line bg-danger-light p-3 text-sm text-danger" role="alert" data-testid="manual-needs-secret">
          Add your Meta app’s App Secret below. Qolumns checks every incoming message against it, and until it is saved no message from this number is
          answered.
        </p>
      )}

      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="phoneNumberId" className="block text-sm font-medium text-text-primary">
            Phone Number ID
          </label>
          <input id="phoneNumberId" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="e.g. 1234567890123456" className={field} required autoComplete="off" />
          <p className="mt-1 text-xs text-text-muted">In your Meta app: WhatsApp → API Setup. The long number under your phone number, not the phone number itself.</p>
        </div>

        <div>
          <label htmlFor="displayPhoneNumber" className="block text-sm font-medium text-text-primary">
            Phone number <span className="font-normal text-text-muted">(optional: Meta tells us)</span>
          </label>
          <input id="displayPhoneNumber" value={displayPhoneNumber} onChange={(e) => setDisplayPhoneNumber(e.target.value)} placeholder="e.g. +1 234 567 8900" className={field} autoComplete="off" />
        </div>

        <div>
          <label htmlFor="accessToken" className="block text-sm font-medium text-text-primary">
            Access token {connected && <span className="font-normal text-text-muted">(leave empty to keep the one saved)</span>}
          </label>
          <input id="accessToken" type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} className={field} required={!connected} autoComplete="off" />
          <p className="mt-1 text-xs text-text-muted">A permanent token from Meta Business Settings → System Users. Stored encrypted and never shown again.</p>
        </div>

        <div>
          <label htmlFor="appSecret" className="block text-sm font-medium text-text-primary">
            App Secret {connected && !needsSecret && <span className="font-normal text-text-muted">(leave empty to keep the one saved)</span>}
          </label>
          <input id="appSecret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} className={field} required={!connected || needsSecret} autoComplete="off" />
          <p className="mt-1 text-xs text-text-muted">In your Meta app: App settings → Basic → App secret. Meta signs each message with it, and we check the signature.</p>
        </div>

        <label className="flex min-h-[44px] items-center gap-3 text-sm text-text-primary">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-6 w-6 rounded-sm accent-primary" />
          Answer messages on this number
        </label>

        {note && (
          <p className={`text-sm ${note.ok ? 'text-secondary' : 'text-danger'}`} role={note.ok ? 'status' : 'alert'} data-testid="manual-note">
            {note.text}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className={primary}>
            {saving ? 'Checking with Meta…' : connected ? 'Save changes' : 'Connect manually'}
          </button>
          {connected && (
            <button type="button" onClick={test} disabled={testing} className={quiet}>
              {testing ? 'Testing…' : 'Test the connection'}
            </button>
          )}
          {connected && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} className={quiet} data-testid="manual-disconnect">
              Disconnect
            </button>
          )}
          {connected && confirming && (
            <>
              <button type="button" onClick={disconnect} className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Yes, disconnect
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={quiet}>
                Keep it connected
              </button>
            </>
          )}
        </div>
      </form>

      <div className="space-y-4">
        <h3 className="font-display text-lg font-bold text-text-primary">Step by step (about 15 minutes, once)</h3>

        <div className="rounded-xl border border-border bg-background p-5">
          <h4 className="font-semibold text-text-primary">1. Create your Meta app with WhatsApp</h4>
          <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-text-secondary">
            <li>
              Go to{' '}
              <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                developers.facebook.com/apps
              </a>{' '}
              → Create App → type Business.
            </li>
            <li>In the app dashboard: Add Product → WhatsApp → Set up.</li>
            <li>Link (or create) your WhatsApp Business phone number when asked.</li>
          </ol>
          <p className="mt-3 text-sm text-text-secondary" data-testid="manual-personal-number-help">
            {PERSONAL_NUMBER_WARNING} {PERSONAL_NUMBER_WAY_ROUND}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background p-5">
          <h4 className="font-semibold text-text-primary">2. Point your app’s webhook at Qolumns</h4>
          <p className="mt-2 text-sm text-text-secondary">
            In your Meta app: WhatsApp → Configuration → Webhook → Edit. Paste these two values, then subscribe to the <span className="font-medium">messages</span> field.
          </p>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-muted">Callback URL</p>
                <code className="block truncate text-sm text-text-primary">{setup?.webhookUrl || '…'}</code>
              </div>
              <button type="button" onClick={() => setup?.webhookUrl && navigator.clipboard.writeText(setup.webhookUrl)} className={copyButton} aria-label="Copy the callback URL">
                Copy
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-surface p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-muted">Verify token</p>
                <code className="block truncate text-sm text-text-primary">{setup?.verifyToken || 'Not set yet. Ask support.'}</code>
              </div>
              {setup?.verifyToken && (
                <button type="button" onClick={() => navigator.clipboard.writeText(setup.verifyToken as string)} className={copyButton} aria-label="Copy the verify token">
                  Copy
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background p-5">
          <h4 className="font-semibold text-text-primary">3. Collect three things and paste them above</h4>
          <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-text-secondary">
            <li>
              <span className="font-medium">Phone Number ID:</span> WhatsApp → API Setup.
            </li>
            <li>
              <span className="font-medium">Permanent access token:</span>{' '}
              <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                Business Settings → System Users
              </a>{' '}
              → create a system user → Generate token with <code className="text-xs">whatsapp_business_messaging</code> and{' '}
              <code className="text-xs">whatsapp_business_management</code>. The temporary token on the API Setup page lasts 24 hours: don’t use it.
            </li>
            <li>
              <span className="font-medium">App Secret:</span> App settings → Basic → App secret → Show.
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
