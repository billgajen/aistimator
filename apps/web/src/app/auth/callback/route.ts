import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Auth callback handler for OAuth and magic links.
 * Exchanges the code for a session and redirects to the app.
 *
 * Note: Tenant and user_profile are created automatically via database trigger
 * when the user signs up, so we can always redirect to /app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Same-site paths only: "//host" or "@host" would turn `${origin}${next}` into another site
  const requested = searchParams.get('next') ?? '/app'
  const next = /^\/(?![/\\])[^@]*$/.test(requested) ? requested : '/app'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return to login on error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
