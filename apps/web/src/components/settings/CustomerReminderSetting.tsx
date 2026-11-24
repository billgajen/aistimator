'use client'

import { useState } from 'react'
import { CUSTOMER_REMINDER_COPY } from '@qolumns/shared'

/**
 * T-201: the one automatic reminder to a customer, on or off. On unless the business switches it off.
 * It saves when it is changed: there is nothing else on the card to save with it.
 */
export function CustomerReminderSetting({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function change(next: boolean) {
    setOn(next)
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerReminder: next }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok) {
        setMessage({ ok: true, text: next ? CUSTOMER_REMINDER_COPY.savedOn : CUSTOMER_REMINDER_COPY.savedOff })
      } else {
        // the tick goes back to what is saved
        setOn(!next)
        setMessage({ ok: false, text: json?.error?.message || 'Could not save' })
      }
    } catch {
      setOn(!next)
      setMessage({ ok: false, text: 'Could not save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-surface p-6 shadow-warm" data-testid="customer-reminder-setting">
      <h2 className="text-lg font-medium text-text-primary">{CUSTOMER_REMINDER_COPY.title}</h2>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={saving}
          onChange={(e) => void change(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded-sm border-border text-primary"
        />
        <span>
          <span className="block text-sm font-medium text-text-secondary">{CUSTOMER_REMINDER_COPY.label}</span>
          <span className="mt-1 block text-sm text-text-muted">{CUSTOMER_REMINDER_COPY.help}</span>
        </span>
      </label>
      <p className="mt-3 min-h-5 text-sm" role="status" aria-live="polite">
        {message && <span className={message.ok ? 'text-secondary' : 'text-danger'}>{message.text}</span>}
      </p>
    </div>
  )
}
