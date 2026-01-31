/**
 * Estimator Queue Consumer Worker
 *
 * This worker processes quote generation jobs from the Cloudflare Queue.
 * It applies rate limiting, runs AI extraction, applies pricing rules,
 * and updates quote status.
 */

import { createRateLimiter } from './rate-limiter'
import type { RateLimiter } from './rate-limiter'
import { getSupabaseClient, updateQuoteStatus } from './supabase'
import { processQuote } from './quote-processor'

export interface Env {
  // Queue bindings
  QUOTE_JOBS: Queue

  // R2 bucket for assets
  ASSETS?: R2Bucket

  // Environment variables
  ENVIRONMENT?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_KEY?: string
  UPSTASH_REDIS_URL?: string
  UPSTASH_REDIS_TOKEN?: string
  GEMINI_API_KEY?: string

  // Email (Postmark)
  POSTMARK_API_TOKEN?: string
  POSTMARK_FROM_EMAIL?: string
  APP_URL?: string

  // Rate limit configuration (optional overrides)
  RATE_LIMIT_GLOBAL?: string
  RATE_LIMIT_TENANT?: string

  // R2 S3-compatible API (for dev mode fallback)
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET_NAME?: string
}

// Queue message type
export interface QuoteJobMessage {
  quoteId: string
  quoteRequestId: string
  tenantId: string
  timestamp: number
  retryCount?: number
  /** Plain text token for quote view URL (needed for email links) */
  quoteToken?: string
}

// Maximum retries before marking as failed
const MAX_RETRIES = 3

// Base delay for exponential backoff (seconds)
const BASE_DELAY_SECONDS = 30

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(retryCount: number): number {
  // Exponential backoff: 30s, 60s, 120s
  return BASE_DELAY_SECONDS * Math.pow(2, retryCount)
}

/**
 * Process a single quote job using the quote processor
 */
async function processQuoteJob(
  job: QuoteJobMessage,
  supabase: ReturnType<typeof getSupabaseClient>,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const { quoteId, quoteRequestId, quoteToken } = job

  // Update status to 'generating'
  await updateQuoteStatus(supabase!, quoteId, 'generating')

  // Process the quote using the full pipeline
  const result = await processQuote(quoteId, quoteRequestId, supabase!, env, quoteToken)

  return {
    success: result.success,
    error: result.error,
  }
}

