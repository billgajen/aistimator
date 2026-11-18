/**
 * T-179 (AD-061): adding and removing a service section on a quote, on the
 * server. Used by the customer's quote page (public, token-checked) and by
 * the dashboard's quote editor (signed in).
 *
 * The price of a section always comes from the worker's rules engine
 * (`/section`: deterministic, no AI). This file asks for it, stores the
 * section, and works the quote's totals out again through
 * `withSections` (packages/shared/src/quote-sections.ts): tax once, on the
 * combined taxable amount.
 *
 * A request with several services is still ONE quote: nothing here touches
 * a usage counter.
 */
import {
  MAX_ADDED_SECTIONS,
  addedSections,
  alsoAskedOf,
  alsoAskedWithStates,
  isShownEarly,
  resolveRegionContext,
  reviewAfterAdding,
  reviewModeOf,
  withSections,
  canCustomerDecide,
} from '@qolumns/shared'
import type { AlsoAsked, CombinedPricing, QuoteSection, ReviewHoldKind, ReviewMode, SectionQuestion, SectionTax } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>
export type RawSectionAnswer = { fieldId: string; value: string | number | boolean | string[] }

export type WorkerSectionResult =
  | { success: false; reason: 'not_a_service' | 'no_price' | 'failed' | 'unreachable' }
  | { success: true; ready: false; serviceName: string; questions: SectionQuestion[] }
  | { success: true; ready: true; serviceName: string; section: Omit<QuoteSection, 'addedBy' | 'addedAt'>; reviewMode: ReviewMode }

/**
 * Ask the worker to price a service as a section of a quote. It answers with
 * the section, or with the questions that still need an answer. Waits for the
 * answer (the worker runs no AI here, so it takes about a second).
 */
