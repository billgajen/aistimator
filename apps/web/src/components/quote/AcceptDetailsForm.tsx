'use client'

import { useEffect, useRef, useState } from 'react'
import { TIMING_CHOICES, checkAcceptance, type Timing } from '@/lib/acceptance'

/**
 * T-151: tapping Accept asks for the next step — when suits the customer,
 * the job address and a phone number — and accepts with them in one go, so
 * the business's acceptance email carries all of it.
 *
 * T-171: when it opens it is scrolled into view and its first field takes
 * the focus (it used to appear mid-page, where a phone might not show it).
 * The fields have an edge that can be seen (3:1), and the timing note has a
 * label of its own, not only a placeholder.
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
  const input = 'w-full min-h-[48px] px-4 py-3 text-base border border-field rounded-xl bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition'
  const root = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    first.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div ref={root} className="scroll-mt-4 space-y-5 rounded-2xl border border-border bg-background p-5" data-testid="accept-details">
      <div>
        <h3 className="font-display text-lg font-bold text-text-primary">Great. A few details for {businessName}</h3>
        <p className="mt-1 text-sm text-text-secondary">So they can get in touch and plan the job.</p>
      </div>

      <fieldset>
        <legend className="text-[13px] font-semibold text-text-primary mb-2">When suits you?</legend>
        <div className="space-y-2">
          {TIMING_CHOICES.map((choice, i) => (
            <label key={choice.value} className="flex min-h-[48px] items-center gap-2.5 px-4 py-3 bg-white border border-field rounded-xl cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-mint transition">
              <input ref={i === 0 ? first : undefined} type="radio" name="timing" value={choice.value} checked={timing === choice.value} onChange={() => setTiming(choice.value)} className="w-[18px] h-[18px] accent-[var(--color-primary)]" />
              <span className="text-sm text-text-primary">{choice.label}</span>
            </label>
          ))}
        </div>
        {errors.timing && <p className="text-xs text-danger mt-1">{errors.timing}</p>}
        <label htmlFor="timing-note" className="mt-3 block text-[13px] font-semibold text-text-primary mb-1.5">Anything about timing? <span className="font-normal text-text-muted">(optional)</span></label>
        <input id="timing-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
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
        <button type="button" onClick={onCancel} className="min-h-[48px] py-3 px-4 text-sm font-semibold text-text-secondary border border-field rounded-xl hover:bg-surface transition">
          Back
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setTouched(true)
            if (check.ok) onConfirm({ timing: check.value.timing, timingNote: note, address, phone })
          }}
          className="flex-1 min-h-[48px] py-3 px-4 rounded-xl font-display font-bold text-on-primary bg-primary hover:bg-primary-hover disabled:opacity-50 transition"
        >
          {submitting ? 'Accepting…' : 'Confirm and accept'}
        </button>
      </div>
    </div>
  )
}
