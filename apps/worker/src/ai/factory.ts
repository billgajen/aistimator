/**
 * Task → client factory (T-135). The single place the worker turns a task into
 * a concrete provider client, using the registry route (env-overridable).
 * Returns null when the provider's key is missing, matching the old
 * `createGeminiClient` contract (callers already degrade gracefully).
 */

import type { AiTask, AiUsageMeter } from '@estimator/shared'
import type { AiClient, AiEnv } from './client'
import { routeFor, thinkingFor, usageSinkFor } from './client'
import { GeminiClient } from './gemini'
import { AnthropicClient } from './anthropic'

export function createAiClient(
  task: AiTask,
  env: AiEnv,
  meter?: AiUsageMeter,
  options?: { maxTokens?: number }
): AiClient | null {
  const route = routeFor(task, env)
  const usage = usageSinkFor(meter, task, route)

  if (route.provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      console.warn(`[AI] ${task} routed to ${route.model} but ANTHROPIC_API_KEY is not set`)
      return null
    }
    return new AnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, model: route.model, maxTokens: options?.maxTokens, usage })
  }

  if (!env.GEMINI_API_KEY) {
    console.warn('[AI] GEMINI_API_KEY not configured')
    return null
  }
  return new GeminiClient({
    apiKey: env.GEMINI_API_KEY,
    model: route.model,
    maxTokens: options?.maxTokens,
    thinkingLevel: thinkingFor(task, route.model, env),
    usage,
  })
}
