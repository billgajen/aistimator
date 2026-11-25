/**
 * T-178: what the queue consumer does with one quote job.
 *
 * It lives here, apart from the worker's entry file, so the rules can be
 * tested without a queue, a database or Upstash:
 *
 *   - The rate limiter can only ever delay a job that is over the limit. Any
 *     limiter error, or no answer within 2 seconds, means the quote is
 *     processed (the same rule as the website's limits, AD-055). The limiter
 *     is never the reason a quote fails or waits. Only the error's name is
 *     logged.
 *   - A job that fails is tried again with a growing wait; after the last
 *     try the quote is marked failed, which also tells the business
 *     (failed-quote.ts).
 *   - T-203: busy is not a failure. A run that ends with a model busy on
 *     every provider (`AiBusyError`, ai/busy.ts) is put back with a wait of
 *     its own (60 s, 90 s, then 120 s) and does NOT use up one of the real
 *     tries above. It is bounded: at most MAX_BUSY_REQUEUES times and
 *     BUSY_MAX_MINUTES from the request's arrival; after that the quote is
 *     marked failed like any other. Cloudflare counts every delivery, so how
 *     many of them were busy requeues is kept on the quote (busy-state.ts)
 *     and taken off the count of real tries.
 */
import { LIMITER_TIMEOUT_MS } from './rate-limiter'
import type { RateLimitResult } from './rate-limiter'
import { isAiBusyError } from './ai/busy'

/**
 * Real tries after the first: a job that fails is tried again this many
 * times. `max_retries` in wrangler.toml must be at least MAX_DELIVERY_RETRIES.
 */
export const MAX_RETRIES = 3
/** T-203: how many times a job may be put back because a model was busy on every provider */
export const MAX_BUSY_REQUEUES = 10
/** T-203: no busy requeue starts later than this many minutes after the request arrived */
export const BUSY_MAX_MINUTES = 15
/** Every delivery after the first that the code may ask for: `max_retries` in wrangler.toml must be >= this */
export const MAX_DELIVERY_RETRIES = MAX_RETRIES + MAX_BUSY_REQUEUES

/** T-203: seconds to wait before busy requeue number `requeues + 1`: 60, 90, then 120 */
export function busyRequeueSeconds(requeues: number): number {
  return requeues <= 0 ? 60 : requeues === 1 ? 90 : 120
}

/** T-203: what a quote's earlier runs met, kept on the quote between deliveries (busy-state.ts) */
export interface BusyState {
  /** Times the job was put back because a model was busy on every provider */
  requeues: number
  /** Busy retries and overflow calls of every run so far */
  busyRetries: number
  overflowCalls: number
  /** When it was last put back, and what that run alone used (the queue check counts by window) */
  lastAt?: string
  lastRun?: { busyRetries: number; overflowCalls: number }
}

export const NO_BUSY_STATE: BusyState = { requeues: 0, busyRetries: 0, overflowCalls: 0 }

/** The two calls the consumer makes on a limiter */
export interface LimiterLike {
  checkLimit(tenantId: string): Promise<RateLimitResult>
  increment(tenantId: string): Promise<void>
}

export type LimitDecision =
  | { proceed: true; failedOpen?: boolean }
  | { proceed: false; delaySeconds: number; limitType?: 'global' | 'tenant' }

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown error')

class LimiterTimeout extends Error {
  constructor() {
    super('the rate limiter did not answer in time')
    this.name = 'LimiterTimeout'
  }
}

/**
 * Ask the limiter whether this job may run now. Never throws and never takes
 * longer than `timeoutMs`: an error or a slow answer is "go ahead".
 */
