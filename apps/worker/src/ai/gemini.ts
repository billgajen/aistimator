/**
 * Gemini client (implements the provider-agnostic AiClient, T-135).
 * The model always comes from the registry (`@estimator/shared` ai-models).
 *
 * Handles communication with the Gemini API for:
 * - Vision extraction (signals from images)
 * - Text generation (scope summary, notes)
 * - Structured output with JSON schema enforcement
 */

import type { AiClient, UsageSink } from './client'
import { parseModelJson } from './client'
import type { ModelRoute, ThinkingLevel } from '@estimator/shared'
import { resolveModelRoute, modelCapabilities, type ModelCapabilities } from '@estimator/shared'

export interface GeminiConfig {
  apiKey: string
  /** Registry-resolved model; defaults to the registry's wording route */
  model?: string
  maxTokens?: number
  /** Registry thinking level for the task; null/absent = model default */
  thinkingLevel?: ThinkingLevel | null
  /** T-135: per-quote token accounting */
  usage?: UsageSink
}

export interface GeminiMessage {
  role: 'user' | 'model'
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>
      role: string
    }
    finishReason: string
    safetyRatings?: Array<{ category: string; probability: string }>
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    /** Thinking tokens — billed as output */
    thoughtsTokenCount?: number
    totalTokenCount: number
  }
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export class GeminiClient implements AiClient {
  private apiKey: string
  private model: string
  private maxTokens: number
  private thinkingLevel: ThinkingLevel | null
  private usage?: UsageSink
  private caps: ModelCapabilities
  readonly route: ModelRoute

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey
    this.model = config.model || resolveModelRoute('wording').model
    this.maxTokens = config.maxTokens || 4096
    this.thinkingLevel = config.thinkingLevel ?? null
    this.usage = config.usage
    this.caps = modelCapabilities(this.model)
    this.route = { provider: 'gemini', model: this.model }
  }

  /** Generate content with text prompt */
  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    return this.generate(this.buildRequest(prompt, [], systemPrompt))
  }

  /** Generate content with images (vision) */
  async generateWithImages(
    prompt: string,
    images: Array<{ mimeType: string; base64: string }>,
    systemPrompt?: string
  ): Promise<string> {
    return this.generate(this.buildRequest(prompt, images, systemPrompt))
  }

  /**
   * Generate structured output. Models with `structuredOutput: 'schema'`
   * get the provider-enforced response schema; `'prompt'` models (Gemini 3.x,
   * whose schema-constrained numbers degenerate) get the schema in the prompt
   * and code validates the result (T-135).
   */
  async generateWithSchema<T>(
    prompt: string,
    schema: Record<string, unknown>,
    systemPrompt?: string
  ): Promise<T> {
    return this.structured<T>(prompt, [], schema, systemPrompt)
  }

  /** Structured output with images (vision + JSON) */
  async generateWithImagesAndSchema<T>(
    prompt: string,
    images: Array<{ mimeType: string; base64: string }>,
    schema: Record<string, unknown>,
    systemPrompt?: string,
    options?: { temperature?: number; maxOutputTokens?: number }
  ): Promise<T> {
    return this.structured<T>(prompt, images, schema, systemPrompt, options)
  }

  private async structured<T>(
    prompt: string,
    images: Array<{ mimeType: string; base64: string }>,
    schema: Record<string, unknown>,
    systemPrompt?: string,
    options?: { temperature?: number; maxOutputTokens?: number }
  ): Promise<T> {
    if (this.caps.structuredOutput === 'prompt') {
      const text = await this.generate(
        this.buildRequest(`${prompt}\n\n${schemaInstruction(schema)}`, images, systemPrompt),
        { responseMimeType: 'application/json' },
        options
      )
      return coerceToSchemaRoot<T>(parseModelJson<unknown>(text), schema)
    }
    const text = await this.generate(
      this.buildRequest(prompt, images, systemPrompt),
      { responseMimeType: 'application/json', responseSchema: schema },
      options
    )
    return JSON.parse(text) as T
  }

  /**
   * Request contents. Legacy models get the system prompt as a primed
   * user/model turn (pre-T-135 behaviour, unchanged); models that reject
   * prefilled turns get a real system instruction.
   */
  private buildRequest(
    prompt: string,
    images: Array<{ mimeType: string; base64: string }>,
    systemPrompt?: string
  ): { contents: GeminiMessage[]; systemInstruction?: { parts: Array<{ text: string }> } } {
    const parts: GeminiMessage['parts'] = images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    }))
    parts.push({ text: prompt })
    const userTurn: GeminiMessage = { role: 'user', parts }

    if (!systemPrompt) return { contents: [userTurn] }
    if (this.caps.systemInstruction) {
      return { contents: [userTurn], systemInstruction: { parts: [{ text: systemPrompt }] } }
    }
    return {
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
        userTurn,
      ],
    }
  }

  /**
   * Internal generate method
   */
  private async generate(
    request: { contents: GeminiMessage[]; systemInstruction?: { parts: Array<{ text: string }> } },
    structuredOutput?: {
      responseMimeType: string
      responseSchema?: Record<string, unknown>
    },
    options?: { temperature?: number; maxOutputTokens?: number }
  ): Promise<string> {
    const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: options?.maxOutputTokens ?? this.maxTokens,
    }
    // Sampling params only for models that still accept them
    if (this.caps.sampling) generationConfig.temperature = options?.temperature ?? 0.3
    // Only levels the model's capabilities list reach here (resolveThinkingLevel)
    if (this.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: this.thinkingLevel }

    if (structuredOutput) {
      generationConfig.response_mime_type = structuredOutput.responseMimeType
      if (structuredOutput.responseSchema) generationConfig.response_schema = structuredOutput.responseSchema
    }

    const body = {
      contents: request.contents,
      ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
      generationConfig,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error: ${response.status} ${errorText}`)
    }

    const data: GeminiResponse = await response.json()

    if (data.usageMetadata) {
      this.usage?.(
        data.usageMetadata.promptTokenCount ?? 0,
        (data.usageMetadata.candidatesTokenCount ?? 0) + (data.usageMetadata.thoughtsTokenCount ?? 0)
      )
    }

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('Gemini returned no candidates')
    }

    const candidate = data.candidates[0]
    if (!candidate) {
      throw new Error('Gemini returned empty candidate')
    }
    if (candidate.finishReason === 'SAFETY') {
      throw new Error('Gemini blocked response due to safety filters')
    }
    if (candidate.finishReason === 'MAX_TOKENS' && structuredOutput) {
      // A truncated JSON body can never parse — fail clearly instead of a SyntaxError
      throw new Error(`Gemini ${this.model} hit MAX_TOKENS before finishing the JSON response`)
    }

    return candidate.content.parts.map((p) => p.text).join('')
  }

  /**
   * Parse JSON from Gemini response, handling markdown code blocks
   */
  static parseJSON<T>(text: string): T {
    return parseModelJson<T>(text)
  }
}

/** Prompt-mode instruction: the schema the response must satisfy (T-135). */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return `Respond with a single JSON object only — no prose, no markdown. It must match this JSON Schema (use plain decimal numbers with at most 2 decimal places):\n${JSON.stringify(schema)}`
}

/**
 * Prompt-mode result check (pure, tested): models sometimes echo the schema
 * wrapper ({"type":"object","properties":{...data...}}) — unwrap it; then
 * require the schema's root `required` keys so a malformed answer fails
 * loudly instead of flowing into pricing as empty data.
 */
export function coerceToSchemaRoot<T>(value: unknown, schema: Record<string, unknown>): T {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  const hasAll = (v: unknown) =>
    Boolean(v) && typeof v === 'object' && !Array.isArray(v) && required.every((k) => k in (v as Record<string, unknown>))
  if (hasAll(value)) return value as T
  const inner = (value as { properties?: unknown } | null)?.properties
  if (hasAll(inner)) return inner as T
  if (required.length === 0 && value && typeof value === 'object') return value as T
  throw new Error(`Structured response missing required keys: ${required.join(', ')}`)
}

/**
 * Create a Gemini client from environment
 */
export function createGeminiClient(
  apiKey: string | undefined,
  options?: { model?: string; maxTokens?: number; usage?: UsageSink }
): GeminiClient | null {
  if (!apiKey) {
    console.warn('[Gemini] API key not configured')
    return null
  }

  return new GeminiClient({ apiKey, model: options?.model, maxTokens: options?.maxTokens, usage: options?.usage })
}
