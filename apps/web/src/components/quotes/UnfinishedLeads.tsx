'use client'

import { useEffect, useState } from 'react'

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

/**
 * T-151: people who gave their contact details but never submitted. Shows
 * who, for what, how far they got, and tap-to-call / tap-to-email.
 */
export function UnfinishedLeads() {
  const [items, setItems] = useState<UnfinishedLead[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/leads?days=30')
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error?.message || 'Failed to load')
        setItems(json.items as UnfinishedLead[])
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  if (error) return <div className="mb-6 rounded-warm-lg bg-danger-light border border-danger/20 p-4 text-danger">{error}</div>
  if (!items) return <p className="py-10 text-center text-sm text-text-muted">Loading…</p>
  if (items.length === 0) {
    return (
      <div className="rounded-warm-lg bg-surface p-8 text-center shadow-warm">
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
      {items.map((lead) => (
        <div key={lead.leadId} className="rounded-warm-lg bg-surface p-4 shadow-warm sm:flex sm:items-start sm:justify-between sm:gap-4" data-testid="unfinished-lead">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-text-primary">{lead.customerName}</span>
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
          </div>
        </div>
      ))}
    </div>
  )
}
