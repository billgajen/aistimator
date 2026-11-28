/**
 * T-173: every public rate limit, in one place.
 *
 * Each scope has one or more windows. In a window, a single IP address may
 * make `perIp` calls and a single business (or, for sign-in, a single email
 * address; for a quote's own page, a single quote) may receive `perKey`
 * calls from everyone together. The longer windows are what stop a slow,
 * steady attack on one business from using up its plan: the per-minute
 * figure alone would allow tens of thousands of requests a day.
 *
 * Change a number here and nowhere else. Limits are off when Upstash is not
 * configured, or when the one switch `RATE_LIMITS_OFF=true` is set (below).
 */
export interface LimitWindow {
  /** Length of the window in seconds */
  seconds: number
  /** Calls allowed from one IP address in the window */
  perIp: number
  /** Calls allowed for one business, quote or email address in the window, from all addresses together */
  perKey: number
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const RATE_LIMITS = {
  // A request for a quote (form, embed, demo): an AI run, emails, and one of the business's plan quotes
  quotes: [
    { seconds: MINUTE, perIp: 5, perKey: 20 },
    { seconds: HOUR, perIp: 15, perKey: 60 },
    { seconds: DAY, perIp: 40, perKey: 200 },
  ],
  // Starting photo and document uploads: signed upload addresses and rows (up to 10 files a call)
  uploads: [
    { seconds: MINUTE, perIp: 20, perKey: 100 },
    { seconds: HOUR, perIp: 120, perKey: 600 },
  ],
  // The chat form of a request: every turn is an AI call
  chat: [
    { seconds: MINUTE, perIp: 15, perKey: 100 },
    { seconds: HOUR, perIp: 120, perKey: 600 },
  ],
  // An unfinished request (the contact step and progress): rows only
  leads: [{ seconds: MINUTE, perIp: 20, perKey: 300 }],
  // The quote link page /quote/{slug}: a page view
  quote_page: [{ seconds: MINUTE, perIp: 60, perKey: 2000 }],
  // The form's settings for a business (read by every embed and quote page)
  widget_config: [{ seconds: MINUTE, perIp: 60, perKey: 1200 }],
  // The form's own view counts: rows only
  widget_analytics: [{ seconds: MINUTE, perIp: 30, perKey: 600 }],
  // What a customer does on their quote: accept, decline, ask a question, answer one.
  // Each emails the business or re-prices the quote. The address is counted before
  // anything is read; the key is the quote, counted once its link has been checked.
  quote_actions: [
    { seconds: MINUTE, perIp: 12, perKey: 8 },
    { seconds: HOUR, perIp: 60, perKey: 30 },
  ],
  // The same actions, counted for the whole business (the key is the business)
  quote_actions_business: [
    { seconds: MINUTE, perIp: 1000, perKey: 60 },
    { seconds: HOUR, perIp: 10000, perKey: 600 },
  ],
  // The one-tap approval link in the review email (the key is the link; the database also caps presses per link)
  approval_link: [{ seconds: MINUTE, perIp: 10, perKey: 5 }],
  // A photo on the approval page (T-183): a page shows up to twelve small ones; the key is the link
  approval_photo: [{ seconds: MINUTE, perIp: 120, perKey: 120 }],
  // T-193: the address of a room's 3D model, asked for when a viewer is opened (the key is the quote or the link)
  room_model: [{ seconds: MINUTE, perIp: 30, perKey: 30 }],
  // T-204: the customer's "Download PDF". The address is counted for every download; the key is the quote
  // and is counted only when a document has to be made (each one is a call to the PDF service): a quote
  // needs one per price, so a handful an hour is already a lot. A PDF already made is never refused for it.
  quote_pdf: [
    { seconds: MINUTE, perIp: 10, perKey: 3 },
    { seconds: HOUR, perIp: 60, perKey: 10 },
  ],
  // T-199: the live check as a business types its own address (signed in; the key is the business)
  address_check: [{ seconds: MINUTE, perIp: 120, perKey: 120 }],
  // T-210: the private voice test (platform admins only; the key is the admin). Starting a call mints a
  // token for a call that costs money by the minute, so a handful an hour is already a full day of testing.
  voice_test_start: [
    { seconds: MINUTE, perIp: 6, perKey: 3 },
    { seconds: HOUR, perIp: 40, perKey: 20 },
    { seconds: DAY, perIp: 120, perKey: 60 },
  ],
  // T-210: one of her tool calls during a test call (each reads the business; an estimate asks the pricing worker)
  voice_test_tool: [{ seconds: MINUTE, perIp: 120, perKey: 60 }],
  // The sign-up relay to Meta: a person signs up once
  marketing: [{ seconds: MINUTE, perIp: 5, perKey: 1000 }],
  // Sign-up: the key is the email address (so one address cannot be sent email after email)
  signup: [
    { seconds: MINUTE, perIp: 3, perKey: 2 },
    { seconds: HOUR, perIp: 10, perKey: 3 },
  ],
  // Log-in: the key is the email address
  login: [
    { seconds: MINUTE, perIp: 10, perKey: 5 },
    { seconds: 15 * MINUTE, perIp: 40, perKey: 12 },
  ],
  // Asking for a password reset email, and setting the new password: the key is the email address
  password_reset: [
    { seconds: MINUTE, perIp: 3, perKey: 2 },
    { seconds: HOUR, perIp: 8, perKey: 3 },
  ],
} as const satisfies Record<string, readonly LimitWindow[]>

export type RateLimitScope = keyof typeof RATE_LIMITS

/** How long a call to Upstash may take before the request goes ahead without it (T-178: was 1500) */
export const RATE_LIMIT_TIMEOUT_MS = 500

/**
 * T-178: the one switch that turns every public rate limit off, without
 * removing the Upstash settings: RATE_LIMITS_OFF=true. For the day the
 * limiter itself is the problem. The numbers above are still not settings.
 */
export function rateLimitsSwitchedOff(env: Record<string, string | undefined> = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env.RATE_LIMITS_OFF ?? '').trim().toLowerCase())
}

/** What a blocked caller is told. Plain, and with no detail an attacker could use. */
export function blockedMessage(retryAfterSeconds: number): string {
  if (retryAfterSeconds <= 90) return 'Too many tries in a short time. Please wait a minute and try again.'
  const minutes = Math.ceil(retryAfterSeconds / 60)
  if (minutes < 90) return `Too many tries in a short time. Please try again in about ${minutes} minutes.`
  return 'Too many tries today. Please try again tomorrow.'
}
