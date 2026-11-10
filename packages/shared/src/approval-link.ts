/**
 * T-156: approve a quote from the "Review and approve" email, no login.
 *
 * The worker puts a single-purpose link in that email; the web app's
 * /approve/{token} page shows the quote and approves it only when the button
 * is pressed (a POST), never on opening the link, so email scanners and link
 * previews can't approve anything. The link:
 * - is bound to one quote and one tenant, and stored only as a sha256 hash;
 * - expires 72 hours after it is issued, and works once;
 * - stops working when the quote is approved, edited, declined, expired or
 *   repriced by any route (a database trigger, migration 37), or when a newer
 *   email replaces it;
 * - can approve that quote and nothing else: no editing, no other quote, no
 *   session.
 *
 * Pure apart from randomness and the Web Crypto digest (available in the
 * worker and in Node 18+), so the worker, the web app and the live checks
 * share it.
 */

export const APPROVAL_LINK_TTL_HOURS = 72
/** Presses allowed per link (counted in the database, so it holds without Redis) */
export const APPROVAL_LINK_MAX_ATTEMPTS = 10

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

// Web Crypto is global in the worker and in Node 18+; this package has no DOM types
interface WebCrypto {
  subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> }
  getRandomValues<T extends Uint8Array>(array: T): T
}
const web = globalThis as unknown as { crypto: WebCrypto; TextEncoder: new () => { encode(s: string): Uint8Array } }

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url without padding */
function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4
    for (let c = 0; c < chars; c++) out += B64URL[(n >> (18 - 6 * c)) & 63]
  }
  return out
}

/** sha256 of the token, hex: the only form the database ever holds */
export async function hashApprovalToken(token: string): Promise<string> {
  const digest = await web.crypto.subtle.digest('SHA-256', new web.TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 256 random bits, URL-safe (43 characters) */
export async function generateApprovalToken(): Promise<{ token: string; hash: string }> {
  const bytes = web.crypto.getRandomValues(new Uint8Array(32))
  const token = toBase64Url(bytes)
  return { token, hash: await hashApprovalToken(token) }
}

/** Cheap shape check before any database read */
export function isApprovalTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token)
}

export function approvalLinkExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + APPROVAL_LINK_TTL_HOURS * 3600 * 1000)
}

