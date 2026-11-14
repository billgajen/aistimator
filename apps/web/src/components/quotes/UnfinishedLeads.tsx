'use client'

import { useEffect, useState } from 'react'
import { QUOTE_TURN_COPY } from '@estimator/shared'
import { UNFINISHED_CHANGED_EVENT } from '@/lib/unfinished-leads'

export interface UnfinishedLead {
  leadId: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  serviceName: string | null
  progress: string
  progressLabel: string
  answerCount: number
  photoCount: number
  postcode: string | null
  createdAt: string
  lastActiveAt: string
  /** T-160: the business has not seen this person before this visit */
  isNew?: boolean
}

/** T-151: the "Started, didn't finish" badge */
export function UnfinishedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-butter px-2.5 py-0.5 text-xs font-semibold text-tertiary">
      Started, didn&apos;t finish
    </span>
  )
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Tell the menu (and anything else listening) that the counts changed */
const announceChange = () => window.dispatchEvent(new Event(UNFINISHED_CHANGED_EVENT))

/**
 * T-151: people who gave their contact details but never submitted. Shows
 * who, for what, how far they got, and tap-to-call / tap-to-email.
 *
 * T-160: opening this list marks the people on it as seen, so the Home banner
 * and the menu badge clear (the ones that were new keep a "New" tag for this
 * visit). "Done" removes a person for good. `onChange` lets the page refresh
 * its tab count.
 */
export function UnfinishedLeads({ onChange }: { onChange?: () => void }) {
  const U = QUOTE_TURN_COPY.unfinished
  const [items, setItems] = useState<UnfinishedLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/leads?days=30')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error?.message || 'Failed to load')
        if (cancelled) return
        const list = json.items as UnfinishedLead[]
        setItems(list)
        // The people now on screen have been seen. Only those: `asOf` is when
        // the list was read, so someone who starts later stays new.
        if (list.some((lead) => lead.isNew)) {
          await fetch('/api/leads/seen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asOf: json.asOf }),
          }).catch(() => undefined)
          announceChange()
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function markDone(lead: UnfinishedLead) {
    setBusy(lead.leadId)
    setNote(null)
    try {
      const res = await fetch(`/api/leads/${lead.leadId}/done`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message || U.saveFailed)
      setItems((current) => (current ?? []).filter((l) => l.leadId !== lead.leadId))
      setNote({ text: U.doneNote, tone: 'ok' })
      announceChange()
      onChange?.()
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : U.saveFailed, tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div className="mb-6 rounded-warm-lg bg-danger-light border border-danger/20 p-4 text-danger">{error}</div>
  if (!items) return <p className="py-10 text-center text-sm text-text-muted">Loading…</p>
  if (items.length === 0) {
    return (
      <div className="rounded-warm-lg bg-surface p-8 text-center shadow-warm" data-testid="unfinished-empty">
        {note && (
          <p role={note.tone === 'error' ? 'alert' : 'status'} className="mb-3 text-sm text-text-secondary" data-testid="unfinished-note">
            {note.text}
          </p>
        )}
        <p className="font-medium text-text-primary">No unfinished requests in the last 30 days</p>
        <p className="mt-1 text-sm text-text-muted">When someone gives their details but doesn&apos;t finish, they show up here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="unfinished-leads">
      <p className="text-sm text-text-secondary">
        These people gave their details but didn&apos;t finish their request. A quick call or email often wins the job.
      </p>
      {note && (
        <p
          role={note.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-sm ${
            note.tone === 'error' ? 'border-danger/20 bg-danger-light text-danger' : 'border-border bg-surface text-text-secondary'
          }`}
          data-testid="unfinished-note"
        >
          {note.text}
        </p>
      )}
      {items.map((lead) => (
        <div
          key={lead.leadId}
          className="rounded-warm-lg bg-surface p-4 shadow-warm sm:flex sm:items-start sm:justify-between sm:gap-4"
          data-testid="unfinished-lead"
          data-lead-id={lead.leadId}
          data-new={lead.isNew ? 'true' : 'false'}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-text-primary">{lead.customerName}</span>
              {lead.isNew && (
                <span className="inline-flex items-center rounded-full bg-mint px-2.5 py-0.5 text-xs font-semibold text-primary" data-testid="unfinished-new">
                  {U.newTag}
                </span>
              )}
              <UnfinishedBadge />
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              {lead.serviceName || 'Service not chosen'} · {lead.progressLabel}
              {lead.photoCount > 0 && ` · ${lead.photoCount} photo${lead.photoCount === 1 ? '' : 's'}`}
              {lead.postcode && ` · ${lead.postcode}`}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Started {when(lead.createdAt)}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
            {lead.customerPhone && (
              <a href={`tel:${lead.customerPhone.replace(/[^0-9+]/g, '')}`} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                Call {lead.customerPhone}
              </a>
            )}
            {lead.customerEmail && (
              <a href={`mailto:${lead.customerEmail}`} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-surface">
                Email {lead.customerEmail}
              </a>
            )}
            <button
              type="button"
              onClick={() => markDone(lead)}
              disabled={busy === lead.leadId}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-surface disabled:opacity-50"
              data-testid="unfinished-done"
            >
              {busy === lead.leadId ? U.doneSaving : U.done}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
