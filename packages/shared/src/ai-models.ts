/**
 * AI model registry (T-135). Model choice is configuration, not code:
 * defaults and prices live in `ai-models.json`; any task can be re-routed at
 * runtime with `AI_MODEL_<TASK>` ("model" or "provider:model"), no code deploy.
 */

import registry from './ai-models.json'

export type AiProvider = 'gemini' | 'anthropic'

export type AiTask =
  | 'extraction_pass'
  | 'adjudication'
  | 'compile'
  | 'wording'
  | 'chat_widget'
  | 'service_match'
  | 'identification'
  /** T-177: is a WhatsApp message a price request for a service this business offers? */
  | 'whatsapp_intent'
  /** T-197: sort a problem a business reported (title, kind, severity, likely cause, draft fix ticket). Reads and sorts only. */
  | 'support_sort'
  /** T-197: find existing feature requests that mean the same thing, and give a new one a plain title */
  | 'feature_match'
  /** T-198: draft a reply to a problem report that is not a fault, for the owner to edit and send. It sends nothing. */
  | 'support_reply'
  /** T-198: answer a business's question about using the product, from the help guide only. Reads and answers; changes nothing. */
  | 'help_answer'
  /** T-210: a spoken call with a business's assistant (the Live API: speech in, speech out). A private test for now. */
  | 'voice_call'

export const AI_TASKS: AiTask[] = [
  'extraction_pass',
  'adjudication',
  'compile',
  'wording',
  'chat_widget',
  'service_match',
  'identification',
  'whatsapp_intent',
  'support_sort',
  'feature_match',
  'support_reply',
  'help_answer',
  'voice_call',
]

export interface ModelRoute {
  provider: AiProvider
  model: string
}

/** Gemini 3.x thinking depth. Thinking tokens count against maxOutputTokens and dominate latency. */
export type ThinkingLevel = 'low' | 'medium' | 'high'

const THINKING_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high']

export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
  asOf: string
  source: string
}

type EnvLike = Record<string, string | undefined>

export interface ModelCapabilities {
  /** 'schema' = provider-enforced response schema; 'prompt' = schema described in the prompt, validated by code */
  structuredOutput: 'schema' | 'prompt'
  /** Send the system prompt as a real system instruction (vs a primed user/model turn) */
  systemInstruction: boolean
  /** Model accepts sampling parameters such as temperature */
  sampling: boolean
  /** Thinking levels the model accepts; empty = never send one (Gemini 2.5 rejects the field) */
  thinkingLevels: ThinkingLevel[]
}

/** Legacy request shape — what every model got before T-135 */
const LEGACY_CAPABILITIES: ModelCapabilities = {
  structuredOutput: 'schema',
  systemInstruction: false,
  sampling: true,
  thinkingLevels: [],
}

const MODEL_CAPS = (registry as { models?: Record<string, Partial<ModelCapabilities>> }).models ?? {}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as string[]).includes(value)
}

/** Request capabilities for a model (registry data; unlisted models keep the legacy shape). */
export function modelCapabilities(model: string): ModelCapabilities {
  const caps = MODEL_CAPS[model]
  if (!caps) return LEGACY_CAPABILITIES
  return {
    structuredOutput: caps.structuredOutput === 'prompt' ? 'prompt' : 'schema',
    systemInstruction: caps.systemInstruction === true,
    sampling: caps.sampling !== false,
    thinkingLevels: (caps.thinkingLevels ?? []).filter(isThinkingLevel),
  }
}

type TaskEntry = ModelRoute & { thinkingLevel?: string; overflow?: 'none' | ModelRoute | string }

const TASKS = registry.tasks as Record<AiTask, TaskEntry>
const DEFAULTS: Record<AiTask, ModelRoute> = Object.fromEntries(
  AI_TASKS.map((task) => [task, { provider: TASKS[task].provider, model: TASKS[task].model }])
) as Record<AiTask, ModelRoute>
const PRICES = registry.prices as Record<string, ModelPrice>

