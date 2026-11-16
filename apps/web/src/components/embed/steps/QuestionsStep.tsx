'use client'

import { useState } from 'react'
import type { MeasurementModel, WidgetField } from '../EstimateWidget'
import { RequiredMark, StepTitle } from '../StepTitle'

/**
 * T-171: a question with two to five choices is answered with large rows to
 * tap, the way "When suits you?" is on the accept form. A longer list keeps
 * the picker, where a row each would fill the screen.
 */
export const TAP_ROWS_MAX = 5
export const usesTapRows = (field: { type: string; options?: unknown[] }) =>
  field.type === 'radio' || (field.type === 'select' && (field.options?.length ?? 0) >= 2 && (field.options?.length ?? 0) <= TAP_ROWS_MAX)
const ROW = 'flex min-h-[48px] items-center gap-2.5 px-4 py-3 bg-white border border-field rounded-xl cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-mint transition'
const BOX = 'w-[18px] h-[18px] accent-[var(--color-primary)]'

/**
 * T-151: the service's own questions (and the quantity, when the business asks
 * for one), straight after the contact step. Moved unchanged from the old
 * "Job Details" step; the address, ZIP and description are asked later
 * (ZIP + description on the last step, the address on accept).
 */

function getUnitLabel(unit: string | null): string {
  const labels: Record<string, string> = {
    sqft: 'Square Footage',
    sqm: 'Square Meters',
    room: 'Number of Rooms',
    item: 'Number of Items',
    hour: 'Estimated Hours',
    linear_ft: 'Linear Feet',
    linear_m: 'Linear Meters',
  }
  return unit ? (labels[unit] || `Quantity (${unit})`) : 'Quantity'
}

// Validation helpers
function validateRequiredFields(
  fields: WidgetField[],
  answers: Record<string, string | number | boolean | string[]>
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    if (!field.required) continue

    const value = answers[field.fieldId]

    if (value === undefined || value === null || value === '') {
      errors[field.fieldId] = `${field.label} is required`
      continue
    }

    // Check array types (checkbox multi-select)
    if (Array.isArray(value) && value.length === 0) {
      errors[field.fieldId] = `${field.label} is required`
      continue
    }
  }

  return errors
}

