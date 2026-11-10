'use client'

import { useState } from 'react'
import { webPersonMailto } from '@/lib/share-texts'
import { embedSnippet } from '@/lib/embed-snippet'
import { useCopy } from './useCopy'

/**
 * T-149: "Add it to your website" — the existing embed code (placement ×
 * experience), Copy, and "Send to my web person". The tenant key is inside
 * the code but no longer shown on its own.
 */
export function EmbedCodeCard({
  appOrigin,
  tenantKey,
  businessName,
  link,
  region,
}: {
  appOrigin: string
  tenantKey: string
  businessName: string
  link: string
  region?: string | null
}) {
  const [placement, setPlacement] = useState<'inline' | 'floating'>('inline')
  const [experience, setExperience] = useState<'form' | 'conversational'>('form')
  const { copy, copiedId } = useCopy()
  const code = embedSnippet({ appOrigin, tenantKey, placement, experience })
  const mailto = webPersonMailto({ businessName, link, embedCode: code, region })

  const pill = (active: boolean) =>
    `rounded-warm-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-mint text-primary' : 'bg-background text-text-secondary hover:bg-mist'}`

  return (
    <section className="rounded-warm-lg bg-surface p-6 shadow-warm">
      <h2 className="text-lg font-medium text-text-primary">Add it to your website</h2>
      <p className="mt-1 text-sm text-text-muted">
        If you have a website, the same form can sit on it. Paste this code, or send it to whoever looks after the site.
      </p>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Placement</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setPlacement('inline')} className={pill(placement === 'inline')}>Inline (on your page)</button>
          <button type="button" onClick={() => setPlacement('floating')} className={pill(placement === 'floating')}>Floating button</button>
        </div>
      </div>
      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Experience</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setExperience('form')} className={pill(experience === 'form')}>Step-by-step form</button>
          <button type="button" onClick={() => setExperience('conversational')} className={pill(experience === 'conversational')}>AI chat (conversational)</button>
        </div>
      </div>

      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-warm-lg bg-text-primary p-4 text-sm text-gray-100" data-testid="embed-code">
        {code}
      </pre>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => copy('embed', code, { shareEvent: false })}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface"
        >
          {copiedId === 'embed' ? 'Copied' : 'Copy code'}
        </button>
        <a
          href={mailto}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface"
          data-testid="web-person-mailto"
        >
          Send to my web person
        </a>
        <a
          href={`/demo?tenantKey=${encodeURIComponent(tenantKey)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          Preview on a demo page
        </a>
      </div>
    </section>
  )
}
