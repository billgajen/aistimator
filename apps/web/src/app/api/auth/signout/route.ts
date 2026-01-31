import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/auth/signout
 * Signs out the current user and redirects to the login page.
 */
export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'), {
    status: 302,
  })
}
