/**
 * T-210, T-211: what a test call found, and the same as plain text for the report.
 *
 * The page keeps one of these while a call runs and after it ends. Nothing here is stored
 * anywhere: it lives in the page, and "Copy results" puts its text on the clipboard.
 *
 * Pure. No browser API here.
 */
import { findConfidenceLanguage, type LiveMinutePrice, type LiveModelPrice, type ModelPrice } from '@qolumns/shared'
import { ENGINE_NAMES, type Engine } from './config'
import { callCost, median, minuteCost, usdText, worst, type CallTokens, type MinuteUsage } from './cost'
import type { GuardStatus } from './guard'
import type { EndReason } from './guard-config'
import type { CallContact } from './session'
import { spokenAmounts, type EngineFigures, type SpokenAmount } from './spoken'

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
  /**
   * When the turn used a tool: from the caller's last sound to her first sound AFTER the tool answered (the
   * answer itself). `ms` is then to her first words, which may be "one moment". Null for a turn with no tool.
   */
  answerMs?: number | null
  /** The tools of this turn */
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
  /** get_typical_price: the engine's typical total and lines */
  typical?: { service: string; currency: string; total: number; lines: number[] }
}

/** What the engines charge by: the registry's prices, as the session route handed them over */
export interface CallPrices {
  live: LiveModelPrice | null
  minute: LiveMinutePrice | null
  backend: ModelPrice | null
}

