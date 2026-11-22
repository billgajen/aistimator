/**
 * T-198: one model answer, as it is written (the web app's own path to the
 * model, the one the chat task uses: Gemini over REST, the model taken from
 * the registry by task, never named here).
 *
 * Yields the answer's text piece by piece. Throws when the model cannot be
 * reached, refuses, or the caller's signal is aborted; the caller decides
 * what a business is told. Nothing is logged here.
 */
import type { AiTask } from '@qolumns/shared'
import { GEMINI_API_BASE, geminiModelFor, geminiThinkingConfig } from './models'

export interface StreamRequest {
  system: string
  prompt: string
  signal?: AbortSignal
  maxOutputTokens?: number
}

export class ModelUnavailable extends Error {
  constructor(name: string) {
    super(name)
    this.name = name
  }
}

interface StreamChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
}

/** The text of one server-sent chunk: the answer's own parts, never the model's thinking */
export function chunkText(chunk: StreamChunk): string {
  return (chunk.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('')
}

/** Read a server-sent stream ("data: {...}" lines) into its JSON chunks */
export async function* sseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!data || data === '[DONE]') continue
        try {
          yield JSON.parse(data) as StreamChunk
        } catch {
          // a piece that is not JSON carries no text
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function* streamModel(task: AiTask, request: StreamRequest): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new ModelUnavailable('NoModelKey')
  const response = await fetch(`${GEMINI_API_BASE}/${geminiModelFor(task)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: request.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: { maxOutputTokens: request.maxOutputTokens ?? 1200, ...geminiThinkingConfig(task) },
    }),
  })
  if (!response.ok || !response.body) throw new ModelUnavailable(`ModelStatus${response.status}`)
  for await (const chunk of sseChunks(response.body)) {
    const text = chunkText(chunk)
    if (text) yield text
  }
}
