/**
 * T-203: a busy AI provider is waited for, then overflowed, then the job is
 * put back; none of it is a failure, and none of it uses up a real try.
 *
 *   1. the one call is retried in place (2 s, 5 s, 10 s with jitter, Retry-After)
 *   2. still busy: the call goes to the task's overflow model
 *   3. busy on both: the job is put back, within two bounds, and keeps its 3 real tries
 *   4. the counts are in the stored timings, and the 5-minute check reports them
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AI_BUSY_ALERT_OVERFLOW,
  AI_BUSY_ALERT_RETRIES,
  AI_TASKS,
  AiUsageMeter,
  busyAlertDue,
  countBusy,
  getModelPrice,
  opsAlertEmail,
  overflowCandidate,
  resolveModelRoute,
  resolveOverflowRoute,
  type AiTask,
} from '@qolumns/shared'
import type { AiClient } from '../ai/client'
import {
  AiBusyError,
  AiBusyLog,
  AiProviderError,
  BUSY_WAITS_MS,
  BusyRetryClient,
  RETRY_AFTER_MAX_MS,
  busyWaitMs,
  isAiBusyError,
  isBusyAnswer,
  parseRetryAfter,
  retryDelayFromBody,
} from '../ai/busy'
import { createAiClient, busyWaitsFor } from '../ai/factory'
import { GeminiClient } from '../ai/gemini'
import { AnthropicClient } from '../ai/anthropic'
import { AiCallTimeoutError, withAiTimeout } from '../ai/timeouts'
import {
  BUSY_MAX_MINUTES,
  MAX_BUSY_REQUEUES,
  MAX_DELIVERY_RETRIES,
  MAX_RETRIES,
  NO_BUSY_STATE,
  busyRequeueSeconds,
  handleQuoteJob,
  type BusyState,
  type JobMessage,
} from '../queue-consumer'
import { busyStateOf, readBusyState, saveBusyState } from '../busy-state'
import { StageTimer } from '../stage-timer'
import { checkBusy } from '../ops-alert'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const quiet = () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

const busy = (status = 429, retryAfterMs?: number) => new AiProviderError(`Gemini API error: ${status} busy`, status, true, retryAfterMs)

/** A client whose every call runs the next step of a script: an error is thrown, anything else is the answer */
function scripted(provider: 'gemini' | 'anthropic', steps: unknown[]) {
  let calls = 0
  const next = async () => {
    const step = steps[Math.min(calls, steps.length - 1)]
    calls += 1
    if (step instanceof Error) throw step
    return step
  }
  const client: AiClient = {
    route: { provider, model: `${provider}-fixture-model` },
    generateText: next as AiClient['generateText'],
    generateWithImages: next as AiClient['generateWithImages'],
    generateWithSchema: next as AiClient['generateWithSchema'],
    generateWithImagesAndSchema: next as AiClient['generateWithImagesAndSchema'],
  }
  return { client, calls: () => calls }
}

function wrapped(primarySteps: unknown[], overflowSteps?: unknown[], log = new AiBusyLog(), random = () => 0.5) {
  const waits: number[] = []
  const primary = scripted('gemini', primarySteps)
  const overflow = overflowSteps ? scripted('anthropic', overflowSteps) : null
  const made = vi.fn(() => overflow?.client ?? null)
  const client = new BusyRetryClient(primary.client, {
    task: 'wording',
    log,
    overflow: made,
    random,
    sleep: async (ms) => {
      waits.push(ms)
    },
  })
  return { client, waits, primary, overflow, made, log }
}

