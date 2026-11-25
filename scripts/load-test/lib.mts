// T-203: the pure parts of the load test (scripts/load-test/run.mts): where it may run, how the
// requests are spread, and the report's sums. Nothing here reads a file, the network or the clock,
// so every rule is unit-tested (apps/web/src/__tests__/load-test-t203.test.ts).

/** No business is sent more than this many requests in a run (the per-business limit is 20 a minute and stays) */
export const PER_BUSINESS_CAP = 15

/** Production's Supabase project (public: it is in the app's build settings) */
export const PRODUCTION_SUPABASE_REF = 'ygsuzeveesgrafgpkrev'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLocalHost(address: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(address).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Why this run is refused, or null when it may go ahead. There is no flag that turns a refusal
 * off: production is the product's own address (and anything under it), the web project's
 * addresses at the host (its main one and every per-deploy one), and anything that names
 * production's database.
 */
export function productionRefusal(appUrl: string, supabaseUrl: string): string | null {
  const app = appRefusal(appUrl)
  if (app) return app
  try {
    new URL(supabaseUrl)
  } catch {
    return 'the Supabase address is not a web address'
  }
  if (supabaseUrl.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) return 'the Supabase address is production’s database'
  // a local database never belongs to an app on the internet, and the other way round
  if (isLocalHost(supabaseUrl) !== isLocalHost(appUrl)) return 'the web address and the Supabase address are not the same environment (one is this machine, the other is not)'
  return null
}

/** The part of the refusal that needs the web address alone (said first, before any setting is asked for) */
export function appRefusal(appUrl: string): string | null {
  let app: URL
  try {
    app = new URL(appUrl)
  } catch {
    return `"${appUrl}" is not a web address`
  }
  if (app.protocol !== 'http:' && app.protocol !== 'https:') return `"${appUrl}" is not a web address`
  const host = app.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'qolumns.com' || host.endsWith('.qolumns.com')) return `${host} is production`
  // the web project's addresses at the host: its main one and each deploy's own (they serve production's data)
  if (host.endsWith('.vercel.app') && /^estimator-/.test(host)) return `${host} belongs to the production web project`
  if (appUrl.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) return 'the web address names production’s database'
  return null
}

/** True when a page or script of the target names production's database (the app's own build says which it uses) */
export function namesProduction(text: string): boolean {
  return text.toLowerCase().includes(PRODUCTION_SUPABASE_REF)
}

export interface Args {
  url: string
  n: number
  keep: boolean
}

/** `--url <address> [--n 25] [--keep]`. The address has no default: a run is always aimed on purpose. */
export function parseArgs(argv: string[]): Args | { error: string } {
  let url = ''
  let n = 25
  let keep = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--url') url = argv[++i] ?? ''
    else if (arg === '--n') n = Number(argv[++i])
    else if (arg === '--keep') keep = true
    else return { error: `unknown argument "${arg}"` }
  }
  if (!url) return { error: 'give the web app’s address: --url http://localhost:3000' }
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: '--n must be a whole number from 1 to 1000' }
  return { url: url.replace(/\/+$/, ''), n, keep }
}

export type Kind = 'text' | 'photos' | 'measured'
export const KINDS: Kind[] = ['text', 'photos', 'measured']
export const KIND_WORDS: Record<Kind, string> = { text: 'text only', photos: 'with photos', measured: 'photo-measured' }

/** About half text only, about half with photos; of those with photos, a few (about a tenth of the run) are photo-measured */
export function kindCounts(n: number): Record<Kind, number> {
  const text = Math.ceil(n / 2)
  const measured = n >= 4 ? Math.min(n - text, Math.max(1, Math.round(n * 0.1))) : 0
  return { text, photos: n - text - measured, measured }
}

export interface PlannedRequest {
  index: number
  /** 0-based: which of the run's businesses receives it */
  business: number
  kind: Kind
}

/**
 * Enough businesses that none gets more than `cap`, the requests dealt out one at a time (so the
 * counts differ by one at most), and each business given a share of every kind.
 */
export function planRun(n: number, cap: number = PER_BUSINESS_CAP): { businesses: number; requests: PlannedRequest[] } {
  const businesses = Math.max(1, Math.ceil(n / cap))
  const counts = kindCounts(n)
  // spread the kinds through the run: measured and photo requests are not bunched at one end
  const order: Kind[] = []
  const left = { ...counts }
  const stride: Record<Kind, number> = { text: n / Math.max(1, counts.text), photos: n / Math.max(1, counts.photos), measured: n / Math.max(1, counts.measured) }
  const next: Record<Kind, number> = { text: 0, photos: stride.photos / 2, measured: stride.measured / 2 }
  for (let i = 0; i < n; i++) {
    const kind = KINDS.filter((k) => left[k] > 0).sort((a, b) => next[a] - next[b])[0]!
    order.push(kind)
    left[kind] -= 1
    next[kind] += stride[kind]
  }
  // dealt per kind, so each business gets its share of each
  const dealt: Record<Kind, number> = { text: 0, photos: 0, measured: 0 }
  const load = new Array<number>(businesses).fill(0)
  const requests = order.map((kind, index) => {
    // the next business in turn for this kind, unless it is already ahead of the lightest one
    let business = dealt[kind]++ % businesses
    const lightest = Math.min(...load)
    if (load[business]! > lightest) business = load.indexOf(lightest)
    load[business]! += 1
    return { index, business, kind }
  })
  return { businesses, requests }
}

