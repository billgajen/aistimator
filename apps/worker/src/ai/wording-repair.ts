/**
 * T-148: the one rewrite call for wording that trips the customer language
 * guard. Runs only when the guard found something; a clean quote never calls
 * it. Uses the `wording` task's client (model from the registry).
 *
 * The model rewrites the offending sentences only. Whether a rewrite is kept
 * (passes the guard, adds no numbers) is decided by the pure repair in
 * `@estimator/shared` wording-repair, not here.
 */

import { CUSTOMER_BANNED_WORDS, CUSTOMER_BANNED_LABELS } from '@estimator/shared'
import type { OffendingSentence, SentenceRewriter } from '@estimator/shared'
import type { AiClient } from './client'
import { parseModelJson } from './client'

/** A rewrite that takes longer than this is abandoned (the sentence is removed instead) */
export const REWRITE_TIMEOUT_MS = 15_000

const SYSTEM_PROMPT = `You edit sentences from a customer estimate so they say the same thing without describing how certain the price is.
Rules:
- Keep each sentence's meaning, facts and tone. Change as few words as possible.
- Never use these words: ${CUSTOMER_BANNED_WORDS.join(', ')}, guaranteed.
- Never mention grades (Grade A/B/C), these labels: ${CUSTOMER_BANNED_LABELS.join(', ')}, confidence, accuracy or AI.
- Do not add, remove or change any number, price, quantity or measurement.
- Return ONLY JSON: {"rewrites":[{"id":"<id>","text":"<rewritten sentence>"}]}`

export function buildRewritePrompt(sentences: OffendingSentence[]): string {
  const items = sentences.map((s) => ({ id: s.id, sentence: s.sentence }))
  return `Rewrite each sentence below. Return one entry per id.\n\n${JSON.stringify(items, null, 2)}`
}

/** Parse the model's reply into id → text, ignoring anything malformed. */
export function parseRewrites(reply: string, sentences: OffendingSentence[]): Record<string, string> {
  const ids = new Set(sentences.map((s) => s.id))
  const parsed = parseModelJson<{ rewrites?: Array<{ id?: unknown; text?: unknown }> }>(reply)
  const out: Record<string, string> = {}
  for (const r of parsed.rewrites ?? []) {
    if (typeof r.id === 'string' && ids.has(r.id) && typeof r.text === 'string') out[r.id] = r.text
  }
  return out
}

/** The rewriter the processor hands to `repairCustomerWording` (one call). */
export function createSentenceRewriter(client: AiClient, timeoutMs = REWRITE_TIMEOUT_MS): SentenceRewriter {
  return async (sentences) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rewrite timed out after ${timeoutMs} ms`)), timeoutMs)
    })
    try {
      const reply = await Promise.race([client.generateText(buildRewritePrompt(sentences), SYSTEM_PROMPT), timeout])
      return parseRewrites(reply, sentences)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