export async function priceSectionNow(
  input: { quoteId: string; serviceId: string; answers?: RawSectionAnswer[]; knownQuestions?: SectionQuestion[] },
  { timeoutMs = 25_000 }: { timeoutMs?: number } = {}
): Promise<WorkerSectionResult> {
  const workerUrl = process.env.CLOUDFLARE_WORKER_URL
  if (!workerUrl) return { success: false, reason: 'unreachable' }
  try {
    const token = process.env.CLOUDFLARE_WORKER_TOKEN
    const response = await fetch(`${workerUrl}/section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const json = (await response.json().catch(() => null)) as WorkerSectionResult | null
    if (json && typeof json.success === 'boolean') return json
    return { success: false, reason: 'failed' }
  } catch (error) {
    console.error(`[Sections] The pricing worker did not answer: ${error instanceof Error ? error.name : 'unknown error'}`)
    return { success: false, reason: 'unreachable' }
  }
}

/** The quote columns every section operation reads */
export const SECTION_QUOTE_COLUMNS =
  'id, tenant_id, service_id, status, review_hold, approved_at, pricing_json, content_json, customer_json, is_test, is_demo, quote_token_hash, previous_token_hash, link_token_hashes, token_expires_at'

export interface SectionQuoteRow {
  id: string
  tenant_id: string
  service_id: string
  status: string
  review_hold: ReviewHoldKind | null
  approved_at: string | null
  pricing_json: CombinedPricing | null
  content_json: (Record<string, unknown> & { alsoAsked?: AlsoAsked[]; sectionsBefore?: SectionsBefore; limitHold?: boolean }) | null
  customer_json: { name?: string; email?: string; phone?: string } | null
  is_test?: boolean | null
  is_demo?: boolean | null
}

/** Where a quote stood before the customer's first added section sent it back for review */
interface SectionsBefore {
  status: string
  approvedAt: string | null
  reviewHold: ReviewHoldKind | null
}

/** Can the customer change the sections of this quote right now? Only while they can see a price and have not decided. */
export function customerCanChangeSections(quote: Pick<SectionQuoteRow, 'status' | 'review_hold' | 'pricing_json' | 'content_json'>): boolean {
  if (canCustomerDecide(quote.status)) return true
  return isShownEarly({ status: quote.status, review_hold: quote.review_hold, total: quote.pricing_json?.total, limitHold: quote.content_json?.limitHold })
}

/** How this business's combined quotes are taxed */
export async function sectionTaxFor(supabase: Admin, tenantId: string, mainServiceId: string): Promise<{ tax: SectionTax; mainService: { name: string; mode: ReviewMode } }> {
  const [{ data: tenant }, { data: service }] = await Promise.all([
    supabase.from('tenants').select('region, currency, unit_system, tax_enabled, tax_label, tax_rate').eq('id', tenantId).single(),
    supabase.from('services').select('name, tax_exempt, auto_send, hold_until_approved').eq('id', mainServiceId).single(),
  ])
  const t = tenant as { region?: string | null; currency?: string | null; unit_system?: string | null; tax_enabled?: boolean; tax_label?: string | null; tax_rate?: number | null } | null
  const s = service as { name?: string; tax_exempt?: boolean | null; auto_send?: boolean | null; hold_until_approved?: boolean | null } | null
  const charges = Boolean(t?.tax_enabled) && (t?.tax_rate ?? 0) > 0
  return {
    tax: {
      // The database keeps the rate as a decimal (0.20); a quote keeps it as a whole-number percentage (20)
      ratePercent: charges ? Math.round((t!.tax_rate as number) * 100 * 1000) / 1000 : 0,
      label: t ? resolveRegionContext(t).taxLabel : undefined,
      mainTaxable: charges && s?.tax_exempt !== true,
    },
    mainService: { name: s?.name ?? 'Service', mode: reviewModeOf(s ?? {}) },
  }
}

async function modesOf(supabase: Admin, tenantId: string, serviceIds: string[]): Promise<ReviewMode[]> {
  if (serviceIds.length === 0) return []
  const { data } = await supabase.from('services').select('id, auto_send, hold_until_approved').eq('tenant_id', tenantId).in('id', serviceIds)
  const rows = (data ?? []) as Array<{ id: string; auto_send?: boolean | null; hold_until_approved?: boolean | null }>
  // a service that can no longer be read is treated as needing review
  return serviceIds.map((id) => {
    const row = rows.find((r) => r.id === id)
    return row ? reviewModeOf(row) : 'show_then_confirm'
  })
}

export type SectionChange =
  | { ok: true; pricing: CombinedPricing; alsoAsked: AlsoAsked[]; status: string; reviewChanged: boolean; section?: QuoteSection }
  | { ok: false; status: number; code: string; message: string; questions?: SectionQuestion[] }

const refuse = (status: number, code: string, message: string, questions?: SectionQuestion[]): SectionChange => ({ ok: false, status, code, message, ...(questions && { questions }) })

/**
 * The customer adds a service to their quote. Prices it (worker), stores the
 * section, recomputes the totals, and moves the quote to the strictest review
 * setting among its services.
 */
export async function addSectionForCustomer(
  supabase: Admin,
  quote: SectionQuoteRow,
  input: { serviceId: string; answers?: RawSectionAnswer[] }
): Promise<SectionChange> {
  if (!customerCanChangeSections(quote)) return refuse(409, 'NOT_CHANGEABLE', 'This quote can no longer be changed.')
  const pricing = quote.pricing_json
  if (!pricing || !(pricing.total > 0)) return refuse(409, 'NOT_CHANGEABLE', 'This quote has no price yet.')

  const existing = addedSections(pricing)
  if (existing.some((s) => s.serviceId === input.serviceId)) return refuse(409, 'ALREADY_ADDED', 'That service is already on your quote.')
  if (existing.length >= MAX_ADDED_SECTIONS) return refuse(409, 'TOO_MANY', `A quote can carry up to ${MAX_ADDED_SECTIONS} added services.`)

  // Only something the customer asked for, that the business offers, can be added
  const offered = alsoAskedOf(quote.content_json).find((a) => a.serviceId === input.serviceId && a.state !== 'not_offered')
  if (!offered) return refuse(404, 'NOT_OFFERED', 'That service is not one you can add to this quote.')

  const priced = await priceSectionNow({ quoteId: quote.id, serviceId: input.serviceId, answers: input.answers ?? [], knownQuestions: offered.questions ?? [] })
  if (!priced.success) {
    return priced.reason === 'unreachable' || priced.reason === 'failed'
      ? refuse(503, 'TRY_AGAIN', 'We could not work out that price just now. Please try again.')
      : refuse(404, 'NOT_OFFERED', 'That service is not one you can add to this quote.')
  }
  if (!priced.ready) return refuse(422, 'ANSWERS_NEEDED', 'A few answers are needed to price this.', priced.questions)

  const section: QuoteSection = { ...priced.section, addedBy: 'customer', addedAt: new Date().toISOString() }
  const { tax, mainService } = await sectionTaxFor(supabase, quote.tenant_id, quote.service_id)
  const sections = [...existing, section]
  const nextPricing = withSections(pricing, sections, tax)

  // Review: the strictest setting among every service now on the quote
  const modes = [mainService.mode, ...(await modesOf(supabase, quote.tenant_id, sections.map((s) => s.serviceId)))]
  const current = { status: quote.status, reviewHold: quote.review_hold, approvedAt: quote.approved_at }
  const { next, changed } = reviewAfterAdding(current, modes)

  const content = { ...(quote.content_json ?? {}) }
  content.alsoAsked = alsoAskedWithStates(alsoAskedOf(content), sections)
  // Remember where a sent quote stood, so removing what was added can put it back
  if (changed && quote.status !== 'pending_review' && !content.sectionsBefore) {
    content.sectionsBefore = { status: quote.status, approvedAt: quote.approved_at, reviewHold: quote.review_hold }
  }

  const { error } = await supabase
    .from('quotes')
    .update({
      pricing_json: nextPricing,
      content_json: content,
      // a PDF made before this change no longer matches the quote
      pdf_asset_id: null,
      ...(changed && { status: next.status, review_hold: next.reviewHold, approved_at: next.approvedAt }),
    })
    .eq('id', quote.id)
  if (error) {
    console.error(`[Sections] Could not save the added section on ${quote.id}: ${error.message}`)
    return refuse(500, 'SAVE_FAILED', 'We could not save that just now. Please try again.')
  }
  return { ok: true, pricing: nextPricing, alsoAsked: content.alsoAsked, status: changed ? next.status : quote.status, reviewChanged: changed, section }
}

/** The customer takes an added service off their quote again (before accepting). */
export async function removeSectionForCustomer(supabase: Admin, quote: SectionQuoteRow, serviceId: string): Promise<SectionChange> {
  if (!customerCanChangeSections(quote)) return refuse(409, 'NOT_CHANGEABLE', 'This quote can no longer be changed.')
  const pricing = quote.pricing_json
  if (!pricing) return refuse(409, 'NOT_CHANGEABLE', 'This quote has no price yet.')
  const existing = addedSections(pricing)
  const removed = existing.find((s) => s.serviceId === serviceId)
  if (!removed) return refuse(404, 'NOT_ON_QUOTE', 'That service is not on your quote.')

  const { tax } = await sectionTaxFor(supabase, quote.tenant_id, quote.service_id)
  const sections = existing.filter((s) => s.serviceId !== serviceId)
  const nextPricing = withSections(pricing, sections, tax)

  const content = { ...(quote.content_json ?? {}) }
  content.alsoAsked = alsoAskedWithStates(alsoAskedOf(content), sections)
  // With nothing added any more, a quote that only went back to review because
  // of what was added returns to where it stood (the business approved exactly this)
  const before = content.sectionsBefore
  const restore = sections.length === 0 && Boolean(before) && quote.status === 'pending_review' && !quote.approved_at
  if (sections.length === 0) delete content.sectionsBefore

  const { error } = await supabase
    .from('quotes')
    .update({
      pricing_json: nextPricing,
      content_json: content,
      pdf_asset_id: null,
      ...(restore && before && { status: before.status, review_hold: before.reviewHold, approved_at: before.approvedAt }),
    })
    .eq('id', quote.id)
  if (error) {
    console.error(`[Sections] Could not save the removal on ${quote.id}: ${error.message}`)
    return refuse(500, 'SAVE_FAILED', 'We could not save that just now. Please try again.')
  }
  return { ok: true, pricing: nextPricing, alsoAsked: content.alsoAsked, status: restore && before ? before.status : quote.status, reviewChanged: restore }
}
