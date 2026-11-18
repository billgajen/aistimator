'use client'

import { useState } from 'react'
import { formatMoney, notOfferedLine, questionsToAddLabel, willConfirmLine } from '@qolumns/shared'
import type { AlsoAsked, SectionQuestion } from '@qolumns/shared'
import { SectionLabel } from '@/components/quote/document-parts'

/**
 * T-179: what else the customer asked for in their note.
 *
 * One card for each other service of the business they explicitly asked for,
 * with their own words. If nothing more needs asking, the card shows that
 * service's price (from the business's price list) and one button, "Add to
 * my quote". If the service has questions of its own, the card asks them
 * first; an answer the note already gave is filled in for the customer to
 * confirm or change. Adding puts the service on this same quote as a section:
 * one total, one accept. Nothing is added until the customer presses the
 * button.
 *
 * A service the business approves first (it holds until approved) shows no
 * price, on the card or once added: only "<business> will confirm this part".
 *
 * Something the business does not offer never gets a price: only "We'll
 * confirm … with you separately."
 */
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-50'
const QUIET = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border-strong bg-background px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:bg-surface disabled:opacity-50'
const INPUT = 'mt-1 block w-full min-h-[44px] rounded-lg border border-field bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'

export type AnswerValue = string | number | boolean
export type AddResult = { ok: true } | { ok: false; message: string; questions?: SectionQuestion[] }

export function AlsoAskedCards({
  items,
  currency,
  locale,
  canChange,
  businessName,
  onAdd,
}: {
  items: AlsoAsked[]
  currency: string
  locale: string
  /** The customer can add a service right now (they can see a price and have not decided) */
  canChange: boolean
  businessName: string
  onAdd: (serviceId: string, answers: Array<{ fieldId: string; value: AnswerValue }>) => Promise<AddResult>
}) {
  // A service already on the quote shows as a section of the price, not here
  const shown = items.filter((item) => item.state !== 'added')
  if (shown.length === 0) return null
  return (
    <section className="mb-8" aria-labelledby="also-asked-title" data-testid="also-asked">
      <SectionLabel>
        <span id="also-asked-title">You also asked for</span>
      </SectionLabel>
      <div className="space-y-3">
        {shown.map((item) =>
          item.state === 'not_offered' ? (
            <div key={item.id} className="rounded-2xl border border-border bg-surface px-5 py-4" data-testid="also-asked-not-offered">
              <p className="text-sm text-text-primary">{notOfferedLine(item.words)}</p>
            </div>
          ) : (
            <OfferedCard key={item.id} item={item} currency={currency} locale={locale} canChange={canChange} businessName={businessName} onAdd={onAdd} />
          )
        )}
      </div>
    </section>
  )
}

