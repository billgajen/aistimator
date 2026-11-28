/**
 * T-210: what a test call found, and the same as plain text for the report.
 *
 * The page keeps one of these while a call runs and after it ends. Nothing here is stored
 * anywhere: it lives in the page, and "Copy results" puts its text on the clipboard.
 *
 * Pure. No browser API here.
 */
import { findConfidenceLanguage, type LiveModelPrice } from '@qolumns/shared'
import { callCost, median, usdText, worst, type CallTokens } from './cost'
import { checkSpokenPrice, type EngineFigures, type PriceCheck } from './spoken'

export interface TranscriptEntry {
  who: 'caller' | 'her'
  /** Seconds into the call when the entry began */
  at: number
  text: string
}

export interface TurnDelay {
  n: number
  at: number
  /** From the caller's last sound to her first audio, in milliseconds. Null when she spoke with nothing said before (the opening, or carrying on). */
  ms: number | null
  /** The tools she waited for before she spoke: their time is inside the delay */
  tools: string[]
  /** She began while the caller was still making sound */
  overlapped: boolean
}

export interface ToolRecord {
  at: number
  name: string
  args: unknown
  ok: boolean
  response: unknown
  /** How long our server took, in milliseconds */
  ms: number
  wouldDo?: string
  engine?: EngineFigures
}

export interface CallResults {
  business: string
  model: string
  voice: string
  browser: string
  /** How long the call has run, in seconds */
  seconds: number
  status: 'idle' | 'starting' | 'live' | 'ended'
  endedBecause: string | null
  transcript: TranscriptEntry[]
  turns: TurnDelay[]
  tools: ToolRecord[]
  tokens: CallTokens
  /** What went wrong, in the order it happened */
  problems: string[]
}

/** What she said from one moment of the call to another */
export function herSpeech(transcript: readonly TranscriptEntry[], from: number, to: number): string {
  return transcript
    .filter((e) => e.who === 'her' && e.at >= from && e.at < to)
    .map((e) => e.text.trim())
    .join(' ')
}

export interface EstimateCheck extends PriceCheck {
  at: number
  service: string
  engine: EngineFigures
}

/**
 * For every estimate she got: the engine's total beside the amounts she then said, up to the
 * next estimate (or the end of the call).
 */
export function priceChecks(results: Pick<CallResults, 'tools' | 'transcript'>): EstimateCheck[] {
  const estimates = results.tools.filter((t) => t.name === 'get_estimate' && t.ok && t.engine)
  return estimates.map((t, i) => {
    const until = estimates[i + 1]?.at ?? Number.POSITIVE_INFINITY
    const service = typeof (t.response as { service?: unknown })?.service === 'string' ? (t.response as { service: string }).service : ''
    return { at: t.at, service, engine: t.engine!, ...checkSpokenPrice(t.engine!, herSpeech(results.transcript, t.at, until)) }
  })
}

/** Words she must not use about a price that she used anyway (the customer language guard's own check) */
export function bannedWordsSaid(transcript: readonly TranscriptEntry[]): string[] {
  return [...new Set(transcript.filter((e) => e.who === 'her').flatMap((e) => findConfidenceLanguage(e.text)))]
}

