/**
 * T-197: the Help button's rules and words (pure; the web app and the worker
 * share them).
 *
 * A business has one place to get help: it reports a problem, reports a
 * problem with one estimate, or suggests a feature. Every report lands in one
 * queue for the owner, is sorted by the AI (support-sort.ts), and the
 * business is told when it is fixed.
 *
 * Three things are true everywhere:
 *   - A report is saved first. Sorting, matching and emailing come after and
 *     may fail without losing it.
 *   - Nothing here changes a price, a setting, a service or a quote. The
 *     figure a business gives for "What should the total have been?" is
 *     recorded and shown to the owner, and read by nothing else.
 *   - A business sees only its own reports and votes: never who else asked
 *     for a feature, never how many.
 */
import { PRODUCT_NAME, SUPPORT_EMAIL } from './brand'

// ---------------------------------------------------------------------------
// Kinds and statuses
// ---------------------------------------------------------------------------

export type SupportReportKind = 'problem' | 'estimate'
export const SUPPORT_REPORT_KINDS: readonly SupportReportKind[] = ['problem', 'estimate']

export type SupportStatus = 'new' | 'looking' | 'fixed' | 'answered' | 'not_a_fault'
export const SUPPORT_STATUSES: readonly SupportStatus[] = ['new', 'looking', 'fixed', 'answered', 'not_a_fault']
/** Statuses that are still open: these are offered as possible duplicates and counted as waiting */
export const SUPPORT_OPEN_STATUSES: readonly SupportStatus[] = ['new', 'looking']

export type FeatureStatus = 'under_review' | 'planned' | 'shipped' | 'not_planned'
export const FEATURE_STATUSES: readonly FeatureStatus[] = ['under_review', 'planned', 'shipped', 'not_planned']
/** A request in one of these may be offered to another business as "is this what you mean?" */
export const FEATURE_OPEN_STATUSES: readonly FeatureStatus[] = ['under_review', 'planned']

/** What the AI says a problem is */
export type SupportAiKind = 'fault' | 'how_to' | 'billing' | 'feature' | 'other'
export const SUPPORT_AI_KINDS: readonly SupportAiKind[] = ['fault', 'how_to', 'billing', 'feature', 'other']

export type SupportSeverity = 'high' | 'medium' | 'low'
export const SUPPORT_SEVERITIES: readonly SupportSeverity[] = ['high', 'medium', 'low']

/** An estimate report's likely cause, read from the pricing trace */
export type SupportCause = 'setup' | 'ai_reading' | 'fault' | 'unknown'
export const SUPPORT_CAUSES: readonly SupportCause[] = ['setup', 'ai_reading', 'fault', 'unknown']

/** What a business can tick on "Report a problem with this estimate" */
export type EstimateChoice = 'too_high' | 'too_low' | 'wrong_reading' | 'missed' | 'extra' | 'wording' | 'other'
export const ESTIMATE_CHOICES: readonly EstimateChoice[] = ['too_high', 'too_low', 'wrong_reading', 'missed', 'extra', 'wording', 'other']

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Reports, and feature requests, a business may send in a day */
export const SUPPORT_DAILY_LIMIT = 20
export const SUPPORT_BODY_MAX = 4000
export const FEATURE_BODY_MAX = 2000
/** The match step may take this long; after it the request is saved as new */
export const FEATURE_MATCH_TIMEOUT_MS = 5000
/** How long the worker gives one sorting call before the report is left unsorted */
export const SUPPORT_SORT_TIMEOUT_MS = 25_000
/** T-198: a draft reply is asked for after the sorting is stored; it is short, and is given up on sooner */
export const SUPPORT_REPLY_TIMEOUT_MS = 15_000
/** At or above this confidence a look-alike is suggested to the owner as a merge. Never merged by itself. */
export const SUPPORT_MERGE_SUGGEST_AT = 0.85
/** Below this a look-alike is not kept at all */
export const SUPPORT_SIMILAR_MIN = 0.5
export const SUPPORT_SIMILAR_MAX = 3
export const FEATURE_MATCH_MAX = 3
/** Below this a feature request is not offered as "is this what you mean?" */
export const FEATURE_MATCH_MIN = 0.6

/**
 * May this business send another today? `countToday` is what the database
 * counted, or null when it could not be counted: then the report is allowed
 * (the limit must never be the reason a report is lost).
 */
export function underDailyLimit(countToday: number | null | undefined, limit: number = SUPPORT_DAILY_LIMIT): boolean {
  if (typeof countToday !== 'number' || !Number.isFinite(countToday)) return true
  return countToday < limit
}

