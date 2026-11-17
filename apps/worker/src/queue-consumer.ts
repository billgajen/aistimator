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
 */
import { LIMITER_TIMEOUT_MS } from './rate-limiter'
import type { RateLimitResult } from './rate-limiter'

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
  /** Runs the pricing pipeline for the job */
  process(job: Job, queueWaitMs: number | undefined): Promise<{ success: boolean; error?: string }>
  /** Marks the quote failed and tells the business (never throws) */
  markFailed(job: Job, error: string): Promise<void>
  maxRetries: number
  /** Seconds to wait before retry number `retryCount + 1` */
  backoffSeconds(retryCount: number): number
  limiterTimeoutMs?: number
}

export type JobOutcome = 'done' | 'requeued_over_limit' | 'retry' | 'failed'

/** One job from the queue: limit, process, then ack, retry or mark failed */
export async function handleQuoteJob<Job extends { quoteId: string; tenantId: string }>(
  message: JobMessage<Job>,
  deps: ConsumerDeps<Job>
): Promise<JobOutcome> {
  const job = message.body
  // Cloudflare counts deliveries (first = 1); the message body never changes
  const retryCount = message.attempts - 1
  console.log(`[Worker] Processing job: quoteId=${job.quoteId}, retry=${retryCount}/${deps.maxRetries}`)

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
    const queueWaitMs = message.timestamp ? Date.now() - message.timestamp.getTime() : undefined
    const result = await deps.process(job, queueWaitMs)
    if (result.success) {
      message.ack()
      return 'done'
    }
    error = result.error ?? 'Unknown error'
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : 'Unknown error'
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
