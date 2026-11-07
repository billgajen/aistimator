import { describe, it, expect } from 'vitest'
import {
  resolveModelRoute,
  parseModelSpec,
  estimateCostUsd,
  AiUsageMeter,
  AI_TASKS,
  harnessModel,
} from '@estimator/shared'
import { toClaudeJsonSchema } from '../ai/anthropic'
import { createAiClient } from '../ai/factory'
import { parseModelJson } from '../ai/client'

describe('model registry (T-135)', () => {
  it('has a default route for every task', () => {
    for (const task of AI_TASKS) {
      const route = resolveModelRoute(task)
      expect(route.model.length).toBeGreaterThan(0)
      expect(['gemini', 'anthropic']).toContain(route.provider)
    }
    expect(harnessModel('customer_sim').model.length).toBeGreaterThan(0)
  })

  it('switches a task by env without code changes', () => {
    expect(resolveModelRoute('wording', { AI_MODEL_WORDING: 'gemini-test-model' })).toEqual({
      provider: 'gemini',
      model: 'gemini-test-model',
    })
    expect(resolveModelRoute('adjudication', { AI_MODEL_ADJUDICATION: 'anthropic:some-claude' })).toEqual({
      provider: 'anthropic',
      model: 'some-claude',
    })
    // other tasks unaffected
    expect(resolveModelRoute('compile', { AI_MODEL_WORDING: 'x' })).toEqual(resolveModelRoute('compile'))
  })

  it('honours the legacy ADJUDICATION_MODEL env', () => {
    expect(resolveModelRoute('adjudication', { ADJUDICATION_MODEL: 'gemini-legacy' }).model).toBe('gemini-legacy')
    expect(
      resolveModelRoute('adjudication', { ADJUDICATION_MODEL: 'gemini-legacy', AI_MODEL_ADJUDICATION: 'gemini-new' }).model
    ).toBe('gemini-new')
  })

  it('parses model specs and infers providers', () => {
    expect(parseModelSpec('claude-x', 'gemini')?.provider).toBe('anthropic')
    expect(parseModelSpec('gemini-x', 'anthropic')?.provider).toBe('gemini')
    expect(parseModelSpec('custom-model', 'gemini')?.provider).toBe('gemini')
    expect(parseModelSpec('openai:gpt', 'gemini')).toBeNull()
    expect(parseModelSpec('  ', 'gemini')).toBeNull()
    // invalid override falls back to the default
    expect(resolveModelRoute('wording', { AI_MODEL_WORDING: 'bogus:model' })).toEqual(resolveModelRoute('wording'))
  })

  it('estimates cost from configured prices only', () => {
    const route = resolveModelRoute('wording')
    const cost = estimateCostUsd(route.model, 1_000_000, 0)
    expect(cost === null || cost > 0).toBe(true)
    expect(estimateCostUsd('unpriced-model', 1000, 1000)).toBeNull()
  })

  it('meters usage per task and flags unpriced models', () => {
    const meter = new AiUsageMeter()
    meter.record('wording', { provider: 'gemini', model: 'unpriced-model' }, 100, 50)
    meter.record('wording', { provider: 'gemini', model: 'unpriced-model' }, 10, 5)
    const summary = meter.summary()
    expect(summary.calls).toBe(2)
    expect(summary.inputTokens).toBe(110)
    expect(summary.outputTokens).toBe(55)
    expect(summary.unpricedModels).toEqual(['unpriced-model'])
    expect(summary.estimatedCostUsd).toBe(0)
  })
})

describe('client factory (T-135)', () => {
  it('returns null when the routed provider has no key', () => {
    expect(createAiClient('wording', {})).toBeNull()
    expect(createAiClient('adjudication', { GEMINI_API_KEY: 'k', AI_MODEL_ADJUDICATION: 'anthropic:m' } as object)).toBeNull()
  })

  it('builds a client on the routed provider', () => {
    const gem = createAiClient('wording', { GEMINI_API_KEY: 'k', AI_MODEL_WORDING: 'gemini-x' } as object)
    expect(gem?.route).toEqual({ provider: 'gemini', model: 'gemini-x' })
    const claude = createAiClient('identification', { ANTHROPIC_API_KEY: 'k', AI_MODEL_IDENTIFICATION: 'anthropic:m' } as object)
    expect(claude?.route).toEqual({ provider: 'anthropic', model: 'm' })
  })
})

