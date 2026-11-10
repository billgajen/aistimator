'use client'

import { useState } from 'react'
import { TIMING_CHOICES, checkAcceptance, type Timing } from '@/lib/acceptance'

/**
 * T-151: tapping Accept asks for the next step — when suits the customer,
 * the job address and a phone number — and accepts with them in one go, so
 * the business's acceptance email carries all of it.
 */
export function AcceptDetailsForm({
  businessName,
  initialPhone,
  phoneExample,
  submitting,
  serverErrors,
  onCancel,
  onConfirm,
}: {
  businessName: string
  initialPhone: string
  phoneExample?: string
  submitting: boolean
  serverErrors?: Partial<Record<string, string>>
  onCancel: () => void
  onConfirm: (details: { timing: Timing; timingNote: string; address: string; phone: string }) => void
}) {
  const [timing, setTiming] = useState<Timing | ''>('')
  const [note, setNote] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState(initialPhone)
  const [touched, setTouched] = useState(false)
  const check = checkAcceptance({ timing, timingNote: note, address, phone })
  const errors = { ...(touched && !check.ok ? check.errors : {}), ...serverErrors }
  const input = 'w-full px-4 py-3 text-sm border border-border rounded-warm-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition'

  return (
    <div className="space-y-5 rounded-warm-xl border border-border bg-background p-5" data-testid="accept-details">
      <div>
        <h3 className="font-display text-lg font-bold text-text-primary">Great. A few details for {businessName}</h3>
        <p className="mt-1 text-sm text-text-secondary">So they can get in touch and plan the job.</p>
      </div>

      <fieldset>
        <legend className="text-[13px] font-semibold text-text-primary mb-2">When suits you?</legend>
        <div className="space-y-2">
          {TIMING_CHOICES.map((choice) => (
            <label key={choice.value} className="flex items-center gap-2.5 px-4 py-3 bg-white border border-border rounded-warm-lg cursor-pointer hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-mint transition">
              <input type="radio" name="timing" value={choice.value} checked={timing === choice.value} onChange={() => setTiming(choice.value)} className="w-[18px] h-[18px] accent-[#205E56]" />
              <span className="text-sm text-text-secondary">{choice.label}</span>
            </label>
          ))}
        </div>
        {errors.timing && <p className="text-xs text-danger mt-1">{errors.timing}</p>}
        <label htmlFor="timing-note" className="sr-only">A note about timing</label>
        <input id="timing-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Anything about timing? (optional)" className={`mt-2 ${input}`} />
      </fieldset>

      <div>
        <label htmlFor="job-address" className="block text-[13px] font-semibold text-text-primary mb-1.5">Address of the job</label>
        <input id="job-address" type="text" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} className={input} />
        {errors.address && <p className="text-xs text-danger mt-1">{errors.address}</p>}
      </div>

      <div>
        <label htmlFor="accept-phone" className="block text-[13px] font-semibold text-text-primary mb-1.5">Best phone number</label>
        <input id="accept-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={phoneExample} className={input} />
        {errors.phone && <p className="text-xs text-danger mt-1">{errors.phone}</p>}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="py-3 px-4 text-sm font-semibold text-text-secondary border border-border rounded-warm-lg hover:bg-surface transition">
          Back
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setTouched(true)
            if (check.ok) onConfirm({ timing: check.value.timing, timingNote: note, address, phone })
          }}
          className="flex-1 py-3 px-4 rounded-warm-lg font-display font-bold text-on-primary bg-primary hover:bg-primary-hover disabled:opacity-50 transition"
        >
          {submitting ? 'Accepting…' : 'Confirm and accept'}
        </button>
      </div>
    </div>
  )
}
