/**
 * T-204: "Photos required" on a service: how many photos a customer must add
 * before they can send a request. 0 means photos are optional. One rule for
 * the editor, the save and the pricing description, so a business's 0 is never
 * turned back into 1. No imports: scripts load this with tsx.
 */
export const MAX_PHOTOS_REQUIRED = 8

/** A whole number from 0 to 8. Anything that is not a number is `fallback` (a new service asks for 1). */
export function photosRequired(value: unknown, fallback = 1): number {
  const typed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(typed)) return Math.min(MAX_PHOTOS_REQUIRED, Math.max(0, Math.floor(fallback)))
  return Math.min(MAX_PHOTOS_REQUIRED, Math.max(0, Math.floor(typed)))
}
