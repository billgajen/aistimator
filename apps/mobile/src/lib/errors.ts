/**
 * What the app says when something goes wrong (T-184): a plain sentence,
 * never a program's own error text.
 *
 * The server's messages are already written for a person (the API's `message`
 * field), so an ApiError is shown as it is. Anything else (a fault inside the
 * app or the phone) is replaced by a plain line: "Cannot convert BigInt to
 * number" tells a trade nothing, and must never reach the screen.
 */
import { ApiError } from './api'

export const PLAIN = {
  offline: 'No signal. Nothing was lost. Try again when you are back online.',
  unknown: 'Something went wrong. Nothing was lost. Try again.',
  signIn: 'Please sign in again.',
  /** T-191: the plan's quotes are used. No "upgrade" and no plan to pick: the app may not point at a purchase */
  planLimit: 'Your plan’s quotes are used, so this request cannot be priced yet.',
} as const

/** T-191: words that point at buying something; the App Store does not allow them in the app */
const BUYING = /\b(upgrade|pick a plan|choose a plan|subscribe|billing|checkout|pricing page|buy)\b/i

/** Is this text something a person wrote for a person? */
function readsPlainly(text: string): boolean {
  const t = text.trim()
  if (t.length < 4 || t.length > 240) return false
  // a program's error: a type name, a stack, code punctuation, a status dump
  if (/\b(TypeError|ReferenceError|RangeError|SyntaxError|undefined is not|is not a function|null is not|NaN|BigInt|JSON|Promise|Exception|stack|at .+:\d+)\b/i.test(t)) return false
  if (/^Request failed \(\d+\)$/.test(t)) return false
  if (/[{}<>;=]|\(\)|=>/.test(t)) return false
  return /^[A-Z“"']/.test(t)
}

/** The sentence to show for anything that was thrown */
export function plainError(thrown: unknown, fallback: string = PLAIN.unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.offline) return PLAIN.offline
    if (thrown.status === 401) return PLAIN.signIn
    if (thrown.status === 402 || thrown.code === 'PLAN_LIMIT_REACHED') return PLAIN.planLimit
    if (BUYING.test(thrown.message)) return fallback
    return readsPlainly(thrown.message) ? thrown.message : fallback
  }
  return fallback
}