export function QuestionsStep({
  fields,
  answers,
  jobQuantity,
  measurementModel,
  onFieldChange,
  onQuantityChange,
  onBack,
  onNext,
}: {
  fields: WidgetField[]
  answers: Record<string, string | number | boolean | string[]>
  jobQuantity: number | null
  measurementModel: MeasurementModel | null | undefined
  onFieldChange: (id: string, value: string | number | boolean | string[]) => void
  onQuantityChange: (value: number | null) => void
  onBack?: () => void
  onNext: () => void
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  function handleContinue() {
    const validationErrors = validateRequiredFields(fields, answers)
    setErrors(validationErrors)

    // Mark all fields as touched to show errors
    const allTouched: Record<string, boolean> = {}
    fields.forEach((f) => {
      allTouched[f.fieldId] = true
    })
    setTouched(allTouched)

    if (Object.keys(validationErrors).length === 0) {
      onNext()
    }
  }

  function handleFieldBlur(fieldId: string) {
    setTouched((prev) => ({ ...prev, [fieldId]: true }))
    // Re-validate this field
    const field = fields.find((f) => f.fieldId === fieldId)
    if (field?.required) {
      const value = answers[fieldId]
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        setErrors((prev) => ({ ...prev, [fieldId]: `${field.label} is required` }))
      } else {
        setErrors((prev) => {
          const updated = { ...prev }
          delete updated[fieldId]
          return updated
        })
      }
    }
  }

  function handleCheckboxChange(fieldId: string, optionValue: string, checked: boolean) {
    const currentValues = (answers[fieldId] as string[]) || []
    const newValues = checked
      ? [...currentValues, optionValue]
      : currentValues.filter((v) => v !== optionValue)
    onFieldChange(fieldId, newValues)
  }

  const inputErrorClass = 'border-danger bg-danger-light/30 focus:border-danger'
  const inputNormalClass = 'border-field bg-white focus:border-primary'

  return (
    <div className="p-4 sm:p-6">
      <StepTitle>About the job</StepTitle>

      <div className="space-y-4">
        {/* Quantity field - shown when measurement model asks for customer quantity */}
        {measurementModel?.type === 'per_unit' && measurementModel.askCustomerForQuantity && (
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1.5">
              {measurementModel.unitLabel || getUnitLabel(measurementModel.unit)}
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={jobQuantity ?? ''}
              onChange={(e) => onQuantityChange(e.target.value ? Number(e.target.value) : null)}
              placeholder={`Enter ${measurementModel.unit || 'quantity'}`}
              className={`w-full px-4 py-3 text-[15px] border rounded-xl placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${inputNormalClass}`}
            />
            <p className="mt-1 text-xs text-text-muted">
              Your estimate is worked out from this
            </p>
          </div>
        )}

        {fields.map((field) => {
          const hasError = touched[field.fieldId] && errors[field.fieldId]
          const fieldClass = hasError ? inputErrorClass : inputNormalClass

          return (
            <div key={field.fieldId} data-testid="question" data-kind={usesTapRows(field) ? 'rows' : field.type}>
              <p className="block text-[13px] font-semibold text-text-primary mb-1.5" id={`q-${field.fieldId}`}>
                {field.label}
                {field.required && <RequiredMark />}
              </p>

              {/* Text input */}
              {field.type === 'text' && (
                <input
                  type="text"
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  placeholder={field.placeholder}
                  aria-labelledby={`q-${field.fieldId}`}
                  aria-required={field.required || undefined}
                  className={`w-full px-4 py-3 text-[15px] border rounded-xl placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
                />
              )}

              {/* Textarea */}
              {field.type === 'textarea' && (
                <textarea
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  placeholder={field.placeholder}
                  aria-labelledby={`q-${field.fieldId}`}
                  aria-required={field.required || undefined}
                  rows={3}
                  className={`w-full px-4 py-3 text-[15px] border rounded-xl placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
                />
              )}

              {/* Number input */}
              {field.type === 'number' && (
                <input
                  type="number"
                  value={(answers[field.fieldId] as number) ?? ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value ? Number(e.target.value) : '')}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  placeholder={field.placeholder}
                  aria-labelledby={`q-${field.fieldId}`}
                  aria-required={field.required || undefined}
                  className={`w-full px-4 py-3 text-[15px] border rounded-xl placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
                />
              )}

              {/* A long list: the picker */}
              {field.type === 'select' && field.options && !usesTapRows(field) && (
                <select
                  aria-labelledby={`q-${field.fieldId}`}
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  className={`w-full min-h-[48px] px-4 py-3 text-base border rounded-xl placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
                >
                  <option value="">Select...</option>
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Two to five choices (and every radio question): rows to tap */}
              {usesTapRows(field) && field.options && (
                <div className="space-y-2 mt-1" role="radiogroup" aria-labelledby={`q-${field.fieldId}`} data-testid="tap-rows">
                  {field.options.map((opt) => (
                    <label key={opt.value} className={ROW} data-testid="tap-row">
                      <input
                        type="radio"
                        name={field.fieldId}
                        value={opt.value}
                        checked={(answers[field.fieldId] as string) === opt.value}
                        onChange={(e) => {
                          onFieldChange(field.fieldId, e.target.value)
                          setErrors((prev) => {
                            const updated = { ...prev }
                            delete updated[field.fieldId]
                            return updated
                          })
                        }}
                        className={BOX}
                      />
                      <span className="text-sm text-text-primary">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Checkbox (multi-select) */}
              {field.type === 'checkbox' && field.options && (
                <div className="space-y-2 mt-1">
                  {field.options.map((opt) => {
                    const currentValues = (answers[field.fieldId] as string[]) || []
                    return (
                      <label key={opt.value} className={ROW}>
                        <input
                          type="checkbox"
                          checked={currentValues.includes(opt.value)}
                          onChange={(e) => handleCheckboxChange(field.fieldId, opt.value, e.target.checked)}
                          className={`${BOX} rounded-sm`}
                        />
                        <span className="text-sm text-text-primary">{opt.label}</span>
                      </label>
                    )
                  })}
                </div>
              )}

              {/* Boolean (single checkbox) */}
              {field.type === 'boolean' && (
                <label className={ROW}>
                  <input
                    type="checkbox"
                    checked={(answers[field.fieldId] as boolean) || false}
                    onChange={(e) => onFieldChange(field.fieldId, e.target.checked)}
                    className={`${BOX} rounded-sm`}
                  />
                  <span className="text-sm text-text-primary">{field.helpText || 'Yes'}</span>
                </label>
              )}

              {/* Help text */}
              {field.helpText && field.type !== 'boolean' && (
                <p className="text-xs text-text-muted mt-1">{field.helpText}</p>
              )}

              {/* Error message */}
              {hasError && (
                <p className="text-xs text-danger mt-1">{errors[field.fieldId]}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-3 mt-6">
        {onBack && (
          <button
            onClick={onBack}
            className="min-h-[48px] px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-field rounded-xl transition"
          >
            Back
          </button>
        )}
        <button
          onClick={handleContinue}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-xl hover:bg-primary-hover active:scale-[0.995] transition"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

