/**
 * T-210: the short-lived token a test call's browser opens the Live API with.
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
 */
import { LIVE_TOKEN_URL, TOKEN_LIFE_SECONDS, TOKEN_START_SECONDS } from './config'

export interface LiveSetup {
  model: string
  voice: string
  instruction: string
  tools: unknown[]
}

/** The session setup the token carries: everything about the call that the browser must not choose */
export function lockedSetup(setup: LiveSetup) {
  return {
    model: `models/${setup.model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } } },
    systemInstruction: { parts: [{ text: setup.instruction }] },
    tools: [{ functionDeclarations: setup.tools }],
    // Both sides of the call as text, for the page's transcript and its price check
    inputAudioTranscription: {},
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
