/**
 * T-211: the second voice engine, for comparison on the test page only (AD-102). OpenAI is not
 * part of the product stack; this file exists so the same call can be heard on another engine.
 *
 * How a call is opened. OpenAI's Live sessions have no client secret for a browser: the browser
 * makes a WebRTC offer and sends it to OUR server, which creates the session with the API key
 * (`POST /v1/live/sessions`) and hands the browser the answer. The key never reaches the
 * browser, and the audio then flows browser to OpenAI directly.
 *
 * What is locked. The model, her instructions and her voice are fixed when the session starts
 * (OpenAI rejects a change to them). Her tools live with the backend ("delegation") model, and a
 * browser could change that model's instructions and tools with a `session.update`, so the
 * session is created with the list of events the browser may send, and `session.update` and
 * `session.instructions.append` are not on it.
 *
 * Her tools still run on our server: the backend model's function calls reach the page on the
 * data channel, and the page passes each to the same tool route as the other engine's.
 *
 * BUILT FROM OPENAI'S DOCUMENTATION AND NOT YET RUN AGAINST OPENAI (no key was available when it
 * was written): see the changelog's T-211 entry.
 */
import { systemNote } from './instructions'

export const OPENAI_LIVE_URL = 'https://api.openai.com/v1/live/sessions'

/** The only events the browser may send on the session's data channel */
export const BROWSER_MAY_SEND = ['response.item.create', 'response.create', 'session.close', 'session.commentary.append', 'session.thinking.append'] as const

export interface OpenAiSetup {
  model: string
  backendModel: string
  voice: string
  instruction: string
  /** Function tools, in JSON Schema (tools.ts `functionTools`) */
  tools: unknown[]
  /** The browser's WebRTC offer */
  sdp: string
}

/** What the backend model is told besides her instructions: it is the half of her that uses the tools */
export const BACKEND_ROLE = 'You are the part of the assistant that uses the tools. Call the tool that is needed, then answer with what the caller should be told, in one or two short sentences.'

/** What the session is created with: everything about the call that the browser must not choose */
export function liveSessionRequest(setup: OpenAiSetup) {
  return {
    session: {
      model: setup.model,
      instructions: setup.instruction,
      audio: { output: { voice: setup.voice } },
      // She opens the call: the session is told the call has connected
      input: [{ role: 'developer', content: [{ type: 'input_text', text: `${systemNote('the call has connected.')} Greet the caller now, then wait for them.` }] }],
      delegation: { type: 'responses', responses: { model: setup.backendModel, instructions: `${setup.instruction}\n\n${BACKEND_ROLE}`, tools: setup.tools, tool_choice: 'auto' } },
      client: { data_channel: { allowed_client_events: [...BROWSER_MAY_SEND] } },
      store: false,
    },
    transport: { type: 'webrtc', sdp: setup.sdp },
  }
}

export type LiveSessionResult = { ok: true; sessionId: string; sdp: string } | { ok: false; status: number }

/** Create the session. The key goes in a header to OpenAI and nowhere else. */
export async function createLiveSession(apiKey: string, setup: OpenAiSetup, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<LiveSessionResult> {
  try {
    const response = await fetchImpl(OPENAI_LIVE_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(liveSessionRequest(setup)), signal: AbortSignal.timeout(20_000) })
    const json = (await response.json().catch(() => null)) as { session?: { id?: unknown }; transport?: { sdp?: unknown } } | null
    if (!response.ok || typeof json?.session?.id !== 'string' || typeof json.transport?.sdp !== 'string') return { ok: false, status: response.status }
    return { ok: true, sessionId: json.session.id, sdp: json.transport.sdp }
  } catch {
    return { ok: false, status: 0 }
  }
}

/** Whether the second engine is offered at all: only when its key is set */
export function openAiEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY)
}
