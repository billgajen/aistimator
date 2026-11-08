/**
 * Which photo-measurable quantities a human has already stated (pure).
 *
 * A quantity the customer typed, or confirmed in the clarification round,
 * wins over any measurement (AD-002/AD-007), so measuring it from photos is
 * wasted time and money. T-138 (LiDAR `scanned` quantities) extends this:
 * a scanned quantity is human-stated too.
 *
 * Conservative by design: a target counts as stated only when an answer maps
 * to it unambiguously (explicit `mapsToSignal`, or the field id IS the signal
 * key, which is how clarification answers are merged) and carries a positive
 * number. Anything less certain is still measured.
 */

export interface StatedAnswer {
  fieldId: string
  value: unknown
}

export interface FieldSignalMapping {
  fieldId: string
  mapsToSignal?: string
}

const normalise = (key: string) => key.toLowerCase().replace(/[_\s-]/g, '')

function positiveNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/,(?=\d{3}\b)/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = parseFloat(cleaned)
  return n > 0 ? n : null
}

/** Target signal keys a human has already given a usable number for. */
export function humanStatedQuantityKeys(
  targetKeys: string[],
  answers: StatedAnswer[],
  mappings: FieldSignalMapping[] = []
): Set<string> {
  const stated = new Set<string>()
  const mappedTo = new Map<string, string>()
  for (const m of mappings) if (m.mapsToSignal) mappedTo.set(m.fieldId, m.mapsToSignal)

  for (const answer of answers) {
    if (answer.fieldId.startsWith('_') || positiveNumber(answer.value) === null) continue
    const explicit = mappedTo.get(answer.fieldId)
    for (const key of targetKeys) {
      if (explicit ? explicit === key : normalise(answer.fieldId) === normalise(key)) stated.add(key)
    }
  }
  return stated
}
