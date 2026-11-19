/**
 * T-186: the quotes whose open questions are the business's to answer.
 *
 * A quote the business made itself (`isMadeByBusiness`) and that has open
 * questions sits under "Needs you", not "Waiting for customer". The status in
 * the database is the same for both, so a list or a count that filters by
 * status asks here which quotes to move. The rule itself is the shared one
 * (packages/shared/src/quote-turn.ts); this only reads the rows it needs.
 *
 * A tenant has few such quotes at a time (each stops being one as soon as it
 * is answered), so they are read in one small query.
 */
import { QUESTIONS_OPEN_STATUS, QUOTE_GROUP_STATUSES, isMadeByBusiness, type QuoteGroup, type QuoteStatus } from '@qolumns/shared'

/** The most such quotes read at once; far above what a tenant holds */
const MAX_ROWS = 500

interface Reader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          limit(count: number): PromiseLike<{ data: unknown; error: unknown }>
        }
      }
    }
  }
}

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null))

/** The source of the request a quote row was made from (`request:quote_requests!quote_request_id (source_json)`) */
export function requestSourceOf(row: unknown): unknown {
  const request = one((row as { request?: unknown } | null)?.request as { source_json?: unknown } | Array<{ source_json?: unknown }> | null)
  return request?.source_json ?? null
}

/** How many questions a quote row carries (`clarification_questions_json`) */
export function questionCountOf(row: unknown): number {
  const questions = (row as { clarification_questions_json?: unknown } | null)?.clarification_questions_json
  return Array.isArray(questions) ? questions.length : 0
}

/** This tenant's quotes with open questions that the business made itself. Empty on a failed read. */
export async function businessAskedQuoteIds(supabase: unknown, tenantId: string): Promise<string[]> {
  const { data, error } = await (supabase as Reader)
    .from('quotes')
    .select('id, request:quote_requests!quote_request_id (source_json)')
    .eq('tenant_id', tenantId)
    .eq('status', QUESTIONS_OPEN_STATUS)
    .limit(MAX_ROWS)
  if (error || !Array.isArray(data)) return []
  return (data as Array<{ id: string }>).filter((row) => isMadeByBusiness(requestSourceOf(row))).map((row) => row.id)
}

/**
 * How a group is filtered once those quotes are moved to "Needs you":
 *   statuses   the group's statuses
 *   plusIds    quotes that belong to the group whatever their status says
 *   minusIds   quotes that do not, though their status is one of the group's
 */
export function groupFilter(group: QuoteGroup, businessAskedIds: readonly string[]): { statuses: readonly QuoteStatus[]; plusIds: readonly string[]; minusIds: readonly string[] } {
  const statuses = QUOTE_GROUP_STATUSES[group]
  if (group === 'needs_you') return { statuses, plusIds: businessAskedIds, minusIds: [] }
  if (group === 'waiting') return { statuses, plusIds: [], minusIds: businessAskedIds }
  return { statuses, plusIds: [], minusIds: [] }
}

/** The part of a query builder this needs */
interface Filterable<Q> {
  in(column: string, values: readonly string[]): Q
  or(filter: string): Q
  not(column: string, operator: string, value: string): Q
}

/**
 * Narrow a quotes query to one group, by `groupFilter`. `statuses` replaces
 * the group's own list where a screen uses a narrower one (Home leaves out
 * nothing, but names its statuses itself).
 */
export function applyGroupFilter<Q>(query: Q, filter: { statuses: readonly string[]; plusIds: readonly string[]; minusIds: readonly string[] }): Q {
  const q = query as unknown as Filterable<Q>
  if (filter.plusIds.length > 0) return q.or(`status.in.(${filter.statuses.join(',')}),id.in.(${filter.plusIds.join(',')})`)
  const byStatus = q.in('status', filter.statuses)
  return filter.minusIds.length > 0 ? (byStatus as unknown as Filterable<Q>).not('id', 'in', `(${filter.minusIds.join(',')})`) : byStatus
}
