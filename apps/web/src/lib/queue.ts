/**
 * Queue service for enqueuing quote generation jobs.
 *
 * In production, this sends messages to the Cloudflare Worker
 * which handles the queue processing.
 */

export interface QuoteJobMessage {
  quoteId: string
  quoteRequestId: string
  tenantId: string
  timestamp: number
  /** Plain text token for quote view URL (needed for email links) */
  quoteToken?: string
}

/**
 * Get the worker URL from environment
 */
function getWorkerUrl(): string | null {
  return process.env.CLOUDFLARE_WORKER_URL || null
}

/**
 * Get the worker auth token from environment
 */
function getWorkerToken(): string | null {
  return process.env.CLOUDFLARE_WORKER_TOKEN || null
}

/** Bearer header for the worker's job endpoints (the worker rejects requests without it) */
function workerAuthHeaders(): Record<string, string> {
  const token = getWorkerToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Sync = the request waits while the worker runs the whole pipeline (/process).
 * Async = /trigger enqueues and returns at once; the queue consumer prices it.
 * SYNC_QUOTE_PROCESSING decides when set ("true"/"false"); unset, local dev
 * is sync and production is async.
 */
export function isSyncProcessing(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.SYNC_QUOTE_PROCESSING?.trim().toLowerCase()
  if (flag === 'true') return true
  if (flag === 'false') return false
  return env.NODE_ENV === 'development'
}

/**
 * Enqueue a quote generation job — direct /process when sync, /trigger
 * (Cloudflare Queue) when async. See isSyncProcessing.
 */
export async function enqueueQuoteJob(job: QuoteJobMessage): Promise<void> {
  const workerUrl = getWorkerUrl()

  // In development or if worker not configured, just log
  if (!workerUrl) {
    console.log('[Queue] Worker URL not configured, logging job:', JSON.stringify(job))
    console.log('[Queue] Set CLOUDFLARE_WORKER_URL to enable queue processing')
    return
  }

  const useDirectProcessing = isSyncProcessing()
  const endpoint = useDirectProcessing ? '/process' : '/trigger'

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...workerAuthHeaders(),
    }

    console.log(`[Queue] Sending job to ${workerUrl}${endpoint}`)
    const response = await fetch(`${workerUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(job),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`[Queue] Failed to process job: ${response.status} ${errorBody}`)
      throw new Error(`Queue processing failed: ${response.status}`)
    }

    const result = await response.json()
    console.log(`[Queue] Job ${useDirectProcessing ? 'processed' : 'enqueued'} successfully:`, result)
  } catch (error) {
    console.error('[Queue] Error dispatching job:', error)
    // Re-throw so the caller knows the queue dispatch failed
    // Without this, the API returns success but the quote is stuck at 'queued' forever
    throw error
  }
}

/**
 * Check the health of the queue worker
 */
export async function checkQueueHealth(): Promise<{
  healthy: boolean
  details?: Record<string, unknown>
}> {
  const workerUrl = getWorkerUrl()

  if (!workerUrl) {
    return { healthy: false, details: { error: 'Worker URL not configured' } }
  }

  try {
    const response = await fetch(`${workerUrl}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return { healthy: false, details: { error: `HTTP ${response.status}` } }
    }

    const details = await response.json()
    return { healthy: true, details }
  } catch (error) {
    return {
      healthy: false,
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    }
  }
}

/**
 * Get rate limit stats from the worker (for monitoring)
 */
export async function getQueueStats(
  tenantId?: string
): Promise<Record<string, unknown> | null> {
  const workerUrl = getWorkerUrl()

  if (!workerUrl) {
    return null
  }

  try {
    const url = tenantId
      ? `${workerUrl}/stats?tenantId=${encodeURIComponent(tenantId)}`
      : `${workerUrl}/stats`

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
    })

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}