export async function askLimiter(limiter: LimiterLike | null, tenantId: string, timeoutMs: number = LIMITER_TIMEOUT_MS): Promise<LimitDecision> {
  if (!limiter) return { proceed: true }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = (async (): Promise<LimitDecision> => {
      const result = await limiter.checkLimit(tenantId)
      if (!result.allowed) {
        return { proceed: false, delaySeconds: Math.min(result.resetIn + 5, 60), limitType: result.limitType }
      }
      await limiter.increment(tenantId)
      return { proceed: true }
    })()
    // an answer or an error that arrives after the time limit is nobody's business
    work.catch(() => undefined)
    const tooSlow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LimiterTimeout()), timeoutMs)
    })
    return await Promise.race([work, tooSlow])
  } catch (error) {
    // The name only: an error's message can carry an address or a key
    console.error(`[Worker] Rate limiter FAILING OPEN (${errorName(error)}): the quote is processed without it`)
    return { proceed: true, failedOpen: true }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The parts of a queue message the consumer uses */
export interface JobMessage<Job> {
  body: Job
  attempts: number
  timestamp?: Date
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export interface ConsumerDeps<Job> {
  limiter: LimiterLike | null
  /** Runs the pricing pipeline for the job. `busyBefore` is what its earlier runs met (T-203). */
  process(job: Job, queueWaitMs: number | undefined, busyBefore: BusyState): Promise<{ success: boolean; error?: string }>
  /** Marks the quote failed and tells the business (never throws) */
  markFailed(job: Job, error: string): Promise<void>
  maxRetries: number
  /** Seconds to wait before retry number `retryCount + 1` */
  backoffSeconds(retryCount: number): number
  limiterTimeoutMs?: number
  /**
   * T-203: where the count of busy requeues is kept between deliveries.
   * Neither call may throw. Without it a busy run is an ordinary failed try.
   */
  busy?: {
    read(job: Job): Promise<BusyState>
    save(job: Job, state: BusyState): Promise<void>
  }
  now?: () => number
}

export type JobOutcome = 'done' | 'requeued_over_limit' | 'requeued_busy' | 'retry' | 'failed'

/** One job from the queue: limit, process, then ack, retry or mark failed */
export async function handleQuoteJob<Job extends { quoteId: string; tenantId: string }>(
  message: JobMessage<Job>,
  deps: ConsumerDeps<Job>
): Promise<JobOutcome> {
  const job = message.body
  const now = deps.now ?? Date.now
  // T-203: deliveries that were busy requeues are not real tries
  const busyBefore = deps.busy ? await deps.busy.read(job) : NO_BUSY_STATE
  // Cloudflare counts deliveries (first = 1); the message body never changes
  const retryCount = Math.max(0, message.attempts - 1 - busyBefore.requeues)
  console.log(`[Worker] Processing job: quoteId=${job.quoteId}, retry=${retryCount}/${deps.maxRetries}${busyBefore.requeues > 0 ? `, busy requeues=${busyBefore.requeues}` : ''}`)

  const limit = await askLimiter(deps.limiter, job.tenantId, deps.limiterTimeoutMs)
  if (!limit.proceed) {
    console.log(`[Worker] Rate limited (${limit.limitType ?? 'limit'}): quote ${job.quoteId} requeued for ${limit.delaySeconds}s`)
    message.retry({ delaySeconds: limit.delaySeconds })
    return 'requeued_over_limit'
  }

  let error: string
  let apiRateLimit = false
  try {
    // Enqueue → now; diagnostics only (stored in pricing_trace_json.timings)
    const queueWaitMs = message.timestamp ? now() - message.timestamp.getTime() : undefined
    const result = await deps.process(job, queueWaitMs, busyBefore)
    if (result.success) {
      message.ack()
      return 'done'
    }
    error = result.error ?? 'Unknown error'
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : 'Unknown error'
    if (deps.busy && isAiBusyError(thrown)) {
      // T-203: a model was busy on every provider. Put the job back, within the two bounds.
      const arrivedAt = message.timestamp ? message.timestamp.getTime() : now()
      const secondsLeft = Math.floor((arrivedAt + BUSY_MAX_MINUTES * 60_000 - now()) / 1000)
      if (busyBefore.requeues < MAX_BUSY_REQUEUES && secondsLeft > 0) {
        const delaySeconds = Math.max(1, Math.min(busyRequeueSeconds(busyBefore.requeues), secondsLeft))
        const run = { busyRetries: thrown.counts?.busyRetries ?? 0, overflowCalls: thrown.counts?.overflowCalls ?? 0 }
        await deps.busy.save(job, {
          requeues: busyBefore.requeues + 1,
          busyRetries: busyBefore.busyRetries + run.busyRetries,
          overflowCalls: busyBefore.overflowCalls + run.overflowCalls,
          lastAt: new Date(now()).toISOString(),
          lastRun: run,
        })
        console.log(`[Worker] Quote ${job.quoteId}: a model was busy on every provider; put back #${busyBefore.requeues + 1} for ${delaySeconds}s (not counted as a try)`)
        message.retry({ delaySeconds })
        return 'requeued_busy'
      }
      error = `${error}; still busy after ${busyBefore.requeues} requeues and ${Math.round((now() - arrivedAt) / 60_000)} minutes`
      console.error(`[Worker] Quote ${job.quoteId} failed: ${error}`)
      await deps.markFailed(job, error)
      message.ack()
      return 'failed'
    }
    // an AI provider's own rate limit: wait longer before the next try
    apiRateLimit = error.includes('429') || error.includes('rate limit') || error.includes('quota')
  }

  if (retryCount >= deps.maxRetries) {
    console.error(`[Worker] Quote ${job.quoteId} failed after ${deps.maxRetries} retries: ${error}`)
    await deps.markFailed(job, error)
    message.ack() // off the queue: the quote is marked failed and the business has been told
    return 'failed'
  }
  const delaySeconds = apiRateLimit ? 60 : deps.backoffSeconds(retryCount)
  console.log(`[Worker] Quote ${job.quoteId} did not finish (${error}); retry #${retryCount + 1} in ${delaySeconds}s`)
  message.retry({ delaySeconds })
  return 'retry'
}
