'use client'

import { useState, useEffect } from 'react'
import type { WorkStepConfig, ExpectedSignalConfig, SuggestedField } from '@estimator/shared'

/**
 * Work Step Editor Component
 *
 * Allows editing of work steps configuration for a service.
 * Each work step represents a distinct billable operation.
 *
 * Features:
 * - Auto-linking: Suggests matching questions based on step name keywords
 * - Smart defaults: Auto-selects if only one number question exists
 * - Simple UI: "Multiply by" dropdown instead of technical "quantity source"
 * - Advanced mode: Hidden by default, shows AI signal option for edge cases
 */

interface WorkStepEditorProps {
  workSteps: WorkStepConfig[]
  onChange: (steps: WorkStepConfig[]) => void
  /** Available signals that can be used as triggers */
  expectedSignals?: ExpectedSignalConfig[]
  /** Customer questions (form fields) for displaying labels in trigger dropdown */
  suggestedFields?: SuggestedField[]
}

const COST_TYPES: { value: WorkStepConfig['costType']; label: string; description: string }[] = [
  { value: 'fixed', label: 'Fixed Amount', description: 'Same price every time' },
  { value: 'per_unit', label: 'Per Unit', description: 'Price × quantity' },
  { value: 'per_hour', label: 'Per Hour', description: 'Hourly rate × hours' },
]

const OPERATORS: { value: string; label: string }[] = [
  { value: 'exists', label: 'Has any value' },
  { value: 'equals', label: 'Equals' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'At least' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'At most' },
]

// Common keywords to match step names with questions
const KEYWORD_MAPPINGS: Record<string, string[]> = {
  bedroom: ['bedroom', 'bedrooms', 'bed', 'beds', 'room'],
  bathroom: ['bathroom', 'bathrooms', 'bath', 'baths', 'restroom'],
  kitchen: ['kitchen', 'kitchens'],
  floor: ['floor', 'floors', 'sqft', 'square', 'footage', 'area', 'sq ft'],
  window: ['window', 'windows'],
  room: ['room', 'rooms'],
  hour: ['hour', 'hours', 'time'],
  employee: ['employee', 'employees', 'staff', 'people', 'person', 'workers'],
  server: ['server', 'servers', 'computer', 'computers', 'device', 'devices'],
  car: ['car', 'cars', 'vehicle', 'vehicles'],
  item: ['item', 'items', 'unit', 'units', 'piece', 'pieces'],
}

function generateId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Find a matching question for a step name using keyword matching
 */
function findMatchingQuestion(stepName: string, questions: SuggestedField[]): SuggestedField | null {
  if (!stepName || questions.length === 0) return null

  const nameLower = stepName.toLowerCase()

  // Check each question for keyword matches
  for (const question of questions) {
    if (question.type !== 'number') continue

    const labelLower = question.label.toLowerCase()

    // Direct substring match
    if (nameLower.includes(labelLower) || labelLower.includes(nameLower)) {
      return question
    }

    // Check keyword mappings
    for (const [, keywords] of Object.entries(KEYWORD_MAPPINGS)) {
      const nameHasKeyword = keywords.some(kw => nameLower.includes(kw))
      const labelHasKeyword = keywords.some(kw => labelLower.includes(kw))

      if (nameHasKeyword && labelHasKeyword) {
        return question
      }
    }
  }

  return null
}

/**
 * Get the display value for the "multiply by" dropdown
 */
function getMultiplyByValue(step: WorkStepConfig): string {
  if (!step.quantitySource) return ''

  switch (step.quantitySource.type) {
    case 'form_field':
      return step.quantitySource.fieldId ? `field:${step.quantitySource.fieldId}` : ''
    case 'constant':
      return `fixed:${step.quantitySource.value || 1}`
    case 'ai_signal':
      return `ai:${step.quantitySource.signalKey || ''}`
    default:
      return ''
  }
}