// ---------------------------------------------------------------------------
// Words (the only place they live)
// ---------------------------------------------------------------------------

export const SUPPORT_COPY = {
  help: 'Help',
  panelTitle: 'Help',
  reportProblem: 'Report a problem',
  reportProblemHint: 'Something broke or looks wrong.',
  suggestFeature: 'Suggest a feature',
  suggestFeatureHint: `Something you would like ${PRODUCT_NAME} to do.`,
  yours: 'Your reports and requests',
  yoursEmpty: 'Nothing yet. What you send us shows here, with our replies.',
  emailLine: `Or email ${SUPPORT_EMAIL}`,
  back: 'Back',
  close: 'Close help',
  problem: {
    label: 'What went wrong?',
    screenshot: 'Add a screenshot (optional)',
    screenshotHint: 'An image, up to 10 MB.',
    include: 'We’ll include',
    send: 'Send report',
    sending: 'Sending…',
    thanks: 'Thanks, we’ve got it. You’ll see our reply here and by email.',
    required: 'Tell us what went wrong.',
  },
  estimate: {
    link: 'Report a problem with this estimate',
    title: 'Report a problem with this estimate',
    choicesLabel: 'What is wrong? Choose one or more.',
    more: 'Tell us more',
    moreOptional: '(optional)',
    moreRequired: '(required)',
    expected: 'What should the total have been?',
    expectedHint: 'For our records only. It does not change this or any other price.',
    investigate: 'We’ll look at this estimate, its photos and how it was priced to investigate.',
    chooseOne: 'Choose at least one.',
    moreNeeded: 'Tell us more about what is wrong.',
    reportedOn: (date: string) => `Reported on ${date}`,
    /** T-198: one line however many times a quote was reported: "Reported on Nov 21", "Reported 2 times, latest Nov 21" */
    reportedLine: (times: number, date: string) => (times > 1 ? `Reported ${times} times, latest ${date}` : `Reported on ${date}`),
    test: 'Test estimate',
  },
  choices: {
    too_high: 'Price too high',
    too_low: 'Price too low',
    wrong_reading: 'Wrong measurement or reading',
    missed: 'Missed something the customer asked for',
    extra: 'Included something it shouldn’t',
    wording: 'Wording',
    other: 'Something else',
  } satisfies Record<EstimateChoice, string>,
  feature: {
    label: `What would you like ${PRODUCT_NAME} to do?`,
    send: 'Send',
    looking: 'Checking…',
    similar: 'Others have asked for something similar. Is one of these what you mean?',
    yes: 'Yes, add my vote',
    no: 'No, mine is different',
    thanks: 'Thanks. We read every request.',
    voted: 'Thanks. Your vote is added.',
    already: 'You’ve already asked for this.',
    required: 'Tell us what you would like.',
  },
  status: {
    new: 'Sent',
    looking: 'Looking into it',
    fixed: 'Fixed',
    answered: 'Answered',
    not_a_fault: 'Not a fault',
  } satisfies Record<SupportStatus, string>,
  /** The owner's inbox says "New" where the business reads "Sent" */
  ownerStatus: {
    new: 'New',
    looking: 'Looking into it',
    fixed: 'Fixed',
    answered: 'Answered',
    not_a_fault: 'Not a fault',
  } satisfies Record<SupportStatus, string>,
  featureStatus: {
    under_review: 'Under review',
    planned: 'Planned',
    shipped: 'Shipped',
    not_planned: 'Not planned',
  } satisfies Record<FeatureStatus, string>,
  aiKind: {
    fault: 'Fault',
    how_to: 'How-to question',
    billing: 'Billing',
    feature: 'Feature request filed as a problem',
    other: 'Other',
  } satisfies Record<SupportAiKind, string>,
  severity: {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  } satisfies Record<SupportSeverity, string>,
  cause: {
    setup: 'Your price setup',
    ai_reading: 'The AI’s reading of the photos or words',
    fault: `A fault in ${PRODUCT_NAME}`,
    unknown: 'Can’t tell',
  } satisfies Record<SupportCause, string>,
  reportKind: {
    problem: 'Problem',
    estimate: 'Estimate',
  } satisfies Record<SupportReportKind, string>,
  /** Under a business's own report, when the sorter found it plainly in the business's setup. A possibility, never a fact. */
  setupHint: (line: string, rate: string) => `This may be down to your prices: ${line} is set to ${rate}. Check it in Services.`,
  setupHintLink: 'Open Services',
  reply: {
    label: 'Reply',
    send: 'Send reply',
    fromUs: PRODUCT_NAME,
    fromYou: 'You',
  },
  limit: `You have sent ${SUPPORT_DAILY_LIMIT} today, which is the most we take in a day. Please try again tomorrow, or email ${SUPPORT_EMAIL}.`,
  failed: `We could not send that. Please try again, or email ${SUPPORT_EMAIL}.`,
} as const

