/**
 * Claude adapter behind the AiClient interface (T-135).
 *
 * Selectable by config for any task (e.g. AI_MODEL_ADJUDICATION=anthropic:<model-id>,
 * AI_MODEL_IDENTIFICATION=anthropic:<model-id>). Uses the official SDK with JSON-schema
 * structured outputs; Gemini-style schemas (uppercase types, `nullable`) are translated
 * by `toClaudeJsonSchema`. Refusals use the server-side "default" fallback chain.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ModelRoute } from '@estimator/shared'
import type { AiClient, GenerationOptions, ImageInput, UsageSink } from './client'
import { parseModelJson } from './client'

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
}

export class AnthropicClient implements AiClient {
  private client: Anthropic
  private model: string
  private maxTokens: number
  private usage?: UsageSink
  readonly route: ModelRoute

  constructor(config: AnthropicClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey })
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
      ...(schema
        ? { output_config: { format: { type: 'json_schema', schema: toClaudeJsonSchema(schema) } } }
        : {}),
    }, options?.signal ? { signal: options.signal } : undefined)

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
