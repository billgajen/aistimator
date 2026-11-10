/**
 * T-151: unfinished requests. A lead is saved the moment the contact step is
 * done, updated as the customer goes on, and closed when the request is
 * submitted (it then IS the quote). No AI runs and nothing counts toward
 * usage. The browser that created a lead holds its token; only that token
 * can update or close it by id.
 */
import { createHash, randomBytes } from 'crypto'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export const LEAD_PROGRESS = ['contact', 'questions', 'photos', 'details'] as const
export type LeadProgress = (typeof LEAD_PROGRESS)[number]

/** Plain words for "how far they got" */
export const PROGRESS_WORDS: Record<LeadProgress, string> = {
  contact: 'Gave contact details',
  questions: 'Answered the questions',
  photos: 'Added photos',
  details: 'Reached the last step',
}

export function isLeadProgress(value: unknown): value is LeadProgress {
  return LEAD_PROGRESS.includes(value as LeadProgress)
}

/** Progress only moves forward (a customer going Back doesn't undo how far they got). */
export function laterProgress(current: LeadProgress, incoming: LeadProgress): LeadProgress {
  return LEAD_PROGRESS.indexOf(incoming) > LEAD_PROGRESS.indexOf(current) ? incoming : current
}

export type LeadAnswer = { fieldId: string; value: string | number | boolean | string[] }

/** Keep only what a customer could have typed: bounded, plain values. */
export function cleanAnswers(raw: unknown): LeadAnswer[] {
  if (!Array.isArray(raw)) return []
  const out: LeadAnswer[] = []
  for (const item of raw.slice(0, 60)) {
    const fieldId = (item as { fieldId?: unknown })?.fieldId
    const value = (item as { value?: unknown })?.value
    if (typeof fieldId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(fieldId)) continue
    if (typeof value === 'string') out.push({ fieldId, value: value.slice(0, 2000) })
    else if (typeof value === 'number' && Number.isFinite(value)) out.push({ fieldId, value })
    else if (typeof value === 'boolean') out.push({ fieldId, value })
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) out.push({ fieldId, value: (value as string[]).slice(0, 30).map((v) => v.slice(0, 200)) })
  }
  return out
}

export function cleanAssetIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && /^[a-z]+_[A-Za-z0-9]{6,64}$/.test(v)).slice(0, 20) : []
}

export const hashLeadToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newLeadToken = () => randomBytes(24).toString('base64url')

/**
 * Close the leads a submitted request came from: the one this browser holds
 * (id + token), and any other open lead for the same customer and service in
 * the last day (a reload loses the token; that must not leave a duplicate).
 */
export async function completeLeads(
  supabase: Admin,
  opts: {
    tenantId: string
    quoteId: string
    serviceId: string
    leadId?: string | null
    leadToken?: string | null
    email?: string | null
    phone?: string | null
  }
): Promise<void> {
  const now = new Date().toISOString()
  const done = { quote_id: opts.quoteId, completed_at: now }
  if (opts.leadId && opts.leadToken) {
    await supabase
      .from('request_leads')
      .update(done)
      .eq('id', opts.leadId)
      .eq('tenant_id', opts.tenantId)
      .eq('lead_token_hash', hashLeadToken(opts.leadToken))
      .is('completed_at', null)
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  for (const [column, value] of [['customer_email', opts.email], ['customer_phone', opts.phone]] as const) {
    if (!value) continue
    await supabase
      .from('request_leads')
      .update(done)
      .eq('tenant_id', opts.tenantId)
      .eq('service_id', opts.serviceId)
      .eq(column, value)
      .is('completed_at', null)
      .gte('created_at', since)
  }
}
