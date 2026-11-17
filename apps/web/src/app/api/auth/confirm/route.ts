import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import type { AuthLinkType } from '@/lib/auth-flow'

export const dynamic = 'force-dynamic'

const AFTER: Record<AuthLinkType, { ok: string; failed: string }> = {
  signup: { ok: '/app', failed: '/login?notice=link-expired' },
  recovery: { ok: '/reset-password', failed: '/forgot-password?notice=link-expired' },
}

/**
 * POST /api/auth/confirm  (T-173)
 * Use the link from an account email. It is a POST from the button on
 * /auth/confirm, never a GET: mail scanners open every link in an email, and
 * a link that worked on being opened would be used up before the person saw it.
 * Where it sends the person next is fixed here; nothing in the request picks it.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const type = form?.get('type')
  const tokenHash = form?.get('token_hash')
  const kind: AuthLinkType | null = type === 'signup' || type === 'recovery' ? type : null
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), { status: 303 })

  if (!kind || typeof tokenHash !== 'string' || !/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) {
    return to('/login?notice=link-expired')
  }

  // By address only: the link itself is single-use
  const rate = await checkRateLimit('login', { ip: getClientIp(request) })
  if (!rate.allowed) return to('/login?notice=too-many')

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: kind, token_hash: tokenHash })
  if (error) return to(AFTER[kind].failed)
  return to(AFTER[kind].ok)
}
