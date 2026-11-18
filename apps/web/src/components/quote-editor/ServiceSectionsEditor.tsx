'use client'

import { useEffect, useState } from 'react'
import { MAX_ADDED_SECTIONS } from '@qolumns/shared'
import type { QuoteSection, SectionQuestion } from '@qolumns/shared'
import { MinimumNote } from '@/components/quote/MinimumNote'
import LineItemEditor from './LineItemEditor'
import type { EditorSection, LineItem } from './useQuotePricing'

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
}
const QUIET = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50 sm:min-h-[40px]'
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 sm:min-h-[40px]'
const INPUT = 'mt-1 block w-full min-h-[44px] rounded-lg border border-field bg-background px-3 py-2 text-sm text-text-primary sm:min-h-[40px]'

type Value = string | number | boolean

/**
 * T-179: the service sections of a combined quote, in the quote editor.
 *
 * The business can add another of its services to this quote, or remove one
 * (also one the customer added). A section's price comes from that service's
 * own rules: the editor asks the server to price it, and if the service has
 * questions of its own, answers them here first. Once added, its lines are
 * edited like any other line. Nothing is saved until the quote is saved.
 */
export function ServiceSectionsEditor({
  quoteId,
  mainServiceId,
  currency,
  sections,
  totals,
  onAdd,
  onRemove,
  onItems,
}: {
  quoteId: string
  mainServiceId?: string
  currency: string
  sections: EditorSection[]
  totals: Array<{ serviceId: string; lines: number; topUp: number; subtotal: number }>
  onAdd: (section: Omit<QuoteSection, 'addedBy' | 'addedAt'>) => void
  onRemove: (serviceId: string) => void
  onItems: (serviceId: string, change: (items: LineItem[]) => LineItem[]) => void
}) {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `
  const [services, setServices] = useState<Array<{ id: string; name: string }> | null>(null)
  const [picking, setPicking] = useState(false)
  const [serviceId, setServiceId] = useState('')
  const [questions, setQuestions] = useState<SectionQuestion[]>([])
  const [values, setValues] = useState<Record<string, Value | ''>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!picking || services) return
    let cancelled = false
    fetch('/api/services')
      .then((res) => (res.ok ? res.json() : { services: [] }))
      .then((json: { services?: Array<{ id: string; name: string; active?: boolean }> }) => {
        if (!cancelled) setServices((json.services ?? []).filter((s) => s.active !== false).map((s) => ({ id: s.id, name: s.name })))
      })
      .catch(() => {
        if (!cancelled) setServices([])
      })
    return () => {
      cancelled = true
    }
  }, [picking, services])

  const choices = (services ?? []).filter((s) => s.id !== mainServiceId && !sections.some((section) => section.serviceId === s.id))
  const full = sections.length >= MAX_ADDED_SECTIONS
  const allAnswered = questions.every((q) => values[q.key] !== '' && values[q.key] !== undefined)

  const reset = () => {
    setPicking(false)
    setServiceId('')
    setQuestions([])
    setValues({})
    setNote(null)
  }

  const price = async () => {
    if (!serviceId) return
    setBusy(true)
    setNote(null)
    try {
      const answers = questions.filter((q) => values[q.key] !== '' && values[q.key] !== undefined).map((q) => ({ fieldId: q.key, value: values[q.key] as Value }))
      const response = await fetch(`/api/quotes/${quoteId}/sections/price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, answers }),
      })
      const json = await response.json().catch(() => null)
      if (response.ok && json?.section) {
        onAdd(json.section as Omit<QuoteSection, 'addedBy' | 'addedAt'>)
        reset()
        return
      }
      if (response.status === 422 && Array.isArray(json?.error?.questions)) {
        const asked = json.error.questions as SectionQuestion[]
        setQuestions(asked)
        setValues((current) => Object.fromEntries(asked.map((q) => [q.key, current[q.key] ?? ''])))
        setNote(null)
        return
      }
      setNote(json?.error?.message || 'The price could not be worked out. Try again.')
    } catch {
      setNote('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="editor-sections">
      {sections.map((section) => {
        const sectionTotals = totals.find((t) => t.serviceId === section.serviceId)
        const change = (fn: (items: LineItem[]) => LineItem[]) => onItems(section.serviceId, fn)
        return (
          <div key={section.serviceId} className="mt-5 border-t border-border pt-5" data-testid="editor-section" data-service={section.serviceId}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text-primary">
                {section.serviceName}
                <span className="ml-2 text-xs font-normal text-text-muted">{section.addedBy === 'customer' ? 'added by the customer' : 'added by you'}</span>
              </h3>
              <button type="button" onClick={() => onRemove(section.serviceId)} className={QUIET} data-testid="editor-section-remove">
                Remove this service
              </button>
            </div>
            <LineItemEditor
              items={section.items}
              currency={currency}
              onUpdate={(id, updates) => change((items) => items.map((item) => (item.id === id ? { ...item, ...updates } : item)))}
              onRemove={(id) => change((items) => items.filter((item) => item.id !== id))}
              onAdd={() => change((items) => [...items, { id: `section-item-${Date.now()}`, label: '', amount: 0 }])}
              onReorder={(from, to) =>
                change((items) => {
                  const next = [...items]
                  const moved = next.splice(from, 1)
                  if (moved[0]) next.splice(to, 0, moved[0])
                  return next
                })
              }
            />
            <div className="mt-3 space-y-1 text-sm">
              {section.floor !== null && sectionTotals && sectionTotals.topUp > 0 && (
                <div className="flex items-center justify-between gap-3" data-testid="editor-section-minimum">
                  <MinimumNote minimumCharge={section.floor} currency={currency} />
                  <span className="text-text-primary">+ {symbol}{sectionTotals.topUp.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-text-secondary">{section.serviceName} subtotal</span>
                <span className="text-text-primary" data-testid="editor-section-subtotal">{symbol}{(sectionTotals?.subtotal ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        )
      })}

      <div className="mt-5 border-t border-border pt-5">
        {!picking ? (
          <button type="button" onClick={() => setPicking(true)} disabled={full} className={QUIET} data-testid="editor-add-service">
            Add another service to this quote
          </button>
        ) : (
          <div className="space-y-4" data-testid="editor-add-service-form">
            <label className="block text-sm font-medium text-text-primary">
              Service to add
              <select
                className={INPUT}
                value={serviceId}
                onChange={(event) => {
                  setServiceId(event.target.value)
                  setQuestions([])
                  setValues({})
                  setNote(null)
                }}
                data-testid="editor-add-service-select"
              >
                <option value="">{services === null ? 'Loading your services…' : choices.length === 0 ? 'No other service to add' : 'Choose a service…'}</option>
                {choices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {questions.map((q) => (
              <label key={q.key} className="block text-sm font-medium text-text-primary">
                {q.label}
                {q.type === 'number' && q.unit ? <span className="font-normal text-text-secondary"> ({q.unit})</span> : null}
                {q.type === 'select' ? (
                  <select className={INPUT} value={String(values[q.key] ?? '')} onChange={(event) => setValues((v) => ({ ...v, [q.key]: event.target.value }))} data-testid="editor-add-service-input">
                    <option value="">Choose…</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : q.type === 'boolean' ? (
                  <select
                    className={INPUT}
                    value={values[q.key] === true ? 'yes' : values[q.key] === false ? 'no' : ''}
                    onChange={(event) => setValues((v) => ({ ...v, [q.key]: event.target.value === '' ? '' : event.target.value === 'yes' }))}
                    data-testid="editor-add-service-input"
                  >
                    <option value="">Choose…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : (
                  <input
                    className={INPUT}
                    type={q.type === 'number' ? 'number' : 'text'}
                    min={q.type === 'number' ? 0 : undefined}
                    step={q.type === 'number' ? 'any' : undefined}
                    value={String(values[q.key] ?? '')}
                    onChange={(event) => setValues((v) => ({ ...v, [q.key]: q.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value }))}
                    data-testid="editor-add-service-input"
                  />
                )}
              </label>
            ))}
            {questions.length > 0 && <p className="text-xs text-text-muted">This service’s price depends on these. The price comes from its own price list.</p>}
            {note && (
              <p className="text-sm text-danger" role="alert" data-testid="editor-add-service-note">
                {note}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={price} disabled={!serviceId || busy || !allAnswered} className={PRIMARY} data-testid="editor-add-service-price">
                {busy ? 'Working out the price…' : 'Add at its price'}
              </button>
              <button type="button" onClick={reset} disabled={busy} className={QUIET}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {full && <p className="mt-2 text-xs text-text-muted">A quote can carry up to {MAX_ADDED_SECTIONS} added services.</p>}
      </div>
    </div>
  )
}