/** Nearest-rank percentile (p from 0 to 100) of the numbers given; null when there are none */
export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length)
  return sorted[Math.max(1, rank) - 1]!
}

export interface Spread {
  count: number
  median: number | null
  p95: number | null
  slowest: number | null
}

export function spread(values: number[]): Spread {
  const clean = values.filter((v) => Number.isFinite(v))
  return { count: clean.length, median: percentile(clean, 50), p95: percentile(clean, 95), slowest: clean.length ? Math.max(...clean) : null }
}

/**
 * A status that carries a price: the estimate went to the customer (sent, viewed, accepted), is
 * held for the business to approve (pending_review), or is shown as a range while the customer
 * answers one question (awaiting_clarification). The row must also hold a total.
 */
export const PRICED_STATUSES = ['sent', 'viewed', 'accepted', 'pending_review', 'awaiting_clarification']
/** Not finished: the request is on the queue or being priced */
export const WAITING_STATUSES = ['queued', 'generating']

export type Outcome = 'priced' | 'failed' | 'waiting' | 'not_sent'

export function outcomeOf(status: string | null | undefined, total: unknown): Outcome {
  if (!status) return 'not_sent'
  if (WAITING_STATUSES.includes(status)) return 'waiting'
  if (PRICED_STATUSES.includes(status) && typeof total === 'number' && Number.isFinite(total)) return 'priced'
  return 'failed'
}

/** One request, as the run measured it and as the stored trace describes it */
export interface RequestResult {
  index: number
  kind: Kind
  business: number
  quoteId: string | null
  /** The public endpoint's HTTP status (0 = no answer) and its error code when it refused */
  httpStatus: number
  refusedCode?: string
  /** How long the endpoint took to answer (it waits for the price when the web app prices directly) */
  postMs: number | null
  status: string | null
  total: number | null
  /** Send → the first check that saw the request finished, by this script's clock */
  sendToDoneMs: number | null
  /** From pricing_trace_json.timings (a missing number is "not given") */
  totalMs: number | null
  queueWaitMs: number | null
  busyRetries: number
  overflowCalls: number
  busyRequeues: number
  /** From pricing_trace_json.aiUsage */
  aiCalls: number
  aiCostUsd: number
  unpricedModels: string[]
  byTask: Record<string, number>
}

export interface KindReport {
  sent: number
  priced: number
  failed: number
  waiting: number
  notSent: number
  sendToPricedMs: Spread
  aiCostUsd: number
  aiCallsByTask: Record<string, number>
}

export interface Report {
  sent: number
  accepted: number
  priced: number
  failed: number
  waitingAtCap: number
  notSent: number
  refusals: Record<string, number>
  statuses: Record<string, number>
  sendToPricedMs: Spread
  queueWaitMs: Spread
  pricingMs: Spread
  postMs: Spread
  busyRetries: { total: number; quotes: number }
  overflowCalls: { total: number; quotes: number }
  busyRequeues: { total: number; quotes: number }
  aiCostUsd: { total: number; perPricedQuote: number | null }
  aiCalls: number
  unpricedModels: string[]
  byKind: Record<Kind, KindReport>
}

const usd = (value: number) => Math.round(value * 1_000_000) / 1_000_000
const tally = (results: RequestResult[], pick: (r: RequestResult) => number) => ({
  total: results.reduce((sum, r) => sum + pick(r), 0),
  quotes: results.filter((r) => pick(r) > 0).length,
})

function kindReport(results: RequestResult[]): KindReport {
  const outcomes = results.map((r) => outcomeOf(r.status, r.total))
  const byTask: Record<string, number> = {}
  for (const r of results) for (const [task, calls] of Object.entries(r.byTask)) byTask[task] = (byTask[task] ?? 0) + calls
  return {
    sent: results.length,
    priced: outcomes.filter((o) => o === 'priced').length,
    failed: outcomes.filter((o) => o === 'failed').length,
    waiting: outcomes.filter((o) => o === 'waiting').length,
    notSent: outcomes.filter((o) => o === 'not_sent').length,
    sendToPricedMs: spread(results.filter((r, i) => outcomes[i] === 'priced' && r.sendToDoneMs !== null).map((r) => r.sendToDoneMs!)),
    aiCostUsd: usd(results.reduce((sum, r) => sum + r.aiCostUsd, 0)),
    aiCallsByTask: byTask,
  }
}

