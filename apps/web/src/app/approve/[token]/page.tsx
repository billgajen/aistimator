import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { loadApprovalLink } from '@/lib/approval-link'
import { checkPublicRateLimit } from '@/lib/rate-limit'
import { ApproveCard } from './ApproveCard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Approve this estimate',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/**
 * /approve/:token (T-156) — the page behind "Approve & send" in the review
 * email. Opening it only reads the link's own quote summary: nothing is
 * approved until the button is pressed (a POST), so an email scanner or link
 * preview fetching this page changes nothing.
 */
export default async function ApprovePage({ params }: { params: { token: string } }) {
  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  const limited = await checkPublicRateLimit('approval_link', { ip, tenantKey: 'page' })
  if (!limited.allowed) {
    return <ApproveCard token={params.token} initialOutcome="too_many" summary={null} />
  }
  const loaded = await loadApprovalLink(createAdminClient(), params.token)
  return <ApproveCard token={params.token} initialOutcome={loaded.outcome} summary={loaded.summary} />
}
