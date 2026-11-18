/**
 * Whose turn it is on a quote, in the dashboard's own words (pure).
 *
 * Nothing is worded here: the label, the line under it and the next-step
 * sentence all come from packages/shared/src/quote-turn.ts, the one place
 * that wording lives. This file only feeds it and colours the result by the
 * status colours of Docs/design/system.md.
 */

import { quoteTurn, type AppQuoteView, type QuoteListItem, type QuoteTurn, type QuoteTurnOptions, type QuoteTurnTone } from '@qolumns/shared'
import { colors } from '../theme'

export function turnOfListItem(item: QuoteListItem, opts: QuoteTurnOptions = {}): QuoteTurn {
  return quoteTurn(
    {
      status: item.status,
      customerName: item.customerName,
      hasEmail: Boolean(item.customerEmail),
      total: item.total,
      held: item.held === true,
      createdAt: item.createdAt,
      sentAt: item.sentAt,
      viewedAt: item.viewedAt,
      acceptedAt: item.acceptedAt,
      paidAt: item.paidAt,
      declinedAt: item.declinedAt ?? null,
      expiresAt: item.expiresAt ?? null,
    },
    opts
  )
}

export function turnOfQuote(q: AppQuoteView, opts: QuoteTurnOptions = {}): QuoteTurn {
  return quoteTurn(
    {
      status: q.status,
      customerName: q.customer?.name ?? q.customerName,
      hasEmail: Boolean(q.customer?.email),
      total: q.pricing.total,
      held: q.held === true,
      createdAt: q.createdAt,
      sentAt: q.dates?.sentAt ?? null,
      viewedAt: q.dates?.viewedAt ?? null,
      acceptedAt: q.dates?.acceptedAt ?? null,
      paidAt: q.dates?.paidAt ?? null,
      declinedAt: q.dates?.declinedAt ?? null,
      expiresAt: q.dates?.expiresAt ?? null,
    },
    opts
  )
}

export interface ToneStyle {
  background: string
  text: string
  /** Closed quotes carry an edge instead of a fill */
  border?: string
  /** "Needs you" carries a small dark marker: colour is never the only signal */
  marker?: boolean
}

/** Status colours by whose turn it is (Docs/design/system.md, "Status colours") */
export const TONE_STYLE: Record<QuoteTurnTone, ToneStyle> = {
  attention: { background: colors.accent, text: colors.onAccent, marker: true },
  danger: { background: colors.dangerLight, text: colors.danger },
  waiting: { background: colors.mist, text: colors.textSecondary },
  working: { background: colors.mist, text: colors.textSecondary },
  good: { background: colors.secondaryLight, text: colors.secondary },
  closed: { background: colors.surface, text: colors.muted, border: colors.line },
}
