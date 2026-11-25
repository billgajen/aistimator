/**
 * T-203: a busy AI provider is waited for, not failed on.
 *
 * Before this a provider's "busy" answer was treated like any other error.
 * Most calls caught it and carried on with their fallback (a quote priced
 * without its photos being read, template wording), and the rest threw, so
 * the whole job started again a minute later. With many requests arriving at
 * once, busy answers are the normal case, not a fault.
 *
 * Now every client the worker makes (`createAiClient`, ai/factory.ts) is
 * wrapped in `BusyRetryClient`:
 *
 *   1. A busy answer is retried in place: wait about 2 s, 5 s, then 10 s
 *      (each with random jitter, so jobs that were refused together do not
 *      come back together), honouring the provider's Retry-After when it
 *      sends one. Everything the job has already done is kept.
 *   2. Still busy after those tries: that one call goes to the task's
 *      overflow model (the registry's `overflow`, a second provider), if the
 *      task has one and its key is set.
 *   3. Busy there too (or the overflow model failed in any way of its own:
 *      its fault is never a worse result than having no overflow): the call
 *      rejects with `AiBusyError` and the task is
 *      marked in the quote's `AiBusyLog`. The pipeline's callers handle the
 *      rejection as they handle any failed call, and the processor then stops
 *      at its next checkpoint (`throwIfExhausted`), so nothing is saved from a
 *      run in which a model could not be reached. The queue consumer puts the
 *      job back without using up one of its real tries (queue-consumer.ts).
 *
 * "Busy" is HTTP 429 or 503 (529 from Anthropic), RESOURCE_EXHAUSTED, or an
 * "overloaded" answer. Any other error is thrown as before, untouched.
 *
 * Nothing here throttles: there is no token bucket and no shared counter
 * (the worker's limiter stays off, AD-060). And nothing here can change a
 * price: the same call is asked again, of the same model or of the overflow
 * one, and its answer goes through the same checks as before.
 *
 * The T-172 caps (ai/timeouts.ts) sit outside this: when a call's cap runs
 * out during a wait, the caller has already moved on to its fallback.
 */
import type { AiTask, ModelRoute } from '@qolumns/shared'
import type { AiClient, GenerationOptions, ImageInput } from './client'

/** The waits before retry 1, 2 and 3 of a busy call, before jitter */
export const BUSY_WAITS_MS: readonly number[] = [2_000, 5_000, 10_000]
/** Each wait is its base time, 25% shorter to 25% longer */
export const BUSY_JITTER = 0.25
/**
 * A provider that asks for a longer wait than this is not waited for: the
 * call goes straight to the overflow model (or is reported busy).
 */
export const RETRY_AFTER_MAX_MS = 15_000
/** Added on top of a provider's own Retry-After, at random, so calls refused together spread out */
export const RETRY_AFTER_SPREAD_MS = 1_000

/** Is this error answer from a provider a "busy" one? */
export function isBusyAnswer(status: number | undefined, body: string): boolean {
  if (status === 429 || status === 503 || status === 529) return true
  return /RESOURCE_EXHAUSTED/.test(body) || /overloaded/i.test(body)
}

/**
 * A Retry-After header as milliseconds from `now`: a number of seconds, or an
 * HTTP date. Undefined when there is none or it cannot be read.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000)
  const at = Date.parse(text)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}

/**
 * Google answers a quota error with a `RetryInfo` detail ("retryDelay": "17s")
 * in the body; it is the same request as a Retry-After header.
 */
export function retryDelayFromBody(body: string): number | undefined {
  const found = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)
  return found ? Math.round(Number(found[1]) * 1000) : undefined
}

/**
 * An error answer from a provider, with what the retry needs to know. Its
 * message is the one the provider client threw before T-203, so code that
 * reads the message keeps working.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly busy: boolean,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

export function isBusyError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError && error.busy
}

/**
 * Thrown when a call was busy on every provider the task has. It carries the
 * task's name and nothing from the request.
 */
export class AiBusyError extends Error {
  /** What this run of the quote used, filled in by the processor's checkpoint */
  counts?: { busyRetries: number; overflowCalls: number }
  constructor(
    readonly task: AiTask,
    readonly overflowTried: boolean
  ) {
    super(`AI busy: ${task} could not be reached (${overflowTried ? 'its own model and the overflow model' : 'its own model; no overflow'})`)
    this.name = 'AiBusyError'
  }
}

/** True for an AiBusyError, also one that crossed a module boundary */
export function isAiBusyError(error: unknown): error is AiBusyError {
  return error instanceof AiBusyError || (error instanceof Error && error.name === 'AiBusyError')
}

/**
 * What one run of one quote met: how many busy retries it made, how many
 * calls went to an overflow model, and which tasks ended busy everywhere.
 * One log is shared by every client the run makes.
 */
export class AiBusyLog {
  busyRetries = 0
  overflowCalls = 0
  private readonly exhausted = new Map<AiTask, boolean>()

  noteRetry(): void {
    this.busyRetries += 1
  }

  noteOverflow(): void {
    this.overflowCalls += 1
  }

  noteExhausted(task: AiTask, overflowTried: boolean): void {
    this.exhausted.set(task, overflowTried)
  }

