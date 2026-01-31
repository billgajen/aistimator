import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'

/**
 * POST /api/quotes/:quoteId/link
 * Generate a quote link. Only regenerates token if expired or force=true
 */
export async function POST(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const supabase = await createClient()

    // Check if force regenerate is requested
    let forceRegenerate = false
    try {
      const body = await request.json()
      forceRegenerate = body?.force === true
    } catch {
      // No body or invalid JSON - that's fine
    }

    // Verify authentication
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

    // Fetch quote with token info
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, status, quote_token_hash, token_expires_at')
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Check if quote is in a viewable status
    const viewableStatuses = ['sent', 'viewed', 'accepted', 'paid', 'expired']
    if (!viewableStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Quote is still ${quote.status}` } },
        { status: 400 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Check if existing token is still valid
    const tokenExpired = quote.token_expires_at && new Date(quote.token_expires_at) < new Date()
    const needsNewToken = !quote.quote_token_hash || tokenExpired || forceRegenerate

    if (!needsNewToken) {
      // Return URL without token (user must use existing token)
      // This prevents token regeneration on every "Copy Link" click
      return NextResponse.json({
        quoteId,
        quoteViewUrl: `${appUrl}/q/${quoteId}`,
        expiresAt: quote.token_expires_at,
        note: 'Use existing token. Add ?regenerate=true to force new token.',
      })
    }

    // Generate new token
    const { token, hash } = generateQuoteToken()
    const tokenExpiry = getTokenExpiry(30) // 30 days

    // Update quote with new token
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Failed to update quote token:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to generate link' } },
        { status: 500 }
      )
    }

    // Build quote URL with new token
    const quoteViewUrl = `${appUrl}/q/${quoteId}?token=${token}`

    return NextResponse.json({
      quoteId,
      quoteViewUrl,
      expiresAt: tokenExpiry.toISOString(),
    })
  } catch (error) {
    console.error('Generate link error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
