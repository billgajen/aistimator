/**
 * Claude adapter behind the AiClient interface (T-135).
 *
 * Selectable by config for any task (e.g. AI_MODEL_ADJUDICATION=anthropic:<model-id>,
 * AI_MODEL_IDENTIFICATION=anthropic:<model-id>). Uses the official SDK with JSON-schema
 * structured outputs; Gemini-style schemas (uppercase types, `nullable`) are translated
 * by `toClaudeJsonSchema`. Refusals use the server-side "default" fallback chain.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ModelRoute, ThinkingLevel } from '@qolumns/shared'
import type { AiClient, GenerationOptions, ImageInput, UsageSink } from './client'
import { parseModelJson } from './client'
import { AiProviderError, isBusyAnswer, parseRetryAfter } from './busy'

type ClaudeImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const CLAUDE_IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Keywords Claude structured outputs reject; dropped from translated schemas */
const UNSUPPORTED_KEYS = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
  'propertyOrdering', 'nullable', 'example', 'default',
])

/**
 * Translate a Gemini/OpenAPI-subset schema into the JSON Schema Claude
 * structured outputs accept: lowercase types, `nullable` → anyOf with null,
 * `additionalProperties: false` on every object, unsupported keywords removed.
 * Pure — unit-tested.
 */
export function toClaudeJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {}
  const src = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(src)) {
    if (UNSUPPORTED_KEYS.has(key)) continue
    if (key === 'type' && typeof value === 'string') {
      out.type = value.toLowerCase()
    } else if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        props[pk] = toClaudeJsonSchema(pv)
      }
      out.properties = props
    } else if (key === 'items') {
      out.items = toClaudeJsonSchema(value)
    } else if ((key === 'anyOf' || key === 'allOf') && Array.isArray(value)) {
      out[key] = value.map((v) => toClaudeJsonSchema(v))
    } else {
      out[key] = value
    }
  }

  if (out.type === 'object') {
    out.additionalProperties = false
    if (!out.properties) out.properties = {}
    if (Array.isArray(out.required)) {
      const known = Object.keys(out.properties as Record<string, unknown>)
      out.required = (out.required as unknown[]).filter((r) => typeof r === 'string' && known.includes(r))
    }
  }

  if (src.nullable === true && typeof out.type === 'string') {
    const { type, ...rest } = out
    return { anyOf: [{ type, ...rest }, { type: 'null' }] }
  }
  return out
}

export interface AnthropicClientConfig {
  apiKey: string
  model: string
  maxTokens?: number
  usage?: UsageSink
  /**
   * T-203: how many times the SDK itself tries again (its default is 2). The
   * overflow client sets 0: the busy retry (ai/busy.ts) owns the waiting, and
   * a busy overflow model means "busy on both".
   */
  maxRetries?: number
  /** T-203: the longest one request may take, ms (the SDK's default is 10 minutes) */
  timeoutMs?: number
  /** T-203, local checks only: a stand-in for the provider (factory.ts honours it only in development) */
  baseUrl?: string
  /**
   * T-204: how much the model thinks before it answers (`output_config.effort`).
   * It is the task's `thinkingLevel` from the registry, sent only to a model whose
   * registry entry lists it; with none, the provider's own default applies.
   */
  effort?: ThinkingLevel | null
}

/** A header from the SDK's error, whichever shape this SDK version gives it */
function headerOf(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const get = (headers as { get?: unknown }).get
  if (typeof get === 'function') return (get.call(headers, name) as string | null) ?? undefined
  const value = (headers as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

export class AnthropicClient implements AiClient {
  private client: Anthropic
  private model: string
  private maxTokens: number
  private usage?: UsageSink
  private effort: ThinkingLevel | null
  readonly route: ModelRoute

  constructor(config: AnthropicClientConfig) {
    this.effort = config.effort ?? null
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.maxRetries !== undefined && { maxRetries: config.maxRetries }),
      ...(config.timeoutMs !== undefined && { timeout: config.timeoutMs }),
      ...(config.baseUrl && { baseURL: config.baseUrl }),
    })
    this.model = config.model
    this.maxTokens = config.maxTokens ?? 16000
    this.usage = config.usage
    this.route = { provider: 'anthropic', model: config.model }
  }

  generateText(prompt: string, systemPrompt?: string): Promise<string> {
    return this.run(prompt, [], systemPrompt)
  }

  generateWithImages(prompt: string, images: ImageInput[], systemPrompt?: string): Promise<string> {
    return this.run(prompt, images, systemPrompt)
  }

  async generateWithSchema<T>(prompt: string, schema: Record<string, unknown>, systemPrompt?: string): Promise<T> {
    return parseModelJson<T>(await this.run(prompt, [], systemPrompt, undefined, schema))
  }

  async generateWithImagesAndSchema<T>(
    prompt: string,
    images: ImageInput[],
    schema: Record<string, unknown>,
    systemPrompt?: string,
    options?: GenerationOptions
  ): Promise<T> {
    return parseModelJson<T>(await this.run(prompt, images, systemPrompt, options, schema))
  }

  private async run(
    prompt: string,
    images: ImageInput[],
    systemPrompt?: string,
    options?: GenerationOptions,
    schema?: Record<string, unknown>
  ): Promise<string> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = []
    for (const img of images) {
      if (!CLAUDE_IMAGE_TYPES.has(img.mimeType)) continue // unsupported type — skip, never fail the call
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType as ClaudeImageType, data: img.base64 },
      })
    }
    content.push({ type: 'text', text: prompt })

    // Current Claude models think adaptively and reject sampling params, so
    // `temperature` is intentionally not forwarded.
    const startedAt = Date.now()
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: Math.max(this.maxTokens, options?.maxOutputTokens ?? 0),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...(schema || this.effort
        ? {
            output_config: {
              ...(this.effort && { effort: this.effort }),
              ...(schema && { format: { type: 'json_schema' as const, schema: toClaudeJsonSchema(schema) } }),
            },
          }
        : {}),
    }, options?.signal ? { signal: options.signal } : undefined).catch((error: unknown) => {
      // T-203: a busy answer (rate limited or overloaded) is told apart for the busy retry
      // (ai/busy.ts). Every other error is thrown exactly as the SDK gave it.
      if (error instanceof Anthropic.APIError && isBusyAnswer(error.status, error.message)) {
        throw new AiProviderError(`Claude API error: ${error.status ?? ''} ${error.message}`.trim(), error.status, true, parseRetryAfter(headerOf(error.headers, 'retry-after')))
      }
      throw error
    })

    this.usage?.(response.usage.input_tokens ?? 0, response.usage.output_tokens ?? 0, Date.now() - startedAt)

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined the request (${response.stop_details?.category ?? 'no category'})`)
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Claude response truncated at max_tokens')
    }
    return response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
  }
}
