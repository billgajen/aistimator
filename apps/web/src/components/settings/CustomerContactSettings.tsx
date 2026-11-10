'use client'

import { useState } from 'react'
import type { ContactRequirement } from '@/lib/contact-rules'

const OPTIONS: Array<{ value: ContactRequirement; label: string; help: string }> = [
  { value: 'email', label: 'Email required, phone optional', help: 'Customers get their estimate by email. Most businesses use this.' },
  { value: 'phone', label: 'Phone required, email optional', help: 'For businesses that call customers back. Customers without an email still get the link on screen.' },
  { value: 'both', label: 'Both email and phone required', help: 'Asks for more up front, so a few customers may not finish.' },
]

/** T-151: which contact details a customer must give before the questions */
export function CustomerContactSettings({ initial }: { initial: ContactRequirement }) {
  const [value, setValue] = useState<ContactRequirement>(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactRequirement: value }),
      })
      const json = await res.json().catch(() => null)
      setMessage(res.ok ? { ok: true, text: 'Saved' } : { ok: false, text: json?.error?.message || 'Could not save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-warm-lg bg-surface p-6 shadow-warm" data-testid="contact-settings">
      <h2 className="text-lg font-medium text-text-primary">Customer contact details</h2>
      <p className="mt-1 text-sm text-text-muted">What customers must give you before the questions, so you can reach them even if they don&apos;t finish.</p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Required contact details</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 ${value === o.value ? 'border-primary bg-mint' : 'border-border bg-background'}`}>
            <input type="radio" name="contactRequirement" value={o.value} checked={value === o.value} onChange={() => setValue(o.value)} className="mt-0.5 h-4 w-4 text-primary" />
            <span>
              <span className="block text-sm font-medium text-text-primary">{o.label}</span>
              <span className="mt-0.5 block text-xs text-text-muted">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex items-center justify-end gap-3">
        {message && <span className={`text-sm ${message.ok ? 'text-secondary' : 'text-danger'}`}>{message.text}</span>}
        <button onClick={save} disabled={saving} className="inline-flex items-center rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
          {saving ? 'Saving...' : 'Save contact settings'}
        </button>
      </div>
    </div>
  )
}
