'use client'

import { useEffect, useState } from 'react'
import { ADDRESS_COPY } from '@qolumns/shared'
import { slugify } from '@/lib/tenant-slug'
import { PlanTag } from '@/components/dashboard/PlanTag'
import { useCopy } from './useCopy'
import { CleanLinkOffer } from './CleanLinkOffer'

interface Check {
  slug: string
  available: boolean
  message?: string
}

/**
 * T-149: "Your quote link" — the address, Copy, Open, and a one-time change
 * of the readable part with live availability checking.
 *
 * T-174: while the link still ends in random characters (`random`), the card
 * offers cleaner ones in place of the one-time change: that replacement is
 * free, and the one-time change is offered again afterwards.
 */
export function QuoteLinkCard({
  appOrigin,
  slug,
  changeable,
  random = false,
  address = null,
  planLine = null,
  onChanged,
  onReplaced,
}: {
  /** T-199: the business's own address, when it is the main link. The quote link is then shown under it as "Also works". */
  address?: { url: string; tag: string | null } | null
  /** T-199: a plan without its own address: one quiet line saying which plan has it */
  planLine?: string | null
  appOrigin: string
  slug: string
  changeable: boolean
  /** the link still ends in generated characters and has never been replaced */
  random?: boolean
  /** the one change was used */
  onChanged: (slug: string) => void
  /** a random link was replaced for free; the one change is still there */
  onReplaced?: (slug: string) => void
}) {
  const link = `${appOrigin}/quote/${slug}`
  /** the link to share: the business's own address when it has one, else its quote link */
  const main = address?.url ?? link
  const { copy, copiedId } = useCopy()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(slug)
  const [check, setCheck] = useState<Check | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live "available" check, debounced
  useEffect(() => {
    if (!editing) return
    const candidate = slugify(draft)
    if (!candidate || candidate === slug) {
      setCheck(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenant/slug?check=${encodeURIComponent(candidate)}`)
        const json = await res.json()
        if (res.ok && json.check) setCheck(json.check as Check)
      } catch {
        // best-effort; saving re-checks on the server
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [draft, editing, slug])

  async function save() {
    const candidate = slugify(draft)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/slug', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: candidate }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error?.message || 'Could not change the link')
        return
      }
      onChanged(json.slug)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const candidate = slugify(draft)
  const canSave = Boolean(candidate) && candidate !== slug && check?.slug === candidate && check.available

  return (
    <section className="rounded-xl bg-surface p-6 shadow-warm">
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-medium text-text-primary">
        Your quote link
        <PlanTag name={address?.tag} />
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Customers open it, tell you about the job and add photos. No website needed.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-text-primary" data-testid="quote-link">
          {main}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copy('link', main)}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          >
            {copiedId === 'link' ? 'Copied' : 'Copy'}
          </button>
          <a
            href={main}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-surface"
          >
            Open
          </a>
        </div>
      </div>

      {address && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary" data-testid="also-works">
          <span>{ADDRESS_COPY.alsoWorks}:</span>
          <code className="min-w-0 break-all text-text-primary">{link}</code>
          <button type="button" onClick={() => copy('also', link)} className="inline-flex min-h-[44px] items-center font-semibold text-primary underline underline-offset-2 sm:min-h-[24px]">
            {copiedId === 'also' ? 'Copied' : 'Copy'}
          </button>
        </p>
      )}
      {planLine && (
        <p className="mt-3 text-sm text-text-muted" data-testid="own-address-plan-line">
          {planLine}
        </p>
      )}

      {random && <CleanLinkOffer appOrigin={appOrigin} onChanged={(next) => onReplaced?.(next)} className="mt-4" />}

      {changeable && !random && !editing && (
        <button
          type="button"
          onClick={() => {
            setDraft(slug)
            setEditing(true)
          }}
          className="inline-flex min-h-[44px] items-center sm:min-h-[24px] mt-3 text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          Change the end of the link
        </button>
      )}
      {!changeable && <p className="mt-3 text-xs text-text-muted">You&apos;ve already changed this link once. Your old link still works.</p>}

      {editing && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <label className="block text-sm font-medium text-text-primary" htmlFor="slug-input">
            New ending
          </label>
          <div className="mt-1.5 flex items-center gap-1 text-sm">
            <span className="hidden text-text-muted sm:inline">{appOrigin}/quote/</span>
            <input
              id="slug-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
            {candidate && candidate !== draft.trim() && <span className="text-text-muted">Will be saved as “{candidate}”. </span>}
            {check?.slug === candidate && (check.available
              ? <span className="text-secondary">Available</span>
              : <span className="text-danger">{check.message}</span>)}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            You can change it once. Your current link will keep working and send people to the new one.
          </p>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save new link'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
