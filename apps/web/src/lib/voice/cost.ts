/**
 * T-210: what a test call cost, from the Live API's own usage figures and the registry's prices.
 *
 * The Live API sends a `usageMetadata` message as each turn finishes. Each one counts that turn:
 * everything the model read for it (the whole conversation so far, which is why the audio heard
 * earlier is counted again each turn) and what it produced. A call's cost is the sum over its
 * turns. Tokens are split by modality; a count with no modality given (a tool call's few tokens,
 * the model's thinking) is charged as text, which is how Google prices it.
 *
 * Pure. No price is written here: every rate is the registry's (`live.prices`).
 */
import type { LiveModelPrice } from '@qolumns/shared'

export interface ModalityCount {
  modality?: string
  tokenCount?: number
}

/** One `usageMetadata` message, as the Live API sends it */
export interface LiveUsage {
  promptTokenCount?: number
  responseTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
  toolUsePromptTokenCount?: number
  cachedContentTokenCount?: number
  promptTokensDetails?: ModalityCount[]
  responseTokensDetails?: ModalityCount[]
  toolUsePromptTokensDetails?: ModalityCount[]
}

/** A call's tokens, added up over its turns */
export interface CallTokens {
  turns: number
  textIn: number
  audioIn: number
  /** Input of any other kind (a picture): none is sent by the test page */
  otherIn: number
  textOut: number
  audioOut: number
  /** The model's thinking: charged as text out */
  thoughts: number
}

export const NO_TOKENS: CallTokens = { turns: 0, textIn: 0, audioIn: 0, otherIn: 0, textOut: 0, audioOut: 0, thoughts: 0 }

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

function split(total: unknown, details: ModalityCount[] | undefined): { text: number; audio: number; other: number } {
  let text = 0
  let audio = 0
  let other = 0
  for (const d of details ?? []) {
    const n = count(d.tokenCount)
    const modality = String(d.modality ?? '').toUpperCase()
    if (modality === 'AUDIO') audio += n
    else if (modality === 'TEXT') text += n
    else other += n
  }
  // What the details do not account for has no modality: text
  text += Math.max(0, count(total) - text - audio - other)
  return { text, audio, other }
}

/** Add one turn's usage to a call's running total */
export function addUsage(sum: CallTokens, usage: LiveUsage): CallTokens {
  const prompt = split(usage.promptTokenCount, usage.promptTokensDetails)
  const tools = split(usage.toolUsePromptTokenCount, usage.toolUsePromptTokensDetails)
  const response = split(usage.responseTokenCount, usage.responseTokensDetails)
  return {
    turns: sum.turns + 1,
    textIn: sum.textIn + prompt.text + tools.text,
    audioIn: sum.audioIn + prompt.audio + tools.audio,
    otherIn: sum.otherIn + prompt.other + tools.other,
    textOut: sum.textOut + response.text + response.other,
    audioOut: sum.audioOut + response.audio,
    thoughts: sum.thoughts + count(usage.thoughtsTokenCount),
  }
}

export interface CallCost {
  textInUsd: number
  audioInUsd: number
  textOutUsd: number
  audioOutUsd: number
  thoughtsUsd: number
  totalUsd: number
  /** Null until the call has run for a second */
  perMinuteUsd: number | null
  /** Input the registry has no price for (not text, not audio): counted, not charged here */
  unpricedTokens: number
}

const usd = (tokens: number, perMTok: number) => (tokens * perMTok) / 1_000_000

/** The call's cost at the registry's prices; null when the registry has no Live price for the model */
export function callCost(tokens: CallTokens, price: LiveModelPrice | null, seconds: number): CallCost | null {
  if (!price) return null
  const textInUsd = usd(tokens.textIn, price.textInPerMTok)
  const audioInUsd = usd(tokens.audioIn, price.audioInPerMTok)
  const textOutUsd = usd(tokens.textOut, price.textOutPerMTok)
  const audioOutUsd = usd(tokens.audioOut, price.audioOutPerMTok)
  const thoughtsUsd = usd(tokens.thoughts, price.textOutPerMTok)
  const totalUsd = textInUsd + audioInUsd + textOutUsd + audioOutUsd + thoughtsUsd
  return { textInUsd, audioInUsd, textOutUsd, audioOutUsd, thoughtsUsd, totalUsd, perMinuteUsd: seconds >= 1 ? totalUsd / (seconds / 60) : null, unpricedTokens: tokens.otherIn }
}

/** T-211: what a call on an engine billed by the minute used: the session's seconds, and its backend model's tokens */
export interface MinuteUsage {
  /** Seconds of session, as the engine reports them (the page's own clock until it does) */
  seconds: number
  backendIn: number
  /** Of `backendIn`, how many were read from the provider's cache */
  backendCachedIn: number
  backendOut: number
}

export const NO_MINUTES: MinuteUsage = { seconds: 0, backendIn: 0, backendCachedIn: 0, backendOut: 0 }

export interface MinuteCost {
  voiceUsd: number
  /** The seconds the voice is charged for: the session's own, and never less than the seconds billed at its start */
  billedSeconds: number
  backendUsd: number
  totalUsd: number
  perMinuteUsd: number | null
}

/**
 * The cost of a call on an engine billed by the minute: the voice at its active rate (a session is
 * billed some seconds as it starts, and its own time is credited against them, so the charge is
 * for whichever is more), plus the backend model's tokens at that model's prices.
 */
export function minuteCost(usage: MinuteUsage, voice: { activePerMinute: number; startSeconds: number } | null, backend: { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number } | null): MinuteCost | null {
  if (!voice) return null
  const billedSeconds = Math.max(usage.seconds, voice.startSeconds)
  const voiceUsd = (billedSeconds / 60) * voice.activePerMinute
  const fresh = Math.max(0, usage.backendIn - usage.backendCachedIn)
  const backendUsd = backend ? usd(fresh, backend.inputPerMTok) + usd(usage.backendCachedIn, backend.cachedInputPerMTok ?? backend.inputPerMTok) + usd(usage.backendOut, backend.outputPerMTok) : 0
  const totalUsd = voiceUsd + backendUsd
  return { voiceUsd, billedSeconds, backendUsd, totalUsd, perMinuteUsd: usage.seconds >= 1 ? totalUsd / (usage.seconds / 60) : null }
}

/** Dollars to four places: a call costs cents, and a cent is too coarse to compare two calls */
export const usdText = (amount: number) => `$${amount.toFixed(4)}`

/** The middle of a list of numbers; null for none */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function worst(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values)
}
