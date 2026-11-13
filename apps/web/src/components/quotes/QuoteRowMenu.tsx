'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { QUOTE_TURN_COPY } from '@estimator/shared'

export interface QuoteRowMenuItem {
  key: string
  label: string
  /** A link (opens a page) or an action */
  href?: string
  onSelect?: () => void
}

const ITEM = 'block w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-surface disabled:opacity-50'

/**
 * T-158: the "More" menu on a quotes list row. Every action has words; the
 * caller passes only the actions that will work (the T-157 rules).
 */
export function QuoteRowMenu({
  quoteId,
  items,
  open,
  busy,
  onToggle,
  onClose,
}: {
  quoteId: string
  items: QuoteRowMenuItem[]
  open: boolean
  busy: boolean
  onToggle: () => void
  onClose: () => void
}) {
  // Close on a click elsewhere or on Escape
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest(`[data-more-root="${quoteId}"]`)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, quoteId, onClose])

  return (
    <div className="relative" data-more-root={quoteId}>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50"
        data-testid="more-button"
      >
        {QUOTE_TURN_COPY.more.button}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-white py-1 shadow-warm-lg"
          data-testid="more-menu"
        >
          {items.map((item) =>
            item.href ? (
              <Link key={item.key} href={item.href} role="menuitem" className={ITEM} onClick={onClose}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={ITEM}
                disabled={busy}
                onClick={() => {
                  onClose()
                  item.onSelect?.()
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
