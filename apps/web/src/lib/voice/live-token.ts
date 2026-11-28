/**
 * T-210, T-211: the short-lived token a test call's browser opens the Gemini Live API with.
 *
 * The page talks to Google directly (no relay of ours carries the audio), so it needs a
 * credential. It is never the API key. The server mints an ephemeral token for one call, and the
 * token LOCKS the whole session setup: the model, her instructions, her voice and her tools are
 * in the token, and Google takes the setup from the token and ignores what the browser sends
 * (no field mask is set, which is what makes the lock total). Probed on 27 Nov 2026: a browser
 * setup naming another model, other instructions and no tools changed nothing; a second
 * connection with the same token was refused; the plain (unconstrained) service refused it.
 *
 * One use, to be opened within a minute, dead a minute after the call limit.
 *
 * T-211, for speed and cost (the numbers are `LIVE_TUNING`):
 * - the wait for the end of speech is set, shorter than the Live API's own (about 800 ms);
 * - the call's memory slides: once the conversation passes `historyTriggerTokens` the oldest
 *   turns are dropped down to `historyKeepTokens`, so a long call stops costing more a minute
 *   than a short one (each turn is billed for everything still in the context). Her
 *   instructions always stay, and what her tools have answered comes back to her with every
 *   tool answer (tools.ts `callSoFar`), so a price given early is not lost with the old turns;
 * - the caller's speech is transcribed as the business's language, so a mis-heard word does not
 *   come back as another language.
 * This model takes no thinking setting (Google's docs say to leave it out), so none is sent.
 */
import { LIVE_TOKEN_URL, TOKEN_LIFE_SECONDS, TOKEN_START_SECONDS } from './config'

/** Every number of the Live API session that this ticket chose */
export const LIVE_TUNING = {
  /** How long a silence ends the caller's turn. Google's default is about 800 ms and its advice is 500 to 800. */
  silenceDurationMs: 500,
  /** Sound kept from before speech is detected, so the first word is not clipped */
  prefixPaddingMs: 120,
  /** How much conversation, beyond her instructions and tools, starts a trim… */
  historyTriggerTokens: 3_000,
  /** …and how much conversation is kept after it (about the last minute of a call) */
  historyKeepTokens: 1_500,
  /** Her instructions and tools are text: about this many characters to a token */
  charsPerToken: 4,
} as const

/**
 * The sliding window for one call. The Live API counts the whole context, instructions and all,
 * and always keeps the instructions; so the two numbers are her instructions' own size plus the
 * conversation to allow and to keep.
 */
export function slidingWindow(setup: Pick<LiveSetup, 'instruction' | 'tools'>): { triggerTokens: number; slidingWindow: { targetTokens: number } } {
  const fixed = Math.ceil((setup.instruction.length + JSON.stringify(setup.tools).length) / LIVE_TUNING.charsPerToken)
  return { triggerTokens: fixed + LIVE_TUNING.historyTriggerTokens, slidingWindow: { targetTokens: fixed + LIVE_TUNING.historyKeepTokens } }
}

export interface LiveSetup {
  model: string
  voice: string
  instruction: string
  tools: unknown[]
  /** The language the caller is expected to speak, as a BCP 47 tag */
  language: string
}

/** The session setup the token carries: everything about the call that the browser must not choose */
export function lockedSetup(setup: LiveSetup) {
  return {
    model: `models/${setup.model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } } },
    systemInstruction: { parts: [{ text: setup.instruction }] },
    tools: [{ functionDeclarations: setup.tools }],
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: LIVE_TUNING.silenceDurationMs, prefixPaddingMs: LIVE_TUNING.prefixPaddingMs } },
    contextWindowCompression: slidingWindow(setup),
    // Both sides of the call as text, for the page's transcript and its price check
    inputAudioTranscription: { languageCodes: [setup.language] },
    outputAudioTranscription: {},
  }
}

export function tokenRequest(setup: LiveSetup, now: Date) {
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString()
  // No fieldMask: the setup then comes from the token alone
  return { uses: 1, newSessionExpireTime: at(TOKEN_START_SECONDS), expireTime: at(TOKEN_LIFE_SECONDS), bidiGenerateContentSetup: lockedSetup(setup) }
}

export type MintResult = { ok: true; token: string } | { ok: false; status: number }

/** Ask Google for the token. The key goes in a header to Google and nowhere else. */
export async function mintLiveToken(apiKey: string, setup: LiveSetup, { now = new Date(), fetchImpl = fetch }: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<MintResult> {
  try {
    const response = await fetchImpl(LIVE_TOKEN_URL, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(tokenRequest(setup, now)), signal: AbortSignal.timeout(15_000) })
    const json = (await response.json().catch(() => null)) as { name?: unknown } | null
    if (!response.ok || typeof json?.name !== 'string' || !json.name) return { ok: false, status: response.status }
    return { ok: true, token: json.name }
  } catch {
    return { ok: false, status: 0 }
  }
}