// ---------------------------------------------------------------------------
// What a business sends
// ---------------------------------------------------------------------------

/** What we attach to a problem report, shown to the business before it sends */
export interface SupportContext {
  /** The page they were on (a path) */
  page?: string
  /** The quote, when they were on one */
  quoteId?: string
  plan?: string
  browser?: string
  /** "1440 × 900" */
  screen?: string
  /** The last error the page showed, if any */
  lastError?: string
}

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : undefined
}

/** Keep only the fields we attach, each a short plain string. Anything else a browser sent is dropped. */
export function cleanSupportContext(raw: unknown): SupportContext {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: SupportContext = {}
  const page = clip(input.page, 200)
  // a path of ours, never a whole address (an address can carry a token)
  if (page && page.startsWith('/')) out.page = page.split('?')[0]!.split('#')[0]!
  const quoteId = clip(input.quoteId, 64)
  if (quoteId && /^[A-Za-z0-9_-]+$/.test(quoteId)) out.quoteId = quoteId
  const browser = clip(input.browser, 200)
  if (browser) out.browser = browser
  const screen = clip(input.screen, 30)
  if (screen && /^\d{2,5} × \d{2,5}$/.test(screen)) out.screen = screen
  const lastError = clip(input.lastError, 300)
  if (lastError) out.lastError = lastError
  return out
}

/** The quote a dashboard page is about, from its path ("/app/quotes/qte_1/trace" → "qte_1") */
export function quoteIdOfPath(path: string | null | undefined): string | null {
  const match = /^\/app\/quotes\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path ?? '')
  return match ? match[1]! : null
}

/** The "We'll include" list, in the order it is shown. A line with nothing to say is left out. */
export function supportContextLines(context: SupportContext): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = []
  if (context.page) lines.push({ label: 'The page you were on', value: context.page })
  if (context.quoteId) lines.push({ label: 'The quote', value: context.quoteId })
  if (context.plan) lines.push({ label: 'Your plan', value: context.plan })
  if (context.browser) lines.push({ label: 'Your browser', value: context.browser })
  if (context.screen) lines.push({ label: 'Screen size', value: context.screen })
  if (context.lastError) lines.push({ label: 'The last error shown', value: context.lastError })
  return lines
}

/** A browser's long description, shortened to its name and version ("Chrome 141 on macOS") */
export function browserName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const pick = (pattern: RegExp, name: string) => {
    const found = pattern.exec(ua)
    return found ? `${name} ${found[1]}` : null
  }
  const browser = pick(/Edg\/(\d+)/, 'Edge') ?? pick(/OPR\/(\d+)/, 'Opera') ?? pick(/Firefox\/(\d+)/, 'Firefox') ?? pick(/Chrome\/(\d+)/, 'Chrome') ?? pick(/Version\/(\d+)[\d.]* .*Safari/, 'Safari')
  if (!browser) return os || 'Unknown browser'
  return os ? `${browser} on ${os}` : browser
}

export interface ProblemInput {
  body: string
  screenshotAssetId: string | null
  context: SupportContext
}

export interface EstimateInput {
  quoteId: string
  choices: EstimateChoice[]
  body: string
  expectedTotal: number | null
}

export type Checked<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** Check a problem report as the server received it */
export function checkProblemInput(raw: unknown): Checked<ProblemInput> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body) return { ok: false, code: 'MISSING_TEXT', message: SUPPORT_COPY.problem.required }
  const asset = typeof input.screenshotAssetId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.screenshotAssetId) ? input.screenshotAssetId : null
  return { ok: true, value: { body: body.slice(0, SUPPORT_BODY_MAX), screenshotAssetId: asset, context: cleanSupportContext(input.context) } }
}

