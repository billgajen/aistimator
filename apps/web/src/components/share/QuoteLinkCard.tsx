'use client'

import { useEffect, useState } from 'react'
import { slugify } from '@/lib/tenant-slug'
import { useCopy } from './useCopy'

interface Check {
  slug: string
  available: boolean
  message?: string
}

/**
 * T-149: "Your quote link" — the address, Copy, Open, and a one-time change
 * of the readable part with live availability checking.
 */
export function QuoteLinkCard({
  appOrigin,
  slug,
  changeable,
  onChanged,
}: {
  appOrigin: string
  slug: string
  changeable: boolean
  onChanged: (slug: string) => void
}) {
  const link = `${appOrigin}/quote/${slug}`
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
    <section className="rounded-warm-lg bg-surface p-6 shadow-warm">
      <h2 className="text-lg font-medium text-text-primary">Your quote link</h2>
      <p className="mt-1 text-sm text-text-muted">
        Customers open it, tell you about the job and add photos. No website needed.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-warm-lg border border-border bg-background px-3.5 py-2.5 text-sm text-text-primary" data-testid="quote-link">
          {link}
        </code>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copy('link', link)}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
          >
            {copiedId === 'link' ? 'Copied' : 'Copy'}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-surface"
          >
            Open
          </a>
        </div>
      </div>

      {changeable && !editing && (
        <button
          type="button"
          onClick={() => {
            setDraft(slug)
            setEditing(true)
          }}
          className="mt-3 text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          Change the end of the link
        </button>
      )}
      {!changeable && <p className="mt-3 text-xs text-text-muted">You&apos;ve already changed this link once. Your old link still works.</p>}

      {editing && (
        <div className="mt-4 rounded-warm-lg border border-border bg-background p-4">
          <label className="block text-sm font-medium text-text-primary" htmlFor="slug-input">
            New ending
          </label>
          <div className="mt-1.5 flex items-center gap-1 text-sm">
            <span className="hidden text-text-muted sm:inline">{appOrigin}/quote/</span>
            <input
              id="slug-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save new link'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
