'use client'

/**
 * AI Draft Badge Component
 *
 * Displays a badge indicating that a field was pre-filled by AI.
 * Provides options to regenerate or clear the AI-generated content.
 */

interface AIDraftBadgeProps {
  /** Callback when user clicks regenerate */
  onRegenerate?: () => void
  /** Callback when user clicks clear/reset */
  onClear?: () => void
  /** Whether regeneration is in progress */
  isRegenerating?: boolean
  /** Show compact version (just the badge) */
  compact?: boolean
}

export function AIDraftBadge({
  onRegenerate,
  onClear,
  isRegenerating,
  compact = false,
}: AIDraftBadgeProps) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-light px-2 py-0.5 text-xs font-medium text-tertiary">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        AI Draft
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-light px-2.5 py-1 text-xs font-medium text-tertiary">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        AI Draft
      </span>
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="inline-flex items-center gap-1 rounded-warm-lg px-2 py-1 text-xs text-text-secondary hover:bg-background hover:text-text-primary disabled:opacity-50"
        >
          <svg
            className={`h-3.5 w-3.5 ${isRegenerating ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {isRegenerating ? 'Regenerating...' : 'Regenerate'}
        </button>
      )}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-warm-lg px-2 py-1 text-xs text-text-secondary hover:bg-background hover:text-text-primary"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Clear
        </button>
      )}
    </div>
  )
}
