/**
 * Numbers that come from the phone itself (T-184).
 *
 * iOS hands some values to JavaScript as BigInt, whatever their declared
 * type says: the bytes sent and expected of an upload are 64-bit integers
 * there. A BigInt cannot be mixed with ordinary numbers; `Math.min(1, x)`
 * with one throws "Cannot convert BigInt to number", which is the red message
 * the owner saw on the Photos and About the job steps while photos uploaded.
 *
 * So every number that crosses from the phone goes through `toNumber` first.
 * Pure, and never throws.
 */

/** An ordinary finite number, whatever was handed over; `fallback` when it is not a number at all */
export function toNumber(value: unknown, fallback = 0): number {
  try {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
    if (typeof value === 'bigint') {
      const n = Number(value)
      return Number.isFinite(n) ? n : fallback
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value)
      return Number.isFinite(n) ? n : fallback
    }
    return fallback
  } catch {
    return fallback
  }
}

/** How far along something is, from 0 to 1, from two counts of any numeric kind */
export function fractionOf(done: unknown, total: unknown): number {
  const all = toNumber(total)
  if (!(all > 0)) return 0
  return clamp01(toNumber(done) / all)
}

/** A fraction kept between 0 and 1, whatever arrives */
export function clamp01(value: unknown): number {
  const n = toNumber(value)
  return n < 0 ? 0 : n > 1 ? 1 : n
}