describe('Claude schema translation (T-135)', () => {
  it('lowercases types, closes objects and maps nullable', () => {
    const out = toClaudeJsonSchema({
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        zip: { type: 'STRING', nullable: true },
        tags: { type: 'ARRAY', items: { type: 'OBJECT', properties: { v: { type: 'NUMBER', minimum: 0 } } } },
      },
      required: ['name', 'missing'],
    })
    expect(out).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        zip: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        tags: {
          type: 'array',
          items: { type: 'object', properties: { v: { type: 'number' } }, additionalProperties: false },
        },
      },
      required: ['name'],
      additionalProperties: false,
    })
  })

  it('parses fenced JSON with trailing commas', () => {
    expect(parseModelJson<{ a: number }>('```json\n{"a": 1,}\n```')).toEqual({ a: 1 })
  })
})

import { vi } from 'vitest'
import { modelCapabilities } from '@estimator/shared'
import { GeminiClient, coerceToSchemaRoot, schemaInstruction } from '../ai/gemini'

describe('per-model request capabilities (T-135)', () => {
  it('keeps the legacy request shape for unlisted models', () => {
    expect(modelCapabilities('some-unlisted-model')).toEqual({ structuredOutput: 'schema', systemInstruction: false, sampling: true })
  })
  it('switches Gemini 3.x to prompt-described JSON, real system instruction, no sampling', () => {
    expect(modelCapabilities('gemini-3.8-flash')).toEqual({ structuredOutput: 'prompt', systemInstruction: true, sampling: false })
  })
})

describe('prompt-mode structured output (T-135)', () => {
  const schema = { type: 'object', properties: { measurements: { type: 'array' } }, required: ['measurements'] }

  it('accepts a direct object, unwraps an echoed schema wrapper, rejects missing keys', () => {
    expect(coerceToSchemaRoot({ measurements: [] }, schema)).toEqual({ measurements: [] })
    expect(coerceToSchemaRoot({ type: 'object', properties: { measurements: [1] } }, schema)).toEqual({ measurements: [1] })
    expect(() => coerceToSchemaRoot({ nope: true }, schema)).toThrow(/missing required keys/)
    expect(schemaInstruction(schema)).toContain('"required":["measurements"]')
  })

  function captureBody(model: string, reply: string) {
    const bodies: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)))
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: reply }], role: 'model' } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 18 } }))
    })
    const usage: number[][] = []
    const client = new GeminiClient({ apiKey: 'k', model, usage: (i, o) => usage.push([i, o]) })
    return { client, bodies, usage }
  }

  it('legacy model: response_schema, primed system turn, temperature', async () => {
    const { client, bodies, usage } = captureBody('gemini-2.5-flash', '{"measurements":[]}')
    await client.generateWithImagesAndSchema('p', [], schema, 'sys', { temperature: 0.7 })
    const body = bodies[0] as { contents: Array<{ role: string }>; generationConfig: Record<string, unknown>; systemInstruction?: unknown }
    expect(body.generationConfig.response_schema).toEqual(schema)
    expect(body.generationConfig.temperature).toBe(0.7)
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(body.systemInstruction).toBeUndefined()
    expect(usage[0]).toEqual([10, 8]) // thinking tokens billed as output
    vi.restoreAllMocks()
  })

  it('Gemini 3.x: no response_schema, schema in prompt, systemInstruction, no temperature', async () => {
    const { client, bodies } = captureBody('gemini-3.8-flash', '```json\n{"type":"object","properties":{"measurements":[{"v":1}]}}\n```')
    const out = await client.generateWithImagesAndSchema<{ measurements: unknown[] }>('p', [], schema, 'sys', { temperature: 0.7 })
    expect(out).toEqual({ measurements: [{ v: 1 }] })
    const body = bodies[0] as { contents: Array<{ role: string; parts: Array<{ text?: string }> }>; generationConfig: Record<string, unknown>; systemInstruction?: unknown }
    expect(body.generationConfig.response_schema).toBeUndefined()
    expect(body.generationConfig.response_mime_type).toBe('application/json')
    expect(body.generationConfig.temperature).toBeUndefined()
    expect(body.contents.map((c) => c.role)).toEqual(['user'])
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] })
    expect(body.contents[0]!.parts.at(-1)!.text).toContain('JSON Schema')
    vi.restoreAllMocks()
  })
})