export function approvalLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/approve/${token}`
}

// ---------------------------------------------------------------------------
// State of a link, and what the page says
// ---------------------------------------------------------------------------

export interface ApprovalLinkRow {
  expires_at: string
  used_at: string | null
  invalidated_at: string | null
  attempts: number
}

export type ApprovalLinkState = 'valid' | 'used' | 'expired' | 'replaced' | 'too_many'

export function approvalLinkState(row: ApprovalLinkRow, now: Date = new Date()): ApprovalLinkState {
  if (row.used_at) return 'used'
  if (row.invalidated_at) return 'replaced'
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  if (row.attempts >= APPROVAL_LINK_MAX_ATTEMPTS) return 'too_many'
  return 'valid'
}

export type ApprovalOutcome =
  | 'ready'
  | 'approved'
  | 'already_approved'
  | 'link_expired'
  | 'not_awaiting'
  | 'wording_needs_edit'
  | 'not_priced'
  | 'too_many'
  | 'not_found'

export interface ApprovalQuoteState {
  status: string
  approved_at: string | null
  pricing_json: { total?: number } | null
  content_json: { limitHold?: boolean } | null
}

/**
 * What the page shows for a link and its quote, before anything is pressed.
 * The quote's own state wins over the link's: a quote approved anywhere reads
 * "already approved" whether its link was used, replaced or has expired.
 */
export function approvalPageOutcome(link: ApprovalLinkRow | null, quote: ApprovalQuoteState | null, now: Date = new Date()): ApprovalOutcome {
  if (!link || !quote) return 'not_found'
  if (quote.status !== 'pending_review') return quote.approved_at ? 'already_approved' : 'not_awaiting'
  const state = approvalLinkState(link, now)
  if (state === 'used') return 'already_approved'
  if (state === 'replaced' || state === 'expired') return 'link_expired'
  if (state === 'too_many') return 'too_many'
  if (quote.content_json?.limitHold || !((quote.pricing_json?.total ?? 0) > 0)) return 'not_priced'
  return 'ready'
}

/** The shared approval function's refusals, as page outcomes */
export function approvalErrorOutcome(code: string, quote?: { approved_at: string | null } | null): ApprovalOutcome {
  switch (code) {
    case 'ALREADY_SENT':
      return 'already_approved'
    case 'INVALID_STATUS':
      return quote?.approved_at ? 'already_approved' : 'not_awaiting'
    case 'NOT_PRICED':
      return 'not_priced'
    case 'WORDING_NEEDS_EDIT':
      return 'wording_needs_edit'
    case 'NOT_FOUND':
      return 'not_found'
    default:
      return 'not_found'
  }
}

/** Plain words for every outcome; the page adds "Open in dashboard to edit" to all of them */
export function approvalOutcomeCopy(
  outcome: ApprovalOutcome,
  ctx: { customerName?: string; businessName?: string; /** approved: whether the confirmed-quote email went out */ emailed?: boolean } = {}
): { title: string; body: string } {
  const customer = ctx.customerName?.trim() || 'Your customer'
  switch (outcome) {
    case 'ready':
      return { title: 'Approve this estimate?', body: `${customer} gets the confirmed quote and can accept it straight away.` }
    case 'approved':
      return ctx.emailed === false
        ? { title: 'Approved', body: `${customer} can accept it now on their quote page. No email went out (there’s no email address for them, or email is off), so send them the link from your dashboard.` }
        : { title: 'Sent', body: `${customer} has been told: they have the confirmed quote by email and can accept it now.` }
    case 'already_approved':
      return { title: 'Already approved', body: 'This quote has already been approved and sent. Nothing was changed.' }
    case 'link_expired':
      return { title: 'This link has expired', body: 'Approval links work for 72 hours, until the quote changes, or until a newer email replaces them. Open the quote in your dashboard to approve it.' }
    case 'not_awaiting':
      return { title: 'No longer waiting for approval', body: 'This quote isn’t waiting for your approval any more (it may have been declined, expired or withdrawn). Nothing was changed.' }
    case 'wording_needs_edit':
      return { title: 'The wording needs a quick edit', body: 'The estimate uses a word customers shouldn’t see. Edit the wording in your dashboard, then send it. Nothing was sent.' }
    case 'not_priced':
      return { title: 'This request has no price yet', body: 'It arrived after you reached your plan’s quote limit, so it was saved as a lead without a price. Price it in your dashboard first.' }
    case 'too_many':
      return { title: 'Too many tries', body: 'This link has been used too many times. Open the quote in your dashboard to approve it.' }
    case 'not_found':
      return { title: 'This link doesn’t work', body: 'It may be incomplete or out of date. Open your dashboard to find the quote.' }
  }
}

// ---------------------------------------------------------------------------
// The review email's words
// ---------------------------------------------------------------------------

export function reviewEmailSubject(d: { customerName: string; serviceName: string; price: string; isTest?: boolean }): string {
  return `${d.isTest ? '[Test] ' : ''}Review and approve: ${d.customerName} - ${d.serviceName} - ${d.price}`
}

/** What the customer can see right now (T-147 hold kinds), for the review email */
export function reviewHoldLine(hold: 'shown' | 'held' | 'check' | null | undefined): string {
  switch (hold) {
    case 'shown':
      return 'Your customer can already see this estimate. They can accept it once you approve.'
    case 'check':
      return 'Held for a check, so your customer hasn’t seen a price yet.'
    default:
      return 'Your customer hasn’t seen a price yet. It’s held until you approve it.'
  }
}

export const TEST_REQUEST_BANNER =
  'This is a test request you made from setup. Approving it works like a real one: the confirmed quote goes to the email you entered for the test, and it counts toward nothing.'
