/**
 * T-204: a business can pick more than one trade in setup.
 *
 * `tenants.trade` is one text column (T-150: a template pack's id, or 'other').
 * It now holds the picked packs' ids, separated by commas, in the order they
 * were picked: "hvac-us,plumbing-us". One id reads as it always did, so no
 * row changes and there is no migration. The first id is the main trade: the
 * one reader that wants a single trade (the cleaner quote link's suggestions)
 * takes that.
 *
 * "Something else" stands alone: it leads to the website or the business's own
 * words, not to a template.
 */
export const OTHER_TRADE = 'other'

/** More than this is a business describing itself, not picking trades: "Something else" serves it better */
export const MAX_TRADES = 4

/** The ids a stored value (or a form's answer) holds, in order, each once */
export function tradeIds(value: string | readonly string[] | null | undefined): string[] {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const ids: string[] = []
  for (const part of parts) {
    const id = typeof part === 'string' ? part.trim() : ''
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** The value to store for these ids; null for none */
export function tradeValue(ids: readonly string[]): string | null {
  const list = tradeIds(ids)
  return list.length > 0 ? list.join(',') : null
}

/** The first trade picked, or null */
export function mainTrade(value: string | readonly string[] | null | undefined): string | null {
  return tradeIds(value)[0] ?? null
}

/**
 * What is wrong with a set of picked trades, or null when it can be saved.
 * `isPack` says whether an id is a template pack.
 */
export function tradesProblem(ids: readonly string[], isPack: (id: string) => boolean): string | null {
  if (ids.length === 0) return null
  if (ids.includes(OTHER_TRADE)) return ids.length === 1 ? null : '"Something else" cannot be combined with a trade'
  if (ids.length > MAX_TRADES) return `Pick up to ${MAX_TRADES} trades`
  return ids.every(isPack) ? null : 'Unknown trade'
}

/** Add or remove a trade from the picked ones, as the setup screen's options do */
export function toggleTrade(picked: readonly string[], id: string): string[] {
  if (id === OTHER_TRADE) return picked.includes(OTHER_TRADE) ? [] : [OTHER_TRADE]
  const packs = picked.filter((p) => p !== OTHER_TRADE)
  if (packs.includes(id)) return packs.filter((p) => p !== id)
  return packs.length >= MAX_TRADES ? packs : [...packs, id]
}
