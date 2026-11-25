/**
 * T-151: unfinished requests. A lead is saved the moment the contact step is
 * done, updated as the customer goes on, and closed when the request is
 * submitted (it then IS the quote). No AI runs and nothing counts toward
 * usage. The browser that created a lead holds its token; only that token
 * can update or close it by id.
 */
import { createHash, randomBytes } from 'crypto'
import type { createAdminClient } from '@/lib/supabase/server'
import { emailKey, phoneKey } from '@/lib/unfinished-leads'

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

/** How long a person's open request for a service is taken up again instead of saved twice (T-204) */
export const SAME_REQUEST_HOURS = 24

/**
 * T-204: the open request this person already has for this service, if any:
 * same email or same phone, not finished, not marked done by the business,
 * started in the last 24 hours. The one that got furthest wins.
 */
export async function openLeadFor(
  supabase: Admin,
  opts: { tenantId: string; serviceId: string; email?: string | null; phone?: string | null; now?: Date }
): Promise<{ id: string; progress: LeadProgress } | null> {
  const email = emailKey(opts.email)
  const phone = phoneKey(opts.phone)
  if (!email && !phone) return null
  const since = new Date((opts.now ?? new Date()).getTime() - SAME_REQUEST_HOURS * 60 * 60 * 1000).toISOString()
  // Contact details are stored as typed ("Derek@…", "(512) 555-0100"), so the day's open requests
  // for this service are read and compared by the list's own keys (lib/unfinished-leads.ts)
  const { data } = await supabase
    .from('request_leads')
    .select('id, progress, updated_at, customer_email, customer_phone')
    .eq('tenant_id', opts.tenantId)
    .eq('service_id', opts.serviceId)
    .is('completed_at', null)
    .is('handled_at', null)
    .gte('created_at', since)
    .order('updated_at', { ascending: false })
    .limit(200)
  const found = ((data ?? []) as Array<{ id: string; progress: string; updated_at: string; customer_email: string | null; customer_phone: string | null }>).filter(
    (row) => (email !== null && emailKey(row.customer_email) === email) || (phone !== null && phoneKey(row.customer_phone) === phone)
  )
  if (found.length === 0) return null
  const step = (row: { progress: string }) => LEAD_PROGRESS.indexOf(row.progress as LeadProgress)
  const best = found.reduce((a, b) => (step(b) > step(a) || (step(b) === step(a) && b.updated_at > a.updated_at) ? b : a))
  return { id: best.id, progress: isLeadProgress(best.progress) ? best.progress : 'contact' }
}

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
