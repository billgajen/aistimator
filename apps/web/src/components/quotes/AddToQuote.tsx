'use client'

/**
 * T-204, item 4: "Add to this quote" beside something else the customer
 * asked for.
 *
 * It prices that service from the business's own price list (the worker's
 * rules engine, the same call the quote editor makes) and adds it to this
 * quote as a section: one quote, one total, counted once (T-179). If the
 * service needs an answer first, it is asked here, filled in with what the
 * customer's note already said.
 *
 * On a quote the customer has not been sent, the section is saved and the
 * quote waits as before. On one already sent, adding it is a revision: the
 * customer is emailed the updated quote, so the business is asked first.
 */
import { useState } from 'react'
import { MAX_ADDED_SECTIONS, addedSections } from '@qolumns/shared'
import type { AlsoAsked, QuoteSection, SectionQuestion } from '@qolumns/shared'

export interface AddToQuoteContext {
  quoteId: string
  version: number
  /** The quote's stored pricing and content: they are saved back unchanged, with the new section */
  pricing: unknown
  content: unknown
  /** The customer has already been sent this quote: adding a service sends them an updated one */
  alreadySent: boolean
  customerFirstName?: string | null
  onAdded: () => void | Promise<unknown>
}

type Value = string | number | boolean
const QUIET = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-field bg-background px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50 sm:min-h-[40px]'
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 sm:min-h-[40px]'
const INPUT = 'mt-1 block w-full min-h-[44px] rounded-lg border border-field bg-background px-3 py-2 text-sm text-text-primary sm:min-h-[40px]'

type Priced = Omit<QuoteSection, 'addedBy' | 'addedAt'>

export function AddToQuote({ item, context }: { item: AlsoAsked; context: AddToQuoteContext }) {
  const [questions, setQuestions] = useState<SectionQuestion[]>([])
  const [values, setValues] = useState<Record<string, Value | ''>>({})
  const [priced, setPriced] = useState<Priced | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const sections = addedSections(context.pricing as Parameters<typeof addedSections>[0])
  if (!item.serviceId || item.state !== 'offered') return null
  if (sections.length >= MAX_ADDED_SECTIONS) {
    return <p className="mt-2 text-sm text-text-secondary">A quote can carry up to {MAX_ADDED_SECTIONS} added services. Remove one in &quot;Edit&quot; to add this.</p>
  }

  const allAnswered = questions.every((q) => values[q.key] !== '' && values[q.key] !== undefined)
  const who = context.customerFirstName || 'the customer'

  const save = async (section: Priced) => {
    const pricing = context.pricing as Record<string, unknown>
    const response = await fetch(`/api/quotes/${context.quoteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: context.version,
        pricing_json: { ...pricing, sections: [...sections, section] },
        content_json: context.content,
        sendToCustomer: context.alreadySent,
      }),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      setNote(json?.error?.code === 'VERSION_CONFLICT' ? 'This quote was changed elsewhere. Reload the page and try again.' : json?.error?.message || 'The service could not be added. Try again.')
      return
    }
    setPriced(null)
    setQuestions([])
    await context.onAdded()
  }

  const price = async () => {
    setBusy(true)
    setNote(null)
    try {
      const answers = questions.filter((q) => values[q.key] !== '' && values[q.key] !== undefined).map((q) => ({ fieldId: q.key, value: values[q.key] as Value }))
      const response = await fetch(`/api/quotes/${context.quoteId}/sections/price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: item.serviceId, answers }),
      })
      const json = await response.json().catch(() => null)
      if (response.ok && json?.section) {
        const section = json.section as Priced
        // A quote the customer already has: ask before sending them a new one
        if (context.alreadySent) setPriced(section)
        else await save(section)
        return
      }
      if (response.status === 422 && Array.isArray(json?.error?.questions)) {
        const asked = json.error.questions as SectionQuestion[]
        // what the customer's note already said is filled in, for the business to confirm or change
        const known = new Map((item.questions ?? []).map((q) => [q.key, q.prefill]))
        setQuestions(asked)
        setValues((current) => Object.fromEntries(asked.map((q) => [q.key, current[q.key] ?? q.prefill ?? known.get(q.key) ?? ''])))
        return
      }
      setNote(json?.error?.message || 'The price could not be worked out. Try again.')
    } catch {
      setNote('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!priced) return
    setBusy(true)
    setNote(null)
    try {
      await save(priced)
    } catch {
      setNote('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3" data-testid="add-to-quote">
      {questions.length > 0 && !priced && (
        <div className="mb-3 space-y-3" data-testid="add-to-quote-questions">
          <p className="text-sm text-text-secondary">A few answers are needed to price {item.serviceName || 'this service'}.</p>
          {questions.map((q) => (
            <label key={q.key} className="block text-sm font-medium text-text-primary">
              {q.label}
              {q.unit ? <span className="font-normal text-text-muted"> ({q.unit})</span> : null}
              {q.type === 'select' && q.options ? (
                <select value={String(values[q.key] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [q.key]: e.target.value }))} className={INPUT}>
                  <option value="">Choose…</option>
                  {q.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : q.type === 'boolean' ? (
                <select value={values[q.key] === true ? 'yes' : values[q.key] === false ? 'no' : ''} onChange={(e) => setValues((v) => ({ ...v, [q.key]: e.target.value === '' ? '' : e.target.value === 'yes' }))} className={INPUT}>
                  <option value="">Choose…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input
                  type={q.type === 'number' ? 'number' : 'text'}
                  min={q.type === 'number' ? 0 : undefined}
                  value={String(values[q.key] ?? '')}
                  onChange={(e) => setValues((v) => ({ ...v, [q.key]: q.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))}
                  className={INPUT}
                />
              )}
            </label>
          ))}
        </div>
      )}

      {priced ? (
        <div className="rounded-lg border border-border bg-background p-3" data-testid="add-to-quote-confirm">
          <p className="text-sm text-text-primary">
            This adds {priced.serviceName} to the quote and emails {who} the updated quote with the new total.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={confirm} disabled={busy} className={PRIMARY} data-testid="add-to-quote-send">
              {busy ? 'Adding…' : 'Add and send the update'}
            </button>
            <button type="button" onClick={() => setPriced(null)} disabled={busy} className={QUIET}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={price} disabled={busy || !allAnswered} className={QUIET} data-testid="add-to-quote-button">
          {busy ? 'Working out the price…' : questions.length > 0 ? 'Price it and add' : 'Add to this quote'}
        </button>
      )}
      {note && (
        <p className="mt-2 text-sm text-danger" role="alert" data-testid="add-to-quote-note">
          {note}
        </p>
      )}
    </div>
  )
}
