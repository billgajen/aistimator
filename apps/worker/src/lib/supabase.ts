import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Create a Supabase admin client for the worker.
 * Uses service role key to bypass RLS (for background job processing).
 */
export function createSupabaseClient(env: {
  SUPABASE_URL?: string
  SUPABASE_SERVICE_KEY?: string
}): SupabaseClient {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing Supabase environment variables in worker')
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
