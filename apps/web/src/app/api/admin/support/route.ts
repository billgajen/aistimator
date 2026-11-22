import { NextResponse } from 'next/server'
import { verifyAdmin } from '@/lib/admin'
import { createAdminClient } from '@/lib/supabase/server'
import { listFeatures, listProblems, newSupportCount } from '@/lib/support-admin'
import { listQuestions, questionsToLookAt } from '@/lib/help-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/support           the inbox: problems by priority, feature requests by votes, and the count of new items
 * GET /api/admin/support?count=1   only the count (the admin menu)
 *
 * T-198: the questions put to the Help assistant come with it, and those the owner has still to look at
 * (a "not sure" answer, or a "No" from the business) are part of the count.
 *
 * T-197. Platform admin only. A business never reaches this: it reads every
 * business's reports.
 */
export async function GET(request: Request) {
  const admin = await verifyAdmin()
  if (!admin) return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, { status: 403 })
  try {
    const supabase = createAdminClient()
    if (new URL(request.url).searchParams.get('count')) {
      const [items, questions] = await Promise.all([newSupportCount(supabase), questionsToLookAt(supabase)])
      return NextResponse.json({ count: items + questions })
    }
    const [problems, features, count, questions, toLookAt] = await Promise.all([listProblems(supabase), listFeatures(supabase), newSupportCount(supabase), listQuestions(supabase), questionsToLookAt(supabase)])
    return NextResponse.json({ problems, features, questions, count: count + toLookAt })
  } catch (error) {
    console.error(`[Support] the inbox could not be read (${error instanceof Error ? error.name : 'error'})`)
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The inbox could not be loaded.' } }, { status: 500 })
  }
}
