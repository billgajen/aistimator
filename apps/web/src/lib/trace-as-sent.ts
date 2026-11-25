/**
 * T-204: the pricing trace shows the quote as sent.
 *
 * The trace page printed only the engine's steps, so a line the business added
 * with "Edit" was missing and the summary's total was the first price, not the
 * quote's. Now the page opens with the quote as it stands: every line, each
 * marked as first priced, changed or added, every added service, and the
 * quote's own subtotal, tax and total. The engine's steps follow, as how the
 * first price was reached.
 *
 * Pure: it reads the quote's stored price and, when the quote was edited, the
 * price it had before the first edit (the oldest amendment's "before").
 */
import { addedSections, lineLabelParts, splitMinimum } from '@qolumns/shared'

interface Line {
  label: string
  amount: number
}

interface PricingLike {
  subtotal?: number
  taxLabel?: string
  taxRate?: number
  taxAmount?: number
  total?: number
  breakdown?: ReadonlyArray<{ label?: unknown; amount?: unknown; kind?: unknown; minimumCharge?: number }>
}

export type SentLineMark = 'first' | 'changed' | 'added'

export interface SentLine extends Line {
  /** Where the line stands against the first price */
  mark: SentLineMark
  /** For a changed line: its amount in the first price */
  was?: number
}

export interface SentSection {
  serviceName: string
  addedBy: 'customer' | 'business'
  /** The service was added after the first price */
  added: boolean
  lines: Line[]
  /** Its minimum charge, when its floor applied */
  minimumCharge: number | null
  subtotal: number
}

export interface QuoteAsSent {
  lines: SentLine[]
  /** Lines of the first price that are no longer on the quote */
  removed: Line[]
  /** The main service's minimum charge, when it applies to the quote as it stands */
  minimumCharge: number | null
  sections: SentSection[]
  subtotal: number
  taxLabel: string | null
  taxRate: number | null
  taxAmount: number
  total: number
  /** The quote differs from its first price */
  edited: boolean
  /** The first price's total, when the quote was edited */
  firstTotal: number | null
}

const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100
const linesOf = (pricing: PricingLike | null | undefined): Line[] =>
  splitMinimum((pricing?.breakdown ?? []) as Array<{ label: string; amount: number; kind?: 'minimum'; minimumCharge?: number }>).lines.map((line) => ({
    label: String(line.label ?? ''),
    amount: money(line.amount),
  }))

/** A line's name without the maths the engine writes after it ("Rooms  $375 × 2 rooms" → "rooms"), in either form it has used */
const nameOf = (label: string) => lineLabelParts(label).name.split(/[:(]/)[0]!.trim().toLowerCase()

/**
 * The quote as it stands, against its first price. `first` is null for a quote
 * that was never edited: every line is then as first priced.
 */
export function quoteAsSent(pricing: PricingLike | null | undefined, first: PricingLike | null | undefined): QuoteAsSent {
  const now = linesOf(pricing)
  const before = first ? linesOf(first) : null
  const left = before ? [...before] : []
  const take = (match: (line: Line) => boolean): Line | undefined => {
    const index = left.findIndex(match)
    return index === -1 ? undefined : left.splice(index, 1)[0]
  }

  const marks: Array<SentLine | null> = now.map(() => null)
  if (!before) {
    now.forEach((line, index) => (marks[index] = { ...line, mark: 'first' }))
  } else {
    // 1. the same line at the same amount; 2. the same label at another amount;
    // 3. the same name (an edited amount drops the label's maths); 4. the rest was added
    now.forEach((line, index) => {
      if (take((b) => b.label === line.label && b.amount === line.amount)) marks[index] = { ...line, mark: 'first' }
    })
    now.forEach((line, index) => {
      if (marks[index]) return
      const was = take((b) => b.label === line.label) ?? take((b) => nameOf(b.label) !== '' && nameOf(b.label) === nameOf(line.label))
      marks[index] = was ? (was.amount === line.amount ? { ...line, mark: 'first' } : { ...line, mark: 'changed', was: was.amount }) : { ...line, mark: 'added' }
    })
  }
  const lines = marks.filter((line): line is SentLine => line !== null)

  const firstSections = new Set(addedSections(first ?? null).map((section) => section.serviceId))
  const sections: SentSection[] = addedSections(pricing ?? null).map((section) => {
    const split = splitMinimum(section.breakdown)
    return {
      serviceName: section.serviceName,
      addedBy: section.addedBy,
      added: before !== null && !firstSections.has(section.serviceId),
      lines: split.lines.map((line) => ({ label: line.label, amount: money(line.amount) })),
      minimumCharge: split.minimum?.minimumCharge ?? null,
      subtotal: money(section.subtotal),
    }
  })
  const sectionsNow = addedSections(pricing ?? null).map((section) => section.serviceId)
  const sectionsChanged = before !== null && (sectionsNow.length !== firstSections.size || sectionsNow.some((id) => !firstSections.has(id)))

  const total = money(pricing?.total)
  const firstTotal = first ? money(first.total) : null
  const edited = before !== null && (lines.some((line) => line.mark !== 'first') || left.length > 0 || sectionsChanged || firstTotal !== total)
  return {
    lines,
    removed: left,
    minimumCharge: splitMinimum((pricing?.breakdown ?? []) as Array<{ label: string; amount: number; kind?: 'minimum'; minimumCharge?: number }>).minimum?.minimumCharge ?? null,
    sections,
    subtotal: money(pricing?.subtotal),
    taxLabel: pricing?.taxLabel ?? null,
    taxRate: typeof pricing?.taxRate === 'number' ? pricing.taxRate : null,
    taxAmount: money(pricing?.taxAmount),
    total,
    edited,
    firstTotal: edited ? firstTotal : null,
  }
}

/** "v1" from "v1", "1" or "vv1": the version is stored with its letter, and the page added another */
export function configVersionLabel(version: unknown): string | null {
  if (version === null || version === undefined) return null
  const bare = String(version).trim().replace(/^v+/i, '')
  return bare ? `v${bare}` : null
}

export const TRACE_AS_SENT_COPY = {
  titleSent: 'The quote as sent',
  titleNotSent: 'The quote as it stands',
  intro: 'Every line on the quote today, and its total.',
  marks: { changed: 'Changed by you', added: 'Added by you' } as Record<Exclude<SentLineMark, 'first'>, string>,
  was: (amount: string) => `was ${amount}`,
  removedTitle: 'Removed from the first price',
  sectionBy: { customer: 'Added by the customer', business: 'Added by you' } as Record<'customer' | 'business', string>,
  edited: (firstTotal: string) => `This quote was changed with Edit. The steps below show how the first price of ${firstTotal} was worked out.`,
  stepsTitle: 'Calculation steps',
  stepsTitleEdited: 'How the first price was worked out',
  firstTotal: 'First price:',
} as const
