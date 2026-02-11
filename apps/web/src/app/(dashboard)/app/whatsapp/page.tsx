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
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

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
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                config?.isActive
                  ? 'bg-secondary-light text-secondary'
                  : 'bg-background text-text-primary'
              }`}
            >
              {config?.isActive ? 'Active' : 'Inactive'}
            </span>
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

      {/* Setup Instructions */}
      <div className="mt-6 rounded-warm-lg bg-primary-light p-6">
        <h3 className="font-medium text-primary">Setup Instructions</h3>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-primary">
          <li>Go to Meta Business Suite and create a WhatsApp Business account</li>
          <li>Navigate to WhatsApp &gt; API Setup to get your Phone Number ID</li>
          <li>Generate a permanent access token in System Users settings</li>
          <li>Configure your webhook URL in Meta Business Suite:</li>
        </ol>
        <div className="mt-3 rounded bg-surface p-3">
          <p className="text-xs text-text-muted">Webhook URL:</p>
          <code className="text-sm text-text-primary">
            {typeof window !== 'undefined' ? window.location.origin : ''}/api/whatsapp/webhook
          </code>
        </div>
        <p className="mt-3 text-xs text-primary">
          Verify token: Use the value from your WHATSAPP_VERIFY_TOKEN environment variable
        </p>
      </div>
    </div>
  )
}