export const delaysOf = (turns: readonly TurnDelay[]): number[] => turns.map((t) => t.ms).filter((ms): ms is number => ms !== null)

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const money = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`

/** The whole results panel as plain text */
export function resultsText(r: CallResults, price: LiveModelPrice | null): string {
  const out: string[] = []
  const delays = delaysOf(r.turns)
  const cost = callCost(r.tokens, price, r.seconds)
  const mid = median(delays)
  const top = worst(delays)

  out.push('OUMN TEST CALL')
  out.push(`Business: ${r.business}`)
  out.push(`Model: ${r.model}   Voice: ${r.voice}`)
  out.push(`Browser: ${r.browser}`)
  out.push(`Length: ${clock(r.seconds)}${r.endedBecause ? `   Ended: ${r.endedBecause}` : ''}`)

  out.push('', '1. COST')
  if (cost && price) {
    out.push(`Total: ${usdText(cost.totalUsd)}   Per minute: ${cost.perMinuteUsd === null ? 'n/a' : usdText(cost.perMinuteUsd)}`)
    out.push(`Audio in: ${r.tokens.audioIn} tokens, ${usdText(cost.audioInUsd)}`)
    out.push(`Text in: ${r.tokens.textIn} tokens, ${usdText(cost.textInUsd)}`)
    out.push(`Audio out: ${r.tokens.audioOut} tokens, ${usdText(cost.audioOutUsd)}`)
    out.push(`Text out: ${r.tokens.textOut} tokens, ${usdText(cost.textOutUsd)}`)
    out.push(`Thinking (charged as text out): ${r.tokens.thoughts} tokens, ${usdText(cost.thoughtsUsd)}`)
    if (cost.unpricedTokens > 0) out.push(`Other input, not priced here: ${cost.unpricedTokens} tokens`)
    out.push(`Usage reports from the Live API: ${r.tokens.turns}`)
    out.push(`Prices per 1M tokens (${price.asOf}): text in $${price.textInPerMTok}, audio in $${price.audioInPerMTok}, text out $${price.textOutPerMTok}, audio out $${price.audioOutPerMTok}`)
  } else out.push('No Live API price in the registry for this model: the cost was not worked out.')

  out.push('', '2. DELAY BEFORE SHE ANSWERS (caller stops speaking to her first audio)')
  out.push(`Median: ${mid === null ? 'n/a' : `${Math.round(mid)} ms`}   Worst: ${top === null ? 'n/a' : `${Math.round(top)} ms`}   Turns measured: ${delays.length}`)
  for (const t of r.turns) out.push(`  Turn ${t.n} at ${clock(t.at)}: ${t.ms === null ? 'no caller speech before it' : `${Math.round(t.ms)} ms`}${t.tools.length > 0 ? ` (after ${t.tools.join(', ')})` : ''}${t.overlapped ? ' (she began over the caller)' : ''}`)

  out.push('', '4. PRICE CHECK (the engine\'s total against what she said)')
  const checks = priceChecks(r)
  if (checks.length === 0) out.push('She got no estimate on this call.')
  for (const c of checks) {
    const verdict = c.verdict === 'match' ? 'MATCH' : c.verdict === 'mismatch' ? 'MISMATCH' : 'TOTAL NOT SAID'
    out.push(`  ${clock(c.at)} ${c.service}: engine total ${money(c.engine.total, c.engine.currency)} | she said: ${c.said.length === 0 ? 'no amount of money' : c.said.map((s) => `"${s.text}" = ${s.amount.toFixed(2)}${s.is === 'not_the_engines' ? ' (NOT THE ENGINE\'S)' : ` (${s.is})`}${s.wrongCurrency ? ' (WRONG CURRENCY)' : ''}`).join('; ')} | ${verdict}`)
  }
  const banned = bannedWordsSaid(r.transcript)
  out.push(`Words she must not use about a price: ${banned.length === 0 ? 'none said' : banned.join('; ')}`)

  out.push('', '5. TOOL CALLS')
  if (r.tools.length === 0) out.push('None.')
  for (const t of r.tools) {
    out.push(`  ${clock(t.at)} ${t.name}(${JSON.stringify(t.args ?? {})}) ${t.ok ? 'ok' : 'REFUSED'} in ${t.ms} ms`)
    if (t.wouldDo) out.push(`    ${t.wouldDo}`)
    out.push(`    -> ${JSON.stringify(t.response)}`)
  }

  if (r.problems.length > 0) {
    out.push('', 'PROBLEMS')
    for (const p of r.problems) out.push(`  ${p}`)
  }

  out.push('', 'TRANSCRIPT')
  for (const e of r.transcript) out.push(`  ${clock(e.at)} ${e.who === 'her' ? 'Oumn' : 'Caller'}: ${e.text.trim()}`)
  out.push('', '3. HOW SHE SOUNDS: for the listener to write (Mac Chrome, iPhone Safari, a British listener).')
  return out.join('\n')
}
