/**
 * T-211: every number of a call's protection, in one place.
 *
 * A call costs money by the minute and a voice can be abused in ways a form cannot, so a call
 * has limits a request does not: how many a device and a business may have in a day, when she
 * ends one, and when a visitor is kept from starting another. Change a number here and nowhere
 * else. No server import: the page reads the silence timings too.
 */
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Why she ends a call (her `end_call` tool) */
export const END_REASONS = ['finished', 'off_topic', 'abusive', 'silent'] as const
export type EndReason = (typeof END_REASONS)[number]

export const VOICE_GUARD = {
  /** Endings that count as a strike. Silence never does: it may be a microphone fault. */
  strikeReasons: ['off_topic', 'abusive'] as readonly EndReason[],
  /** Strikes are counted over this long… */
  strikeWindowSeconds: 24 * HOUR,
  /** …and this many in it block the visitor… */
  strikesToBlock: 2,
  /** …for this long */
  blockSeconds: 2 * DAY,
  /** A strike within this long of a block ending blocks again, at once… */
  repeatWindowSeconds: 30 * DAY,
  /** …for this long */
  repeatBlockSeconds: 7 * DAY,
  /** Calls one device may start in a day (a UTC day) */
  callsPerDevicePerDay: 3,
  /** Calls all visitors together may start with one business in a day */
  callsPerBusinessPerDay: 20,
  /** With no sound from the caller for this long, she asks whether they are there… */
  silenceAskSeconds: 20,
  /** …and this long after that with still none, she ends the call */
  silenceEndSeconds: 10,
  /** How long she gives an off-topic caller after steering them once (said to her; she has no clock) */
  offTopicSeconds: 30,
  /** After `end_call`, how long the page waits for her last sentence before it disconnects anyway */
  lastWordsSeconds: 8,
  /** How long the store (Upstash) is given to answer before the call goes ahead without it */
  storeTimeoutMs: 600,
  /** What a blocked visitor is told */
  blockedMessage: "Calls aren't available right now",
  /** What a visitor over a day's limit is told */
  limitMessage: "Calls aren't available right now. Please try again tomorrow.",
} as const

/** The same settings with any numbers and words (a test tries other numbers) */
export type GuardConfig = { [K in keyof typeof VOICE_GUARD]: (typeof VOICE_GUARD)[K] extends number ? number : (typeof VOICE_GUARD)[K] extends string ? string : (typeof VOICE_GUARD)[K] }