/** Legacy env names still honoured so existing deployments keep their routing */
const LEGACY_ENV: Partial<Record<AiTask, string>> = {
  adjudication: 'ADJUDICATION_MODEL',
}

function isProvider(value: string): value is AiProvider {
  return value === 'gemini' || value === 'anthropic'
}

/** Parse "model" or "provider:model"; a bare model infers its provider from its name. */
export function parseModelSpec(spec: string, fallbackProvider: AiProvider): ModelRoute | null {
  const trimmed = spec.trim()
  if (!trimmed) return null
  const colon = trimmed.indexOf(':')
  if (colon > 0) {
    const provider = trimmed.slice(0, colon).trim().toLowerCase()
    const model = trimmed.slice(colon + 1).trim()
    if (!isProvider(provider) || !model) return null
    return { provider, model }
  }
  const inferred: AiProvider = trimmed.startsWith('claude-')
    ? 'anthropic'
    : trimmed.startsWith('gemini-')
      ? 'gemini'
      : fallbackProvider
  return { provider: inferred, model: trimmed }
}

/** The provider + model for a task, after env overrides. */
export function resolveModelRoute(task: AiTask, env: EnvLike = {}): ModelRoute {
  const fallback = DEFAULTS[task]
  const override = env[`AI_MODEL_${task.toUpperCase()}`] ?? (LEGACY_ENV[task] ? env[LEGACY_ENV[task]!] : undefined)
  if (override) {
    const parsed = parseModelSpec(override, fallback.provider)
    if (parsed) return parsed
  }
  return fallback
}

/** The registry's word, and the env override's, for "this task has no overflow" */
export const OVERFLOW_OFF = 'none'

/**
 * T-203: the second provider a task's call is sent to when its own model is
 * still busy after the in-place retries, or null when the task has none.
 *
 * Registry: `tasks.<task>.overflow` is "none" or `{ provider, model }`.
 * `AI_OVERFLOW_<TASK>` overrides it per deployment: "none" switches it off,
 * "model" or "provider:model" names another. An overflow that is the task's
 * own route is no overflow (the same busy provider would be asked again).
 */
export function resolveOverflowRoute(task: AiTask, env: EnvLike = {}): ModelRoute | null {
  const primary = resolveModelRoute(task, env)
  const override = env[`AI_OVERFLOW_${task.toUpperCase()}`]?.trim()
  let route: ModelRoute | null = null
  if (override) {
    if (override.toLowerCase() === OVERFLOW_OFF) return null
    // a bare model name with no known prefix is read as the OTHER provider: an overflow on the same one is pointless
    route = parseModelSpec(override, primary.provider === 'gemini' ? 'anthropic' : 'gemini')
  }
  if (!route) {
    const entry = TASKS[task].overflow
    if (!entry || entry === OVERFLOW_OFF) return null
    route = typeof entry === 'string' ? parseModelSpec(entry, primary.provider === 'gemini' ? 'anthropic' : 'gemini') : isProvider(entry.provider) && entry.model ? { provider: entry.provider, model: entry.model } : null
  }
  if (!route) return null
  return route.provider === primary.provider && route.model === primary.model ? null : route
}

/**
 * T-203: the model the overflow proof (scripts/load-test/overflow-proof.mts)
 * runs for a task whose overflow is still "none". Registry data, like every
 * model name; null when the registry names none.
 */
export function overflowCandidate(): ModelRoute | null {
  const entry = (registry as { overflowCandidate?: Partial<ModelRoute> }).overflowCandidate
  return entry && typeof entry.provider === 'string' && isProvider(entry.provider) && typeof entry.model === 'string' && entry.model ? { provider: entry.provider, model: entry.model } : null
}

/**
 * Thinking level to send for a task on a given model, or null to send none.
 * `AI_THINKING_<TASK>` overrides the registry ("default" clears it). A level
 * the model does not accept is dropped, so re-routing a task to a model
 * without thinking levels (e.g. by AI_MODEL_<TASK>) never breaks the request.
 */
