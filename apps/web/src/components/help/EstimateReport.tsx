'use client'

/**
 * T-197: "Report a problem with this estimate", on every quote in the
 * dashboard. A quiet link under the page; the form opens in place.
 *
 * The figure for "What should the total have been?" is sent to be recorded
 * on the report. Nothing on this page, and nothing that prices, reads it.
 * The report links to the estimate by its id; nothing is copied out of it.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ESTIMATE_CHOICES, SUPPORT_COPY, type EstimateChoice } from '@qolumns/shared'
import type { MyReport } from '@/lib/support'
import { FIELD, FormError, LABEL, MAIN_BUTTON, QUIET_BUTTON, StatusPill, postJson, shortDate } from './parts'

const C = SUPPORT_COPY.estimate

export function EstimateReport({ quoteId, currency, isTest }: { quoteId: string; currency: string; isTest: boolean }) {
  const [reports, setReports] = useState<MyReport[]>([])
  const [open, setOpen] = useState(false)
  const [choices, setChoices] = useState<EstimateChoice[]>([])
  const [more, setMore] = useState('')
  const [expected, setExpected] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/support?quoteId=${encodeURIComponent(quoteId)}`)
      if (!response.ok) return
      const data = (await response.json()) as { reports?: MyReport[] }
      setReports(data.reports ?? [])
    } catch {
      // the estimate reads the same without it
    }
  }, [quoteId])
  useEffect(() => {
    void load()
  }, [load])

  const toggle = (choice: EstimateChoice) => setChoices((current) => (current.includes(choice) ? current.filter((c) => c !== choice) : [...current, choice]))
  const needsMore = choices.includes('other')

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (choices.length === 0) return setError(C.chooseOne)
    if (needsMore && !more.trim()) return setError(C.moreNeeded)
    setSending(true)
    setError(null)
    const result = await postJson<{ message?: string }>('/api/support/reports', { kind: 'estimate', quoteId, choices, body: more, expectedTotal: expected.trim() === '' ? null : expected })
    setSending(false)
    if (!result.ok) return setError(result.data?.error?.message ?? SUPPORT_COPY.failed)
    setThanks(result.data?.message ?? SUPPORT_COPY.problem.thanks)
    setOpen(false)
    setChoices([])
    setMore('')
    setExpected('')
    void load()
  }

  return (
    <section className="mb-6" aria-label={C.title} data-testid="estimate-report">
      {reports.length > 0 && (
        <ul className="mb-3 space-y-2" data-testid="estimate-reported">
          {reports.map((report) => (
            <li key={report.id} className="text-sm text-text-secondary" data-testid="estimate-reported-item">
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  {C.reportedOn('')}
                  <span className="figure">{shortDate(report.createdAt)}</span>
                </span>
                <StatusPill status={report.status} />
              </span>
              {report.setupHint && (
                <span className="mt-1.5 block rounded-lg border border-tertiary-line bg-white px-3 py-2 text-text-primary" data-testid="setup-hint">
                  {SUPPORT_COPY.setupHint(report.setupHint.line, report.setupHint.rate)}{' '}
                  <Link href="/app/services" className="font-semibold text-primary underline underline-offset-2">
                    {SUPPORT_COPY.setupHintLink}
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {thanks && !open && (
        <p role="status" className="mb-3 rounded-lg border border-secondary-line bg-secondary-light px-4 py-3 text-sm text-secondary" data-testid="estimate-report-thanks">
          {thanks}
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setThanks(null)
          }}
          className="inline-flex min-h-[44px] items-center text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
          data-testid="estimate-report-link"
        >
          {C.link}
        </button>
      ) : (
        <form onSubmit={send} className="space-y-5 rounded-2xl border border-border bg-white p-5" data-testid="estimate-report-form" noValidate>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-text-primary">{C.title}</h2>
            {isTest && <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted" data-testid="estimate-report-test">{C.test}</span>}
          </div>

          <fieldset>
            <legend className={LABEL}>{C.choicesLabel}</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {ESTIMATE_CHOICES.map((choice) => (
                <label key={choice} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-field bg-white px-3 text-sm text-text-primary">
                  <input type="checkbox" checked={choices.includes(choice)} onChange={() => toggle(choice)} className="h-4 w-4 shrink-0 accent-primary" data-testid="estimate-choice" data-choice={choice} />
                  {SUPPORT_COPY.choices[choice]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="estimate-more" className={LABEL}>
              {C.more} <span className="font-normal text-text-muted">{needsMore ? C.moreRequired : C.moreOptional}</span>
            </label>
            <textarea id="estimate-more" value={more} onChange={(e) => setMore(e.target.value)} rows={3} maxLength={4000} className={FIELD} data-testid="estimate-more" />
          </div>

          <div>
            <label htmlFor="estimate-expected" className={LABEL}>
              {C.expected} <span className="font-normal text-text-muted">(optional, in {currency})</span>
            </label>
            <input id="estimate-expected" inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} className={`${FIELD} figure sm:max-w-[14rem]`} data-testid="estimate-expected" />
            <p className="mt-1 text-xs text-text-muted">{C.expectedHint}</p>
          </div>

          <p className="text-sm text-text-secondary" data-testid="estimate-investigate">{C.investigate}</p>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={sending} className={MAIN_BUTTON} data-testid="estimate-report-send">
              {sending ? SUPPORT_COPY.problem.sending : SUPPORT_COPY.problem.send}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={QUIET_BUTTON}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
