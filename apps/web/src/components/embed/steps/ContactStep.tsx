'use client'

import { useState } from 'react'
import { checkContact, type ContactRequirement } from '@/lib/contact-rules'

/**
 * T-151: contact details come first, straight after the service: "Where
 * should we send your estimate?" Which of email and phone are required is the
 * business's setting; the phone example and hint come from the region.
 */
export function ContactStep({
  businessName,
  requirement,
  phoneExample,
  phoneHint,
  name,
  email,
  phone,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onBack,
  onNext,
  saving,
  serverErrors,
  note,
}: {
  businessName: string
  requirement: ContactRequirement
  phoneExample: string
  phoneHint: string
  name: string
  email: string
  phone: string
  onNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onBack?: () => void
  onNext: () => void
  saving: boolean
  /** Errors the server returned for these fields */
  serverErrors?: Partial<Record<'name' | 'email' | 'phone', string>>
  /** T-153 demo: e.g. "Example details. No message will be sent." */
  note?: string
}) {
  const [touched, setTouched] = useState(false)
  const check = checkContact({ name, email, phone }, requirement)
  const errors = touched ? { ...check.errors, ...serverErrors } : serverErrors ?? {}
  const emailRequired = requirement !== 'phone'
  const phoneRequired = requirement !== 'email'

  const field = (hasError: boolean) =>
    `w-full px-4 py-3 text-[15px] bg-white border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${
      hasError ? 'border-danger/50 focus:ring-danger/25 focus:border-danger' : 'border-border focus:ring-primary/25 focus:border-primary'
    }`
  const optional = <span className="font-normal text-text-muted"> (optional)</span>

  return (
    <div className="p-6">
      <h3 className="font-display text-xl font-bold text-text-primary mb-5">Where should we send your estimate?</h3>
      {note && (
        <p className="-mt-2 mb-4 rounded-warm-lg border border-tape/50 bg-butter px-3 py-2 text-sm text-text-primary" role="note" data-testid="demo-contact-note">
          {note}
        </p>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="contact-name" className="block text-[13px] font-semibold text-text-primary mb-1.5">Your name</label>
          <input id="contact-name" type="text" autoComplete="name" value={name} onChange={(e) => onNameChange(e.target.value)} className={field(Boolean(errors.name))} />
          {errors.name && <p className="text-xs text-danger mt-1">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="contact-email" className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Email{!emailRequired && optional}
          </label>
          <input id="contact-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => onEmailChange(e.target.value)} className={field(Boolean(errors.email))} />
          {errors.email && <p className="text-xs text-danger mt-1">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="contact-phone" className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Phone{!phoneRequired && optional}
          </label>
          <input id="contact-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => onPhoneChange(e.target.value)} placeholder={phoneExample} className={field(Boolean(errors.phone))} />
          {errors.phone ? <p className="text-xs text-danger mt-1">{errors.phone}</p> : <p className="text-xs text-text-muted mt-1">{phoneHint}</p>}
        </div>
      </div>

      <p className="mt-5 text-xs text-text-muted">
        {businessName} uses these details only to send your estimate and contact you about this job.
      </p>

      <div className="flex gap-3 mt-6">
        {onBack && (
          <button type="button" onClick={onBack} className="px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setTouched(true)
            if (check.ok) onNext()
          }}
          disabled={saving}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover active:scale-[0.995] disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
