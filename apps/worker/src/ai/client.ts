/**
 * Provider-agnostic AI client (T-135).
 *
 * Every AI consumer in the worker types against `AiClient`, never a concrete
 * provider. `createAiClient(task, env, meter)` resolves the provider + model
 * for a task from the shared registry (`@estimator/shared` ai-models), so the
 * model per task is switched by env (`AI_MODEL_<TASK>`) with no code change.
 */

import type { AiTask, AiUsageMeter, ModelRoute, ThinkingLevel } from '@estimator/shared'
import { resolveModelRoute, resolveThinkingLevel } from '@estimator/shared'

export interface ImageInput {
  mimeType: string
  base64: string
}

export interface GenerationOptions {
  temperature?: number
  maxOutputTokens?: number
}

/** The four call shapes the worker uses. */
export interface AiClient {
  readonly route: ModelRoute
  generateText(prompt: string, systemPrompt?: string): Promise<string>
  generateWithImages(prompt: string, images: ImageInput[], systemPrompt?: string): Promise<string>
  generateWithSchema<T>(prompt: string, schema: Record<string, unknown>, systemPrompt?: string): Promise<T>
  generateWithImagesAndSchema<T>(
    prompt: string,
    images: ImageInput[],
    schema: Record<string, unknown>,
    systemPrompt?: string,
    options?: GenerationOptions
  ): Promise<T>
}

/** Usage reporter handed to clients: task + route are bound at creation. */
export type UsageSink = (inputTokens: number, outputTokens: number) => void

export function usageSinkFor(meter: AiUsageMeter | undefined, task: AiTask, route: ModelRoute): UsageSink {
  return (input, output) => meter?.record(task, route, input, output)
}

/**
 * Parse JSON text from a model, tolerating markdown fences and trailing
 * commas (shared by every provider).
 */
export function parseModelJson<T>(text: string): T {
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim().replace(/,\s*([\]}])/g, '$1')
  return JSON.parse(cleaned) as T
}

export interface AiEnv {
  GEMINI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
}

/** String-valued env entries only (model overrides are strings). */
export function stringEnv(env: object): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v
  return out
}

/** Resolve the route for a task with this env's overrides. */
export function routeFor(task: AiTask, env: object): ModelRoute {
  return resolveModelRoute(task, stringEnv(env))
}

/** Registry thinking level for a task on its routed model (env-overridable). */
export function thinkingFor(task: AiTask, model: string, env: object): ThinkingLevel | null {
  return resolveThinkingLevel(task, model, stringEnv(env))
}
