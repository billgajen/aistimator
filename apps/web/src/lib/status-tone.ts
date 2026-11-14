/**
 * T-164: the colour of a status, by whose turn it is (Docs/design/system.md,
 * Status colours). One map, used by the quotes list, the quote page, Home,
 * the menu badge and the /design preview.
 *
 *   needs you   the accent tint      (attention)
 *   waiting     neutral, cool        (waiting, working)
 *   accepted    green                (good)
 *   closed      grey                 (closed)
 *   failed      red                  (danger)
 *
 * "Needs you" is never butter: butter and tape are for measurement only.
 * Each pair reads at 4.5:1 or more (design-tokens.test.ts).
 */
import type { QuoteTurnTone } from '@qolumns/shared'

export const STATUS_TONE: Record<QuoteTurnTone, string> = {
  attention: 'bg-accent-tint text-accent-ink',
  waiting: 'bg-mist text-text-secondary',
  working: 'bg-mist text-text-secondary',
  good: 'bg-secondary-light text-secondary',
  closed: 'border border-border bg-surface text-text-muted',
  danger: 'bg-danger-light text-danger',
}

/** A small "this needs you" mark that is not a quote status: a count, a "New" tag */
export const NEEDS_YOU_MARK = STATUS_TONE.attention

/** A surface that asks for the owner's attention: the Home tile and the unfinished-requests banner */
export const NEEDS_YOU_SURFACE = 'bg-accent-tint'

/** The token pairs behind each tone, for the contrast test: [text, background] */
export const STATUS_TONE_TOKENS: Record<QuoteTurnTone, readonly [string, string]> = {
  attention: ['--color-accent-ink', '--color-accent-tint'],
  waiting: ['--color-text-secondary', '--color-mist'],
  working: ['--color-text-secondary', '--color-mist'],
  good: ['--color-secondary', '--color-secondary-light'],
  closed: ['--color-text-muted', '--color-surface'],
  danger: ['--color-danger', '--color-danger-light'],
}
