'use client'

import { useEffect, useState } from 'react'

/**
 * T-152: Settings → Notifications. The same field and the same PUT /api/tenant
 * as before; it moved here from the business settings page.
 */
export function NotificationsSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [notificationEmail, setNotificationEmail] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/tenant')
      .then((res) => res.json())
      .then((data) => {
        setUserEmail(data.user?.email || '')
        setNotificationEmail(data.tenant?.notificationEmail || '')
      })
      .catch(() => setMessage({ kind: 'error', text: 'Could not load your settings' }))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationEmail: notificationEmail.trim() || null }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error?.message || 'Could not save')
      setMessage({ kind: 'ok', text: 'Saved' })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
      <h2 className="text-lg font-medium text-text-primary">Notifications</h2>
      <p className="mt-1 text-sm text-text-muted">Where we email you about new requests and quotes</p>

      <div className="mt-6">
        <label htmlFor="notification-email" className="block text-sm font-medium text-text-secondary">
          Send notifications to
        </label>
        <input
          id="notification-email"
          type="email"
          value={notificationEmail}
          onChange={(e) => setNotificationEmail(e.target.value)}
          placeholder={userEmail || 'Leave empty to use account email'}
          className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <p className="mt-1 text-xs text-text-muted">
          Quote notifications will be sent to this email instead of your account email. Leave empty to use your
          account email{userEmail ? ` (${userEmail})` : ''}.
        </p>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        {message && (
          <span className={`text-sm ${message.kind === 'ok' ? 'text-secondary' : 'text-danger'}`} role="status">
            {message.text}
          </span>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Notifications'}
        </button>
      </div>
    </div>
  )
}
