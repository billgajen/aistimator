'use client'

import { useState, type FormEvent } from 'react'
import { postAuth } from '@/components/auth/auth-form'
import { CHANGE_PASSWORD_COPY, NEW_PASSWORD_MIN_LENGTH } from '@/lib/change-password'

const FIELD = 'mt-1 w-full rounded-xl border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2'

/**
 * T-201: Settings → Business → "Change password". Current password, the new
 * one, and the new one again. The server checks the current password; the
 * email address is not changed here.
 */
export function ChangePassword() {
  const C = CHANGE_PASSWORD_COPY
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    if (next !== confirm) {
      setMessage({ ok: false, text: C.mismatch })
      return
    }
    setSaving(true)
    const result = await postAuth('/api/auth/change-password', { currentPassword: current, newPassword: next, confirmPassword: confirm })
    setSaving(false)
    if (result.ok) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setMessage({ ok: true, text: C.done })
    } else {
      setMessage({ ok: false, text: result.message ?? C.failed })
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-surface p-6 shadow-warm" data-testid="change-password">
      <h2 className="text-lg font-medium text-text-primary">{C.title}</h2>
      <p className="mt-1 text-sm text-text-muted">{C.intro}</p>
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2 sm:max-w-sm">
          <label htmlFor="current-password" className="block text-sm font-medium text-text-secondary">
            {C.current}
          </label>
          <input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-text-secondary">
            {C.next}
          </label>
          <input id="new-password" type="password" autoComplete="new-password" required minLength={NEW_PASSWORD_MIN_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} className={FIELD} />
          <p className="mt-1 text-xs text-text-muted">Minimum {NEW_PASSWORD_MIN_LENGTH} characters</p>
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-text-secondary">
            {C.confirm}
          </label>
          <input id="confirm-password" type="password" autoComplete="new-password" required minLength={NEW_PASSWORD_MIN_LENGTH} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={FIELD} />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        {message && (
          <span className={`text-sm ${message.ok ? 'text-secondary' : 'text-danger'}`} role="status" data-testid="change-password-message">
            {message.text}
          </span>
        )}
        <button type="submit" disabled={saving} className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
          {saving ? C.saving : C.button}
        </button>
      </div>
    </form>
  )
}
