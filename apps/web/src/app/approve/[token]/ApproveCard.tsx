'use client'

import Link from 'next/link'
import { useState } from 'react'
import { approvalOutcomeCopy, APPROVAL_COPY, PRODUCT_NAME, type ApprovalDetail, type ApprovalOutcome } from '@qolumns/shared'
import type { ApprovalPhoto, ApprovalSummary } from '@/lib/approval-link'
import { RoomScanCard } from '@/components/room-scan/RoomScanCard'

/**
 * T-183: what the business judges the price by, in reading order: warnings
 * first, then every line with its amount and where its quantity came from,
 * each service's subtotal on a combined quote, and the one total. Drawn from
 * the same result as the review email (shared/approval-detail.ts).
 */
function Detail({ detail }: { detail: ApprovalDetail }) {
  return (
    <div data-testid="approve-detail">
      {detail.warnings.map((warning, i) => (
        // a notice, so `tertiary` (system.md, Colour), as on the dashboard quote page
        <div key={i} className="mt-3 rounded-xl border border-tertiary-line bg-tertiary-light p-3" role="note" data-testid="approve-warning" data-kind={warning.kind}>
          <p className="text-xs font-semibold uppercase text-tertiary">{warning.title}</p>
          {warning.lines.map((line, j) => (
            <p key={j} className="mt-1 break-words text-sm text-text-primary">
              {line}
            </p>
          ))}
          {warning.kind === 'check' && <p className="mt-1 text-xs text-text-secondary">{APPROVAL_COPY.checksNote}</p>}
        </div>
      ))}

      <div className="mt-4" data-testid="approve-lines">
        {detail.parts.map((part, i) => (
          <section key={i} className={i > 0 ? 'mt-4' : ''} data-testid="approve-part" data-main={part.main}>
            {detail.combined && (
              <h2 className="text-sm font-bold text-text-primary">
                {part.serviceName}
                {part.addedBy && (
                  <span className="font-normal text-text-secondary"> ({part.addedBy === 'customer' ? APPROVAL_COPY.addedByCustomer : APPROVAL_COPY.addedByYou})</span>
                )}
              </h2>
            )}
            <ul className={`divide-y divide-border border-y border-border text-sm ${detail.combined ? 'mt-2' : ''}`}>
              {part.lines.map((line, j) => (
                <li key={j} className="flex justify-between gap-4 py-2" data-testid="approve-line">
                  <span className="min-w-0">
                    <span className="block break-words text-text-primary">{line.label}</span>
                    {line.source && (
                      <span className="block text-xs text-text-secondary" data-testid="approve-source">
                        {line.source}
                      </span>
                    )}
                  </span>
                  <span className="figure shrink-0 text-text-primary">{line.amount}</span>
                </li>
              ))}
            </ul>
            {part.minimumNote && (
              <p className="mt-2 text-xs text-text-secondary" data-testid="approve-minimum">
                {part.minimumNote}
              </p>
            )}
            {part.priceWaits && <p className="mt-2 text-xs text-text-secondary">{APPROVAL_COPY.priceWaits}</p>}
            {detail.combined && (
              <p className="mt-2 flex justify-between gap-4 text-sm" data-testid="approve-part-subtotal">
                <span className="text-text-secondary">{APPROVAL_COPY.subtotal}</span>
                <span className="figure shrink-0 font-semibold text-text-primary">{part.subtotal}</span>
              </p>
            )}
          </section>
        ))}
        {detail.totals.tax && (
          <p className="mt-3 flex justify-between gap-4 text-sm text-text-secondary" data-testid="approve-tax">
            <span>{detail.totals.tax.label}</span>
            <span className="figure shrink-0">{detail.totals.tax.amount}</span>
          </p>
        )}
        <p className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
          <span className="text-sm font-bold text-text-primary">{APPROVAL_COPY.total}</span>
          <span className="figure shrink-0 text-2xl text-text-primary" data-testid="approve-total">
            {detail.totals.total}
          </span>
        </p>
      </div>
    </div>
  )
}

