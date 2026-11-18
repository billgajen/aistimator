'use client'

import { useEffect, useState } from 'react'
import type { BillingNotice } from '@/lib/billing-notice'

/**
 * T-180: the account notice at the top of EVERY dashboard page (the dashboard
 * layout renders it). One line and one action, only when the business must
 * act: a payment that did not go through (the action opens Stripe's portal,
 * where the card is changed), or an account that is paused (the action is an
 * email to us). Nothing is shown otherwise, and nothing while it loads.
 *
 * A failure is `danger` (design: Colour, "Meaning"). No yellow: dashboard
 * buttons are never yellow, and a pale tint would read as a measurement note.
 */
export function AccountNotice({ pathname }: { pathname: string }) {
  const [notice, setNotice] = useState<BillingNotice | null>(null)
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  // Read again on every page change, so it goes as soon as the card is fixed
  useEffect(() => {
    let stopped = false
    fetch('/api/billing/notice')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { notice?: BillingNotice | null } | null) => {
        if (!stopped) setNotice(json?.notice ?? null)
      })
      .catch(() => undefined)
    return () => {
      stopped = true
    }
  }, [pathname])

  if (!notice) return null

  const openPortal = async () => {
    setOpening(true)
    setFailed(false)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const json = (await res.json()) as { portalUrl?: string }
      if (!res.ok || !json.portalUrl) throw new Error('no portal')
      window.location.href = json.portalUrl
    } catch {
      setFailed(true)
      setOpening(false)
    }
  }

  const button =
    'inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50'

  return (
    <div
      role="status"
      data-testid="account-notice"
      data-kind={notice.kind}
      className="mb-6 rounded-2xl border border-danger-line bg-danger-light p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-danger">{notice.line}</p>
        {notice.action === 'portal' ? (
          <button type="button" onClick={openPortal} disabled={opening} className={button} data-testid="account-notice-action">
            {opening ? 'Opening…' : notice.actionLabel}
          </button>
        ) : (
          <a href={`mailto:${notice.email}`} className={button} data-testid="account-notice-action">
            {notice.actionLabel}
          </a>
        )}
      </div>
      {failed && <p className="mt-2 text-sm text-danger">That did not open. Go to Settings, then Billing, and choose &ldquo;Manage billing&rdquo;.</p>}
    </div>
  )
}
