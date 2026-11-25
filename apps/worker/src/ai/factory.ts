/**
 * Task → client factory (T-135). The single place the worker turns a task into
 * a concrete provider client, using the registry route (env-overridable).
 * Returns null when the provider's key is missing, matching the old
 * `createGeminiClient` contract (callers already degrade gracefully).
 *
 * T-203: the client it returns waits for a busy provider and then sends the
 * call to the task's overflow model (ai/busy.ts). The overflow model comes
 * from the registry too (`overflow`, or AI_OVERFLOW_<TASK>); with no key for
 * its provider, or with "none", there is no overflow and the waiting still
 * happens.
 */

import type { AiTask, AiUsageMeter, ModelRoute } from '@qolumns/shared'
import { resolveOverflowRoute } from '@qolumns/shared'
import type { AiClient, AiEnv } from './client'
import { aiStandInOn, routeFor, stringEnv, thinkingFor, usageSinkFor } from './client'
import { GeminiClient } from './gemini'
import { AnthropicClient } from './anthropic'
import { BUSY_WAITS_MS, BusyRetryClient, type AiBusyLog } from './busy'

let standInSaid = false
const overflowOffSaid = new Set<string>()

/** The longest one overflow request may take: a call that hangs there is an error, not a wait */
export const OVERFLOW_TIMEOUT_MS = 120_000

const isDevelopment = (env: AiEnv) => env.ENVIRONMENT === 'development'

/** T-203, local checks only: shorter waits between busy retries (see AiEnv) */
export function busyWaitsFor(env: AiEnv): readonly number[] {
  if (!isDevelopment(env) || !env.AI_BUSY_WAITS_MS) return BUSY_WAITS_MS
  const waits = env.AI_BUSY_WAITS_MS.split(',').map((part) => Number(part.trim()))
  return waits.length > 0 && waits.every((ms) => Number.isFinite(ms) && ms >= 0) ? waits : BUSY_WAITS_MS
}

interface ProviderOptions {
  maxTokens?: number
  /** The overflow client: one try, a time limit, and no complaint in the log when its key is missing */
  overflow?: boolean
}

/** A client for one provider and model, or null when that provider's key is not set */
function providerClient(task: AiTask, route: ModelRoute, env: AiEnv, meter: AiUsageMeter | undefined, options: ProviderOptions): AiClient | null {
  const usage = usageSinkFor(meter, task, route)
  const dev = isDevelopment(env)

  if (route.provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      if (!options.overflow) console.warn(`[AI] ${task} routed to ${route.model} but ANTHROPIC_API_KEY is not set`)
      return null
    }
    return new AnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY,
      model: route.model,
      maxTokens: options.maxTokens,
      usage,
      ...(options.overflow && { maxRetries: 0, timeoutMs: OVERFLOW_TIMEOUT_MS }),
      ...(dev && env.AI_ANTHROPIC_BASE_URL && { baseUrl: env.AI_ANTHROPIC_BASE_URL }),
    })
  }

  if (!env.GEMINI_API_KEY) {
    if (!options.overflow) console.warn('[AI] GEMINI_API_KEY not configured')
    return null
  }
  return new GeminiClient({
    apiKey: env.GEMINI_API_KEY,
    model: route.model,
    maxTokens: options.maxTokens,
    thinkingLevel: thinkingFor(task, route.model, env),
    usage,
    ...(dev && env.AI_GEMINI_BASE_URL && { baseUrl: env.AI_GEMINI_BASE_URL }),
  })
}

export function createAiClient(
  task: AiTask,
  env: AiEnv,
  meter?: AiUsageMeter,
  options?: { maxTokens?: number; /** T-203: the quote's busy log */ busy?: AiBusyLog }
): AiClient | null {
  // T-183: the quick checks run with no model (local development only)
  if (aiStandInOn(env)) {
    if (!standInSaid) console.log('[AI] AI_STAND_IN=off: no model is asked; built-in defaults are used (local checks only)')
    standInSaid = true
    return null
  }
  const primary = providerClient(task, routeFor(task, env), env, meter, { maxTokens: options?.maxTokens })
  if (!primary) return null

  return new BusyRetryClient(primary, {
    task,
    log: options?.busy,
    waitsMs: busyWaitsFor(env),
    // made only when a call is still busy after its retries
    overflow: () => {
      const route = resolveOverflowRoute(task, stringEnv(env))
      if (!route) return null
      const client = providerClient(task, route, env, meter, { maxTokens: options?.maxTokens, overflow: true })
      if (!client && !overflowOffSaid.has(task)) {
        overflowOffSaid.add(task)
        console.warn(`[AI] ${task} has an overflow model (${route.provider}) but that provider's key is not set: overflow is off`)
      }
      return client
    },
  })
}
