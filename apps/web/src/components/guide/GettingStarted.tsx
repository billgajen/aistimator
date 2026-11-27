'use client'

import { GUIDE_COPY, gettingStartedHiddenKey, showGettingStarted } from '@/lib/guides'
import { GuideList } from './GuideList'
import { remember, useRemembered } from './memory'

/**
 * T-207: Home's "Getting started" card: the six guides in order, with their
 * ticks.
 *
 * For a new business: Home draws it while the business has sent fewer than
 * three quotes (`showGettingStarted`), below "Waiting for you" and never
 * above it. "Hide" puts it away for this business in this browser.
 *
 * The page arrives from the server, which cannot know what the browser
 * remembers. So that a hidden card is not shown for a moment on every visit,
 * the one line of script under the card hides it before it is first painted;
 * React then takes the card out once it has read the same key.
 */
export function GettingStarted({ tenantId, sentQuotes }: { tenantId: string; sentQuotes: number }) {
  const key = gettingStartedHiddenKey(tenantId)
  const hidden = useRemembered(key)
  if (!showGettingStarted(sentQuotes, hidden)) return null

  const hideBeforePaint = `try{if(localStorage.getItem(${JSON.stringify(key).replace(/</g, '\\u003c')})==='1')document.currentScript.parentElement.hidden=true}catch(e){}`

  return (
    <section className="mb-8 rounded-2xl bg-white p-6 shadow-warm-md" data-testid="getting-started" suppressHydrationWarning>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-text-primary">{GUIDE_COPY.gettingStarted}</h2>
          <p className="mt-1 text-sm text-text-secondary">{GUIDE_COPY.gettingStartedLine}</p>
        </div>
        <button
          type="button"
          onClick={() => remember(key)}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border border-field bg-white px-4 text-sm font-semibold text-text-primary hover:bg-surface sm:min-h-[40px]"
          data-testid="getting-started-hide"
        >
          {GUIDE_COPY.hide}
        </button>
      </div>
      <div className="mt-4 border-b border-border">
        <GuideList />
      </div>
      <script dangerouslySetInnerHTML={{ __html: hideBeforePaint }} />
    </section>
  )
}