export function summarise(results: RequestResult[]): Report {
  const all = kindReport(results)
  const priced = results.filter((r) => outcomeOf(r.status, r.total) === 'priced')
  const refusals: Record<string, number> = {}
  const statuses: Record<string, number> = {}
  for (const r of results) {
    if (r.status) statuses[r.status] = (statuses[r.status] ?? 0) + 1
    else {
      const why = r.refusedCode ?? (r.httpStatus ? `HTTP ${r.httpStatus}` : 'no answer')
      refusals[why] = (refusals[why] ?? 0) + 1
    }
  }
  const cost = usd(results.reduce((sum, r) => sum + r.aiCostUsd, 0))
  return {
    sent: results.length,
    accepted: results.filter((r) => r.quoteId).length,
    priced: all.priced,
    failed: all.failed,
    waitingAtCap: all.waiting,
    notSent: all.notSent,
    refusals,
    statuses,
    sendToPricedMs: all.sendToPricedMs,
    queueWaitMs: spread(results.filter((r) => r.queueWaitMs !== null).map((r) => r.queueWaitMs!)),
    pricingMs: spread(priced.filter((r) => r.totalMs !== null).map((r) => r.totalMs!)),
    postMs: spread(results.filter((r) => r.postMs !== null).map((r) => r.postMs!)),
    busyRetries: tally(results, (r) => r.busyRetries),
    overflowCalls: tally(results, (r) => r.overflowCalls),
    busyRequeues: tally(results, (r) => r.busyRequeues),
    aiCostUsd: { total: cost, perPricedQuote: priced.length ? usd(cost / priced.length) : null },
    aiCalls: results.reduce((sum, r) => sum + r.aiCalls, 0),
    unpricedModels: [...new Set(results.flatMap((r) => r.unpricedModels))].sort(),
    byKind: {
      text: kindReport(results.filter((r) => r.kind === 'text')),
      photos: kindReport(results.filter((r) => r.kind === 'photos')),
      measured: kindReport(results.filter((r) => r.kind === 'measured')),
    },
  }
}

const seconds = (ms: number | null) => (ms === null ? 'not given' : `${(ms / 1000).toFixed(1)} s`)
const spreadLine = (s: Spread) => (s.count === 0 ? 'not given' : `median ${seconds(s.median)}, 95th ${seconds(s.p95)}, slowest ${seconds(s.slowest)} (${s.count} quotes)`)
const dollars = (value: number | null) => (value === null ? 'not given' : `$${value.toFixed(4)}`)
const listing = (counts: Record<string, number>) => Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(', ') || 'none'

/** The report as the owner reads it. Numbers only: no name, no customer text, no key. */
export function reportText(report: Report, context: { target: string; businesses: number; pricedDirectly: boolean; capMinutes: number }): string {
  const lines = [
    `Load test: ${report.sent} requests at the same moment to ${context.target}, across ${context.businesses} test business${context.businesses === 1 ? '' : 'es'}`,
    '',
    `Priced:            ${report.priced} of ${report.sent}`,
    `Failed:            ${report.failed}`,
    `Still waiting:     ${report.waitingAtCap} (after ${context.capMinutes} minutes)`,
    `Not taken in:      ${report.notSent}${report.notSent ? ` (${listing(report.refusals)})` : ''}`,
    `By status:         ${listing(report.statuses)}`,
    '',
    `Send to priced:    ${spreadLine(report.sendToPricedMs)}`,
    `Queue wait:        ${report.queueWaitMs.count === 0 && context.pricedDirectly ? 'not given: the web app priced each request directly, with no queue' : spreadLine(report.queueWaitMs)}`,
    `Pricing itself:    ${spreadLine(report.pricingMs)}`,
    '',
    `Busy retries:      ${report.busyRetries.total} (in ${report.busyRetries.quotes} quotes)`,
    `Overflow calls:    ${report.overflowCalls.total} (in ${report.overflowCalls.quotes} quotes)`,
    `Put back as busy:  ${report.busyRequeues.total} (in ${report.busyRequeues.quotes} quotes)`,
    '',
    `AI cost:           ${dollars(report.aiCostUsd.total)} in all, ${dollars(report.aiCostUsd.perPricedQuote)} a priced quote (${report.aiCalls} calls, registry prices)`,
    ...(report.unpricedModels.length ? [`No price listed:   ${report.unpricedModels.join(', ')} (their calls are not in the cost)`] : []),
    '',
    'By kind:',
  ]
  for (const kind of KINDS) {
    const k = report.byKind[kind]
    if (k.sent === 0) continue
    lines.push(`  ${KIND_WORDS[kind].padEnd(15)} ${k.priced} of ${k.sent} priced, ${k.failed} failed${k.waiting ? `, ${k.waiting} waiting` : ''}${k.notSent ? `, ${k.notSent} not taken in` : ''}; ${spreadLine(k.sendToPricedMs)}; ${dollars(k.aiCostUsd)}; calls: ${listing(k.aiCallsByTask)}`)
  }
  return lines.join('\n')
}