export interface CallResults {
  business: string
  engine: Engine
  model: string
  voice: string
  browser: string
  /** How long the call has run, in seconds */
  seconds: number
  status: 'idle' | 'starting' | 'live' | 'ended'
  endedBecause: string | null
  /** Why she ended the call, when she did (her end_call tool) */
  endReason: EndReason | null
  transcript: TranscriptEntry[]
  turns: TurnDelay[]
  tools: ToolRecord[]
  /** Gemini: tokens by kind, added up over the call's turns */
  tokens: CallTokens
  /** The size of the context at each turn (what that turn was billed for reading): a trimmed call saws, an untrimmed one climbs */
  contexts: number[]
  /** OpenAI: the session's seconds and its backend model's tokens */
  minutes: MinuteUsage
  /** Strikes and block of this visitor, as last heard from the server */
  guard: GuardStatus | null
  /** The caller's details as they now stand, and which ones were corrected in the call */
  contact: CallContact
  corrected: Array<{ at: number; field: string; value: string }>
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

/** Every figure the engine has given her so far in the call: a spoken amount of money must be one of them */
export interface ValidAmounts {
  currency: string | null
  totals: number[]
  lines: number[]
  typical: number[]
}

export function validAmounts(tools: readonly ToolRecord[], upTo = Number.POSITIVE_INFINITY): ValidAmounts {
  const valid: ValidAmounts = { currency: null, totals: [], lines: [], typical: [] }
  for (const t of tools) {
    if (!t.ok || t.at > upTo) continue
    if (t.engine) {
      valid.currency = t.engine.currency
      valid.totals.push(t.engine.total)
      // the lines, and with tax the amount before it and the tax itself, are the engine's line amounts
      valid.lines.push(...(t.engine.lines ?? []).map(Math.abs), ...(t.engine.taxAmount && t.engine.taxAmount > 0 ? [t.engine.subtotal ?? t.engine.total, t.engine.taxAmount] : []))
    }
    if (t.typical) {
      valid.currency = valid.currency ?? t.typical.currency
      valid.typical.push(t.typical.total)
    }
  }
  return valid
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005

export interface SaidAmount extends SpokenAmount {
  at: number
  is: 'total' | 'line' | 'typical' | 'not_the_engines'
  wrongCurrency: boolean
}

/**
 * T-211: every amount of money she said in the call, each held against what the engine had given
 * her BY THEN. Valid: an engine total, an engine line amount, or a typical price returned in this
 * call. Anything else is a mismatch.
 */
export function moneySaid(results: Pick<CallResults, 'tools' | 'transcript'>): SaidAmount[] {
  return results.transcript
    .filter((e) => e.who === 'her')
    .flatMap((entry) => {
      const valid = validAmounts(results.tools, entry.at)
      return spokenAmounts(entry.text)
        .filter((a) => a.money)
        .map((a): SaidAmount => {
          const is = valid.totals.some((t) => same(t, a.amount)) ? 'total' : valid.typical.some((t) => same(t, a.amount)) ? 'typical' : valid.lines.some((l) => same(l, a.amount)) ? 'line' : 'not_the_engines'
          return { ...a, at: entry.at, is, wrongCurrency: a.currency !== null && valid.currency !== null && a.currency !== valid.currency }
        })
    })
}

export interface EstimateCheck {
  at: number
  service: string
  kind: 'estimate' | 'typical'
  total: number
  currency: string
  /** She said this total, with a currency or without, before the next price she was given */
  said: boolean
}

/** Each price the engine gave her, and whether she then said it */
export function priceChecks(results: Pick<CallResults, 'tools' | 'transcript'>): EstimateCheck[] {
  const priced = results.tools.filter((t) => t.ok && (t.engine || t.typical))
  return priced.map((t, i) => {
    const until = priced[i + 1]?.at ?? Number.POSITIVE_INFINITY
    const total = t.engine ? t.engine.total : t.typical!.total
    const service = t.typical?.service ?? (typeof (t.response as { service?: unknown })?.service === 'string' ? (t.response as { service: string }).service : '')
    return { at: t.at, service, kind: t.engine ? 'estimate' : 'typical', total, currency: t.engine?.currency ?? t.typical!.currency, said: spokenAmounts(herSpeech(results.transcript, t.at, until)).some((a) => same(a.amount, total)) }
  })
}

/** Words she must not use about a price that she used anyway (the customer language guard's own check) */
export function bannedWordsSaid(transcript: readonly TranscriptEntry[]): string[] {
  return [...new Set(transcript.filter((e) => e.who === 'her').flatMap((e) => findConfidenceLanguage(e.text)))]
}

/** How she says a thing is for the team: "not on my list", or that the team will confirm or be asked */
const FOR_THE_TEAM = /not on (my|our|the) list|(get|have|ask) (the|our) team (to )?(confirm|check)|check with (the|our) team/i

/**
 * T-211: what she could not answer from the business's lists, for the business to follow up.
 * Read from the call itself: each time she says it is not on her list (or that she will get the
 * team to confirm), what the caller had just asked is recorded. No tool is called for it: a tool
 * cost a second billed turn and a second sentence every time.
 */
export function forTheTeam(transcript: readonly TranscriptEntry[]): Array<{ at: number; asked: string; said: string }> {
  const out: Array<{ at: number; asked: string; said: string }> = []
  let asked = ''
  for (const entry of transcript) {
    if (entry.who === 'caller') asked = entry.text.trim()
    // a line with a price in it is an estimate being called "an estimate we'll confirm", not an unanswered question
    else if (FOR_THE_TEAM.test(entry.text) && !spokenAmounts(entry.text).some((a) => a.money) && asked && out.at(-1)?.asked !== asked) out.push({ at: entry.at, asked, said: entry.text.trim() })
  }
  return out
}

/** Sentences she said more than once in the call (she is told never to) */
export function repeatedSentences(transcript: readonly TranscriptEntry[]): string[] {
  const seen = new Map<string, number>()
  for (const entry of transcript) {
    if (entry.who !== 'her') continue
    for (const sentence of entry.text.split(/(?<=[.!?])\s+/)) {
      const key = sentence.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
      if (key.split(' ').length >= 4) seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen].filter(([, n]) => n > 1).map(([sentence, n]) => `"${sentence}" (${n} times)`)
}

export const delaysOf = (turns: readonly TurnDelay[]): number[] => turns.map((t) => t.ms).filter((ms): ms is number => ms !== null)
/** For turns that used a tool: how long until the answer itself (after the tool). And the delays of turns with no tool. */
export const toolDelaysOf = (turns: readonly TurnDelay[]): number[] => turns.filter((t) => t.tools.length > 0 && typeof t.answerMs === 'number').map((t) => t.answerMs!)
export const plainDelaysOf = (turns: readonly TurnDelay[]): number[] => turns.filter((t) => t.ms !== null && t.tools.length === 0).map((t) => t.ms!)

/** The cost of the call so far, whichever way its engine charges */
export function costOf(r: Pick<CallResults, 'engine' | 'tokens' | 'minutes' | 'seconds'>, prices: CallPrices): { totalUsd: number; perMinuteUsd: number | null } | null {
  return r.engine === 'gemini' ? callCost(r.tokens, prices.live, r.seconds) : minuteCost({ ...r.minutes, seconds: r.minutes.seconds || r.seconds }, prices.minute, prices.backend)
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const ms = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value)} ms`)
const until = (seconds: number | null) => (seconds === null ? '' : new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC')

/** The whole results panel as plain text */
export function resultsText(r: CallResults, prices: CallPrices): string {
  const out: string[] = []
  const delays = delaysOf(r.turns)

  out.push('OUMN TEST CALL')
  out.push(`Business: ${r.business}`)
  out.push(`Engine: ${ENGINE_NAMES[r.engine]}   Model: ${r.model}   Voice: ${r.voice}`)
  out.push(`Browser: ${r.browser}`)
  out.push(`Length: ${clock(r.seconds)}   Ended: ${r.endedBecause ?? 'not yet'}${r.endReason ? `   Her reason: ${r.endReason}` : ''}`)
  out.push(`Strikes: ${r.guard ? (r.guard.unavailable ? 'not counted (the store was not there)' : String(r.guard.strikes)) : 'n/a'}   Blocked: ${r.guard?.blocked ? `yes, until ${until(r.guard.blockedUntil)}` : 'no'}${r.guard && !r.guard.unavailable ? `   Calls today: device ${r.guard.deviceCallsToday ?? 'n/a'}, business ${r.guard.businessCallsToday ?? 'n/a'}` : ''}`)

  out.push('', '1. COST')
  if (r.engine === 'gemini') {
    const cost = callCost(r.tokens, prices.live, r.seconds)
    if (cost && prices.live) {
      out.push(`Total: ${usdText(cost.totalUsd)}   Per minute: ${cost.perMinuteUsd === null ? 'n/a' : usdText(cost.perMinuteUsd)}`)
      out.push(`Audio in: ${r.tokens.audioIn} tokens, ${usdText(cost.audioInUsd)}`)
      out.push(`Text in: ${r.tokens.textIn} tokens, ${usdText(cost.textInUsd)}`)
      out.push(`Audio out: ${r.tokens.audioOut} tokens, ${usdText(cost.audioOutUsd)}`)
      out.push(`Text out: ${r.tokens.textOut} tokens, ${usdText(cost.textOutUsd)}`)
      out.push(`Thinking (charged as text out): ${r.tokens.thoughts} tokens, ${usdText(cost.thoughtsUsd)}`)
      if (cost.unpricedTokens > 0) out.push(`Other input, not priced here: ${cost.unpricedTokens} tokens`)
      out.push(`Usage reports from the Live API: ${r.tokens.turns}`)
      out.push(`Context read at each turn (tokens): ${r.contexts.join(', ') || 'none yet'}`)
      out.push(`Prices per 1M tokens (${prices.live.asOf}): text in $${prices.live.textInPerMTok}, audio in $${prices.live.audioInPerMTok}, text out $${prices.live.textOutPerMTok}, audio out $${prices.live.audioOutPerMTok}`)
    } else out.push('No Live API price in the registry for this model: the cost was not worked out.')
  } else {
    const usage = { ...r.minutes, seconds: r.minutes.seconds || r.seconds }
    const cost = minuteCost(usage, prices.minute, prices.backend)
    if (cost && prices.minute) {
      out.push(`Total: ${usdText(cost.totalUsd)}   Per minute: ${cost.perMinuteUsd === null ? 'n/a' : usdText(cost.perMinuteUsd)}`)
      out.push(`Voice: ${Math.round(cost.billedSeconds)} s charged at $${prices.minute.activePerMinute} a minute (a session is charged at least ${prices.minute.startSeconds} s), ${usdText(cost.voiceUsd)}`)
      out.push(`Backend model: ${r.minutes.backendIn} tokens in (${r.minutes.backendCachedIn} from cache), ${r.minutes.backendOut} out, ${usdText(cost.backendUsd)}${prices.backend ? '' : ' (no price in the registry)'}`)
      out.push(`Prices (${prices.minute.asOf}): voice $${prices.minute.activePerMinute} a minute${prices.backend ? `; backend per 1M tokens: in $${prices.backend.inputPerMTok}, out $${prices.backend.outputPerMTok}` : ''}`)
    } else out.push('No per-minute price in the registry for this model: the cost was not worked out.')
  }

  out.push('', '2. DELAY BEFORE SHE ANSWERS (caller stops speaking to her first audio)')
  out.push(`Median: ${ms(median(delays))}   Worst: ${ms(worst(delays))}   Turns measured: ${delays.length}`)
  out.push(`Without a tool: median ${ms(median(plainDelaysOf(r.turns)))}, worst ${ms(worst(plainDelaysOf(r.turns)))}   With a tool, to the answer itself: median ${ms(median(toolDelaysOf(r.turns)))}, worst ${ms(worst(toolDelaysOf(r.turns)))}`)
  for (const t of r.turns) out.push(`  Turn ${t.n} at ${clock(t.at)}: ${t.ms === null ? 'no caller speech before it' : `${Math.round(t.ms)} ms`}${t.tools.length > 0 ? ` (${t.tools.join(', ')}${typeof t.answerMs === 'number' && t.answerMs !== t.ms ? `: ${Math.round(t.answerMs)} ms to the answer` : ''})` : ''}${t.overlapped ? ' (she began over the caller)' : ''}`)

  out.push('', "4. PRICE CHECK (what she said against the engine's figures)")
  const checks = priceChecks(r)
  if (checks.length === 0) out.push('The engine gave her no price on this call.')
  for (const c of checks) out.push(`  ${clock(c.at)} ${c.kind === 'typical' ? 'typical price' : 'estimate'}, ${c.service}: ${c.total.toFixed(2)} ${c.currency} | ${c.said ? 'SAID' : 'NOT SAID'}`)
  const said = moneySaid(r)
  if (said.length === 0) out.push('She said no amount of money.')
  for (const s of said) out.push(`  ${clock(s.at)} she said "${s.text}" = ${s.amount.toFixed(2)}: ${s.is === 'not_the_engines' ? "MISMATCH (not a figure the engine gave)" : `valid (${s.is === 'total' ? 'an engine total' : s.is === 'typical' ? 'a typical price' : 'an engine line'})`}${s.wrongCurrency ? ' WRONG CURRENCY' : ''}`)
  const banned = bannedWordsSaid(r.transcript)
  out.push(`Words she must not use about a price: ${banned.length === 0 ? 'none said' : banned.join('; ')}`)
  const repeats = repeatedSentences(r.transcript)
  out.push(`Sentences she said more than once: ${repeats.length === 0 ? 'none' : repeats.join('; ')}`)

  out.push('', '5. WHAT SHE RECORDED')
  const team = forTheTeam(r.transcript)
  out.push(`Not on her list, for the team to confirm: ${team.length === 0 ? 'nothing' : ''}`)
  for (const item of team) out.push(`  ${clock(item.at)} the caller asked: "${item.asked}"`)
  out.push(`Contact details corrected: ${r.corrected.length === 0 ? 'none' : r.corrected.map((c) => `${clock(c.at)} ${c.field} is now ${c.value}`).join('; ')}`)
  out.push(`Details on file: ${r.contact.name}${r.contact.email ? `, ${r.contact.email}` : ''}${r.contact.phone ? `, ${r.contact.phone}` : ''}`)

  out.push('', '6. TOOL CALLS')
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
