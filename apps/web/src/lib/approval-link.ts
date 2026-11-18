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
  approvalDetail,
  formatMoney,
  getRegion,
  displaySections,
  CHECKER_SETTINGS_VERSION,
  type ApprovalDetail,
  type ApprovalOutcome,
  type ApprovalLinkRow,
  type QuotePricing,
} from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { approveQuote } from '@/lib/quote-approval'
import { assetIdsOf } from '@/lib/quote-photos'
import { SHOW_WORTH_CHECKING } from '@/lib/quote-understanding'

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
  /** T-183: the request's photos and the form's suggestion of another service */
  request?: unknown
}

/** T-183: one of the customer's photos on the approval page: a path on our own site, checked against the link */
export interface ApprovalPhoto {
  id: string
  /** The small copy (the original when it has none) */
  smallUrl: string
  url: string
}

/** The most photos the approval page lists (a request form accepts fewer) */
export const APPROVAL_MAX_PHOTOS = 12

export const approvalPhotoUrl = (token: string, assetId: string) => `/api/public/approval/${encodeURIComponent(token)}/photos/${encodeURIComponent(assetId)}`

/** What the confirmation page shows: the quote's summary and nothing more */
export interface ApprovalSummary {
  quoteId: string
  businessName: string
  customerName: string
  serviceName: string
  price: string
  scopeSummary?: string
  /** T-179: a combined quote's services, each with its subtotal (absent on a single-service quote) */
  sections?: Array<{ serviceName: string; subtotal: string }>
  /**
   * T-183: what the business judges the price by: warnings, every line with
   * its amount and source, each service's subtotal, the total. Only while the
   * link can still approve; a used or expired link shows the summary alone.
   */
  detail?: ApprovalDetail
  /** T-183: the customer's photos, while the link can still approve */
  photos?: ApprovalPhoto[]
}

export interface LoadedLink {
  outcome: ApprovalOutcome
  link: LinkRow | null
  summary: ApprovalSummary | null
  quote: QuoteRow | null
}

/** T-179: the services on a combined quote, for the confirmation page */
function sectionsSummary(q: QuoteRow): { sections?: Array<{ serviceName: string; subtotal: string }> } {
  const pricing = q.pricing_json as (QuotePricing & { sections?: unknown }) | null
  const sections = pricing ? displaySections(pricing, { serviceName: q.services?.name ?? 'Service' }) : null
  if (!pricing || !sections) return {}
  const region = getRegion(q.tenants?.region)
  const currency = pricing.currency || region.currency
  return { sections: sections.map((s) => ({ serviceName: s.serviceName, subtotal: formatMoney(s.subtotal, currency, region.locale) })) }
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
    .select(
      'id, status, approved_at, pricing_json, content_json, customer_json, tenants!tenant_id ( name, region ), services!service_id ( name ), request:quote_requests!quote_request_id ( asset_ids, source_json )'
    )
    .eq('id', link.quote_id)
    .eq('tenant_id', link.tenant_id)
    .maybeSingle()
  if (!quote) return { ...none, link: link as LinkRow }
  const q = quote as unknown as QuoteRow
  const outcome = approvalPageOutcome(link as LinkRow, q, now)
  return {
    outcome,
    link: link as LinkRow,
    quote: q,
    summary: {
      quoteId: q.id,
      businessName: q.tenants?.name ?? '',
      customerName: q.customer_json?.name ?? '',
      serviceName: q.services?.name ?? '',
      price: priceLabel(q.pricing_json, q.tenants?.region),
      ...(q.content_json?.scopeSummary && { scopeSummary: q.content_json.scopeSummary }),
      ...sectionsSummary(q),
      ...(outcome === 'ready' && (await judgeable(admin, token, link as LinkRow, q))),
    },
  }
}

/**
 * T-183: everything the business judges the price by, for a link that can
 * still approve. Read through the link's own quote and tenant, like the rest:
 * the photos are the request's own image assets of that tenant, and the
 * checker's findings come from the same marked rows the dashboard reads.
 */
async function judgeable(admin: Admin, token: string, link: LinkRow, q: QuoteRow): Promise<Pick<ApprovalSummary, 'detail' | 'photos'>> {
  const request = (Array.isArray(q.request) ? q.request[0] : q.request) as { source_json?: unknown } | null | undefined
  const assetIds = assetIdsOf(q.request)
  const [images, checker] = await Promise.all([
    assetIds.length > 0
      ? admin.from('assets').select('id').eq('tenant_id', link.tenant_id).eq('type', 'image').in('id', assetIds)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
    SHOW_WORTH_CHECKING
      ? admin
          .from('quote_validation_logs')
          .select('issues:validation_result->issues')
          .eq('quote_id', link.quote_id)
          .eq('tenant_id', link.tenant_id)
          .neq('outcome', 'passed')
          // only a check made with the business's money settings (T-172), as on the dashboard
          .eq('input_snapshot->>serviceConfigVersion', CHECKER_SETTINGS_VERSION)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const imageIds = new Set(((images.data ?? []) as Array<{ id: string }>).map((a) => a.id))
  // in the order the customer sent them
  const photoIds = assetIds.filter((id) => imageIds.has(id))
  const region = getRegion(q.tenants?.region)
  return {
    detail: approvalDetail({
      pricing: q.pricing_json,
      content: q.content_json,
      mainServiceName: q.services?.name ?? '',
      requestSource: request?.source_json,
      checkerIssues: (checker.data as { issues?: unknown } | null)?.issues,
      photoCount: photoIds.length,
      currency: region.currency,
      locale: region.locale,
    }),
    photos: photoIds.slice(0, APPROVAL_MAX_PHOTOS).map((id) => {
      const url = approvalPhotoUrl(token, id)
      return { id, url, smallUrl: `${url}?size=small` }
    }),
  }
}

/**
 * T-183: may this link show this photo? Only a link that can still approve
 * (not used, replaced, expired or pressed too often), and only a photo of its
 * own quote's request that is an image of its own tenant. Returns the storage
 * key, or null: every refusal is the same "not found" to the caller. Opening
 * a photo is not a press and counts nothing.
 */
export async function approvalPhotoKey(admin: Admin, token: string, assetId: string, now: Date = new Date()): Promise<string | null> {
  if (!isApprovalTokenShape(token)) return null
  const hash = await hashApprovalToken(token)
  const { data: link } = await admin
    .from('quote_approval_tokens')
    .select('id, quote_id, tenant_id, expires_at, used_at, invalidated_at, attempts')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!link || approvalLinkState(link as LinkRow, now) !== 'valid') return null
  const row = link as LinkRow
  const { data: quote } = await admin
    .from('quotes')
    .select('id, request:quote_requests!quote_request_id ( asset_ids )')
    .eq('id', row.quote_id)
    .eq('tenant_id', row.tenant_id)
    .maybeSingle()
  if (!quote || !assetIdsOf((quote as { request?: unknown }).request).includes(assetId)) return null
  const { data: asset } = await admin.from('assets').select('id, r2_key').eq('id', assetId).eq('tenant_id', row.tenant_id).eq('type', 'image').maybeSingle()
  return (asset as { r2_key?: string } | null)?.r2_key ?? null
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
