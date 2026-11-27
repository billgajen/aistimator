import { SETUP_GUIDES, guide } from '@/lib/guides'
import { GuideLink } from './GuideLink'

/**
 * T-207: the six how-to guides in order, 1 to 6, each with its link (and its
 * tick once watched). Home's "Getting started" card and the support page's
 * "Video guides" both draw this. One column on a phone; from 640 px two
 * columns that read downwards (1 to 3, then 4 to 6).
 */
export function GuideList() {
  return (
    <ol className="sm:grid sm:grid-flow-col sm:grid-rows-3 sm:gap-x-10" data-testid="guide-list">
      {SETUP_GUIDES.map((id, i) => (
        <li key={id} className="flex min-w-0 items-center justify-between gap-4 border-t border-border" data-guide={id}>
          <span className="flex min-w-0 items-baseline gap-2 py-2 text-sm text-text-primary">
            <span className="figure w-4 shrink-0 text-text-muted">{i + 1}</span>
            <span className="font-medium">{guide(id).title}</span>
          </span>
          <GuideLink id={id} />
        </li>
      ))}
    </ol>
  )
}
