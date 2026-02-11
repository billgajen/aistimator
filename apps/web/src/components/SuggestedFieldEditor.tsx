'use client'

import { useState, type KeyboardEvent } from 'react'
import type { ServiceDraftConfig } from '@estimator/shared'

type SuggestedField = ServiceDraftConfig['suggestedFields'][0]

/**
 * Suggested Field Editor Component
 *
 * Allows editing of suggested form fields for the widget.
 * These fields collect critical information for accurate pricing.
 */

interface SuggestedFieldEditorProps {
  fields: SuggestedField[]
  onChange: (fields: SuggestedField[]) => void
}

const FIELD_TYPES: { value: SuggestedField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'checkbox', label: 'Checkboxes' },
  { value: 'boolean', label: 'Yes/No Toggle' },
]

function generateFieldId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function SuggestedFieldEditor({
  fields,
  onChange,
}: SuggestedFieldEditorProps) {
  const [expandedField, setExpandedField] = useState<string | null>(null)
  const [optionInput, setOptionInput] = useState<{ [key: string]: string }>({})

  const addField = () => {
    const newField: SuggestedField = {
      label: '',
      fieldId: '',
      type: 'text',
      required: false,
      criticalForPricing: false,
    }
    const newFields = [...fields, newField]
    onChange(newFields)
    setExpandedField(String(newFields.length - 1))
  }

  const removeField = (index: number) => {
    const newFields = fields.filter((_, i) => i !== index)
    onChange(newFields)
    if (expandedField === String(index)) setExpandedField(null)
  }

  const updateField = (index: number, updates: Partial<SuggestedField>) => {
    const newFields = fields.map((f, i) =>
      i === index ? { ...f, ...updates } : f
    )
    onChange(newFields)
  }

  const addOption = (index: number, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const field = fields[index]
    if (!field) return
    if (field.options?.includes(trimmed)) return
    updateField(index, {
      options: [...(field.options || []), trimmed],
    })
    setOptionInput({ ...optionInput, [index]: '' })
  }

  const removeOption = (index: number, optionIndex: number) => {
    const field = fields[index]
    if (!field) return
    updateField(index, {
      options: field.options?.filter((_, i) => i !== optionIndex),
    })
  }

  const handleOptionKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addOption(index, optionInput[index] || '')
    }
  }

  const moveField = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= fields.length) return
    const newFields = [...fields]
    const removed = newFields.splice(index, 1)[0]
    if (!removed) return
    newFields.splice(newIndex, 0, removed)
    onChange(newFields)
  }

  const needsOptions = (type: SuggestedField['type']) =>
    ['dropdown', 'radio', 'checkbox'].includes(type)

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <div className="rounded-warm-lg border-2 border-dashed border-border p-4 text-center">
          <p className="text-sm text-text-muted">No questions defined yet</p>
          <p className="mb-2 text-xs text-text-muted">
            Add questions to collect information for accurate pricing
          </p>
          <button
            type="button"
            onClick={addField}
            className="text-sm font-medium text-primary hover:text-primary"
          >
            Add your first question
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={index}
              className="rounded-warm-lg border border-border bg-surface"
            >
              {/* Field Header */}
              <div
                className="flex cursor-pointer items-center justify-between px-4 py-3"
                onClick={() =>
                  setExpandedField(expandedField === String(index) ? null : String(index))
                }
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveField(index, 'up')
                      }}
                      disabled={index === 0}
                      className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveField(index, 'down')
                      }}
                      disabled={index === fields.length - 1}
                      className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">
                      {field.label || <span className="italic text-text-muted">Unnamed Field</span>}
                      {field.required && <span className="ml-1 text-danger">*</span>}
                      {field.criticalForPricing && (
                        <span className="ml-2 rounded-full bg-tertiary-light px-2 py-0.5 text-xs text-tertiary">
                          Critical
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-text-muted">
                      {FIELD_TYPES.find((t) => t.value === field.type)?.label || field.type}
                      {needsOptions(field.type) && field.options && (
                        <span className="ml-1 text-text-muted">
                          ({field.options.length} options)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeField(index)
                    }}
                    className="rounded p-1 text-text-muted hover:bg-danger-light hover:text-danger"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                  <svg
                    className={`h-5 w-5 text-text-muted transition-transform ${
                      expandedField === String(index) ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Field Details (Expanded) */}
              {expandedField === String(index) && (
                <div className="space-y-4 border-t border-border px-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Label *
                      </label>
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => {
                          updateField(index, {
                            label: e.target.value,
                            fieldId: generateFieldId(e.target.value),
                          })
                        }}
                        placeholder="e.g., Number of Rooms"
                        className="w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Field Type
                      </label>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateField(index, {
                            type: e.target.value as SuggestedField['type'],
                            options: needsOptions(e.target.value as SuggestedField['type'])
                              ? field.options || []
                              : undefined,
                          })
                        }
                        className="w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {FIELD_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-text-secondary">
                      Help Text
                    </label>
                    <input
                      type="text"
                      value={field.helpText || ''}
                      onChange={(e) => updateField(index, { helpText: e.target.value || undefined })}
                      placeholder="Instructions for the customer"
                      className="w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Options for dropdown/radio/checkbox */}
                  {needsOptions(field.type) && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Options
                      </label>
                      <div className="min-h-[60px] rounded-warm-lg border border-border p-2">
                        <div className="flex flex-wrap gap-2">
                          {field.options?.map((option, optionIndex) => (
                            <span
                              key={optionIndex}
                              className="inline-flex items-center gap-1 rounded-warm-lg bg-primary-light px-2 py-1 text-sm text-primary"
                            >
                              {option}
                              <button
                                type="button"
                                onClick={() => removeOption(index, optionIndex)}
                                className="text-primary hover:text-primary"
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          ))}
                          <input
                            type="text"
                            value={optionInput[index] || ''}
                            onChange={(e) =>
                              setOptionInput({ ...optionInput, [index]: e.target.value })
                            }
                            onKeyDown={(e) => handleOptionKeyDown(e, index)}
                            onBlur={() => {
                              if (optionInput[index]) addOption(index, optionInput[index])
                            }}
                            placeholder={
                              field.options?.length
                                ? 'Add option...'
                                : 'Type and press Enter'
                            }
                            className="min-w-[100px] flex-1 border-none p-1 text-sm outline-none"
                          />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        Press Enter to add each option
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <span className="text-sm text-text-secondary">Required</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={field.criticalForPricing}
                        onChange={(e) =>
                          updateField(index, { criticalForPricing: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <span className="text-sm text-text-secondary">Critical for Pricing</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Field Button */}
      {fields.length > 0 && (
        <button
          type="button"
          onClick={addField}
          className="inline-flex w-full items-center justify-center gap-1 rounded-warm-lg border border-dashed border-border px-3 py-2 text-sm text-text-secondary hover:border-border-strong hover:text-text-primary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Question
        </button>
      )}
    </div>
  )
}
