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

/**
 * Enqueue a quote generation job.
 *
 * In development mode (NODE_ENV=development or SYNC_QUOTE_PROCESSING=true),
 * processes the quote directly via /process endpoint.
 * In production, sends to /trigger which queues for async processing.
 */
export async function enqueueQuoteJob(job: QuoteJobMessage): Promise<void> {
  const workerUrl = getWorkerUrl()

  // In development or if worker not configured, just log
  if (!workerUrl) {
    console.log('[Queue] Worker URL not configured, logging job:', JSON.stringify(job))
    console.log('[Queue] Set CLOUDFLARE_WORKER_URL to enable queue processing')
    return
  }

  // Use direct processing in development (queues don't work locally)
  const useDirectProcessing = process.env.NODE_ENV === 'development' || process.env.SYNC_QUOTE_PROCESSING === 'true'
  const endpoint = useDirectProcessing ? '/process' : '/trigger'

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add auth token if configured
    const workerToken = getWorkerToken()
    if (workerToken) {
      headers['Authorization'] = `Bearer ${workerToken}`
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
    console.error('[Queue] Error processing job:', error)
    // Don't throw - we don't want to fail the quote request if queueing fails
    // The quote is already created with 'queued' status and can be retried
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
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}
