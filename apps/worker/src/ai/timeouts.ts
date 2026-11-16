/**
 * T-172: wall-time caps for the AI calls that had none, set in this one place.
 *
 * The wording, add-on detection and checker calls used to wait for as long as
 * the provider took. Each now gives up after its cap and the quote goes on
 * with what a failed call already falls back to:
 *
 *   wording   the template wording (`generateWordingFallback`)
 *   addons    no AI-detected add-ons (add-ons the business's own keywords or
 *             the customer's form answers trigger are still priced)
 *   checker   the quote goes on unchecked, as priced; no log row is written
 *
 * None of these calls sets or changes a price (AD-001, AD-049), so a timeout
 * cannot either. A cap is a number of milliseconds; 0 means no cap. Each can
 * be changed per deployment with its env var, without a code change.
 *
 * The caps are generous on purpose: each call usually answers in 3 to 5
 * seconds. They exist for the call that never answers.
 */

export const AI_CALL_TIMEOUTS = {
  wording: { defaultMs: 30_000, env: 'AI_TIMEOUT_WORDING_MS' },
  addons: { defaultMs: 20_000, env: 'AI_TIMEOUT_ADDONS_MS' },
  checker: { defaultMs: 30_000, env: 'AI_TIMEOUT_CHECKER_MS' },
} as const

export type TimedAiCall = keyof typeof AI_CALL_TIMEOUTS

export type AiTimeoutEnv = Partial<Record<(typeof AI_CALL_TIMEOUTS)[TimedAiCall]['env'], string>>

/** The cap for a call: its env var when that is a whole number of ms (0 = no cap), else the default */
export function aiCallTimeoutMs(call: TimedAiCall, env: AiTimeoutEnv = {}): number {
  const { defaultMs, env: name } = AI_CALL_TIMEOUTS[call]
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return defaultMs
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : defaultMs
}

/** Carries the call's name and its cap, and nothing from the request */
export class AiCallTimeoutError extends Error {
  constructor(
    readonly call: TimedAiCall,
    readonly timeoutMs: number
  ) {
    super(`AI call "${call}" timed out after ${timeoutMs} ms`)
    this.name = 'AiCallTimeoutError'
  }
}

/**
 * Run an AI call with its cap. On a timeout it logs one line (the call's name
 * and the cap: no customer text, no prompt) and rejects with
 * `AiCallTimeoutError`, which the caller treats as it treats any failed call.
 * The request already sent is not waited for; its late answer is dropped.
 */
export async function withAiTimeout<T>(call: TimedAiCall, timeoutMs: number, run: () => Promise<T>): Promise<T> {
  if (!(timeoutMs > 0)) return run()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.warn(`[AI] ${call} timed out after ${timeoutMs} ms; continuing with the fallback`)
      reject(new AiCallTimeoutError(call, timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(), timedOut])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
