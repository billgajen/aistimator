'use client'

import { useEffect, useId, useState } from 'react'
import { ADDRESS_COPY, ADDRESS_MAX_LENGTH, addressHostname, cleanAddress, type AddressCheckState } from '@qolumns/shared'
import { PlanTag } from '@/components/dashboard/PlanTag'
import type { AddressView } from '@/lib/own-address'

interface Check {
  name: string
  hostname: string
  state: AddressCheckState
  message: string
}

const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50'
const quiet = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-field bg-white px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50'

/**
 * T-199: "Choose your own address". A box for the name with what comes after
 * it, a live check as the business types, and a second step that says the
 * choice is for good before it is made.
 *
 * On Home it can be put off ("Later"); on the Quote link page it stays until
 * an address is chosen. One main action per step; nothing here is yellow.
 */
export function OwnAddressCard({ view, place, onChosen, onLater }: { view: AddressView; place: 'home' | 'quote-link'; onChosen: (view: AddressView) => void; onLater?: () => void }) {
  const host = view.host ?? ''
  const fieldId = useId()
  const [typed, setTyped] = useState(view.suggested)
  const [check, setCheck] = useState<Check | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = cleanAddress(typed, host)

  // The live check, a moment after the typing stops
  useEffect(() => {
    if (!name) {
      setCheck(null)
      return
    }
    let live = true
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenant/address?check=${encodeURIComponent(name)}`)
        const json = (await res.json()) as { check?: Check }
        if (live && res.ok && json.check) setCheck(json.check)
      } catch {
        // best-effort: choosing checks again on the server
      }
    }, 350)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [name])

  const current = check && check.name === name ? check : null
  const hostname = name ? addressHostname(name, host) : ''

  async function choose() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/address', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: name }) })
      const json = (await res.json()) as { address?: AddressView; error?: { message?: string } }
      if (!res.ok || !json.address) {
        setError(json.error?.message || ADDRESS_COPY.failed)
        setConfirming(false)
        return
      }
      onChosen(json.address)
    } catch {
      setError(ADDRESS_COPY.failed)
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }

  async function later() {
    onLater?.()
    try {
      await fetch('/api/tenant/address', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ later: true }) })
    } catch {
      // the card is already hidden on this visit; it is asked again on the next
    }
  }

  return (
    <section className={`rounded-xl bg-white p-6 shadow-warm-md ${place === 'home' ? 'mb-8' : ''}`} aria-labelledby={`${fieldId}-title`} data-testid="own-address-card">
      <h2 id={`${fieldId}-title`} className="flex flex-wrap items-center gap-2 text-lg font-medium text-text-primary">
        {ADDRESS_COPY.cardHeading}
        <PlanTag name={view.tag} />
      </h2>

      {confirming ? (
        <div data-testid="own-address-confirm">
          <p className="figure mt-3 break-all text-base text-text-primary">{hostname}</p>
          <p className="mt-2 text-sm text-text-secondary">{ADDRESS_COPY.confirmText}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={choose} disabled={saving} data-testid="own-address-use">
              {ADDRESS_COPY.use(hostname)}
            </button>
            <button type="button" className={quiet} onClick={() => setConfirming(false)} disabled={saving}>
              {ADDRESS_COPY.back}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-secondary">{ADDRESS_COPY.cardText}</p>
          <label htmlFor={fieldId} className="sr-only">
            The name in your address
          </label>
          <div className="mt-4 flex max-w-xl items-stretch rounded-lg border border-field bg-white focus-within:border-primary focus-within:ring-2">
            <input
              id={fieldId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={ADDRESS_MAX_LENGTH + 20}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={`${fieldId}-check ${fieldId}-rules`}
              className="min-h-[44px] w-full min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm text-text-primary focus:outline-none"
              data-testid="own-address-input"
            />
            <span className="flex shrink-0 items-center rounded-r-lg border-l border-border bg-background px-3 text-sm text-text-secondary" data-testid="own-address-host">
              .{host}
            </span>
          </div>
          <p id={`${fieldId}-check`} className={`mt-2 min-h-[1.25rem] text-sm font-medium ${current?.state === 'free' ? 'text-secondary' : 'text-danger'}`} role="status" data-testid="own-address-check">
            {current?.message ?? ''}
          </p>
          <p id={`${fieldId}-rules`} className="text-xs text-text-muted">
            {ADDRESS_COPY.rules}
          </p>
          {error && (
            <p className="mt-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => setConfirming(true)} disabled={current?.state !== 'free'} data-testid="own-address-choose">
              {ADDRESS_COPY.choose}
            </button>
            {place === 'home' && (
              <button type="button" className={quiet} onClick={later} data-testid="own-address-later">
                {ADDRESS_COPY.later}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
