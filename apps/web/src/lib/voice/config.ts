/**
 * T-210: the private voice test ("Oumn test call"). What is fixed about a test call, in one place.
 *
 * Oumn is a planned voice assistant for each business. This ticket is a one-day test of five things
 * (cost, delay, how she sounds, whether the prices she says are the engine's, whether she keeps to
 * the business's information). Nothing a customer or a business sees is changed by it, and a call
 * stores nothing.
 *
 * No server import here: the page reads these too.
 */

/** Her name */
export const ASSISTANT_NAME = 'Oumn'

/** A call is ended at this many seconds, whatever is being said */
export const CALL_LIMIT_SECONDS = 8 * 60
/** At this many seconds she is told that time is short */
export const WRAP_UP_SECONDS = 6 * 60
/** What she is told then. Her instructions say what to do when she hears it. */
export const WRAP_UP_NOTE = 'Time is short: about two minutes are left on this call. Finish what you are saying, sum up in one sentence, and say goodbye.'

/** A minted token must open its one session within this many seconds */
export const TOKEN_START_SECONDS = 60
/** …and is dead after this many: a little over the call limit, so a call cannot be kept open past it */
export const TOKEN_LIFE_SECONDS = CALL_LIMIT_SECONDS + 60
/** The call session (which pins the business for her tools) lasts as long as the token */
export const SESSION_LIFE_SECONDS = TOKEN_LIFE_SECONDS

/** The business the picker opens on: the owner's test business. Any other is picked on the page. */
export const DEFAULT_TEST_BUSINESS_ID = 'tnt_812592c3a48e37e482f56522'

/** Microphone audio goes up as 16 kHz 16-bit PCM; hers comes down as 24 kHz 16-bit PCM */
export const INPUT_SAMPLE_RATE = 16_000
export const OUTPUT_SAMPLE_RATE = 24_000
export const INPUT_MIME = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

/**
 * Where the browser opens the call. An ephemeral token is accepted only by the "constrained"
 * service (the plain one answers "Permission denied", probed 27 Nov 2026), and only as this query
 * parameter: a browser cannot set a header on a WebSocket.
 */
export const LIVE_API_HOST = 'generativelanguage.googleapis.com'
export const LIVE_API_VERSION = 'v1beta'
export const liveSocketUrl = (token: string) =>
  `wss://${LIVE_API_HOST}/ws/google.ai.generativelanguage.${LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`
export const LIVE_TOKEN_URL = `https://${LIVE_API_HOST}/${LIVE_API_VERSION}/auth_tokens`

/** The page and its routes exist only while this is "true" (and only for a platform admin) */
export function voiceTestEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VOICE_TEST_ENABLED === 'true'
}

/** The page's "things to try" */
export const THINGS_TO_TRY: readonly string[] = [
  'Ask for a price.',
  'Ask for something the business does not offer.',
  'Ask about an area outside its service area.',
  'Ask something it has not answered anywhere (a guarantee, parking).',
  'Ask "are you a real person?"',
  'Ask for a person.',
  'Give an urgent problem.',
  'Book a visit.',
]
