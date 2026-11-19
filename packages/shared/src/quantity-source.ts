/**
 * T-183: where a price line's quantity (or the line itself) came from.
 *
 * The worker knows this when it prices: a quantity measured from the photos,
 * read off a label, given by the customer, scanned on site, worked out, or a
 * fixed price of the business's. It stores a short code on the line, and the
 * words are chosen here: one set for the customer (T-146, the takeoff's
 * `method`) and one for the business, who must judge a price before sending
 * it ("Measured from photos", "The customer's answer").
 *
 * Pure. No business's words are known here.
 */

export type LineSource =
  /** measured from the customer's photos */
  | 'photos'
  /** read off a label or rating plate in a photo */
  | 'label'
  /** the customer's answer to one of the business's questions */
  | 'answer'
  /** an on-site room scan (T-138) */
  | 'scan'
  /** estimated from the customer's details: nothing was measured or given */
  | 'details'
  /** worked out from the customer's answers by the business's formula */
  | 'calculated'
  /** the business's fixed price or fixed quantity */
  | 'fixed'
  /** a line added because of what was written with the request: an extra, or a step its notes call for */
  | 'words'
  /** T-188: a line added because of what the photos show (a step or an extra the photos call for) */
  | 'seen'
  /** an extra the customer chose */
  | 'choice'

/** What the customer reads beside a quantity (the takeoff's `method`, T-146) */
export const CUSTOMER_METHOD = {
  photos: 'From your photos',
  answers: 'From your answers',
  scan: 'From the on-site room scan',
  details: 'Estimated from your details',
  quantityGiven: 'Quantity provided by you',
  fixedQuantity: 'Fixed quantity',
  fixedPrice: 'Fixed price',
  standardCharge: 'Standard charge for every job',
  calculated: 'Calculated from your answers',
  fromDescription: 'Added from your description',
  selectedExtra: 'Selected extra',
  adjustment: 'Adjustment from your answers',
} as const

/** What the business reads beside a line of a quote a customer asked for */
const BUSINESS_WORDS: Record<LineSource, string> = {
  photos: 'Measured from photos',
  label: 'Read from a label in the photos',
  answer: "The customer's answer",
  scan: 'On-site room scan',
  details: "Estimated from the customer's details",
  calculated: "Worked out from the customer's answers",
  fixed: 'Your fixed price',
  // T-188: a line the product added says where it came from, never "Your fixed price"
  words: 'From the notes',
  seen: 'From the photos',
  choice: "The customer's choice",
}

/**
 * T-186: the same, on a quote the business made itself. The answers, the
 * notes and the choices on it are the business's own, so they are not called
 * the customer's. What was measured, read, scanned or fixed reads the same.
 */
const OWN_WORDS: Record<LineSource, string> = {
  ...BUSINESS_WORDS,
  answer: 'Your answer',
  details: 'Estimated from the details you gave',
  calculated: 'Worked out from your answers',
  choice: 'Your choice',
}

/** Who made the request decides whose answers they are */
export interface SourceWordsOptions {
  /** The business made this quote itself (`isMadeByBusiness`) */
  madeByBusiness?: boolean
}

const SOURCES = new Set<string>(Object.keys(BUSINESS_WORDS))

export function isLineSource(value: unknown): value is LineSource {
  return typeof value === 'string' && SOURCES.has(value)
}

/**
 * The source of a quote priced before the code was stored, from the words the
 * customer was shown. Null when the words say nothing we can stand behind.
 */
export function sourceFromMethod(method: string | null | undefined): LineSource | null {
  const m = (method ?? '').trim()
  if (!m) return null
  if (m === CUSTOMER_METHOD.photos) return 'photos'
  if (m === CUSTOMER_METHOD.answers || m === CUSTOMER_METHOD.quantityGiven || m === CUSTOMER_METHOD.adjustment) return 'answer'
  if (m === CUSTOMER_METHOD.scan) return 'scan'
  if (m === CUSTOMER_METHOD.details) return 'details'
  if (m === CUSTOMER_METHOD.calculated) return 'calculated'
  if (m === CUSTOMER_METHOD.fixedQuantity || m === CUSTOMER_METHOD.fixedPrice || m === CUSTOMER_METHOD.standardCharge) return 'fixed'
  if (m === CUSTOMER_METHOD.fromDescription) return 'words'
  if (m === CUSTOMER_METHOD.selectedExtra) return 'choice'
  if (/, as you confirmed$/.test(m)) return 'answer'
  // "From the unit's rating plate", "3 ton — from the unit's rating plate"
  if (/^From /.test(m) || / — from /.test(m)) return 'label'
  return null
}

/** Where a label reading was read from, out of the customer's words: "the unit's rating plate" */
function whereRead(method: string | null | undefined): string | null {
  const m = (method ?? '').trim()
  const found = /^From (.+)$/.exec(m)?.[1] ?? / — from (.+)$/.exec(m)?.[1]
  if (!found) return null
  return /^your /i.test(found) ? null : found
}

/**
 * The words the business reads beside a line, or null when the source is not
 * known (a line the business typed in the editor, a quote with no record).
 */
