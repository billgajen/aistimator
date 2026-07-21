'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'

interface WhatsAppConfig {
  phoneNumberId: string
  displayPhoneNumber: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function WhatsAppSettingsPage() {
  const [configured, setConfigured] = useState(false)
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  // T-112: webhook values the business pastes into Meta
  const [setup, setSetup] = useState<{ webhookUrl: string; verifyToken: string | null } | null>(null)

  // Form state
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    fetchConfig()
  }, [])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  async function fetchConfig() {
    try {
      const response = await fetch('/api/whatsapp/config')
      if (!response.ok) {
        throw new Error('Failed to fetch config')
      }
      const data = await response.json()
      setConfigured(data.configured)
      setConfig(data.config)
      setSetup(data.setup || null)

      if (data.config) {
        setPhoneNumberId(data.config.phoneNumberId)
        setDisplayPhoneNumber(data.config.displayPhoneNumber)
        setIsActive(data.config.isActive)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      // T-112: verify new credentials against the Graph API BEFORE saving —
      // catches bad tokens/IDs at setup time instead of at the first customer message
      if (accessToken) {
        const verifyRes = await fetch('/api/whatsapp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumberId, accessToken }),
        })
        const verifyData = await verifyRes.json()
        if (!verifyRes.ok) {
          throw new Error(verifyData.error?.message || 'Credential verification failed')
        }
        if (verifyData.displayPhoneNumber && !displayPhoneNumber) {
          setDisplayPhoneNumber(verifyData.displayPhoneNumber)
        }
        setToast({
          message: `Verified with Meta: ${verifyData.verifiedName || 'OK'} (${verifyData.displayPhoneNumber || phoneNumberId})`,
          type: 'success',
        })
      }

      const response = await fetch('/api/whatsapp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId,
          displayPhoneNumber,
          accessToken: accessToken || 'unchanged', // Don't require re-entry if updating
          isActive,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to save')
      }

      setToast({ message: 'WhatsApp configuration saved', type: 'success' })
      setAccessToken('') // Clear token field after save
      fetchConfig()
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to save',
        type: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  /** T-112: re-verify the stored connection against the Graph API */
  async function handleTestConnection() {
    setTesting(true)
    try {
      const response = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useStored: true }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error?.message || 'Connection test failed')
      }
      setToast({
        message: `Connection healthy — ${data.verifiedName || 'verified'} (${data.displayPhoneNumber || ''})${data.qualityRating ? `, quality: ${data.qualityRating}` : ''}`,
        type: 'success',
      })
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Connection test failed',
        type: 'error',
      })
    } finally {
      setTesting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect WhatsApp?')) {
      return
    }

    try {
      const response = await fetch('/api/whatsapp/config', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect')
      }

      setToast({ message: 'WhatsApp disconnected', type: 'success' })
      setConfigured(false)
      setConfig(null)
      setPhoneNumberId('')
      setDisplayPhoneNumber('')
      setAccessToken('')
      setIsActive(true)
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to disconnect',
        type: 'error',
      })
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader
          title="WhatsApp"
          description="Connect WhatsApp Business to receive quote requests"
        />
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        description="Connect WhatsApp Business to receive quote requests"
      />

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 rounded-warm-lg p-4 ${
            toast.type === 'success' ? 'bg-secondary-light text-secondary' : 'bg-danger-light text-danger'
          }`}
        >
          {toast.message}
        </div>
      )}

      {error && <div className="mb-4 rounded-warm-lg bg-danger-light p-4 text-danger">{error}</div>}

      {/* Status Card */}
      <div className="mb-6 rounded-warm-lg bg-surface p-6 shadow-warm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full ${
                configured && config?.isActive ? 'bg-secondary-light' : 'bg-background'
              }`}
            >
              <svg className="h-6 w-6 text-secondary" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-text-primary">
                {configured ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
              </h3>
              <p className="text-sm text-text-muted">
                {configured && config?.isActive
                  ? `Active: ${config.displayPhoneNumber}`
                  : configured
                    ? 'Configured but inactive'
                    : 'Connect your WhatsApp Business number'}
              </p>
            </div>
          </div>
          {configured && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="rounded-warm-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  config?.isActive
                    ? 'bg-secondary-light text-secondary'
                    : 'bg-background text-text-primary'
                }`}
              >
                {config?.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Configuration Form */}
      <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <h2 className="text-lg font-medium text-text-primary">
          {configured ? 'Update Configuration' : 'Connect WhatsApp'}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Enter your WhatsApp Business API credentials from Meta Business Suite.
        </p>

        <form onSubmit={handleSave} className="mt-6 space-y-4">
          <div>
            <label htmlFor="phoneNumberId" className="block text-sm font-medium text-text-secondary">
              Phone Number ID
            </label>
            <input
              type="text"
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="e.g., 1234567890123456"
              className="mt-1 block w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              required
            />
            <p className="mt-1 text-xs text-text-muted">
              Found in Meta Business Suite under WhatsApp &gt; API Setup
            </p>
          </div>

          <div>
            <label htmlFor="displayPhoneNumber" className="block text-sm font-medium text-text-secondary">
              Display Phone Number
            </label>
            <input
              type="text"
              id="displayPhoneNumber"
              value={displayPhoneNumber}
              onChange={(e) => setDisplayPhoneNumber(e.target.value)}
              placeholder="e.g., +1 234 567 8900"
              className="mt-1 block w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              required
            />
            <p className="mt-1 text-xs text-text-muted">
              Your WhatsApp Business phone number
            </p>
          </div>

          <div>
            <label htmlFor="accessToken" className="block text-sm font-medium text-text-secondary">
              Access Token {configured && '(leave empty to keep current)'}
            </label>
            <input
              type="password"
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={configured ? '••••••••' : 'Enter your access token'}
              className="mt-1 block w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              required={!configured}
            />
            <p className="mt-1 text-xs text-text-muted">
              Permanent token from Meta Business Suite. Keep this secure.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
            />
            <label htmlFor="isActive" className="text-sm text-text-secondary">
              Enable WhatsApp integration
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-warm-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : configured ? 'Update Configuration' : 'Connect WhatsApp'}
            </button>

            {configured && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="rounded-warm-lg border border-danger/20 px-4 py-2 text-danger hover:bg-danger-light"
              >
                Disconnect
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Guided setup walkthrough (T-112) */}
      {!configured && (
        <div className="mt-6 space-y-4">
          <h3 className="font-display text-lg font-bold text-text-primary">
            Step-by-step setup (~15 minutes, one time)
          </h3>

          <div className="rounded-warm-lg bg-surface p-5 shadow-warm">
            <h4 className="font-semibold text-text-primary">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span>
              Create your Meta app with WhatsApp
            </h4>
            <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-text-secondary">
              <li>
                Go to{' '}
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                  developers.facebook.com/apps
                </a>{' '}
                → <span className="font-medium">Create App</span> → type <span className="font-medium">Business</span>
              </li>
              <li>In the app dashboard, click <span className="font-medium">Add Product</span> → <span className="font-medium">WhatsApp</span> → Set up</li>
              <li>Link (or create) your WhatsApp Business phone number when prompted</li>
            </ol>
          </div>

          <div className="rounded-warm-lg bg-surface p-5 shadow-warm">
            <h4 className="font-semibold text-text-primary">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</span>
              Point Meta&apos;s webhook at us
            </h4>
            <p className="mt-2 text-sm text-text-secondary">
              In your Meta app: <span className="font-medium">WhatsApp → Configuration → Webhook → Edit</span>. Paste these two values, then subscribe to the{' '}
              <span className="font-medium">messages</span> field:
            </p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded bg-background p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-text-muted">Callback URL</p>
                  <code className="block truncate text-sm text-text-primary">{setup?.webhookUrl || '…'}</code>
                </div>
                <button
                  type="button"
                  onClick={() => setup?.webhookUrl && navigator.clipboard.writeText(setup.webhookUrl)}
                  className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface"
                >
                  Copy
                </button>
              </div>
              <div className="flex items-center gap-2 rounded bg-background p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-text-muted">Verify token</p>
                  <code className="block truncate text-sm text-text-primary">
                    {setup?.verifyToken || 'Not configured — set WHATSAPP_VERIFY_TOKEN on the server first'}
                  </code>
                </div>
                {setup?.verifyToken && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(setup.verifyToken!)}
                    className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface"
                  >
                    Copy
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-warm-lg bg-surface p-5 shadow-warm">
            <h4 className="font-semibold text-text-primary">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">3</span>
              Get your credentials and connect above
            </h4>
            <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-text-secondary">
              <li>
                <span className="font-medium">Phone Number ID</span>: WhatsApp → API Setup — the long number under your phone number (not the phone number itself)
              </li>
              <li>
                <span className="font-medium">Permanent access token</span>:{' '}
                <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
                  Business Settings → System Users
                </a>{' '}
                → create a system user → <span className="font-medium">Generate token</span> with{' '}
                <code className="text-xs">whatsapp_business_messaging</code> and <code className="text-xs">whatsapp_business_management</code> permissions.
                (The API Setup page&apos;s temporary token expires in 24h — don&apos;t use it.)
              </li>
              <li>Paste both into the form above — we verify them with Meta before saving</li>
            </ol>
          </div>

          <p className="text-xs text-text-muted">
            Once connected, any customer message to your WhatsApp number starts an instant quote
            conversation — and because customers message you first, these conversations are free
            under Meta&apos;s pricing.
          </p>
        </div>
      )}
    </div>
  )
}
