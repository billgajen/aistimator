'use client'

import { useState } from 'react'
import { RequiredMark, StepTitle } from '../StepTitle'

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
  const input = 'w-full px-4 py-3 text-[15px] border rounded-xl placeholder:text-text-muted focus:outline-none focus:ring-2 transition border-field bg-white focus:border-primary'

  return (
    <div className="p-4 sm:p-6">
      <StepTitle>Last step</StepTitle>
      <div className="space-y-4">
        <div className="max-w-[220px]">
          <label htmlFor="job-postcode" className="block text-[13px] font-semibold text-text-primary mb-1.5">{postalCodeLabel}</label>
          <input id="job-postcode" type="text" autoComplete="postal-code" value={postcode} onChange={(e) => onPostcodeChange(e.target.value)} placeholder={postalCodeExample} className={input} />
        </div>
        <div>
          <label htmlFor="job-description" className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Anything else about the job?
            {descriptionRequired ? <RequiredMark /> : <span className="font-normal text-text-muted"> (optional)</span>}
          </label>
          <textarea id="job-description" value={description} onChange={(e) => onDescriptionChange(e.target.value)} rows={4} className={`${input} ${touched && missingDescription ? 'border-danger' : ''}`} />
          {touched && missingDescription
            ? <p className="mt-1 text-xs text-danger">Please describe the job.</p>
            : <p className="mt-1 text-xs text-text-muted">{descriptionRequired ? 'What needs doing, and roughly how big it is.' : 'Anything the questions didn’t cover.'}</p>}
        </div>
      </div>
      <div className="flex gap-3 mt-6">
        {onBack && (
          <button type="button" onClick={onBack} className="min-h-[48px] px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-field rounded-xl transition">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setTouched(true)
            if (!missingDescription) onSubmit()
          }}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-xl hover:bg-primary-hover active:scale-[0.995] transition"
        >
          {/* T-171 (the owner's wording): what the customer gets at this point is an estimate (T-146) */}
          Get my estimate
        </button>
      </div>
    </div>
  )
}
