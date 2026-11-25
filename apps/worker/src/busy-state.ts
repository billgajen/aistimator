/**
 * T-203: what a quote's earlier runs met with busy models, kept on the quote
 * between deliveries of its job (the queue message itself cannot be changed).
 *
 * It lives in `quotes.content_json.busy`, beside the other processing notes
 * a quote carries before it has content (`error`, `failedAt`). A run that
 * prices the quote writes its content over it and moves the totals into the
 * stored timings (`pricing_trace_json.timings`, stage-timer.ts).
 *
 * Neither call throws: a count that could not be read is "none yet", and a
 * count that could not be saved means the next delivery is taken for a real
 * try, which errs on the side of fewer deliveries, never more.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NO_BUSY_STATE, type BusyState } from './queue-consumer'

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/** The state as stored, read defensively (anything unexpected is "none yet") */
export function busyStateOf(contentJson: unknown): BusyState {
  const busy = (contentJson as { busy?: unknown } | null | undefined)?.busy
  if (!busy || typeof busy !== 'object') return NO_BUSY_STATE
  const raw = busy as Record<string, unknown>
  const lastRun = raw.lastRun && typeof raw.lastRun === 'object' ? (raw.lastRun as Record<string, unknown>) : null
  return {
    requeues: count(raw.requeues),
    busyRetries: count(raw.busyRetries),
    overflowCalls: count(raw.overflowCalls),
    ...(typeof raw.lastAt === 'string' && { lastAt: raw.lastAt }),
    ...(lastRun && { lastRun: { busyRetries: count(lastRun.busyRetries), overflowCalls: count(lastRun.overflowCalls) } }),
  }
}

export async function readBusyState(supabase: SupabaseClient, quoteId: string): Promise<BusyState> {
  try {
    const { data, error } = await supabase.from('quotes').select('content_json').eq('id', quoteId).maybeSingle()
    if (error || !data) return NO_BUSY_STATE
    return busyStateOf((data as { content_json?: unknown }).content_json)
  } catch {
    return NO_BUSY_STATE
  }
}

export async function saveBusyState(supabase: SupabaseClient, quoteId: string, state: BusyState): Promise<void> {
  try {
    const { data } = await supabase.from('quotes').select('content_json').eq('id', quoteId).maybeSingle()
    const content = ((data as { content_json?: unknown } | null)?.content_json as Record<string, unknown> | null) ?? {}
    // the status is left as it is ("generating"): the customer's page keeps saying the estimate is being prepared
    const { error } = await supabase.from('quotes').update({ content_json: { ...content, busy: state } }).eq('id', quoteId)
    if (error) console.error(`[Worker] Could not save the busy count for ${quoteId}`)
  } catch (unexpected) {
    console.error(`[Worker] Could not save the busy count for ${quoteId}: ${unexpected instanceof Error ? unexpected.name : 'unknown error'}`)
  }
}
