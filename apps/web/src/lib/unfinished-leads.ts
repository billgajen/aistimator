/**
 * Unfinished requests: which ones the business still sees, and which are new
 * (T-151, T-160). One place for the rule, so the list, its tab count, the Home
 * banner and the menu badge can never disagree.
 *
 * An unfinished request (a row in `request_leads`) is:
 * - listed  while it is not completed (it never became a quote), not handled
 *           (the business has not pressed "Done") and was started in the last
 *           30 days;
 * - new     while it is listed and the business has not seen it. Opening the
 *           Unfinished list marks the ones shown as seen. The banner and the
 *           badge count only new ones, so they clear and come back only when
 *           another person starts and does not finish.
 */

export const UNFINISHED_WINDOW_DAYS = 30

export interface UnfinishedLeadState {
  created_at: string
  completed_at?: string | null
  handled_at?: string | null
  seen_at?: string | null
}

/** The start of the window the list covers */
export function unfinishedSince(now: Date = new Date(), days: number = UNFINISHED_WINDOW_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** Shown in the Unfinished list and counted on its tab */
export function isUnfinishedListed(lead: UnfinishedLeadState, now: Date = new Date()): boolean {
  return !lead.completed_at && !lead.handled_at && lead.created_at >= unfinishedSince(now)
}

/** Counted by the Home banner and the menu badge */
export function isUnfinishedNew(lead: UnfinishedLeadState, now: Date = new Date()): boolean {
  return isUnfinishedListed(lead, now) && !lead.seen_at
}

/** The parts of a query builder the rule needs (the Supabase builder has them) */
interface LeadQuery {
  eq(column: string, value: string): LeadQuery
  is(column: string, value: null): LeadQuery
  gte(column: string, value: string): LeadQuery
}

/**
 * The same rule as a database filter. Always scoped to one tenant.
 * `newOnly` narrows it to the ones the business has not seen.
 *
 * The builder comes back as the type it went in as (Supabase's filters return
 * the builder itself); it is only narrowed inside to the three calls made.
 */
export function unfinishedFilter<Q>(query: Q, tenantId: string, opts: { newOnly?: boolean; now?: Date; days?: number } = {}): Q {
  let q = (query as unknown as LeadQuery)
    .eq('tenant_id', tenantId)
    .is('completed_at', null)
    .is('handled_at', null)
    .gte('created_at', unfinishedSince(opts.now, opts.days))
  if (opts.newOnly) q = q.is('seen_at', null)
  return q as unknown as Q
}

/** Lead ids are short text ids; anything else is not ours to look up */
export const LEAD_ID = /^[A-Za-z0-9_-]{1,80}$/

/** The browser event that tells the menu its count changed */
export const UNFINISHED_CHANGED_EVENT = 'unfinished-requests-changed'
