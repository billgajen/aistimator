import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/quotes/[quoteId]
 * Get a single quote with all details including pricing trace
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await params
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Fetch quote with related data
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        service:services (
          id,
          name,
          description,
          work_steps,
          expected_signals
        )
      `)
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    return NextResponse.json({ quote })
  } catch (error) {
    console.error('Quote GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