/** Check an estimate report: at least one choice, words when the choice is "Something else", and a figure that is a plain amount */
export function checkEstimateInput(raw: unknown): Checked<EstimateInput> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const quoteId = typeof input.quoteId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.quoteId) ? input.quoteId : ''
  if (!quoteId) return { ok: false, code: 'MISSING_QUOTE', message: 'This report needs an estimate.' }
  const picked = Array.isArray(input.choices) ? input.choices : []
  const choices = ESTIMATE_CHOICES.filter((choice) => picked.includes(choice))
  if (choices.length === 0) return { ok: false, code: 'MISSING_CHOICE', message: SUPPORT_COPY.estimate.chooseOne }
  const body = typeof input.body === 'string' ? input.body.trim().slice(0, SUPPORT_BODY_MAX) : ''
  if (choices.includes('other') && !body) return { ok: false, code: 'MISSING_TEXT', message: SUPPORT_COPY.estimate.moreNeeded }
  let expectedTotal: number | null = null
  if (input.expectedTotal !== null && input.expectedTotal !== undefined && input.expectedTotal !== '') {
    const amount = typeof input.expectedTotal === 'number' ? input.expectedTotal : Number(String(input.expectedTotal).replace(/[, ]/g, ''))
    if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999) return { ok: false, code: 'INVALID_TOTAL', message: 'Enter the total as a number.' }
    expectedTotal = Math.round(amount * 100) / 100
  }
  return { ok: true, value: { quoteId, choices, body, expectedTotal } }
}

/** Check a feature request's words */
export function checkFeatureText(raw: unknown): Checked<string> {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, code: 'MISSING_TEXT', message: SUPPORT_COPY.feature.required }
  return { ok: true, value: text.slice(0, FEATURE_BODY_MAX) }
}

/** A new request's first title: the business's own words, cut at a word. Replaced by the AI's or the owner's. */
export function titleFromWords(words: string, max = 80): string {
  const text = words.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text || 'A feature request'
  const cut = text.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[.,;:!?-]+$/, '')}…`
}

// ---------------------------------------------------------------------------
// The owner's inbox
// ---------------------------------------------------------------------------

export interface PriorityInput {
  severity: SupportSeverity | null | undefined
  /** How many businesses reported it (its own and those merged into it) */
  businesses: number
  createdAt: string
}

/**
 * Severity first. A report the AI has not sorted has no severity yet: it sits
 * just under "high", so that nothing unread is buried under sorted low ones.
 */
export function severityRank(severity: SupportSeverity | null | undefined): number {
  if (severity === 'high') return 0
  if (severity === 'medium') return 2
  if (severity === 'low') return 3
  return 1
}

/** The inbox order: severity, then the number of businesses affected, then age (oldest first) */
export function byPriority(a: PriorityInput, b: PriorityInput): number {
  const severity = severityRank(a.severity) - severityRank(b.severity)
  if (severity !== 0) return severity
  if (a.businesses !== b.businesses) return b.businesses - a.businesses
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

/** Feature requests: by votes (businesses), then by how many of them pay, then newest */
export function byVotes(a: { votes: number; paying: number; createdAt: string }, b: { votes: number; paying: number; createdAt: string }): number {
  if (a.votes !== b.votes) return b.votes - a.votes
  if (a.paying !== b.paying) return b.paying - a.paying
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

/** "3 days", "5 hours", "just now": how old a report is */
export function ageWords(createdAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * Who is told a problem is fixed: every report attached to it (its own and
 * those merged into it) that has not been told before, one per business (the
 * earliest report of a business stands for it).
 */
export function fixedRecipients<T extends { reportId: string; tenantId: string; createdAt: string; fixedEmailedAt: string | null }>(attached: readonly T[]): T[] {
  const told = new Set(attached.filter((r) => r.fixedEmailedAt).map((r) => r.tenantId))
  const first = new Map<string, T>()
  for (const row of [...attached].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
    if (told.has(row.tenantId) || first.has(row.tenantId)) continue
    first.set(row.tenantId, row)
  }
  return [...first.values()]
}

/** Who is told a request shipped: one vote per business that has not been told before */
export function shippedRecipients<T extends { voteId: string; tenantId: string; shippedEmailedAt: string | null }>(votes: readonly T[]): T[] {
  const told = new Set(votes.filter((v) => v.shippedEmailedAt).map((v) => v.tenantId))
  const seen = new Set<string>()
  const out: T[] = []
  for (const vote of votes) {
    if (told.has(vote.tenantId) || seen.has(vote.tenantId)) continue
    seen.add(vote.tenantId)
    out.push(vote)
  }
  return out
}

/** Where the Help panel opens on one of a business's items ("/app?help=report:<id>") */
export function helpLink(appUrl: string, item: { kind: 'report' | 'request'; id: string }): string {
  return `${appUrl.replace(/\/+$/, '')}/app?help=${item.kind}:${encodeURIComponent(item.id)}`
}

/** Read `?help=report:<id>` back */
export function parseHelpParam(value: string | null | undefined): { kind: 'report' | 'request'; id: string } | { kind: 'open' } | null {
  if (value === null || value === undefined) return null
  const match = /^(report|request):([A-Za-z0-9-]{1,64})$/.exec(value)
  if (match) return { kind: match[1] as 'report' | 'request', id: match[2]! }
  return { kind: 'open' }
}
