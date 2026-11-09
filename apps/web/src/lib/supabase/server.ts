import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'

interface CookieToSet {
  name: string
  value: string
  options: CookieOptions
}

/**
 * Create a Supabase client for use in Server Components, Route Handlers, and Server Actions.
 * This client uses cookies for auth session management.
 *
 * T-137: a request carrying `Authorization: Bearer <Supabase access token>`
 * (the business mobile app) gets a client bound to that token instead: the
 * same user, the same row-level security, so every dashboard API works for
 * the app unchanged. Supabase verifies the token on `auth.getUser()`.
 */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  const bearer = bearerToken((await headers()).get('authorization'))
  if (bearer) return createBearerClient(supabaseUrl, supabaseAnonKey, bearer)

  const cookieStore = await cookies()


  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  })
}

/**
 * Create a Supabase admin client with service role key.
 * Use ONLY in trusted server contexts (API routes, background jobs).
 * Bypasses RLS - use with caution.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase admin environment variables')
  }

  return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * The access token from an `Authorization: Bearer` header, only when it is a
 * signed-in USER's token (JWT role "authenticated"). Anything else (a
 * service-role or anon key, garbage) is ignored, so a leaked key sent as a
 * bearer can never bypass row-level security. Supabase still verifies the
 * signature on auth.getUser().
 */
export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)
  if (!match) return null
  try {
    const payload = JSON.parse(Buffer.from(match[1]!.split('.')[1]!, 'base64url').toString('utf8')) as { role?: unknown }
    return payload.role === 'authenticated' ? match[1]! : null
  } catch {
    return null
  }
}

function createBearerClient(url: string, anonKey: string, token: string) {
  const client = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  // Existing routes call auth.getUser() with no argument (cookie style); bind
  // it to the bearer so every dashboard API works unchanged
  const getUser = client.auth.getUser.bind(client.auth)
  client.auth.getUser = (jwt?: string) => getUser(jwt ?? token)
  return client
}