function OfferedCard({
  item,
  currency,
  locale,
  canChange,
  businessName,
  onAdd,
}: {
  item: AlsoAsked
  currency: string
  locale: string
  canChange: boolean
  businessName: string
  onAdd: (serviceId: string, answers: Array<{ fieldId: string; value: AnswerValue }>) => Promise<AddResult>
}) {
  const [questions, setQuestions] = useState<SectionQuestion[]>(item.questions ?? [])
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, AnswerValue | ''>>(() =>
    Object.fromEntries((item.questions ?? []).map((q) => [q.key, q.prefill ?? '']))
  )
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const needsAnswers = questions.length > 0
  const allAnswered = questions.every((q) => values[q.key] !== '' && values[q.key] !== undefined)

  const add = async () => {
    if (!item.serviceId) return
    setBusy(true)
    setNote(null)
    const answers = questions
      .filter((q) => values[q.key] !== '' && values[q.key] !== undefined)
      .map((q) => ({ fieldId: q.key, value: values[q.key] as AnswerValue }))
    const result = await onAdd(item.serviceId, answers)
    setBusy(false)
    if (result.ok) return
    // The service needs something more: ask exactly that
    if (result.questions?.length) {
      setQuestions(result.questions)
      setValues((current) => Object.fromEntries(result.questions!.map((q) => [q.key, current[q.key] ?? q.prefill ?? ''])))
      setOpen(true)
    }
    setNote(result.message)
  }

  return (
    <div className="rounded-2xl border border-border bg-mist/70 px-5 py-4" data-testid="also-asked-card" data-service={item.serviceId ?? ''}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary" data-testid="also-asked-service">
            {item.serviceName}
          </p>
          <p className="mt-1 break-words text-sm text-text-secondary" data-testid="also-asked-words">
            You also asked for: “{item.words}”
          </p>
          {item.priceOnApproval && (
            <p className="mt-1 text-sm text-text-secondary" data-testid="also-asked-on-approval">
              {willConfirmLine(businessName)}
            </p>
          )}
        </div>
        {!needsAnswers && !item.priceOnApproval && typeof item.price === 'number' && (
          <p className="figure whitespace-nowrap text-lg font-medium text-text-primary" data-testid="also-asked-price">
            {formatMoney(item.price, currency, locale)}
          </p>
        )}
      </div>

      {!canChange ? null : !needsAnswers ? (
        <div className="mt-4">
          <button type="button" onClick={add} disabled={busy} className={PRIMARY} data-testid="also-asked-add">
            {busy ? 'Adding…' : 'Add to my quote'}
          </button>
        </div>
      ) : !open ? (
        <div className="mt-4">
          <button type="button" onClick={() => setOpen(true)} className={QUIET} data-testid="also-asked-answer">
            {questionsToAddLabel(questions.length)}
          </button>
        </div>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (allAnswered && !busy) void add()
          }}
          data-testid="also-asked-form"
        >
          {questions.map((q) => (
            <QuestionField key={q.key} question={q} value={values[q.key] ?? ''} onChange={(v) => setValues((current) => ({ ...current, [q.key]: v }))} />
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={!allAnswered || busy} className={PRIMARY} data-testid="also-asked-add">
              {busy ? 'Adding…' : 'Add to my quote'}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={QUIET}>
              Not now
            </button>
          </div>
        </form>
      )}

      {note && (
        <p className="mt-3 text-sm text-danger" role="alert" data-testid="also-asked-note">
          {note}
        </p>
      )}
    </div>
  )
}

function QuestionField({ question, value, onChange }: { question: SectionQuestion; value: AnswerValue | ''; onChange: (value: AnswerValue | '') => void }) {
  const id = `also-${question.key}`
  const filled = question.prefill !== undefined && question.prefill !== ''
  const hint = filled ? (
    <span className="mt-1 block text-xs text-text-muted" data-testid="also-asked-prefilled">
      Filled in from your note. Change it if it is not right.
    </span>
  ) : null

  if (question.type === 'boolean') {
    return (
      <fieldset>
        <legend className="text-sm font-medium text-text-primary">{question.label}</legend>
        <div className="mt-2 flex gap-3">
          {[
            { label: 'Yes', v: true },
            { label: 'No', v: false },
          ].map((option) => (
            <label key={option.label} className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm ${value === option.v ? 'border-primary bg-background font-semibold text-text-primary' : 'border-field bg-background text-text-secondary'}`}>
              <input type="radio" name={id} checked={value === option.v} onChange={() => onChange(option.v)} />
              {option.label}
            </label>
          ))}
        </div>
        {hint}
      </fieldset>
    )
  }
  return (
    <label htmlFor={id} className="block">
      <span className="text-sm font-medium text-text-primary">
        {question.label}
        {question.type === 'number' && question.unit ? <span className="font-normal text-text-secondary"> ({question.unit})</span> : null}
      </span>
      {question.type === 'select' ? (
        <select id={id} className={INPUT} value={String(value)} onChange={(event) => onChange(event.target.value)} data-testid="also-asked-input">
          <option value="">Choose…</option>
          {(question.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={INPUT}
          type={question.type === 'number' ? 'number' : 'text'}
          inputMode={question.type === 'number' ? 'decimal' : undefined}
          min={question.type === 'number' ? 0 : undefined}
          step={question.type === 'number' ? 'any' : undefined}
          value={String(value)}
          onChange={(event) => onChange(question.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)}
          data-testid="also-asked-input"
        />
      )}
      {hint}
    </label>
  )
}
