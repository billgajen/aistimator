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

export const AI_TASKS: AiTask[] = [
  'extraction_pass',
  'adjudication',
  'compile',
  'wording',
  'chat_widget',
  'service_match',
  'identification',
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

type TaskEntry = ModelRoute & { thinkingLevel?: string }

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

  record(task: AiTask, route: ModelRoute, inputTokens: number, outputTokens: number): void {
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