export function resolveThinkingLevel(task: AiTask, model: string, env: EnvLike = {}): ThinkingLevel | null {
  const override = env[`AI_THINKING_${task.toUpperCase()}`]?.trim().toLowerCase()
  const level = override || TASKS[task].thinkingLevel
  if (!level || !isThinkingLevel(level)) return null
  return modelCapabilities(model).thinkingLevels.includes(level) ? level : null
}

/** Pinned model for test tooling (the simulated customer must not drift between comparisons). */
export function harnessModel(name: keyof typeof registry.harness): ModelRoute {
  return registry.harness[name] as ModelRoute
}

export function getModelPrice(model: string): ModelPrice | null {
  return PRICES[model] ?? null
}

/** T-210: a Live API model's prices, USD per 1M tokens, one per modality and direction */
export interface LiveModelPrice {
  textInPerMTok: number
  audioInPerMTok: number
  textOutPerMTok: number
  audioOutPerMTok: number
  asOf: string
  source: string
}

const LIVE = (registry as unknown as { live: { prices: Record<string, LiveModelPrice>; defaultVoice: string; voices: string[] } }).live

/** The Live API prices for a model; null when the registry has none (the cost is then not worked out) */
export function getLivePrice(model: string): LiveModelPrice | null {
  return LIVE.prices[model] ?? null
}

/** The Live API's prebuilt voices, and the one a call uses when none is picked */
export const LIVE_VOICES: readonly string[] = LIVE.voices
export const DEFAULT_LIVE_VOICE: string = LIVE.defaultVoice

/** Estimated USD for a call; null when the model has no configured price. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = getModelPrice(model)
  if (!price) return null
  const cost = (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}

/** Per-quote AI usage, accumulated across every call (stored in the pricing trace). */
export interface AiUsageEntry {
  task: AiTask
  provider: AiProvider
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  /** null when the model has no configured price */
  estimatedCostUsd: number | null
  /** Summed wall time of this entry's calls (calls may overlap when run in parallel) */
  totalMs?: number
}

export interface AiUsageSummary {
  calls: number
  inputTokens: number
  outputTokens: number
  /** Sum over priced entries; unpriced models listed in `unpricedModels` */
  estimatedCostUsd: number
  unpricedModels: string[]
  byTask: AiUsageEntry[]
}

/** Accumulates token usage per task+model. Pure; safe to share across clients. */
export class AiUsageMeter {
  private entries = new Map<string, AiUsageEntry>()

  record(task: AiTask, route: ModelRoute, inputTokens: number, outputTokens: number, durationMs?: number): void {
    const key = `${task}|${route.provider}|${route.model}`
    const existing = this.entries.get(key) ?? {
      task,
      provider: route.provider,
      model: route.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    }
    existing.calls += 1
    existing.inputTokens += Math.max(0, inputTokens || 0)
    existing.outputTokens += Math.max(0, outputTokens || 0)
    existing.estimatedCostUsd = estimateCostUsd(route.model, existing.inputTokens, existing.outputTokens)
    if (durationMs !== undefined && durationMs >= 0) {
      existing.totalMs = (existing.totalMs ?? 0) + Math.round(durationMs)
    }
    this.entries.set(key, existing)
  }

  summary(): AiUsageSummary {
    const byTask = [...this.entries.values()]
    return {
      calls: byTask.reduce((s, e) => s + e.calls, 0),
      inputTokens: byTask.reduce((s, e) => s + e.inputTokens, 0),
      outputTokens: byTask.reduce((s, e) => s + e.outputTokens, 0),
      estimatedCostUsd:
        Math.round(byTask.reduce((s, e) => s + (e.estimatedCostUsd ?? 0), 0) * 1_000_000) / 1_000_000,
      unpricedModels: [...new Set(byTask.filter((e) => e.estimatedCostUsd === null).map((e) => e.model))],
      byTask,
    }
  }
}
