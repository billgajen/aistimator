/**
 * Supabase client for the Worker
 *
 * Uses the service role key for admin access to update quote statuses.
 */

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

let supabaseClient: SupabaseClient | null = null

/**
 * Get or create Supabase admin client
 */
export function getSupabaseClient(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined
): SupabaseClient | null {
  if (!supabaseUrl || !supabaseKey) {
    console.error('[Supabase] Missing URL or service key')
    return null
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return supabaseClient
}

/**
 * Quote status values
 */
export type QuoteStatus = 'queued' | 'generating' | 'sent' | 'failed' | 'viewed' | 'accepted' | 'paid'

/**
 * Update quote status with optional error message
 */
export async function updateQuoteStatus(
  client: SupabaseClient,
  quoteId: string,
  status: QuoteStatus,
  errorMessage?: string
): Promise<boolean> {
  const updateData: Record<string, unknown> = { status }

  if (status === 'failed' && errorMessage) {
    // Store error in content_json for debugging
    const { data: quote } = await client
      .from('quotes')
      .select('content_json')
      .eq('id', quoteId)
      .single()

    const contentJson = (quote?.content_json as Record<string, unknown>) || {}
    updateData.content_json = {
      ...contentJson,
      error: errorMessage,
      failedAt: new Date().toISOString(),
    }
  }

  if (status === 'sent') {
    updateData.sent_at = new Date().toISOString()
  }

  const { error } = await client.from('quotes').update(updateData).eq('id', quoteId)

  if (error) {
    console.error(`[Supabase] Failed to update quote ${quoteId} status:`, error)
    return false
  }

  return true
}

/**
 * Get quote with request details for processing
 */
export async function getQuoteWithRequest(
  client: SupabaseClient,
  quoteId: string
): Promise<{
  quote: Record<string, unknown>
  quoteRequest: Record<string, unknown>
  tenant: Record<string, unknown>
  service: Record<string, unknown>
} | null> {
  const { data: quote, error: quoteError } = await client
    .from('quotes')
    .select(
      `
      *,
      quote_requests!quote_request_id (*),
      tenants!tenant_id (
        id,
        name,
        currency,
        tax_enabled,
        tax_label,
        tax_rate
      ),
      services!service_id (
        id,
        name,
        base_description,
        document_type_default
      )
    `
    )
    .eq('id', quoteId)
    .single()

  if (quoteError || !quote) {
    console.error(`[Supabase] Failed to fetch quote ${quoteId}:`, quoteError)
    return null
  }

  return {
    quote,
    quoteRequest: quote.quote_requests as Record<string, unknown>,
    tenant: quote.tenants as Record<string, unknown>,
    service: quote.services as Record<string, unknown>,
  }
}

/**
 * Get assets for a quote request
 */
export async function getQuoteAssets(
  client: SupabaseClient,
  quoteRequestId: string
): Promise<Array<Record<string, unknown>>> {
  const { data: assets, error } = await client
    .from('assets')
    .select('*')
    .eq('quote_request_id', quoteRequestId)

  if (error) {
    console.error(`[Supabase] Failed to fetch assets for request ${quoteRequestId}:`, error)
    return []
  }

  return assets || []
}
