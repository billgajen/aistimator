/**
 * T-198: "Report a problem with this estimate" in the app (pure). The same
 * choices, note and "should have been" figure as the dashboard, sent through
 * the same route; the words are the shared ones (SUPPORT_COPY).
 *
 * The figure is recorded on the report. Nothing in the app, and nothing that
 * prices, reads it.
 */
import { ESTIMATE_CHOICES, SUPPORT_COPY, parseMoneyInput, type EstimateChoice, type SupportStatus } from '@qolumns/shared'
import type { ToneStyle } from './status'
import { TONE_STYLE } from './status'

/** One of the business's own reports on this estimate, as the route answers it (newest first) */
export interface EstimateReportItem {
  id: string
  status: SupportStatus
  statusLabel: string
  createdAt: string
}

export const REPORT_CHOICES = ESTIMATE_CHOICES.map((value) => ({ value, label: SUPPORT_COPY.choices[value] }))

/** "21 Nov" in the phone's own order of day and month */
export function shortDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * The one line a reported quote shows: "Reported on 21 Nov", or "Reported 2
 * times, latest 21 Nov", with the latest report's status. Null when the quote
 * has not been reported.
 */
export function reportedLine(reports: readonly EstimateReportItem[] | null | undefined, locale?: string): { text: string; status: string; tone: ToneStyle } | null {
  const latest = reports?.[0]
  if (!latest) return null
  return {
    text: SUPPORT_COPY.estimate.reportedLine(reports!.length, shortDate(latest.createdAt, locale)),
    status: latest.statusLabel || SUPPORT_COPY.status[latest.status],
    tone: latest.status === 'fixed' || latest.status === 'answered' ? TONE_STYLE.good : latest.status === 'not_a_fault' ? TONE_STYLE.closed : TONE_STYLE.waiting,
  }
}

export function toggleChoice(chosen: readonly EstimateChoice[], choice: string): EstimateChoice[] {
  if (!(ESTIMATE_CHOICES as readonly string[]).includes(choice)) return [...chosen]
  const picked = choice as EstimateChoice
  return chosen.includes(picked) ? chosen.filter((c) => c !== picked) : [...chosen, picked]
}

/** What is wrong with the form, in the dashboard's own words; null when it can be sent */
export function reportProblem(chosen: readonly EstimateChoice[], more: string): string | null {
  if (chosen.length === 0) return SUPPORT_COPY.estimate.chooseOne
  if (chosen.includes('other') && !more.trim()) return SUPPORT_COPY.estimate.moreNeeded
  return null
}

/** The body the route takes: the same one the dashboard sends */
export function reportBody(quoteId: string, chosen: readonly EstimateChoice[], more: string, expected: string): { kind: 'estimate'; quoteId: string; choices: EstimateChoice[]; body: string; expectedTotal: number | null } {
  return { kind: 'estimate', quoteId, choices: [...chosen], body: more.trim(), expectedTotal: expected.trim() === '' ? null : parseMoneyInput(expected) }
}