  isExhausted(task: AiTask): boolean {
    return this.exhausted.has(task)
  }

  get exhaustedTasks(): AiTask[] {
    return [...this.exhausted.keys()]
  }

  /**
   * The processor's checkpoint: if any call of this run ended busy on every
   * provider, stop here. Nothing has been saved or sent yet.
   */
  throwIfExhausted(): void {
    const first = this.exhausted.entries().next().value as [AiTask, boolean] | undefined
    if (!first) return
    const error = new AiBusyError(first[0], first[1])
    error.counts = { busyRetries: this.busyRetries, overflowCalls: this.overflowCalls }
    throw error
  }
}

/**
 * How long to wait before retry number `attempt + 1`, or null for "do not
 * wait for this provider any longer".
 */
export function busyWaitMs(
  attempt: number,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
  waitsMs: readonly number[] = BUSY_WAITS_MS
): number | null {
  const base = waitsMs[attempt]
  if (base === undefined) return null
  const jittered = Math.round(base * (1 - BUSY_JITTER + random() * 2 * BUSY_JITTER))
  if (retryAfterMs === undefined) return jittered
  if (retryAfterMs > RETRY_AFTER_MAX_MS) return null
  return Math.max(jittered, Math.round(retryAfterMs + random() * RETRY_AFTER_SPREAD_MS))
}

/** A wait that ends early, with the signal's own reason, when the call is cancelled */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface BusyRetryOptions {
  task: AiTask
  /** The quote's log; calls made outside a quote (the support inbox) have none */
  log?: AiBusyLog
  /** The task's overflow client, made only when it is first needed; null when the task has none */
  overflow?: () => AiClient | null
  waitsMs?: readonly number[]
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

/** An AiClient that waits for a busy provider and then tries the overflow one */
export class BusyRetryClient implements AiClient {
  readonly route: ModelRoute
  private overflowClient: AiClient | null | undefined

  constructor(
    private readonly primary: AiClient,
    private readonly options: BusyRetryOptions
  ) {
    this.route = primary.route
  }

  generateText(prompt: string, systemPrompt?: string): Promise<string> {
    return this.call((client) => client.generateText(prompt, systemPrompt))
  }

  generateWithImages(prompt: string, images: ImageInput[], systemPrompt?: string): Promise<string> {
    return this.call((client) => client.generateWithImages(prompt, images, systemPrompt))
  }

  generateWithSchema<T>(prompt: string, schema: Record<string, unknown>, systemPrompt?: string): Promise<T> {
    return this.call((client) => client.generateWithSchema<T>(prompt, schema, systemPrompt))
  }

  generateWithImagesAndSchema<T>(
    prompt: string,
    images: ImageInput[],
    schema: Record<string, unknown>,
    systemPrompt?: string,
    options?: GenerationOptions
  ): Promise<T> {
    return this.call((client) => client.generateWithImagesAndSchema<T>(prompt, images, schema, systemPrompt, options), options?.signal)
  }

  private overflow(): AiClient | null {
    if (this.overflowClient === undefined) this.overflowClient = this.options.overflow?.() ?? null
    return this.overflowClient
  }

  private async call<T>(run: (client: AiClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const { task, log } = this.options
    // This run has already found the task busy everywhere: a second call (a
    // caller's own "try the other way") does not wait all over again
    if (log?.isExhausted(task)) throw new AiBusyError(task, this.overflow() !== null)

    const wait = this.options.sleep ?? sleep
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(this.primary)
      } catch (error) {
        if (!isBusyError(error) || signal?.aborted) throw error
        const ms = busyWaitMs(attempt, error.retryAfterMs, this.options.random, this.options.waitsMs)
        if (ms === null) break
        log?.noteRetry()
        // The task, the provider and the wait: nothing of the request
        console.warn(`[AI] ${task}: ${this.route.provider} is busy (${error.status ?? 'no status'}); retry ${attempt + 1} in ${ms} ms`)
        await wait(ms, signal)
      }
    }

    const overflow = this.overflow()
    if (overflow) {
      log?.noteOverflow()
      console.warn(`[AI] ${task}: ${this.route.provider} is still busy; this call goes to the overflow model (${overflow.route.provider})`)
      try {
        return await run(overflow)
      } catch (error) {
        if (signal?.aborted) throw error
        // Busy there too, or the overflow model failed in some way of its own. Either way
        // the task's own model was busy, and an overflow model's fault must never give a
        // worse result than having no overflow: the call is "busy", and the job is put back.
        // The error's name and status only: a message can repeat the request.
        if (!isBusyError(error)) {
          const status = error instanceof AiProviderError ? error.status : (error as { status?: unknown } | null)?.status
          console.error(`[AI] ${task}: the overflow model failed (${error instanceof Error ? error.name : 'unknown error'}${typeof status === 'number' ? ` ${status}` : ''}); treated as busy`)
        }
      }
    }
    log?.noteExhausted(task, overflow !== null)
    console.warn(`[AI] ${task}: busy on ${overflow ? 'both providers' : `${this.route.provider}, and the task has no overflow`}`)
    throw new AiBusyError(task, overflow !== null)
  }
}
