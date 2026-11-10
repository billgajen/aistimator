/**
 * T-156: the one-tap approval link from the "Review and approve" email.
 *
 * Server only, service role (no one is signed in). Every read goes through
 * the link's own row: its quote_id and tenant_id, never anything from the
 * request, so a link can only ever see or approve its own quote. Approval
 * goes through the same approveQuote as the dashboard and the app.
 */
import {
  hashApprovalToken,
  isApprovalTokenShape,
  approvalPageOutcome,
  approvalErrorOutcome,
  approvalLinkState,
  formatMoney,
  getRegion,
  type ApprovalOutcome,
  type ApprovalLinkRow,
} from '@estimator/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { approveQuote } from '@/lib/quote-approval'

type Admin = ReturnType<typeof createAdminClient>

interface LinkRow extends ApprovalLinkRow {
  id: string
  quote_id: string
  tenant_id: string
}

interface QuoteRow {
  id: string
  status: string
  approved_at: string | null
  pricing_json: { total?: number; currency?: string; estimate?: { rangeLow?: number; rangeHigh?: number } } | null
  content_json: { limitHold?: boolean; scopeSummary?: string } | null
  customer_json: { name?: string } | null
  tenants: { name: string; region?: string | null } | null
  services: { name: string } | null
}

/** What the confirmation page shows: the quote's summary and nothing more */
export interface ApprovalSummary {
  quoteId: string
  businessName: string
  customerName: string
  serviceName: string
  price: string
  scopeSummary?: string
}

export interface LoadedLink {
  outcome: ApprovalOutcome
  link: LinkRow | null
  summary: ApprovalSummary | null
  quote: QuoteRow | null
}

function priceLabel(pricing: QuoteRow['pricing_json'], region?: string | null): string {
  if (!pricing || !((pricing.total ?? 0) > 0)) return ''
  const locale = getRegion(region).locale
  const currency = pricing.currency || getRegion(region).currency
  const money = (n: number) => formatMoney(n, currency, locale)
  const low = pricing.estimate?.rangeLow
  const high = pricing.estimate?.rangeHigh
  return low !== undefined && high !== undefined && high > low ? `${money(low)} – ${money(high)}` : money(pricing.total!)
}

export async function loadApprovalLink(admin: Admin, token: string, now: Date = new Date()): Promise<LoadedLink> {
  const none: LoadedLink = { outcome: 'not_found', link: null, summary: null, quote: null }
  if (!isApprovalTokenShape(token)) return none
  const hash = await hashApprovalToken(token)
  const { data: link } = await admin
    .from('quote_approval_tokens')
    .select('id, quote_id, tenant_id, expires_at, used_at, invalidated_at, attempts')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!link) return none
  const { data: quote } = await admin
    .from('quotes')
    .select('id, status, approved_at, pricing_json, content_json, customer_json, tenants!tenant_id ( name, region ), services!service_id ( name )')
    .eq('id', link.quote_id)
    .eq('tenant_id', link.tenant_id)
    .maybeSingle()
  if (!quote) return { ...none, link: link as LinkRow }
  const q = quote as unknown as QuoteRow
  return {
    outcome: approvalPageOutcome(link as LinkRow, q, now),
    link: link as LinkRow,
    quote: q,
    summary: {
      quoteId: q.id,
      businessName: q.tenants?.name ?? '',
      customerName: q.customer_json?.name ?? '',
      serviceName: q.services?.name ?? '',
      price: priceLabel(q.pricing_json, q.tenants?.region),
      ...(q.content_json?.scopeSummary && { scopeSummary: q.content_json.scopeSummary }),
    },
  }
}

export interface ApproveByLinkResult {
  outcome: ApprovalOutcome
  summary: ApprovalSummary | null
  /** Whether the customer's confirmed-quote email went out (approved only) */
  emailed?: boolean
}

/**
 * Approve the link's quote. Counts the press against the link first (so the
 * per-link limit holds without Redis), then calls the shared approveQuote,
 * whose status guard lets exactly one press send. A refusal changes nothing.
 */
export async function approveByLink(admin: Admin, token: string, now: Date = new Date()): Promise<ApproveByLinkResult> {
  const loaded = await loadApprovalLink(admin, token, now)
  const { link, summary } = loaded
  if (!link) return { outcome: 'not_found', summary: null }

  // Count the press (optimistic on the old value: a racing press counts too)
  if (approvalLinkState(link, now) !== 'used') {
    await admin.from('quote_approval_tokens').update({ attempts: link.attempts + 1 }).eq('id', link.id).eq('attempts', link.attempts)
  }
  if (loaded.outcome !== 'ready') return { outcome: loaded.outcome, summary }

  const result = await approveQuote({
    supabase: admin,
    quoteId: link.quote_id,
    tenantId: link.tenant_id,
    userId: null,
    via: 'email_link',
  })
  if (!result.ok) {
    // The quote may have moved on between the read and the press
    const { data: fresh } = await admin.from('quotes').select('approved_at').eq('id', link.quote_id).eq('tenant_id', link.tenant_id).maybeSingle()
    console.warn(`[ApprovalLink] ${link.quote_id}: ${result.code}`)
    return { outcome: approvalErrorOutcome(result.code, fresh as { approved_at: string | null } | null), summary }
  }

  await admin.from('quote_approval_tokens').update({ used_at: now.toISOString() }).eq('id', link.id)
  console.log(`[ApprovalLink] ${link.quote_id}: approved by email link`)
  return { outcome: 'approved', summary, emailed: result.emailed }
}
