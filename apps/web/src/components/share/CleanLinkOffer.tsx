'use client'

import { useEffect, useState } from 'react'
import { slugify } from '@/lib/tenant-slug'

interface Check {
  slug: string
  available: boolean
  message?: string
}

const OWN = '__own__'

/** The address without its scheme: "https://example.com" → "example.com" */
const hostOf = (appOrigin: string) => appOrigin.replace(/^[a-z]+:\/\//, '')

/**
 * T-174: a business whose link ends in random characters is offered cleaner
 * ones, built by the server from its own stored details and already checked
 * free, or it types its own with the live check. Replacing a random link is
 * free: the server decides that, and the one change stays available.
 *
 * The component asks the server itself (GET /api/tenant/slug), so it shows
 * what is true now, at the end of setup as well as on the Quote link page.
 * It renders nothing for a business whose link is not random.
 */
export function CleanLinkOffer({
  appOrigin,
  onChanged,
  className = '',
}: {
  appOrigin: string
  /** the new slug, once the link is replaced */
  onChanged: (slug: string) => void
  className?: string
}) {
  const [state, setState] = useState<{ slug: string; options: string[] } | null>(null)
  const [choice, setChoice] = useState<string>('')
  const [draft, setDraft] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ from: string; to: string } | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/tenant/slug')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!live || !json?.random) return
        const options = Array.isArray(json.options) ? (json.options as string[]) : []
        setState({ slug: json.slug as string, options })
        setChoice(options[0] ?? OWN)
      })
      .catch(() => {
        // no offer: the link works as it is
      })
    return () => {
      live = false
    }
  }, [])

  const typed = slugify(draft)
  const current = state?.slug ?? ''

  // Live check of a typed link, debounced
  useEffect(() => {
    if (choice !== OWN || !typed || typed === current) {
      setCheck(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenant/slug?check=${encodeURIComponent(typed)}`)
        const json = await res.json()
        if (res.ok && json.check) setCheck(json.check as Check)
      } catch {
        // best-effort; saving checks again on the server
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [choice, typed, current])

  if (done) {
    return (
      <p className={`rounded-lg border border-secondary-line bg-secondary-light p-3 text-sm text-text-primary ${className}`} role="status" data-testid="clean-link-done">
        Your link now ends in <strong className="font-semibold">{done.to}</strong>. The old one still works and sends people to the new one.
      </p>
    )
  }
  if (!state) return null

  const chosen = choice === OWN ? typed : choice
  const canSave = Boolean(chosen) && chosen !== current && (choice !== OWN || (check?.slug === typed && check.available))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/slug', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: chosen }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error?.message || 'Could not change the link')
        return
      }
      setDone({ from: current, to: json.slug as string })
      onChanged(json.slug as string)
    } catch {
      setError('Could not change the link. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // Each option is one control the size of its row (44 px or more), as on the set-up screens
  const row = (on: boolean) =>
    `flex min-h-[44px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${on ? 'border-primary bg-mint' : 'border-border bg-surface hover:border-field'}`
  const dot = (on: boolean) => (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-primary' : 'border-field'}`} aria-hidden="true">
      {on && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
    </span>
  )

  return (
    <div className={`rounded-xl border border-border bg-background p-4 ${className}`} data-testid="clean-link-offer">
      <h3 className="text-sm font-semibold text-text-primary">Get a cleaner link</h3>
      <p className="mt-1 text-sm text-text-secondary">
        Your link ends in random characters. {state.options.length > 0 ? 'Pick a cleaner one, or type your own.' : 'Type a cleaner ending.'} It&apos;s free
        and doesn&apos;t use up your one change. Your current link keeps working.
      </p>

      {state.options.length > 0 && (
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Choose a new link">
          {state.options.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={choice === option} onClick={() => setChoice(option)} className={row(choice === option)} data-testid="clean-link-option">
              {dot(choice === option)}
              <span className="min-w-0 break-all text-text-primary">
                <span className="text-text-muted">{hostOf(appOrigin)}/quote/</span>
                <span className="font-semibold">{option}</span>
              </span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={choice === OWN} onClick={() => setChoice(OWN)} className={row(choice === OWN)}>
            {dot(choice === OWN)}
            <span className="text-text-primary">Type my own</span>
          </button>
        </div>
      )}

      {choice === OWN && (
        <div className="mt-3">
          <label className="block text-sm font-medium text-text-primary" htmlFor="clean-link-own">
            New ending
          </label>
          <div className="mt-1.5 flex items-center gap-1 text-sm">
            <span className="hidden text-text-muted sm:inline">{hostOf(appOrigin)}/quote/</span>
            <input
              id="clean-link-own"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-field bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <p className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
            {typed && typed !== draft.trim() && <span className="text-text-muted">Will be saved as “{typed}”. </span>}
            {check?.slug === typed && (check.available
              ? <span className="text-secondary">Available</span>
              : <span className="text-danger">{check.message}</span>)}
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={!canSave || saving}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Use this link'}
      </button>
    </div>
  )
}