// ---------------------------------------------------------------------------------------------
describe('T-203 item 1: what counts as busy, and how long to wait', () => {
  it('busy is 429, 503 (529 from Anthropic), RESOURCE_EXHAUSTED or an overloaded answer; nothing else', () => {
    expect(isBusyAnswer(429, '')).toBe(true)
    expect(isBusyAnswer(503, '')).toBe(true)
    expect(isBusyAnswer(529, '')).toBe(true)
    expect(isBusyAnswer(500, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')).toBe(true)
    expect(isBusyAnswer(500, 'The model is overloaded. Please try again later.')).toBe(true)
    for (const status of [400, 401, 403, 404, 413, 500, undefined]) expect(isBusyAnswer(status, 'INVALID_ARGUMENT'), String(status)).toBe(false)
  })

  it('a Retry-After header is read as seconds or as a date; Google’s retryDelay in the body is read too', () => {
    expect(parseRetryAfter('7')).toBe(7000)
    expect(parseRetryAfter('1.5')).toBe(1500)
    expect(parseRetryAfter('Wed, 25 Nov 2026 12:00:09 GMT', Date.parse('2026-11-25T12:00:00Z'))).toBe(9000)
    expect(parseRetryAfter('Wed, 25 Nov 2026 11:00:00 GMT', Date.parse('2026-11-25T12:00:00Z'))).toBe(0)
    for (const none of [undefined, null, '', 'soon']) expect(parseRetryAfter(none)).toBeUndefined()
    expect(retryDelayFromBody('{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay": "17s"}]}}')).toBe(17000)
    expect(retryDelayFromBody('{"error":{}}')).toBeUndefined()
  })

  it('the waits are about 2 s, 5 s and 10 s, each 25% either way, and there is no fourth', () => {
    expect([...BUSY_WAITS_MS]).toEqual([2000, 5000, 10000])
    expect([0, 1, 2].map((n) => busyWaitMs(n, undefined, () => 0))).toEqual([1500, 3750, 7500])
    expect([0, 1, 2].map((n) => busyWaitMs(n, undefined, () => 0.5))).toEqual([2000, 5000, 10000])
    expect([0, 1, 2].map((n) => busyWaitMs(n, undefined, () => 1))).toEqual([2500, 6250, 12500])
    expect(busyWaitMs(3, undefined, () => 0.5)).toBeNull()
  })

  it('250 jobs refused together do not come back together: the waits differ', () => {
    const waits = new Set(Array.from({ length: 250 }, () => busyWaitMs(0, undefined)))
    expect(waits.size).toBeGreaterThan(100)
    for (const ms of waits) {
      expect(ms).toBeGreaterThanOrEqual(1500)
      expect(ms).toBeLessThanOrEqual(2500)
    }
  })

  it('a provider’s Retry-After is honoured (never shorter than it), with a little spread; a very long one is not waited for', () => {
    expect(busyWaitMs(0, 8000, () => 0)).toBe(8000)
    expect(busyWaitMs(0, 8000, () => 1)).toBe(9000)
    // shorter than our own wait: our own wait stands
    expect(busyWaitMs(2, 1000, () => 0.5)).toBe(10000)
    expect(busyWaitMs(0, RETRY_AFTER_MAX_MS, () => 0)).toBe(RETRY_AFTER_MAX_MS)
    expect(busyWaitMs(0, RETRY_AFTER_MAX_MS + 1, () => 0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-203 items 1 and 2: the one call is retried in place, then sent to the overflow model', () => {
  it('busy, busy, then an answer: the same call is asked three times and the job carries on', async () => {
    quiet()
    const { client, waits, primary, made, log } = wrapped([busy(), busy(503), 'the wording'])
    expect(await client.generateText('prompt')).toBe('the wording')
    expect(primary.calls()).toBe(3)
    expect(waits).toEqual([2000, 5000])
    expect(log.busyRetries).toBe(2)
    expect(log.overflowCalls).toBe(0)
    expect(log.exhaustedTasks).toEqual([])
    // the overflow client is not even made
    expect(made).not.toHaveBeenCalled()
  })

  it('every call shape is retried, not only text', async () => {
    quiet()
    for (const call of [
      (c: AiClient) => c.generateText('p'),
      (c: AiClient) => c.generateWithImages('p', []),
      (c: AiClient) => c.generateWithSchema('p', {}),
      (c: AiClient) => c.generateWithImagesAndSchema('p', [], {}),
    ]) {
      const { client, primary } = wrapped([busy(), { ok: true }])
      expect(await call(client)).toEqual({ ok: true })
      expect(primary.calls()).toBe(2)
    }
  })

  it('still busy after the three waits: that one call goes to the overflow model, and its answer is used', async () => {
    quiet()
    const { client, waits, primary, overflow, log } = wrapped([busy()], ['from the overflow model'])
    expect(await client.generateText('prompt')).toBe('from the overflow model')
    expect(primary.calls()).toBe(4) // the first try and three retries
    expect(waits).toEqual([2000, 5000, 10000])
    expect(overflow!.calls()).toBe(1)
    expect(log.busyRetries).toBe(3)
    expect(log.overflowCalls).toBe(1)
    expect(log.exhaustedTasks).toEqual([])
  })

  it('busy on both: the call rejects with AiBusyError and the task is marked for the run', async () => {
    quiet()
    const { client, primary, overflow, log } = wrapped([busy()], [busy(529)])
    const error = await client.generateText('prompt').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiBusyError)
    expect(isAiBusyError(error)).toBe(true)
    expect((error as AiBusyError).task).toBe('wording')
    expect((error as AiBusyError).overflowTried).toBe(true)
    // the message names the task and nothing of the request
    expect((error as Error).message).not.toContain('prompt')
    expect(primary.calls()).toBe(4)
    expect(overflow!.calls()).toBe(1)
    expect(log.exhaustedTasks).toEqual(['wording'])
    expect(log.overflowCalls).toBe(1)
  })

  it('once a task is busy everywhere, a second call in the same run does not wait all over again', async () => {
    quiet()
    const { client, waits, primary, overflow } = wrapped([busy()], [busy()])
    await client.generateText('first').catch(() => undefined)
    const before = { waits: waits.length, primary: primary.calls(), overflow: overflow!.calls() }
    await expect(client.generateWithSchema('second', {})).rejects.toBeInstanceOf(AiBusyError)
    expect({ waits: waits.length, primary: primary.calls(), overflow: overflow!.calls() }).toEqual(before)
  })

  it('a task with no overflow: the waits still happen, then it is busy', async () => {
    quiet()
    const { client, waits, log } = wrapped([busy()])
    const error = await client.generateText('prompt').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiBusyError)
    expect((error as AiBusyError).overflowTried).toBe(false)
    expect(waits).toHaveLength(3)
    expect(log.overflowCalls).toBe(0)
  })

  it('a real error behaves as before: thrown at once, the same error, no wait, no overflow', async () => {
    quiet()
    for (const real of [new Error('Gemini returned no candidates'), new AiProviderError('Gemini API error: 400 INVALID_ARGUMENT', 400, false), new SyntaxError('Unexpected token')]) {
      const { client, waits, primary, made, log } = wrapped([real], ['never asked'])
      await expect(client.generateText('prompt')).rejects.toBe(real)
      expect(primary.calls()).toBe(1)
      expect(waits).toEqual([])
      expect(made).not.toHaveBeenCalled()
      expect(log.busyRetries + log.overflowCalls).toBe(0)
    }
  })

  it('a real error after a busy one is still thrown as itself', async () => {
    quiet()
    const real = new Error('Gemini blocked response due to safety filters')
    const { client, waits } = wrapped([busy(), real])
    await expect(client.generateText('prompt')).rejects.toBe(real)
    expect(waits).toEqual([2000])
  })

  it('an overflow model that fails for any reason leaves the call busy: its fault is never a worse result than having no overflow', async () => {
    quiet()
    const real = new Error('the response was truncated at max_tokens')
    const { client, log } = wrapped([busy()], [real])
    const error = await client.generateText('prompt').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiBusyError)
    expect((error as AiBusyError).overflowTried).toBe(true)
    expect(log.exhaustedTasks).toEqual(['wording'])
    expect(log.overflowCalls).toBe(1)
  })

  it('…but a call cancelled while the overflow model is asked is still a cancelled call', async () => {
    quiet()
    const stop = new AbortController()
    const aborted = new DOMException('Aborted', 'AbortError')
    const primary = scripted('gemini', [busy()])
    const overflow = scripted('anthropic', [aborted])
    const log = new AiBusyLog()
    const client = new BusyRetryClient(primary.client, { task: 'extraction_pass', log, overflow: () => overflow.client, sleep: async () => undefined })
    stop.abort()
    // already cancelled when the first busy answer arrives: no wait, no overflow
    await expect(client.generateWithImagesAndSchema('p', [], {}, undefined, { signal: stop.signal })).rejects.toBeInstanceOf(AiProviderError)
    expect(overflow.calls()).toBe(0)
    expect(log.exhaustedTasks).toEqual([])
  })

  it('Retry-After is honoured; one too long to wait for sends the call straight to the overflow model', async () => {
    quiet()
    const first = wrapped([busy(429, 6000), 'ok'])
    await first.client.generateText('p')
    expect(first.waits[0]).toBeGreaterThanOrEqual(6000)
    const second = wrapped([busy(429, 60_000)], ['from the overflow model'])
    expect(await second.client.generateText('p')).toBe('from the overflow model')
    expect(second.waits).toEqual([])
    expect(second.primary.calls()).toBe(1)
  })

  it('a cancelled call stops waiting (the measurement’s early stop)', async () => {
    quiet()
    const stop = new AbortController()
    const primary = scripted('gemini', [busy()])
    const client = new BusyRetryClient(primary.client, { task: 'extraction_pass', waitsMs: [10_000] })
    const call = client.generateWithImagesAndSchema('p', [], {}, undefined, { signal: stop.signal })
    setTimeout(() => stop.abort(), 20)
    const started = Date.now()
    const error = await call.catch((e: unknown) => e)
    expect((error as Error).name).toBe('AbortError')
    expect(Date.now() - started).toBeLessThan(2000)
    expect(primary.calls()).toBe(1)
  })

  it('a call’s cap still wins (T-172): it times out during the wait and the caller gets its timeout, not a busy error', async () => {
    quiet()
    const primary = scripted('gemini', [busy()])
    const client = new BusyRetryClient(primary.client, { task: 'wording', waitsMs: [300, 300, 300] })
    const error = await withAiTimeout('wording', 30, () => client.generateText('p')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiCallTimeoutError)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-203: the provider clients say when an answer was a busy one', () => {
  const answer = (status: number, body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json', ...headers } })

  it('Gemini: 429 with Retry-After is busy, with the same message as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}', { 'Retry-After': '4' })))
    const client = new GeminiClient({ apiKey: 'local-test-key', model: resolveModelRoute('wording').model })
    const error = (await client.generateText('p').catch((e: unknown) => e)) as AiProviderError
    expect(error).toBeInstanceOf(AiProviderError)
    expect(error.busy).toBe(true)
    expect(error.status).toBe(429)
    expect(error.retryAfterMs).toBe(4000)
    expect(error.message).toBe('Gemini API error: 429 {"error":{"status":"RESOURCE_EXHAUSTED"}}')
  })

  it('Gemini: 503 overloaded is busy; the body’s retryDelay is read when there is no header; a 400 is not busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(503, '{"error":{"message":"The model is overloaded.","details":[{"retryDelay":"3s"}]}}')))
    const client = new GeminiClient({ apiKey: 'local-test-key', model: resolveModelRoute('wording').model })
    const overloaded = (await client.generateText('p').catch((e: unknown) => e)) as AiProviderError
    expect([overloaded.busy, overloaded.status, overloaded.retryAfterMs]).toEqual([true, 503, 3000])
    vi.stubGlobal('fetch', vi.fn(async () => answer(400, '{"error":{"status":"INVALID_ARGUMENT"}}')))
    const bad = (await client.generateText('p').catch((e: unknown) => e)) as AiProviderError
    expect([bad.busy, bad.status]).toEqual([false, 400])
    expect(bad.message).toContain('Gemini API error: 400')
  })

  it('Anthropic: 429 and 529 are busy (with Retry-After); a 400 is the SDK’s own error, untouched', async () => {
    const model = overflowCandidate()!.model
    const make = () => new AnthropicClient({ apiKey: 'local-test-key', model, maxRetries: 0, baseUrl: 'http://127.0.0.1:9/stand-in' })
    vi.stubGlobal('fetch', vi.fn(async () => answer(429, '{"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}', { 'retry-after': '6' })))
    const limited = (await make().generateText('p').catch((e: unknown) => e)) as AiProviderError
    expect(limited).toBeInstanceOf(AiProviderError)
    expect([limited.busy, limited.status, limited.retryAfterMs]).toEqual([true, 429, 6000])
    vi.stubGlobal('fetch', vi.fn(async () => answer(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')))
    const overloaded = (await make().generateText('p').catch((e: unknown) => e)) as AiProviderError
    expect([overloaded.busy, overloaded.status]).toEqual([true, 529])
    vi.stubGlobal('fetch', vi.fn(async () => answer(400, '{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}')))
    const bad = await make().generateText('p').catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(Anthropic.BadRequestError)
    expect(bad).not.toBeInstanceOf(AiProviderError)
  })

  it('the overflow client makes one try: the busy retry owns the waiting, not the SDK', async () => {
    const fetched = vi.fn(async () => answer(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'))
    vi.stubGlobal('fetch', fetched)
    const client = new AnthropicClient({ apiKey: 'local-test-key', model: overflowCandidate()!.model, maxRetries: 0, baseUrl: 'http://127.0.0.1:9/stand-in' })
    await client.generateText('p').catch(() => undefined)
    expect(fetched).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-203 item 2: the overflow model comes from the registry, per task', () => {
  const registry = JSON.parse(read('packages/shared/src/ai-models.json')) as {
    tasks: Record<string, { provider: string; model: string; overflow?: unknown }>
    overflowCandidate?: { provider: string; model: string }
  }
  const candidate = overflowCandidate()!
  const spec = `${candidate.provider}:${candidate.model}`

  it('every task has an overflow entry: "none", or a provider and a model', () => {
    for (const task of AI_TASKS) {
      const entry = registry.tasks[task]!.overflow
      expect(entry, task).toBeDefined()
      if (entry !== 'none') expect(entry, task).toEqual({ provider: expect.any(String), model: expect.any(String) })
    }
  })

  it('a task’s overflow is on in the registry only after its proof passed: wording and identification (T-204)', () => {
    // When a task passes scripts/load-test/overflow-proof.mts, its entry changes and this list with it.
    // T-204, the run of 25 Nov 2026: wording and identification passed; extraction_pass and adjudication
    // gave a measurement outside the pack's envelope and stay off.
    const on = AI_TASKS.filter((task) => registry.tasks[task]!.overflow !== 'none')
    expect([...on].sort()).toEqual(['identification', 'wording'])
    for (const task of AI_TASKS) {
      if (on.includes(task)) expect(resolveOverflowRoute(task), task).toEqual(candidate)
      else expect(resolveOverflowRoute(task), task).toBeNull()
    }
  })

  it('the candidate is another provider than the tasks’ own, and has a price', () => {
    expect(candidate.provider).toBe('anthropic')
    expect(getModelPrice(candidate.model)).not.toBeNull()
    for (const task of AI_TASKS) expect(resolveModelRoute(task).provider, task).not.toBe(candidate.provider)
  })

  it('AI_OVERFLOW_<TASK> switches one task on, or off; a route that is the task’s own is no overflow', () => {
    expect(resolveOverflowRoute('wording', { AI_OVERFLOW_WORDING: spec })).toEqual(candidate)
    expect(resolveOverflowRoute('wording', { AI_OVERFLOW_WORDING: candidate.model })).toEqual(candidate)
    expect(resolveOverflowRoute('adjudication', { AI_OVERFLOW_WORDING: spec })).toBeNull()
    for (const off of ['none', 'NONE', ' none ']) expect(resolveOverflowRoute('wording', { AI_OVERFLOW_WORDING: off })).toBeNull()
    const own = resolveModelRoute('wording')
    expect(resolveOverflowRoute('wording', { AI_OVERFLOW_WORDING: `${own.provider}:${own.model}` })).toBeNull()
  })

  it('no model name is typed in the worker’s busy code', () => {
    for (const file of ['apps/worker/src/ai/busy.ts', 'apps/worker/src/ai/factory.ts', 'apps/worker/src/queue-consumer.ts', 'apps/worker/src/busy-state.ts']) {
      expect(read(file), file).not.toMatch(/claude-[a-z]+-\d|gemini-\d/)
    }
  })

  // the worker's own clients, against stand-in answers
  const geminiOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from the task’s own model' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }), { status: 200 })
  const overflowOk = () => new Response(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant', model: candidate.model, content: [{ type: 'text', text: 'from the overflow model' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 20, output_tokens: 8 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const tooMany = () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 })
  const routes = (gemini: () => Response, overflow: () => Response) => {
    const seen = { gemini: 0, overflow: 0 }
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      if (url.includes('generativelanguage')) {
        seen.gemini += 1
        return gemini()
      }
      seen.overflow += 1
      return overflow()
    }))
    return seen
  }
  const dev = { ENVIRONMENT: 'development', GEMINI_API_KEY: 'local-test-key', AI_BUSY_WAITS_MS: '1,1,1' }

  it('createAiClient: a busy task with an overflow and its key gets its answer from the overflow model, and the cost is metered to that model', async () => {
    quiet()
    const seen = routes(tooMany, overflowOk)
    const meter = new AiUsageMeter()
    const log = new AiBusyLog()
    const client = createAiClient('wording', { ...dev, ANTHROPIC_API_KEY: 'local-test-key', AI_OVERFLOW_WORDING: spec } as never, meter, { busy: log })!
    expect(client).toBeInstanceOf(BusyRetryClient)
    expect(await client.generateText('p')).toBe('from the overflow model')
    expect(seen).toEqual({ gemini: 4, overflow: 1 })
    expect([log.busyRetries, log.overflowCalls]).toEqual([3, 1])
    const usage = meter.summary()
    expect(usage.byTask).toHaveLength(1)
    expect(usage.byTask[0]).toMatchObject({ task: 'wording', provider: 'anthropic', model: candidate.model, calls: 1, inputTokens: 20, outputTokens: 8 })
    expect(usage.estimatedCostUsd).toBeGreaterThan(0)
  })

  it('with no ANTHROPIC_API_KEY overflow is off, and the retries still work', async () => {
    quiet()
    const seen = routes(tooMany, overflowOk)
    const log = new AiBusyLog()
    const client = createAiClient('wording', { ...dev, AI_OVERFLOW_WORDING: spec } as never, undefined, { busy: log })!
    const error = await client.generateText('p').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiBusyError)
    expect((error as AiBusyError).overflowTried).toBe(false)
    expect(seen).toEqual({ gemini: 4, overflow: 0 })
    expect(log.busyRetries).toBe(3)
  })

  it('"none" is off even with the key; and a task that answers needs no overflow at all', async () => {
    quiet()
    const seen = routes(tooMany, overflowOk)
    const off = createAiClient('wording', { ...dev, ANTHROPIC_API_KEY: 'local-test-key', AI_OVERFLOW_WORDING: 'none' } as never)!
    await expect(off.generateText('p')).rejects.toBeInstanceOf(AiBusyError)
    expect(seen.overflow).toBe(0)
    const fine = routes(geminiOk, overflowOk)
    const client = createAiClient('wording', { ...dev, ANTHROPIC_API_KEY: 'local-test-key', AI_OVERFLOW_WORDING: spec } as never)!
    expect(await client.generateText('p')).toBe('from the task’s own model')
    expect(fine).toEqual({ gemini: 1, overflow: 0 })
  })

  it('the stand-in addresses and the short waits are for local checks only: production ignores them', () => {
    const production = { ENVIRONMENT: 'production', GEMINI_API_KEY: 'k', AI_BUSY_WAITS_MS: '1,1,1', AI_GEMINI_BASE_URL: 'http://127.0.0.1:9', AI_ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }
    expect(busyWaitsFor(production)).toBe(BUSY_WAITS_MS)
    expect(busyWaitsFor({ ...production, ENVIRONMENT: 'development' })).toEqual([1, 1, 1])
    expect(busyWaitsFor({ ENVIRONMENT: 'development', AI_BUSY_WAITS_MS: 'soon' })).toBe(BUSY_WAITS_MS)
    const factory = read('apps/worker/src/ai/factory.ts')
    expect(factory).toContain('...(dev && env.AI_GEMINI_BASE_URL && { baseUrl: env.AI_GEMINI_BASE_URL })')
    expect(factory).toContain('...(dev && env.AI_ANTHROPIC_BASE_URL && { baseUrl: env.AI_ANTHROPIC_BASE_URL })')
    expect(factory).toContain("const isDevelopment = (env: AiEnv) => env.ENVIRONMENT === 'development'")
  })

  it('there is no throttle: no token bucket, no shared counter, and the limiter is not touched (AD-060)', () => {
    const code = read('apps/worker/src/ai/busy.ts').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/bucket|throttle|semaphore|Upstash|redis/i)
    expect(read('apps/worker/src/ai/factory.ts')).not.toMatch(/rate-limiter|Upstash/i)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-203 item 3: busy is not a failure (the queue consumer)', () => {
  type Job = { quoteId: string; tenantId: string }
  const job: Job = { quoteId: 'qte_fixture_1', tenantId: 'tnt_fixture_1' }
  const NOW = Date.parse('2026-11-25T12:00:00Z')

  function message(attempts = 1, arrivedSecondsAgo = 0) {
    const m = { body: job, attempts, timestamp: new Date(NOW - arrivedSecondsAgo * 1000), ack: vi.fn(), retry: vi.fn() }
    return m as typeof m & JobMessage<Job>
  }

  function busyError(counts = { busyRetries: 3, overflowCalls: 1 }) {
    const error = new AiBusyError('extraction_pass', true)
    error.counts = counts
    return error
  }

  function deps(result: { success: boolean; error?: string } | Error, state: BusyState = NO_BUSY_STATE, withBusy = true) {
    const saved: BusyState[] = []
    return {
      saved,
      limiter: null,
      process: vi.fn(async (_job: Job, _wait: number | undefined, _before: BusyState) => {
        if (result instanceof Error) throw result
        return result
      }),
      markFailed: vi.fn(async (_job: Job, _error: string) => undefined),
      maxRetries: MAX_RETRIES,
      backoffSeconds: (n: number) => 30 * 2 ** n,
      now: () => NOW,
      ...(withBusy && {
        busy: {
          read: vi.fn(async () => state),
          save: vi.fn(async (_job: Job, next: BusyState) => {
            saved.push(next)
          }),
        },
      }),
    }
  }

  it('the numbers: 3 real tries, 10 busy requeues, 15 minutes, and the waits 60 s, 90 s, then 120 s', () => {
    expect([MAX_RETRIES, MAX_BUSY_REQUEUES, BUSY_MAX_MINUTES, MAX_DELIVERY_RETRIES]).toEqual([3, 10, 15, 13])
    expect([0, 1, 2, 3, 9].map(busyRequeueSeconds)).toEqual([60, 90, 120, 120, 120])
  })

  it('wrangler.toml lets the queue deliver that often, in both queues, and keeps the note', () => {
    const toml = read('apps/worker/wrangler.toml')
    const retries = [...toml.matchAll(/^max_retries = (\d+)$/gm)].map((m) => Number(m[1]))
    expect(retries).toHaveLength(2)
    for (const value of retries) expect(value).toBeGreaterThanOrEqual(MAX_DELIVERY_RETRIES)
    expect(toml).toContain('max_retries must be >= MAX_DELIVERY_RETRIES in src/queue-consumer.ts')
    // the entry file takes the numbers from one place
    expect(read('apps/worker/src/index.ts')).toContain("import { handleQuoteJob, MAX_RETRIES, type BusyState } from './queue-consumer'")
    expect(read('apps/worker/src/index.ts')).not.toMatch(/const MAX_RETRIES =/)
  })

  it('busy on both providers: the job is put back for 60 s, nothing is marked failed, and the count is kept', async () => {
    quiet()
    const m = message(1)
    const d = deps(busyError())
    expect(await handleQuoteJob(m, d)).toBe('requeued_busy')
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
    expect(m.ack).not.toHaveBeenCalled()
    expect(d.markFailed).not.toHaveBeenCalled()
    expect(d.saved).toEqual([{ requeues: 1, busyRetries: 3, overflowCalls: 1, lastAt: new Date(NOW).toISOString(), lastRun: { busyRetries: 3, overflowCalls: 1 } }])
  })

  it('then longer: the second wait is 90 s, the third and later 120 s, and the totals add up', async () => {
    quiet()
    const second = deps(busyError({ busyRetries: 2, overflowCalls: 0 }), { requeues: 1, busyRetries: 3, overflowCalls: 1 })
    const m2 = message(2, 70)
    expect(await handleQuoteJob(m2, second)).toBe('requeued_busy')
    expect(m2.retry).toHaveBeenCalledWith({ delaySeconds: 90 })
    expect(second.saved[0]).toMatchObject({ requeues: 2, busyRetries: 5, overflowCalls: 1, lastRun: { busyRetries: 2, overflowCalls: 0 } })
    const third = deps(busyError(), { requeues: 2, busyRetries: 5, overflowCalls: 1 })
    const m3 = message(3, 170)
    await handleQuoteJob(m3, third)
    expect(m3.retry).toHaveBeenCalledWith({ delaySeconds: 120 })
  })

  it('the pipeline is told what earlier runs met', async () => {
    const state = { requeues: 2, busyRetries: 5, overflowCalls: 1 }
    const d = deps({ success: true }, state)
    const m = message(3, 170)
    expect(await handleQuoteJob(m, d)).toBe('done')
    expect(d.process).toHaveBeenCalledWith(job, 170_000, state)
    expect(m.ack).toHaveBeenCalledTimes(1)
  })

  it('a busy requeue does NOT use up a real try: after four of them a real error is still try number one', async () => {
    quiet()
    const d = deps(new Error('the database did not answer'), { requeues: 4, busyRetries: 12, overflowCalls: 4 })
    const m = message(5, 400)
    expect(await handleQuoteJob(m, d)).toBe('retry')
    // today's wait for a first failure, unchanged
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
    expect(d.markFailed).not.toHaveBeenCalled()
  })

  it('real errors keep their 3 tries and today’s waits, with or without busy requeues in between', async () => {
    quiet()
    for (const [attempts, requeues, expected, wait] of [
      [1, 0, 'retry', 30],
      [2, 0, 'retry', 60],
      [3, 0, 'retry', 120],
      [4, 0, 'failed', null],
      [7, 4, 'retry', 120], // 7 deliveries, 4 of them busy: this is real try 3
      [8, 4, 'failed', null],
      [14, 10, 'failed', null],
    ] as const) {
      const d = deps(new Error('a real fault'), { requeues, busyRetries: 0, overflowCalls: 0 })
      const m = message(attempts, 60)
      expect(await handleQuoteJob(m, d), `${attempts} deliveries, ${requeues} busy`).toBe(expected)
      if (wait !== null) expect(m.retry).toHaveBeenCalledWith({ delaySeconds: wait })
      else {
        expect(d.markFailed).toHaveBeenCalledTimes(1)
        expect(m.ack).toHaveBeenCalledTimes(1)
      }
      expect(d.saved).toEqual([])
    }
  })

  it('a provider’s rate limit that reaches the consumer as an ordinary error still waits 60 s, as before', async () => {
    quiet()
    const d = deps(new Error('Gemini API error: 429 quota'))
    const m = message(1)
    expect(await handleQuoteJob(m, d)).toBe('retry')
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
  })

  it('bound one: after 10 busy requeues the quote is marked failed, as any failed quote is', async () => {
    quiet()
    const d = deps(busyError(), { requeues: MAX_BUSY_REQUEUES, busyRetries: 30, overflowCalls: 10 })
    const m = message(11, 600)
    expect(await handleQuoteJob(m, d)).toBe('failed')
    expect(d.markFailed).toHaveBeenCalledTimes(1)
    expect(d.markFailed.mock.calls[0]![1]).toMatch(/AI busy: extraction_pass .* still busy after 10 requeues and 10 minutes/)
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
    expect(d.saved).toEqual([])
  })

  it('bound two: 15 minutes after the request arrived it is marked failed, however few requeues it had', async () => {
    quiet()
    const d = deps(busyError(), { requeues: 3, busyRetries: 9, overflowCalls: 3 })
    const m = message(4, BUSY_MAX_MINUTES * 60)
    expect(await handleQuoteJob(m, d)).toBe('failed')
    expect(d.markFailed).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
  })

  it('the last wait is cut short so no run starts after the 15 minutes', async () => {
    quiet()
    const d = deps(busyError(), { requeues: 5, busyRetries: 15, overflowCalls: 5 })
    const m = message(6, BUSY_MAX_MINUTES * 60 - 25)
    expect(await handleQuoteJob(m, d)).toBe('requeued_busy')
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 25 })
  })

  it('the worst case fits the queue: 10 busy requeues and 3 real retries are 13 deliveries after the first', async () => {
    quiet()
    // delivery 14 = attempts 14: ten busy, then the fourth real try fails
    const d = deps(new Error('a real fault'), { requeues: 10, busyRetries: 0, overflowCalls: 0 })
    expect(await handleQuoteJob(message(1 + MAX_DELIVERY_RETRIES, 800), d)).toBe('failed')
  })

  it('where no count can be kept (no store), a busy run is an ordinary failed try', async () => {
    quiet()
    const d = deps(busyError(), NO_BUSY_STATE, false)
    const m = message(1)
    expect(await handleQuoteJob(m, d)).toBe('retry')
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
  })

  it('the count is kept on the quote, beside its other processing notes, and reading it never throws', async () => {
    expect(busyStateOf(null)).toEqual(NO_BUSY_STATE)
    expect(busyStateOf({ busy: 'yes' })).toEqual(NO_BUSY_STATE)
    expect(busyStateOf({ busy: { requeues: -1, busyRetries: 'many' } })).toEqual(NO_BUSY_STATE)
    expect(busyStateOf({ busy: { requeues: 2, busyRetries: 6, overflowCalls: 2, lastAt: '2026-11-25T12:00:00.000Z', lastRun: { busyRetries: 3, overflowCalls: 1 } } })).toEqual({
      requeues: 2,
      busyRetries: 6,
      overflowCalls: 2,
      lastAt: '2026-11-25T12:00:00.000Z',
      lastRun: { busyRetries: 3, overflowCalls: 1 },
    })

    const updates: unknown[] = []
    const db = (row: unknown, fail = false) =>
      ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => (fail ? Promise.reject(new Error('down')) : { data: row, error: null }) }) }),
          update: (values: unknown) => {
            updates.push(values)
            return { eq: async () => ({ error: null }) }
          },
        }),
      }) as never
    expect(await readBusyState(db({ content_json: { busy: { requeues: 1 } } }), 'qte_1')).toMatchObject({ requeues: 1 })
    expect(await readBusyState(db(null), 'qte_1')).toEqual(NO_BUSY_STATE)
    expect(await readBusyState(db(null, true), 'qte_1')).toEqual(NO_BUSY_STATE)
    await saveBusyState(db({ content_json: { businessRetries: 2 } }), 'qte_1', { requeues: 1, busyRetries: 3, overflowCalls: 1 })
    // the quote's other notes are kept, and its status is not touched
    expect(updates).toEqual([{ content_json: { businessRetries: 2, busy: { requeues: 1, busyRetries: 3, overflowCalls: 1 } } }])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(saveBusyState(db(null, true), 'qte_1', NO_BUSY_STATE)).resolves.toBeUndefined()
  })

  it('the processor stops before anything is saved or sent, at three checkpoints, and every client shares the run’s log', () => {
    const processor = read('apps/worker/src/quote-processor.ts')
    expect(processor.match(/busy\.throwIfExhausted\(\)/g)).toHaveLength(3)
    expect(processor.match(/createAiClient\('[a-z_]+', env, aiUsage, \{ busy \}\)/g)).toHaveLength(4)
    expect(processor.match(/createAiClient\(/g)).toHaveLength(4)
    // each save of a result has a checkpoint before it, with no other write in between
    const firstSave = processor.indexOf('const { error: clarifyError } = await supabase')
    const finalSave = processor.indexOf('// 5. Update quote record with signals and pricing trace')
    for (const save of [firstSave, finalSave]) {
      expect(save).toBeGreaterThan(-1)
      const before = processor.slice(0, save)
      const checkpoint = before.lastIndexOf('busy.throwIfExhausted()')
      expect(checkpoint).toBeGreaterThan(-1)
      expect(before.slice(checkpoint)).not.toMatch(/\.update\(|\.insert\(|sendQuoteEmails|notifyPhones|incrementUsageCounter/)
    }
    // the usage counter, the phones and the emails all come after the last checkpoint
    const last = processor.lastIndexOf('busy.throwIfExhausted()')
    for (const after of ["incrementUsageCounter(supabase, quoteData.quote.tenant_id, 'estimates_sent')", "notifyPhones(supabase, env, 'new_request', quoteId)", 'sendQuoteEmails(']) {
      expect(processor.indexOf(after), after).toBeGreaterThan(last)
    }
  })

  it('the checkpoint throws the busy error with what the run used', () => {
    const log = new AiBusyLog()
    expect(() => log.throwIfExhausted()).not.toThrow()
    log.noteRetry()
    log.noteRetry()
    log.noteOverflow()
    expect(() => log.throwIfExhausted()).not.toThrow()
    log.noteExhausted('extraction_pass' as AiTask, true)
    let thrown: unknown
    try {
      log.throwIfExhausted()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AiBusyError)
    expect((thrown as AiBusyError).counts).toEqual({ busyRetries: 2, overflowCalls: 1 })
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-203 item 4: seeing it happen', () => {
  it('every stored timing says how many busy retries and overflow calls the quote used (0 when none)', () => {
    const plain = new StageTimer().summary()
    expect(plain.busyRetries).toBe(0)
    expect(plain.overflowCalls).toBe(0)
    expect(plain).not.toHaveProperty('busyRequeues')
    expect(plain).not.toHaveProperty('lastRun')
    expect(Number.isNaN(Date.parse(plain.finishedAt))).toBe(false)
  })

  it('a quote priced in one run: its own counts; one that was put back: every run’s, the requeues, and the last run’s', () => {
    const log = new AiBusyLog()
    log.noteRetry()
    log.noteRetry()
    log.noteOverflow()
    const once = new StageTimer()
    once.busy = { log, before: NO_BUSY_STATE }
    expect(once.summary()).toMatchObject({ busyRetries: 2, overflowCalls: 1 })
    expect(once.summary()).not.toHaveProperty('busyRequeues')
    const again = new StageTimer()
    again.busy = { log, before: { requeues: 2, busyRetries: 6, overflowCalls: 2 } }
    expect(again.summary()).toMatchObject({ busyRetries: 8, overflowCalls: 3, busyRequeues: 2, lastRun: { busyRetries: 2, overflowCalls: 1 } })
  })

  const NOW = Date.parse('2026-11-25T12:00:00Z')
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()
  const window: [number, number] = [NOW - 5 * 60_000, NOW]

  it('the window’s count: each run of a quote once, in the window it ended in', () => {
    const rows = [
      // priced in one run, inside the window
      { timings: { busyRetries: 4, overflowCalls: 1, finishedAt: at(1) }, busy: null },
      // priced before the window: not counted again
      { timings: { busyRetries: 9, overflowCalls: 9, finishedAt: at(7) }, busy: null },
      // put back twice earlier, priced now: only its last run is this window's
      { timings: { busyRetries: 10, overflowCalls: 3, busyRequeues: 2, lastRun: { busyRetries: 1, overflowCalls: 0 }, finishedAt: at(2) }, busy: null },
      // still waiting, put back inside the window
      { timings: null, busy: { requeues: 1, lastAt: at(3), lastRun: { busyRetries: 3, overflowCalls: 1 } } },
      // still waiting, put back before the window
      { timings: null, busy: { requeues: 1, lastAt: at(9), lastRun: { busyRetries: 3, overflowCalls: 1 } } },
      // nothing happened to it, and a row with nothing stored
      { timings: { busyRetries: 0, overflowCalls: 0, finishedAt: at(1) }, busy: null },
      { timings: null, busy: null },
      { timings: { busyRetries: 'many', finishedAt: 'yesterday' } },
    ]
    expect(countBusy(rows, ...window)).toEqual({ busyRetries: 8, overflowCalls: 2, requeued: 1, quotes: 3 })
    expect(countBusy([], ...window)).toEqual({ busyRetries: 0, overflowCalls: 0, requeued: 0, quotes: 0 })
  })

  it('the thresholds: many busy retries, or several overflow calls, in one window', () => {
    expect([AI_BUSY_ALERT_RETRIES, AI_BUSY_ALERT_OVERFLOW]).toEqual([20, 5])
    const count = (busyRetries: number, overflowCalls: number) => ({ busyRetries, overflowCalls, requeued: 0, quotes: 1 })
    expect(busyAlertDue(count(19, 4))).toBe(false)
    expect(busyAlertDue(count(20, 0))).toBe(true)
    expect(busyAlertDue(count(0, 5))).toBe(true)
  })

  const env = { ALERT_EMAIL: 'alerts@owner.test', POSTMARK_API_TOKEN: 'local-token', POSTMARK_FROM_EMAIL: 'quotes@example.test', APP_URL: 'https://app.example.test', ENVIRONMENT: 'production' }
  function fakeDb(rows: unknown[], claim: { send: boolean; held_back: number } = { send: true, held_back: 0 }, fail = false) {
    const calls = { rpc: [] as unknown[], select: '' }
    const query = {
      select: (columns: string) => {
        calls.select = columns
        return query
      },
      gt: () => query,
      order: () => query,
      limit: async () => (fail ? { data: null, error: { message: 'down' } } : { data: rows, error: null }),
    }
    const db = {
      from: () => query,
      rpc: async (name: string, args: unknown) => {
        calls.rpc.push([name, args])
        return { data: [claim], error: null }
      },
    }
    return { db: db as never, calls }
  }

  it('the 5-minute check: below the thresholds nothing is sent', async () => {
    const { db, calls } = fakeDb([{ timings: { busyRetries: 6, overflowCalls: 1, finishedAt: at(1) }, busy: null }])
    const send = vi.fn(async () => ({ success: true }))
    expect(await checkBusy(db, env, new Date(NOW), send)).toEqual({ count: { busyRetries: 6, overflowCalls: 1, requeued: 0, quotes: 1 }, alert: 'none' })
    expect(send).not.toHaveBeenCalled()
    expect(calls.rpc).toEqual([])
    expect(calls.select).toBe('timings:pricing_trace_json->timings, busy:content_json->busy')
  })

  it('past a threshold: one email, with the counts and nothing else (no quote, no business, no customer)', async () => {
    quiet()
    const rows = Array.from({ length: 8 }, () => ({ timings: { busyRetries: 3, overflowCalls: 1, finishedAt: at(2) }, busy: null }))
    const { db, calls } = fakeDb(rows)
    const send = vi.fn(async (_config: unknown, _email: unknown) => ({ success: true }))
    const result = await checkBusy(db, env, new Date(NOW), send as never)
    expect(result).toEqual({ count: { busyRetries: 24, overflowCalls: 8, requeued: 0, quotes: 8 }, alert: 'sent' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(calls.rpc).toEqual([['claim_ops_alert', { p_kind: 'ai_busy', p_every_seconds: 3600 }]])
    const mail = send.mock.calls[0]![1] as { to: string; subject: string; textBody: string; htmlBody: string }
    expect(mail.to).toBe('alerts@owner.test')
    expect(mail.subject).toContain('The AI providers were busy')
    for (const fact of ['Busy retries: 24', 'Calls sent to the overflow provider: 8', 'Requests put back to wait: 0', 'Requests that met any of it: 8', 'Minutes counted: 5']) expect(mail.textBody).toContain(fact)
    expect(`${mail.textBody}${mail.htmlBody}`).not.toMatch(/qte_|tnt_/)
    // no address but the owner's own
    expect((`${mail.textBody}${mail.htmlBody}`.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).filter((address) => address !== 'alerts@owner.test')).toEqual([])
  })

  it('at most one an hour: a second window in the same hour is held back, like every kind of alert', async () => {
    quiet()
    const rows = [{ timings: { busyRetries: 30, overflowCalls: 0, finishedAt: at(1) }, busy: null }]
    const { db } = fakeDb(rows, { send: false, held_back: 1 })
    const send = vi.fn(async () => ({ success: true }))
    expect((await checkBusy(db, env, new Date(NOW), send)).alert).toBe('held')
    expect(send).not.toHaveBeenCalled()
  })

  it('a count that cannot be read is nothing to report, and the check never throws; with no alert address it is off', async () => {
    const send = vi.fn(async () => ({ success: true }))
    expect((await checkBusy(fakeDb([], undefined, true).db, env, new Date(NOW), send)).alert).toBe('none')
    expect((await checkBusy({ from: () => { throw new Error('down') } } as never, env, new Date(NOW), send)).alert).toBe('none')
    const rows = [{ timings: { busyRetries: 30, overflowCalls: 0, finishedAt: at(1) }, busy: null }]
    expect((await checkBusy(fakeDb(rows).db, { ...env, ALERT_EMAIL: undefined }, new Date(NOW), send)).alert).toBe('off')
    expect(send).not.toHaveBeenCalled()
  })

  it('the email says it is news, not a fault, and what to look at', () => {
    const mail = opsAlertEmail({ kind: 'ai_busy', details: { 'Busy retries': 24 } }, { environment: 'production' })
    expect(mail.text).toContain('Requests are retried and put back by themselves')
    expect(mail.text).toContain('rate limit tier of the main provider')
    expect(mail.text).toContain('overflow provider’s key is set in the worker')
  })

  it('the check runs on the same 5-minute timer as the queue check, after it', () => {
    const entry = read('apps/worker/src/index.ts')
    const scheduled = entry.slice(entry.indexOf('async scheduled('))
    expect(scheduled.indexOf('checkQueue(supabase, env)')).toBeGreaterThan(-1)
    expect(scheduled.indexOf('checkBusy(supabase, env)')).toBeGreaterThan(scheduled.indexOf('checkQueue(supabase, env)'))
    expect(read('apps/worker/wrangler.toml')).toContain('crons = ["*/5 * * * *"]')
  })
})