export function WorkStepEditor({
  workSteps,
  onChange,
  expectedSignals = [],
  suggestedFields = [],
}: WorkStepEditorProps) {
  // Build a map from signal key to question label for display
  const signalToLabel = new Map<string, string>()
  suggestedFields.forEach((field) => {
    if (field.mapsToSignal && field.label) {
      signalToLabel.set(field.mapsToSignal, field.label)
    }
    if (field.fieldId && field.label) {
      signalToLabel.set(field.fieldId, field.label)
    }
  })

  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState<Record<string, boolean>>({})
  const [autoLinkSuggestions, setAutoLinkSuggestions] = useState<Record<string, SuggestedField | null>>({})

  // Number questions available for linking
  const numberQuestions = suggestedFields.filter(f => f.type === 'number')

  // Update auto-link suggestions when step names change
  useEffect(() => {
    const suggestions: Record<string, SuggestedField | null> = {}
    workSteps.forEach(step => {
      if ((step.costType === 'per_unit' || step.costType === 'per_hour') && !step.quantitySource) {
        suggestions[step.id] = findMatchingQuestion(step.name, numberQuestions)
      }
    })
    setAutoLinkSuggestions(suggestions)
  }, [workSteps, numberQuestions])

  const addStep = () => {
    const newStep: WorkStepConfig = {
      id: generateId(),
      name: '',
      description: '',
      costType: 'fixed',
      defaultCost: 25,
      optional: false,
    }
    onChange([...workSteps, newStep])
    setExpandedStep(newStep.id)
  }

  const removeStep = (id: string) => {
    onChange(workSteps.filter((s) => s.id !== id))
    if (expandedStep === id) setExpandedStep(null)
  }

  const updateStep = (id: string, updates: Partial<WorkStepConfig>) => {
    onChange(
      workSteps.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      )
    )
  }

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= workSteps.length) return
    const newSteps = [...workSteps]
    const removed = newSteps.splice(index, 1)[0]
    if (!removed) return
    newSteps.splice(newIndex, 0, removed)
    onChange(newSteps)
  }

  /**
   * Handle "multiply by" dropdown change
   */
  const handleMultiplyByChange = (stepId: string, value: string) => {
    if (!value) {
      updateStep(stepId, { quantitySource: undefined })
      return
    }

    const parts = value.split(':')
    const type = parts[0]
    const rest = parts[1] || ''

    switch (type) {
      case 'field':
        updateStep(stepId, {
          quantitySource: { type: 'form_field', fieldId: rest },
        })
        break
      case 'fixed':
        updateStep(stepId, {
          quantitySource: { type: 'constant', value: parseInt(rest) || 1 },
        })
        break
      case 'ai':
        updateStep(stepId, {
          quantitySource: { type: 'ai_signal', signalKey: rest },
        })
        break
    }
  }

  /**
   * Accept auto-link suggestion
   */
  const acceptAutoLink = (stepId: string, question: SuggestedField) => {
    updateStep(stepId, {
      quantitySource: { type: 'form_field', fieldId: question.fieldId },
    })
    setAutoLinkSuggestions(prev => ({ ...prev, [stepId]: null }))
  }

  return (
    <div className="space-y-3">
      {workSteps.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-4 text-center">
          <p className="text-sm text-gray-500">No pricing items defined yet</p>
          <p className="mb-2 text-xs text-gray-400">
            Add items that will appear as lines on your quote
          </p>
          <button
            type="button"
            onClick={addStep}
            className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Add your first line item
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {workSteps.map((step, index) => {
            const suggestion = autoLinkSuggestions[step.id]
            const hasQuantityIssue = (step.costType === 'per_unit' || step.costType === 'per_hour') && !step.quantitySource

            return (
              <div
                key={step.id}
                className={`rounded-lg border bg-white ${hasQuantityIssue ? 'border-amber-300' : 'border-gray-200'}`}
              >
                {/* Step Header */}
                <div
                  className="flex cursor-pointer items-center justify-between px-4 py-3"
                  onClick={() =>
                    setExpandedStep(expandedStep === step.id ? null : step.id)
                  }
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          moveStep(index, 'up')
                        }}
                        disabled={index === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          moveStep(index, 'down')
                        }}
                        disabled={index === workSteps.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {step.name || <span className="italic text-gray-400">Unnamed Item</span>}
                      </p>
                      <p className="text-sm text-gray-500">
                        {step.costType === 'fixed' && `$${step.defaultCost.toFixed(2)}`}
                        {step.costType === 'per_unit' && (
                          <>
                            ${step.defaultCost.toFixed(2)} × {' '}
                            {step.quantitySource?.type === 'form_field' && step.quantitySource.fieldId ? (
                              <span className="text-blue-600">
                                {suggestedFields.find(f => f.fieldId === step.quantitySource?.fieldId)?.label || 'question'}
                              </span>
                            ) : step.quantitySource?.type === 'constant' ? (
                              <span className="text-green-600">{step.quantitySource.value}</span>
                            ) : step.quantitySource?.type === 'ai_signal' ? (
                              <span className="text-amber-600">AI (legacy)</span>
                            ) : (
                              <span className="text-red-500">needs link</span>
                            )}
                          </>
                        )}
                        {step.costType === 'per_hour' && (
                          <>
                            ${step.defaultCost.toFixed(2)}/hr × {' '}
                            {step.quantitySource?.type === 'form_field' && step.quantitySource.fieldId ? (
                              <span className="text-blue-600">
                                {suggestedFields.find(f => f.fieldId === step.quantitySource?.fieldId)?.label || 'hours'}
                              </span>
                            ) : step.quantitySource?.type === 'constant' ? (
                              <span className="text-green-600">{step.quantitySource.value}h</span>
                            ) : (
                              <span className="text-gray-400">1h default</span>
                            )}
                          </>
                        )}
                        {step.optional && <span className="text-gray-400"> (optional)</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasQuantityIssue && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Needs link
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeStep(step.id)
                      }}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
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
                      className={`h-5 w-5 text-gray-400 transition-transform ${
                        expandedStep === step.id ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Auto-link Suggestion Banner */}
                {suggestion && expandedStep !== step.id && (
                  <div className="border-t border-blue-100 bg-blue-50 px-4 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-sm text-blue-700">
                          Link to &quot;{suggestion.label}&quot;?
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            acceptAutoLink(step.id, suggestion)
                          }}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          Yes, link it
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setAutoLinkSuggestions(prev => ({ ...prev, [step.id]: null }))
                          }}
                          className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step Details (Expanded) */}
                {expandedStep === step.id && (
                  <div className="space-y-4 border-t border-gray-100 px-4 py-4">
                    {/* Auto-link Suggestion (when expanded) */}
                    {suggestion && (
                      <div className="rounded-md bg-blue-50 p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <div>
                              <p className="text-sm font-medium text-blue-800">We found a matching question!</p>
                              <p className="text-sm text-blue-600">
                                Link &quot;{step.name}&quot; to &quot;{suggestion.label}&quot;?
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => acceptAutoLink(step.id, suggestion)}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            >
                              Yes, link it
                            </button>
                            <button
                              type="button"
                              onClick={() => setAutoLinkSuggestions(prev => ({ ...prev, [step.id]: null }))}
                              className="rounded-md px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100"
                            >
                              No thanks
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Item Name *
                        </label>
                        <input
                          type="text"
                          value={step.name}
                          onChange={(e) => updateStep(step.id, { name: e.target.value })}
                          placeholder="e.g., Bedroom Cleaning"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Pricing Type
                        </label>
                        <select
                          value={step.costType}
                          onChange={(e) => {
                            const newType = e.target.value as WorkStepConfig['costType']
                            const updates: Partial<WorkStepConfig> = { costType: newType }

                            // Smart defaults when switching to per_unit
                            if (newType === 'per_unit' && !step.quantitySource) {
                              const firstQuestion = numberQuestions[0]
                              if (numberQuestions.length === 1 && firstQuestion?.fieldId) {
                                // Auto-select if only one number question
                                updates.quantitySource = { type: 'form_field', fieldId: firstQuestion.fieldId }
                              } else if (numberQuestions.length === 0) {
                                // Default to constant 1 if no questions
                                updates.quantitySource = { type: 'constant', value: 1 }
                              }
                            }

                            updateStep(step.id, updates)
                          }}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {COST_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          {COST_TYPES.find(t => t.value === step.costType)?.description}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          {step.costType === 'fixed' ? 'Amount' : step.costType === 'per_hour' ? 'Hourly Rate' : 'Price Per Unit'}
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">$</span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={step.defaultCost}
                            onChange={(e) =>
                              updateStep(step.id, {
                                defaultCost: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full rounded-md border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      {/* Multiply By - Only for per_unit and per_hour */}
                      {(step.costType === 'per_unit' || step.costType === 'per_hour') && (
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Multiply by
                          </label>
                          <select
                            value={getMultiplyByValue(step)}
                            onChange={(e) => handleMultiplyByChange(step.id, e.target.value)}
                            className={`w-full rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              !step.quantitySource ? 'border-amber-300 bg-amber-50' : 'border-gray-300'
                            }`}
                          >
                            <option value="">Select what to multiply by...</option>

                            {/* Customer Questions */}
                            {numberQuestions.length > 0 && (
                              <optgroup label="Customer Questions">
                                {numberQuestions.map((field) => (
                                  <option key={field.fieldId} value={`field:${field.fieldId}`}>
                                    {field.label}
                                  </option>
                                ))}
                              </optgroup>
                            )}

                            {/* Fixed Quantities */}
                            <optgroup label="Fixed Quantity">
                              <option value="fixed:1">Always 1</option>
                              <option value="fixed:2">Always 2</option>
                              <option value="fixed:3">Always 3</option>
                              <option value="fixed:4">Always 4</option>
                              <option value="fixed:5">Always 5</option>
                            </optgroup>

                            {/* Advanced/Legacy - only show if already using or advanced mode */}
                            {(showAdvanced[step.id] || step.quantitySource?.type === 'ai_signal') && expectedSignals.filter(s => s.type === 'number').length > 0 && (
                              <optgroup label="Advanced (AI Signals)">
                                {expectedSignals.filter(s => s.type === 'number').map((sig) => (
                                  <option key={sig.signalKey} value={`ai:${sig.signalKey}`}>
                                    {signalToLabel.get(sig.signalKey) || sig.description || sig.signalKey} (AI)
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>

                          {!step.quantitySource && (
                            <p className="mt-1 text-xs text-amber-600">
                              Required: Select what determines the quantity
                            </p>
                          )}

                          {numberQuestions.length === 0 && !step.quantitySource && (
                            <p className="mt-1 text-xs text-gray-500">
                              Tip: Add a number question in Customer Questions to link here
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Unit Label - Only for per_unit */}
                    {step.costType === 'per_unit' && step.quantitySource && (
                      <div className="max-w-xs">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Unit Label (optional)
                        </label>
                        <input
                          type="text"
                          value={step.unitLabel || ''}
                          onChange={(e) => updateStep(step.id, { unitLabel: e.target.value || undefined })}
                          placeholder="e.g., bedrooms, sq ft, items"
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Shown on the quote (e.g., &quot;3 bedrooms × $25&quot;)
                        </p>
                      </div>
                    )}

                    {/* Optional toggle */}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={step.optional}
                          onChange={(e) =>
                            updateStep(step.id, { optional: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">Only include when condition is met</span>
                      </label>
                    </div>

                    {/* Optional Step Trigger */}
                    {step.optional && (
                      <div className="rounded-md bg-gray-50 p-3">
                        <p className="mb-2 text-sm font-medium text-gray-700">
                          When to include this item
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="mb-1 block text-xs text-gray-600">
                              Question
                            </label>
                            <select
                              value={step.triggerSignal || ''}
                              onChange={(e) =>
                                updateStep(step.id, {
                                  triggerSignal: e.target.value || undefined,
                                })
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">Select question...</option>
                              {expectedSignals.map((sig) => (
                                <option key={sig.signalKey} value={sig.signalKey}>
                                  {signalToLabel.get(sig.signalKey) || sig.description || sig.signalKey}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-gray-600">
                              Condition
                            </label>
                            <select
                              value={step.triggerCondition?.operator || 'exists'}
                              onChange={(e) =>
                                updateStep(step.id, {
                                  triggerCondition: {
                                    ...step.triggerCondition,
                                    operator: e.target.value as 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists',
                                  },
                                })
                              }
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              {OPERATORS.map((op) => (
                                <option key={op.value} value={op.value}>
                                  {op.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {step.triggerCondition?.operator &&
                            !['exists', 'not_exists'].includes(step.triggerCondition.operator) && (
                            <div>
                              <label className="mb-1 block text-xs text-gray-600">
                                Value
                              </label>
                              <input
                                type="text"
                                value={String(step.triggerCondition?.value ?? '')}
                                onChange={(e) =>
                                  updateStep(step.id, {
                                    triggerCondition: {
                                      ...step.triggerCondition!,
                                      value: e.target.value,
                                    },
                                  })
                                }
                                placeholder="Value"
                                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Description (optional)
                      </label>
                      <input
                        type="text"
                        value={step.description}
                        onChange={(e) => updateStep(step.id, { description: e.target.value })}
                        placeholder="Brief note about this item"
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    {/* Advanced Options Toggle */}
                    {(step.costType === 'per_unit' || step.costType === 'per_hour') && expectedSignals.filter(s => s.type === 'number').length > 0 && (
                      <div className="border-t border-gray-100 pt-3">
                        <button
                          type="button"
                          onClick={() => setShowAdvanced(prev => ({ ...prev, [step.id]: !prev[step.id] }))}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {showAdvanced[step.id] ? 'Hide' : 'Show'} advanced options
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Step Button */}
      {workSteps.length > 0 && (
        <button
          type="button"
          onClick={addStep}
          className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Line Item
        </button>
      )}
    </div>
  )
}
