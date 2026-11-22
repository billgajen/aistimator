import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PLATFORM_ADMIN_ROLE } from '@/lib/roles'
import { addressProxyCaller } from '@qolumns/shared'
import { quotePageLimit, tooManyPageResponse } from '@/lib/rate-limit-edge'

// Routes that require authentication
const PROTECTED_ROUTES = ['/app', '/setup']
// Routes that require admin role
const ADMIN_ROUTES = ['/admin']
// Routes that should redirect to /app if already authenticated
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password']
// T-173: choosing a new password needs the session the reset link gives
const RESET_ROUTE = '/reset-password'

/** `/app` and `/app/...`, never `/approve` or `/apple` */
export function underRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // T-178: the quote link page's rate limit is checked here, before anything
  // renders, so a blocked visitor gets a real 429 (the page could only answer
  // 200 with the words). Fails open like every public limit (AD-055).
  if (request.method === 'GET' && pathname.startsWith('/quote/')) {
    let limit
    try {
      // T-199: a visit through a business's own address is counted against the customer's own address
      const caller = addressProxyCaller(request.headers, process.env.ADDRESS_PROXY_KEY) ?? request.headers.get('x-forwarded-for')
      limit = await quotePageLimit(pathname, caller, request.headers.get('x-real-ip'))
    } catch {
      limit = null // a slug that cannot be decoded: the page itself answers "not found"
    }
    if (limit && !limit.allowed) return tooManyPageResponse(limit)
  }

  // Create Supabase client
  let response = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // Allow request to proceed without Supabase if not configured
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Check if route is protected
  // T-156: match whole path segments, so /approve (public) isn't caught by /app
  const isProtectedRoute = PROTECTED_ROUTES.some((route) => underRoute(pathname, route))
  const isAdminRoute = ADMIN_ROUTES.some((route) => underRoute(pathname, route))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname === route)

  // Redirect unauthenticated users from protected routes to login
  if ((isProtectedRoute || isAdminRoute) && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // T-173: without a session there is no password to change: ask for a new link
  if (pathname === RESET_ROUTE && !user) {
    return NextResponse.redirect(new URL('/forgot-password?notice=link-expired', request.url))
  }

  // Check admin role for admin routes
  if (isAdminRoute && user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== PLATFORM_ADMIN_ROLE) {
      // Redirect non-admin users to dashboard
      return NextResponse.redirect(new URL('/app', request.url))
    }
  }

  // Redirect authenticated users from auth routes to dashboard
  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/app', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
