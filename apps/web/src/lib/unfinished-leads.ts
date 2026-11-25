/**
 * Unfinished requests: which ones the business still sees, and which are new
 * (T-151, T-160). One place for the rule, so the list, its tab count, the Home
 * banner and the menu badge can never disagree. T-204: and one entry per
 * person per service (`collapseLeads`, below).
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

/**
 * T-204: one entry per person per service.
 *
 * A reload loses the form's token, a second visit starts again, and each used
 * to save another row: the same person showed three or four times. Now a
 * person's rows for one service, started within 24 hours of each other, are
 * one entry: the row that got furthest (the latest of them on a tie).
 *
 * "The same person" is the same email or the same phone number. The public
 * form reuses an open row when it can (api/public/leads), so new duplicates
 * are rare; this rule is what the list and every count read, so rows saved
 * before that, or from a second device, collapse too.
 */
export const SAME_REQUEST_HOURS = 24

const PROGRESS_ORDER = ['contact', 'questions', 'photos', 'details']

/** The columns the rule reads */
export interface LeadRow {
  id: string
  service_id: string | null
  customer_email: string | null
  customer_phone: string | null
  progress: string
  created_at: string
  updated_at?: string | null
  seen_at?: string | null
}

/** Those columns, as a select list */
export const LEAD_ROW_COLUMNS = 'id, service_id, customer_email, customer_phone, progress, created_at, updated_at, seen_at'

export interface LeadEntry<T extends LeadRow> {
  /** The row shown: the one that got furthest */
  lead: T
  /** Every row of this entry, the shown one included */
  rows: T[]
  /** Not seen yet: any of its rows is unseen (the person came back after the business last looked) */
  isNew: boolean
  /** When the person first started, and when they were last active */
  firstAt: string
  lastActiveAt: string
}

/** Contact details are stored as the customer typed them, so they are compared by these keys */
export const emailKey = (value: string | null | undefined): string | null => value?.trim().toLowerCase() || null
/**
 * A phone number's digits, the last ten of them: "+1 (512) 555-0100", "15125550100" and
 * "512-555-0100" are one number, with or without the country's code in front.
 */
export const phoneKey = (value: string | null | undefined): string | null => {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-10) : null
}
const lastActive = (row: LeadRow) => row.updated_at || row.created_at
const stepOf = (row: LeadRow) => PROGRESS_ORDER.indexOf(row.progress)

/**
 * Rows to entries, newest first. Pure: the list, the tab count, the Home
 * banner, the menu badge and "Done" all go through it.
 */
export function collapseLeads<T extends LeadRow>(rows: readonly T[]): LeadEntry<T>[] {
  const windowMs = SAME_REQUEST_HOURS * 60 * 60 * 1000
  const groups: Array<{ rows: T[]; emails: Set<string>; phones: Set<string>; service: string | null; latestStart: number }> = []
  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const email = emailKey(row.customer_email)
    const phone = phoneKey(row.customer_phone)
    const started = new Date(row.created_at).getTime()
    const matching = groups.filter(
      (g) =>
        g.service === (row.service_id ?? null) &&
        started - g.latestStart <= windowMs &&
        ((email !== null && g.emails.has(email)) || (phone !== null && g.phones.has(phone)))
    )
    const group = matching[0]
    if (group) {
      // A try that gives an email one earlier try gave and a phone number another gave shows they
      // were all the same person: those entries become one
      for (const also of matching.slice(1)) {
        group.rows.push(...also.rows)
        for (const e of also.emails) group.emails.add(e)
        for (const p of also.phones) group.phones.add(p)
        groups.splice(groups.indexOf(also), 1)
      }
      group.rows.push(row)
      if (email) group.emails.add(email)
      if (phone) group.phones.add(phone)
      group.latestStart = started
    } else {
      groups.push({ rows: [row], emails: new Set(email ? [email] : []), phones: new Set(phone ? [phone] : []), service: row.service_id ?? null, latestStart: started })
    }
  }
  return groups
    .map((group) => {
      const lead = group.rows.reduce((best, row) =>
        stepOf(row) > stepOf(best) || (stepOf(row) === stepOf(best) && lastActive(row) >= lastActive(best)) ? row : best
      )
      const inOrder = [...group.rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
      return {
        lead,
        rows: inOrder,
        isNew: group.rows.some((row) => !row.seen_at),
        firstAt: inOrder[0]!.created_at,
        lastActiveAt: group.rows.map(lastActive).sort().at(-1)!,
      }
    })
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
}

/** The parts of a client the count needs */
interface LeadReader {
  from(table: string): { select(columns: string): unknown }
}

/** The most rows one business's list reads; the window is 30 days, so this is far above any real list */
export const UNFINISHED_READ_LIMIT = 1000

/**
 * How many unfinished requests a business has, counted as the list shows
 * them: one per person per service. `newOnly` counts the entries not seen yet.
 * Null when the read failed.
 */
export async function countUnfinished(supabase: unknown, tenantId: string, opts: { newOnly?: boolean; now?: Date } = {}): Promise<number | null> {
  const query = unfinishedFilter((supabase as LeadReader).from('request_leads').select(LEAD_ROW_COLUMNS), tenantId, { now: opts.now }) as unknown as {
    limit(n: number): PromiseLike<{ data: LeadRow[] | null; error: unknown }>
  }
  const { data, error } = await query.limit(UNFINISHED_READ_LIMIT)
  if (error || !data) return null
  const entries = collapseLeads(data)
  return opts.newOnly ? entries.filter((entry) => entry.isNew).length : entries.length
}

/** Lead ids are short text ids; anything else is not ours to look up */
export const LEAD_ID = /^[A-Za-z0-9_-]{1,80}$/

/** The browser event that tells the menu its count changed */
export const UNFINISHED_CHANGED_EVENT = 'unfinished-requests-changed'
