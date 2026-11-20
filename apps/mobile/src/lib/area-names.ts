/**
 * T-194: the names this business has given its scanned areas, kept on the
 * phone, offered as quick picks the next time an area is named. Nothing is
 * suggested that the business did not type itself: no trade's words are
 * known here. Pure (the phone's copy is read and written by device-files).
 */

/** How many earlier names are kept */
export const AREA_NAMES_KEPT = 12

/** The list with this name first (once, whatever its case), the oldest dropped */
export function rememberAreaName(names: readonly string[], name: string): string[] {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!clean) return [...names]
  return [clean, ...names.filter((n) => n.toLowerCase() !== clean.toLowerCase())].slice(0, AREA_NAMES_KEPT)
}