export default {
  // HTTP handler (for health checks and manual triggers)
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check endpoint
    if (url.pathname === '/health') {
      const rateLimiter = createRateLimiter(env.UPSTASH_REDIS_URL, env.UPSTASH_REDIS_TOKEN)

      return new Response(
        JSON.stringify({
          status: 'ok',
          env: env.ENVIRONMENT || 'unknown',
          hasRedis: !!rateLimiter,
          hasSupabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY),
          hasGemini: !!env.GEMINI_API_KEY,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Rate limit stats endpoint (for monitoring)
    if (url.pathname === '/stats' && request.method === 'GET') {
      const rateLimiter = createRateLimiter(env.UPSTASH_REDIS_URL, env.UPSTASH_REDIS_TOKEN)
      if (!rateLimiter) {
        return new Response(JSON.stringify({ error: 'Redis not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const tenantId = url.searchParams.get('tenantId')
      const stats = await rateLimiter.getStats(tenantId || undefined)

      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Manual job trigger endpoint (for testing)
    if (url.pathname === '/trigger' && request.method === 'POST') {
      try {
        const body = (await request.json()) as QuoteJobMessage

        if (!body.quoteId || !body.quoteRequestId || !body.tenantId) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: quoteId, quoteRequestId, tenantId' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }

        // Enqueue the job
        await env.QUOTE_JOBS.send(body)

        return new Response(JSON.stringify({ success: true, message: 'Job enqueued' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid request body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Direct processing endpoint (for development - bypasses queue)
    if (url.pathname === '/process' && request.method === 'POST') {
      const supabase = getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
      if (!supabase) {
        return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      try {
        const body = (await request.json()) as QuoteJobMessage

        if (!body.quoteId || !body.quoteRequestId) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: quoteId, quoteRequestId' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }

        console.log(`[Worker] Direct processing: quoteId=${body.quoteId}`)

        // Update status to 'generating'
        await updateQuoteStatus(supabase, body.quoteId, 'generating')

        // Process the quote directly
        const result = await processQuote(body.quoteId, body.quoteRequestId, supabase, env, body.quoteToken)

        if (result.success) {
          return new Response(
            JSON.stringify({
              success: true,
              pricing: result.pricing,
              message: 'Quote processed successfully',
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        } else {
          await updateQuoteStatus(supabase, body.quoteId, 'failed', result.error)
          return new Response(
            JSON.stringify({ success: false, error: result.error }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('[Worker] Process error:', errorMessage)
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Estimator Worker', { status: 200 })
  },

  // Queue consumer handler
  async queue(batch: MessageBatch<QuoteJobMessage>, env: Env): Promise<void> {
    // Initialize services
    const rateLimiter: RateLimiter | null = createRateLimiter(
      env.UPSTASH_REDIS_URL,
      env.UPSTASH_REDIS_TOKEN,
      {
        globalLimit: env.RATE_LIMIT_GLOBAL ? parseInt(env.RATE_LIMIT_GLOBAL, 10) : 100,
        tenantLimit: env.RATE_LIMIT_TENANT ? parseInt(env.RATE_LIMIT_TENANT, 10) : 10,
      }
    )

    const supabase = getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)

    if (!supabase) {
      console.error('[Worker] Supabase not configured, retrying all messages')
      batch.retryAll()
      return
    }

    for (const message of batch.messages) {
      const job = message.body
      const retryCount = job.retryCount || 0

      console.log(
        `[Worker] Processing job: quoteId=${job.quoteId}, retry=${retryCount}/${MAX_RETRIES}`
      )

      try {
        // Check rate limits if Redis is configured
        if (rateLimiter) {
          const limitResult = await rateLimiter.checkLimit(job.tenantId)

          if (!limitResult.allowed) {
            console.log(
              `[Worker] Rate limited (${limitResult.limitType}): ` +
                `${limitResult.current}/${limitResult.limit}, reset in ${limitResult.resetIn}s`
            )

            // Requeue with delay based on reset time
            message.retry({
              delaySeconds: Math.min(limitResult.resetIn + 5, 60),
            })
            continue
          }

          // Increment counters before processing
          await rateLimiter.increment(job.tenantId)
        }

        // Process the quote
        const result = await processQuoteJob(job, supabase, env)

        if (result.success) {
          message.ack()
        } else {
          // Check if we should retry or fail permanently
          if (retryCount >= MAX_RETRIES) {
            console.error(
              `[Worker] Quote ${job.quoteId} failed after ${MAX_RETRIES} retries: ${result.error}`
            )
            await updateQuoteStatus(supabase, job.quoteId, 'failed', result.error)
            message.ack() // Ack to remove from queue, we've marked it failed
          } else {
            // Retry with exponential backoff
            const delaySeconds = getBackoffDelay(retryCount)
            console.log(`[Worker] Retrying quote ${job.quoteId} in ${delaySeconds}s`)

            message.retry({
              delaySeconds,
            })

            // Note: The retry will use the original message body.
            // Cloudflare Queues tracks retries internally.
            console.log(`[Worker] Scheduled retry #${retryCount + 1} for quote ${job.quoteId}`)
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[Worker] Error processing quote ${job.quoteId}:`, errorMessage)

        // Check for rate limit errors from external APIs
        const isRateLimitError =
          errorMessage.includes('429') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('quota')

        if (isRateLimitError) {
          // Longer delay for API rate limits
          console.log(`[Worker] API rate limit hit, retrying in 60s`)
          message.retry({ delaySeconds: 60 })
        } else if (retryCount >= MAX_RETRIES) {
          console.error(`[Worker] Quote ${job.quoteId} permanently failed: ${errorMessage}`)
          await updateQuoteStatus(supabase, job.quoteId, 'failed', errorMessage)
          message.ack()
        } else {
          // Standard retry with backoff
          const delaySeconds = getBackoffDelay(retryCount)
          message.retry({ delaySeconds })
        }
      }
    }
  },
}