/** T-183: the customer's photos, small. Tapping one opens it full size in a new tab. */
function Photos({ photos, line }: { photos: ApprovalPhoto[]; line: string | null }) {
  if (photos.length === 0) return null
  return (
    <div className="mt-4" data-testid="approve-photos">
      {line && <p className="text-xs font-semibold uppercase text-text-secondary">{line}</p>}
      <ul className="mt-2 grid grid-cols-4 gap-2">
        {photos.map((photo, i) => (
          <li key={photo.id}>
            <a href={photo.url} target="_blank" rel="noopener noreferrer" className="block min-h-[44px] overflow-hidden rounded-lg border border-border bg-surface" aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              {/* a short-lived signed address behind our own route: next/image cannot fetch it */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.smallUrl} alt={`Photo ${i + 1} from the customer`} loading="lazy" className="aspect-square w-full object-cover" data-testid="approve-photo" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * T-156: the phone-first confirmation card. One button, "Approve & send";
 * every state offers "Open in dashboard to edit".
 */
export function ApproveCard({ token, initialOutcome, summary }: { token: string; initialOutcome: ApprovalOutcome; summary: ApprovalSummary | null }) {
  const [outcome, setOutcome] = useState<ApprovalOutcome | 'error'>(initialOutcome)
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const copy = message ?? (outcome === 'error' ? { title: 'Something went wrong', body: 'Nothing was sent. Try again, or open the quote in your dashboard.' } : approvalOutcomeCopy(outcome, { customerName: summary?.customerName }))
  const dashboard = summary ? `/app/quotes/${summary.quoteId}` : '/app'

  async function approve() {
    setBusy(true)
    try {
      const res = await fetch(`/api/public/approval/${encodeURIComponent(token)}`, { method: 'POST' })
      const json = (await res.json().catch(() => null)) as { outcome?: ApprovalOutcome; title?: string; body?: string } | null
      if (json?.outcome && json.title && json.body) {
        setOutcome(json.outcome)
        setMessage({ title: json.title, body: json.body })
      } else {
        setOutcome(res.status === 429 ? 'too_many' : 'error')
        setMessage(null)
      }
    } catch {
      setOutcome('error')
    } finally {
      setBusy(false)
    }
  }

  const done = outcome === 'approved'
  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:py-12">
      <div className="mx-auto max-w-md">
        <p className="mb-4 text-center font-display text-sm font-extrabold tracking-tight text-text-secondary">{PRODUCT_NAME}</p>
        <div className="rounded-2xl bg-white p-5 shadow-warm-md sm:p-6" data-testid="approve-card" data-outcome={outcome}>
          {summary && (
            <div className="border-b border-border pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">{summary.businessName}</p>
              <p className="mt-2 font-display text-xl font-bold text-text-primary">{summary.customerName}</p>
              <p className="text-sm text-text-secondary">{summary.serviceName}</p>
              {/* T-193: what the room scan measured, above the price, as on the dashboard */}
              {summary.detail && summary.roomScan && <RoomScanCard view={summary.roomScan} modelPath={summary.roomModelPath ?? null} className="mt-4" />}
              {/* T-183: while the link can approve, the full detail replaces the short list below */}
              {summary.detail && <Detail detail={summary.detail} />}
              {/* a measured range is said beside the total it surrounds; a single price is the total itself */}
              {summary.detail && summary.price && summary.price !== summary.detail.totals.total && (
                <p className="mt-2 text-sm text-text-secondary" data-testid="approve-range">
                  Measured range: <span className="figure text-text-primary">{summary.price}</span>
                </p>
              )}
              {summary.detail && summary.photos && <Photos photos={summary.photos} line={summary.detail.photosLine} />}
              {/* T-179: a combined quote lists each service with its subtotal, then the one total */}
              {!summary.detail && summary.sections && summary.sections.length > 0 && (
                <ul className="mt-3 divide-y divide-border border-y border-border text-sm" data-testid="approve-sections">
                  {summary.sections.map((section, i) => (
                    <li key={i} className="flex justify-between gap-4 py-2">
                      <span className="min-w-0 text-text-secondary">{section.serviceName}</span>
                      <span className="figure shrink-0 text-text-primary">{section.subtotal}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!summary.detail && summary.price && <p className="figure mt-3 text-3xl text-text-primary" data-testid="approve-price">{summary.price}</p>}
              {summary.scopeSummary && <p className="mt-3 text-sm leading-relaxed text-text-secondary">{summary.scopeSummary}</p>}
            </div>
          )}

          <div className={summary ? 'pt-4' : ''} role="status" aria-live="polite">
            <h1 className={`font-display text-lg font-bold ${done ? 'text-primary' : 'text-text-primary'}`} data-testid="approve-title">
              {copy.title}
            </h1>
            <p className="mt-1 text-sm text-text-secondary" data-testid="approve-body">
              {copy.body}
            </p>
          </div>

          {outcome === 'ready' && (
            <button
              type="button"
              onClick={approve}
              disabled={busy}
              className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-lg bg-primary px-6 text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              data-testid="approve-button"
            >
              {busy ? 'Sending…' : 'Approve & send'}
            </button>
          )}

          <Link
            href={dashboard}
            className="mt-4 flex min-h-[44px] items-center justify-center text-sm font-semibold text-primary underline underline-offset-2"
            data-testid="approve-dashboard"
          >
            Open in dashboard to edit
          </Link>
        </div>
      </div>
    </main>
  )
}
