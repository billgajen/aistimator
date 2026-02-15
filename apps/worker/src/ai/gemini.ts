/**
 * Gemini 2.5 Flash Client
 *
 * Handles communication with the Gemini API for:
 * - Vision extraction (signals from images)
 * - Text generation (scope summary, notes)
 * - Structured output with JSON schema enforcement
 */

export interface GeminiConfig {
  apiKey: string
  model?: string
  maxTokens?: number
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
    totalTokenCount: number
  }
}

const DEFAULT_MODEL = 'gemini-2.5-flash'
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export class GeminiClient {
  private apiKey: string
  private model: string
  private maxTokens: number

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey
    this.model = config.model || DEFAULT_MODEL
    this.maxTokens = config.maxTokens || 4096
  }

  /**
   * Generate content with text prompt
   */
  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: GeminiMessage[] = []

    if (systemPrompt) {
      messages.push({
        role: 'user',
        parts: [{ text: systemPrompt }],
      })
      messages.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow these instructions.' }],
      })
    }

    messages.push({
      role: 'user',
      parts: [{ text: prompt }],
    })

    return this.generate(messages)
  }

  /**
   * Generate content with images (vision)
   */
  async generateWithImages(
    prompt: string,
    images: Array<{ mimeType: string; base64: string }>,
    systemPrompt?: string
  ): Promise<string> {
    const messages: GeminiMessage[] = []

    if (systemPrompt) {
      messages.push({
        role: 'user',
        parts: [{ text: systemPrompt }],
      })
      messages.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow these instructions.' }],
      })
    }

    // Build parts with images and prompt
    const parts: GeminiMessage['parts'] = images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64,
      },
    }))
    parts.push({ text: prompt })

    messages.push({
      role: 'user',
      parts,
    })

    return this.generate(messages)
  }

  /**
   * Generate structured output with JSON schema enforcement.
   * Uses Gemini's response_mime_type + response_schema to guarantee valid JSON.
   * Returns parsed T directly — no markdown stripping needed.
   */
  async generateWithSchema<T>(
    prompt: string,
    schema: Record<string, unknown>,
    systemPrompt?: string
  ): Promise<T> {
    const messages: GeminiMessage[] = []

    if (systemPrompt) {
      messages.push({
        role: 'user',
        parts: [{ text: systemPrompt }],
      })
      messages.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow these instructions.' }],
      })
    }

    messages.push({
      role: 'user',
      parts: [{ text: prompt }],
    })

    const text = await this.generate(messages, {
      responseMimeType: 'application/json',
      responseSchema: schema,
    })

    return JSON.parse(text) as T
  }

  /**
   * Generate structured output with images and JSON schema enforcement.
   * Combines vision analysis with guaranteed JSON structure.
   */
  async generateWithImagesAndSchema<T>(
    prompt: string,
    images: Array<{ mimeType: string; base64: string }>,
    schema: Record<string, unknown>,
    systemPrompt?: string
  ): Promise<T> {
    const messages: GeminiMessage[] = []

    if (systemPrompt) {
      messages.push({
        role: 'user',
        parts: [{ text: systemPrompt }],
      })
      messages.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow these instructions.' }],
      })
    }

    const parts: GeminiMessage['parts'] = images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64,
      },
    }))
    parts.push({ text: prompt })

    messages.push({
      role: 'user',
      parts,
    })

    const text = await this.generate(messages, {
      responseMimeType: 'application/json',
      responseSchema: schema,
    })

    return JSON.parse(text) as T
  }

  /**
   * Internal generate method
   */
  private async generate(
    messages: GeminiMessage[],
    structuredOutput?: {
      responseMimeType: string
      responseSchema: Record<string, unknown>
    }
  ): Promise<string> {
    const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: this.maxTokens,
      temperature: 0.3,
    }

    if (structuredOutput) {
      generationConfig.response_mime_type = structuredOutput.responseMimeType
      generationConfig.response_schema = structuredOutput.responseSchema
    }

    const body = {
      contents: messages,
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

    const text = candidate.content.parts.map((p) => p.text).join('')
    return text
  }

  /**
   * Parse JSON from Gemini response, handling markdown code blocks
   */
  static parseJSON<T>(text: string): T {
    // Remove markdown code blocks if present
    let cleaned = text.trim()
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7)
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3)
    }
    cleaned = cleaned.trim()

    // Fix trailing commas before } or ] (common Gemini 2.5 issue)
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1')

    return JSON.parse(cleaned) as T
  }
}

/**
 * Create a Gemini client from environment
 */
export function createGeminiClient(apiKey: string | undefined): GeminiClient | null {
  if (!apiKey) {
    console.warn('[Gemini] API key not configured')
    return null
  }

  return new GeminiClient({ apiKey })
}
