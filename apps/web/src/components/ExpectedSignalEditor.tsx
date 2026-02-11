'use client'

import { useState, type KeyboardEvent } from 'react'
import type { ExpectedSignalConfig } from '@estimator/shared'

/**
 * Expected Signal Editor Component
 *
 * Allows editing of expected signals configuration for a service.
 * Signals define what AI should extract from photos and form inputs.
 */

interface ExpectedSignalEditorProps {
  signals: ExpectedSignalConfig[]
  onChange: (signals: ExpectedSignalConfig[]) => void
  /** Maximum number of signals allowed */
  maxSignals?: number
}

const SIGNAL_TYPES: { value: ExpectedSignalConfig['type']; label: string; description: string }[] = [
  { value: 'number', label: 'Number', description: 'Counts, measurements, quantities' },
  { value: 'enum', label: 'Category', description: 'One of several options' },
  { value: 'boolean', label: 'Yes/No', description: 'True or false condition' },
  { value: 'string', label: 'Text', description: 'Free-form text value' },
]

function generateKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function ExpectedSignalEditor({
  signals,
  onChange,
  maxSignals = 6,
}: ExpectedSignalEditorProps) {
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null)
  const [enumInput, setEnumInput] = useState<{ [key: string]: string }>({})

  const addSignal = () => {
    if (signals.length >= maxSignals) return
    const newSignal: ExpectedSignalConfig = {
      signalKey: '',
      type: 'number',
      description: '',
    }
    const newSignals = [...signals, newSignal]
    onChange(newSignals)
    setExpandedSignal(String(newSignals.length - 1))
  }

  const removeSignal = (index: number) => {
    const newSignals = signals.filter((_, i) => i !== index)
    onChange(newSignals)
    if (expandedSignal === String(index)) setExpandedSignal(null)
  }

  const updateSignal = (index: number, updates: Partial<ExpectedSignalConfig>) => {
    const newSignals = signals.map((s, i) =>
      i === index ? { ...s, ...updates } : s
    )
    onChange(newSignals)
  }

  const addEnumValue = (index: number, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const signal = signals[index]
    if (!signal) return
    if (signal.possibleValues?.includes(trimmed)) return
    updateSignal(index, {
      possibleValues: [...(signal.possibleValues || []), trimmed],
    })
    setEnumInput({ ...enumInput, [index]: '' })
  }

  const removeEnumValue = (index: number, valueIndex: number) => {
    const signal = signals[index]
    if (!signal) return
    updateSignal(index, {
      possibleValues: signal.possibleValues?.filter((_, i) => i !== valueIndex),
    })
  }

  const handleEnumKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addEnumValue(index, enumInput[index] || '')
    }
  }

  return (
    <div className="space-y-3">
      {signals.length === 0 ? (
        <div className="rounded-warm-lg border-2 border-dashed border-border p-4 text-center">
          <p className="text-sm text-text-muted">No signals defined</p>
          <p className="mb-2 text-xs text-text-muted">
            Signals define what AI should extract from photos and forms
          </p>
          <button
            type="button"
            onClick={addSignal}
            className="text-sm font-medium text-primary hover:text-primary"
          >
            Add your first signal
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((signal, index) => (
            <div
              key={index}
              className="rounded-warm-lg border border-border bg-surface"
            >
              {/* Signal Header */}
              <div
                className="flex cursor-pointer items-center justify-between px-4 py-3"
                onClick={() =>
                  setExpandedSignal(expandedSignal === String(index) ? null : String(index))
                }
              >
                <div>
                  <p className="font-medium text-text-primary">
                    {signal.signalKey || <span className="italic text-text-muted">Unnamed Signal</span>}
                  </p>
                  <p className="text-sm text-text-muted">
                    {SIGNAL_TYPES.find((t) => t.value === signal.type)?.label || signal.type}
                    {signal.type === 'enum' && signal.possibleValues && (
                      <span className="ml-1 text-text-muted">
                        ({signal.possibleValues.join(', ')})
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSignal(index)
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
                      expandedSignal === String(index) ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Signal Details (Expanded) */}
              {expandedSignal === String(index) && (
                <div className="space-y-4 border-t border-border px-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Signal Key *
                      </label>
                      <input
                        type="text"
                        value={signal.signalKey}
                        onChange={(e) => {
                          const key = generateKey(e.target.value)
                          updateSignal(index, { signalKey: key })
                        }}
                        placeholder="e.g., item_count"
                        className="w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <p className="mt-1 text-xs text-text-muted">
                        Unique identifier (auto-formatted)
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Type
                      </label>
                      <select
                        value={signal.type}
                        onChange={(e) =>
                          updateSignal(index, {
                            type: e.target.value as ExpectedSignalConfig['type'],
                            possibleValues: e.target.value === 'enum' ? [] : undefined,
                          })
                        }
                        className="w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {SIGNAL_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label} - {type.description}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-text-secondary">
                      Description
                    </label>
                    <input
                      type="text"
                      value={signal.description}
                      onChange={(e) => updateSignal(index, { description: e.target.value })}
                      placeholder="What does this signal represent?"
                      className="w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Enum Values */}
                  {signal.type === 'enum' && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Possible Values
                      </label>
                      <div className="min-h-[60px] rounded-warm-lg border border-border p-2">
                        <div className="flex flex-wrap gap-2">
                          {signal.possibleValues?.map((value, valueIndex) => (
                            <span
                              key={valueIndex}
                              className="inline-flex items-center gap-1 rounded-warm-lg bg-primary-light px-2 py-1 text-sm text-primary"
                            >
                              {value}
                              <button
                                type="button"
                                onClick={() => removeEnumValue(index, valueIndex)}
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
                            value={enumInput[index] || ''}
                            onChange={(e) =>
                              setEnumInput({ ...enumInput, [index]: e.target.value })
                            }
                            onKeyDown={(e) => handleEnumKeyDown(e, index)}
                            onBlur={() => {
                              if (enumInput[index]) addEnumValue(index, enumInput[index])
                            }}
                            placeholder={
                              signal.possibleValues?.length
                                ? 'Add value...'
                                : 'e.g., low, medium, high'
                            }
                            className="min-w-[100px] flex-1 border-none p-1 text-sm outline-none"
                          />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        Press Enter to add each value
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Signal Button */}
      {signals.length < maxSignals && signals.length > 0 && (
        <button
          type="button"
          onClick={addSignal}
          className="inline-flex w-full items-center justify-center gap-1 rounded-warm-lg border border-dashed border-border px-3 py-2 text-sm text-text-secondary hover:border-border-strong hover:text-text-primary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Signal ({signals.length}/{maxSignals})
        </button>
      )}
    </div>
  )
}
