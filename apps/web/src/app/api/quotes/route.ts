import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { QUOTE_GROUP_STATUSES, QUOTE_LIST_GROUPS, defaultQuoteListGroup } from '@estimator/shared'
import type { QuoteListCounts, QuoteListGroup, QuoteListItem, QuotesListResponse, QuoteStatus } from '@estimator/shared'

const VALID_STATUSES: QuoteStatus[] = [
  'queued',
  'generating',
  'pending_review',
  'awaiting_clarification',
  'sent',
  'viewed',
  'feedback_received',
  'revised',
  'accepted',
  'declined', // T-158: was missing, so a declined filter returned everything
  'paid',
  'expired',
  'failed',
]

/** Unfinished requests are counted over the same window the Unfinished tab lists (GET /api/leads) */
const UNFINISHED_WINDOW_DAYS = 30

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Customer name or email contains the search text.
 * T-158: the filter read the JSON value (`->`), which Postgres cannot match
 * with ilike, so every search answered 500. It reads the text (`->>`) now, and
 * the value is quoted so a comma or a bracket in the search stays part of it.
 */
function searchFilter(search: string): string {
  const value = `"%${search.replace(/["\\]/g, '\\$&')}%"`
  return `customer_json->>name.ilike.${value},customer_json->>email.ilike.${value}`
}

/**
 * T-158: how many quotes each tab holds, for this tenant only. The quote
 * counts follow the search text so a tab's number matches what it lists.
 */
async function countTabs(supabase: Supabase, tenantId: string, search: string): Promise<QuoteListCounts | null> {
  const countQuotes = async (statuses: readonly QuoteStatus[] | null) => {
    let query = supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    if (statuses) query = query.in('status', statuses as QuoteStatus[])
    if (search) query = query.or(searchFilter(search))
    const { count, error } = await query
    // A failed count has no body to read, so a missing number is a failure too
    if (error || count === null) throw error ?? new Error('count failed')
    return count
  }
  const countUnfinished = async () => {
    const since = new Date(Date.now() - UNFINISHED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { count, error } = await supabase
      .from('request_leads')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('completed_at', null)
      .gte('created_at', since)
    if (error || count === null) throw error ?? new Error('count failed')
    return count
  }

  try {
    const [needsYou, waiting, accepted, closed, all, unfinished] = await Promise.all([
      countQuotes(QUOTE_GROUP_STATUSES.needs_you),
      countQuotes(QUOTE_GROUP_STATUSES.waiting),
      countQuotes(QUOTE_GROUP_STATUSES.accepted),
      countQuotes(QUOTE_GROUP_STATUSES.closed),
      countQuotes(null),
      countUnfinished(),
    ])
    return { needs_you: needsYou, waiting, accepted, closed, all, unfinished }
  } catch (error) {
    console.error('Error counting quotes:', error)
    return null
  }
}

/**
 * GET /api/quotes
 * List quotes for the current tenant.
 *
 * Query: search, status, limit, cursor, and (T-158) group:
 *   needs_you | waiting | accepted | closed | all  filter by whose turn it is
 *   default                                        needs_you when it has any, otherwise all
 * With `group` the response also carries the tab counts and the group used.
 * Without it the route behaves as before (every quote; the mobile app's call).
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()

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
    const tenantId: string = profile.tenant_id

    // Parse query parameters
    const url = new URL(request.url)
    const search = url.searchParams.get('search')?.trim() || ''
    const status = url.searchParams.get('status') as QuoteStatus | null
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
    const cursor = url.searchParams.get('cursor')
    const groupParam = url.searchParams.get('group')

    if (groupParam !== null && groupParam !== 'default' && !(QUOTE_LIST_GROUPS as readonly string[]).includes(groupParam)) {
      return NextResponse.json(
        { error: { code: 'INVALID_GROUP', message: 'Unknown group' } },
        { status: 400 }
      )
    }

    // T-158: the counts come back in the same request as the list
    let counts: QuoteListCounts | null = null
    let group: QuoteListGroup | null = null
    if (groupParam !== null) {
      counts = await countTabs(supabase, tenantId, search)
      if (!counts) {
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to fetch quotes' } },
          { status: 500 }
        )
      }
      group = groupParam === 'default' ? defaultQuoteListGroup(counts) : (groupParam as QuoteListGroup)
    }

    // Build query
    let query = supabase
      .from('quotes')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        viewed_at,
        accepted_at,
        paid_at,
        declined_at,
        token_expires_at,
        customer_json,
        pricing_json,
        is_test,
        held:content_json->limitHold,
        services!service_id (
          id,
          name
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit + 1) // Fetch one extra to check for more

    // T-158: filter by whose turn it is
    if (group && group !== 'all') {
      query = query.in('status', QUOTE_GROUP_STATUSES[group] as QuoteStatus[])
    }

    // Apply status filter
    if (status && VALID_STATUSES.includes(status)) {
      query = query.eq('status', status)
    }

    // Apply cursor for pagination
    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    // Apply search filter (customer name or email)
    if (search) {
      query = query.or(searchFilter(search))
    }

    const { data: quotes, error: quotesError } = await query

    if (quotesError) {
      console.error('Error fetching quotes:', quotesError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch quotes' } },
        { status: 500 }
      )
    }

    // Check if there are more results
    const hasMore = quotes && quotes.length > limit
    const items = quotes?.slice(0, limit) || []

    // Transform to response format
    const responseItems: QuoteListItem[] = items.map((quote) => {
      const customer = quote.customer_json as { name: string; email: string } | null
      const pricing = quote.pricing_json as { total: number; currency: string } | null
      // Supabase returns single relation as object, not array
      const service = quote.services as unknown as { id: string; name: string } | null
      const row = quote as unknown as { is_test?: boolean; declined_at?: string | null; token_expires_at?: string | null; held?: unknown }

      return {
        quoteId: quote.id,
        serviceName: service?.name || 'Unknown Service',
        customerName: customer?.name || 'Unknown',
        customerEmail: customer?.email || '',
        status: quote.status as QuoteStatus,
        isTest: row.is_test === true,
        createdAt: quote.created_at,
        sentAt: quote.sent_at,
        viewedAt: quote.viewed_at,
        acceptedAt: quote.accepted_at,
        paidAt: quote.paid_at,
        declinedAt: row.declined_at ?? null,
        expiresAt: row.token_expires_at ?? null,
        held: row.held === true,
        total: pricing?.total || 0,
        currency: pricing?.currency || 'GBP',
      }
    })

    // Get next cursor if there are more results
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? lastItem.created_at : null

    const response: QuotesListResponse = {
      items: responseItems,
      nextCursor,
      ...(counts && group && { counts, group }),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Quotes list error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