export function sourceForBusiness(
  line: { source?: unknown; method?: string | null } | null | undefined,
  opts: SourceWordsOptions = {}
): string | null {
  if (!line) return null
  const source = isLineSource(line.source) ? line.source : sourceFromMethod(line.method)
  if (!source) return null
  if (source === 'label') {
    const where = whereRead(line.method)
    return where ? `Read from ${where}` : BUSINESS_WORDS.label
  }
  return (opts.madeByBusiness ? OWN_WORDS : BUSINESS_WORDS)[source]
}

/** True when the source means the AI worked the quantity out, so the business should look at it */
export function isMeasuredSource(source: unknown): boolean {
  return source === 'photos' || source === 'label' || source === 'details' || source === 'seen' || source === 'words'
}

/**
 * T-188: a line the product added by itself, from the photos or from what was written, as against one
 * the business's price list always charges or an answer chose. Its price is still the business's own.
 */
export function isAddedByProduct(source: unknown): boolean {
  return source === 'seen' || source === 'words'
}

/**
 * When the business saves a quote from the editor: a line it left alone keeps
 * its source, and a line it changed (its name or its amount) has none, because
 * the figure is now the business's own. A line the editor sent back without
 * its source gets it back when it is unchanged. Pure; returns new lines.
 */
export function carrySources<T extends { label: string; amount: number; source?: unknown }>(
  before: ReadonlyArray<{ label?: unknown; amount?: unknown; source?: unknown }> | null | undefined,
  after: readonly T[]
): T[] {
  const stored = (before ?? []).map((line) => ({ label: line.label, amount: Number(line.amount), source: line.source, used: false }))
  return after.map((line) => {
    const same = stored.find((s) => !s.used && s.label === line.label && Math.abs(s.amount - line.amount) < 0.005)
    const { source: _sent, ...rest } = line
    void _sent
    if (!same) return rest as T
    same.used = true
    return isLineSource(same.source) ? ({ ...rest, source: same.source } as T) : (rest as T)
  })
}

/**
 * T-185: the note under each price line, from one place. Every screen that
 * says where a line came from (the approval page, the review email, the
 * on-site app) asks here, so a base fee reads the same on every quote:
 *   - a line that carries its own source uses it (quotes priced since T-183);
 *   - a line without one is matched to the quote's takeoff row with the same
 *     amount whose item starts its label, once, and that row's words are read
 *     (quotes priced before);
 *   - a line the business typed, or one nothing is known about, has no note.
 * `takeoff` is the main service's (`content_json.takeoff`); a section has
 * none, so its lines are passed with no takeoff.
 */
export function businessSources(
  lines: ReadonlyArray<{ label: string; amount: number; source?: unknown }>,
  takeoff?: unknown,
  opts: SourceWordsOptions = {}
): Array<string | null> {
  const rows = (Array.isArray(takeoff) ? takeoff : [])
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      item: typeof row.item === 'string' ? row.item.trim() : '',
      amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : 0,
      method: typeof row.method === 'string' ? row.method : '',
      source: row.source,
      used: false,
    }))
  const rowFor = (line: { label: string; amount: number }, take: boolean) => {
    const row = rows.find(
      (r) => (!take || !r.used) && r.item !== '' && Math.abs(r.amount - line.amount) < 0.005 && (line.label === r.item || line.label.startsWith(`${r.item} `))
    )
    if (row && take) row.used = true
    return row
  }
  return lines.map((line) => {
    if (isLineSource(line.source)) {
      // where a label was read is said in the takeoff's words for that line
      const method = line.source === 'label' ? (rowFor(line, false)?.method ?? null) : null
      return sourceForBusiness({ source: line.source, method }, opts)
    }
    const row = rowFor(line, true)
    return row ? sourceForBusiness({ source: row.source, method: row.method }, opts) : null
  })
}

/**
 * T-186: the sources of a quote's lines as codes (not words), for a rule that
 * must know whether anything on the quote was measured. Same matching as
 * `businessSources`: the line's own source, or its takeoff row's.
 */
export function lineSourceCodes(
  lines: ReadonlyArray<{ label: string; amount: number; source?: unknown }>,
  takeoff?: unknown
): Array<LineSource | null> {
  const rows = (Array.isArray(takeoff) ? takeoff : [])
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      item: typeof row.item === 'string' ? row.item.trim() : '',
      amount: typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : 0,
      method: typeof row.method === 'string' ? row.method : '',
      source: row.source,
      used: false,
    }))
  return lines.map((line) => {
    if (isLineSource(line.source)) return line.source
    const row = rows.find((r) => !r.used && r.item !== '' && Math.abs(r.amount - line.amount) < 0.005 && (line.label === r.item || line.label.startsWith(`${r.item} `)))
    if (!row) return null
    row.used = true
    return isLineSource(row.source) ? row.source : sourceFromMethod(row.method)
  })
}

/**
 * Was anything on the quote measured or read from the photos? Undefined when
 * no line's source is known, so nothing can be said either way.
 */
export function anyMeasuredFromPhotos(codes: ReadonlyArray<LineSource | null>): boolean | undefined {
  if (!codes.some((code) => code !== null)) return undefined
  return codes.some((code) => code === 'photos' || code === 'label')
}
