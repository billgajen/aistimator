'use client'

import { useState } from 'react'

/**
 * T-151: the last step — the ZIP or postcode (for the service area and the
 * price) and the free-text description. The description is required only when
 * the service asks no questions of its own. The full address is asked on accept.
 */
export function JobDetailsStep({
  postalCodeLabel,
  postalCodeExample,
  postcode,
  description,
  descriptionRequired,
  onPostcodeChange,
  onDescriptionChange,
  onBack,
  onSubmit,
}: {
  postalCodeLabel: string
  postalCodeExample: string
  postcode: string
  description: string
  descriptionRequired: boolean
  onPostcodeChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onBack?: () => void
  onSubmit: () => void
}) {
  const [touched, setTouched] = useState(false)
  const missingDescription = descriptionRequired && !description.trim()
  const input = 'w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition border-border bg-background focus:ring-primary/25 focus:border-primary focus:bg-white'

  return (
    <div className="p-6">
      <h3 className="font-display text-xl font-bold text-text-primary mb-5">Last step</h3>
      <div className="space-y-4">
        <div className="max-w-[220px]">
          <label htmlFor="job-postcode" className="block text-[13px] font-semibold text-text-primary mb-1.5">{postalCodeLabel}</label>
          <input id="job-postcode" type="text" autoComplete="postal-code" value={postcode} onChange={(e) => onPostcodeChange(e.target.value)} placeholder={postalCodeExample} className={input} />
        </div>
        <div>
          <label htmlFor="job-description" className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Anything else about the job?
            {descriptionRequired ? <span className="text-danger"> *</span> : <span className="font-normal text-text-muted"> (optional)</span>}
          </label>
          <textarea id="job-description" value={description} onChange={(e) => onDescriptionChange(e.target.value)} rows={4} className={`${input} ${touched && missingDescription ? 'border-danger/50' : ''}`} />
          {touched && missingDescription
            ? <p className="mt-1 text-xs text-danger">Please describe the job.</p>
            : <p className="mt-1 text-xs text-text-muted">{descriptionRequired ? 'What needs doing, and roughly how big it is.' : 'Anything the questions didn’t cover.'}</p>}
        </div>
      </div>
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
            if (!missingDescription) onSubmit()
          }}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover active:scale-[0.995] transition"
        >
          Get Quote
        </button>
      </div>
    </div>
  )
}
