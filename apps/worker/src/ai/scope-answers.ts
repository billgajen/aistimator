/**
 * The customer's own answers, as plain lines a reviewing model can read (pure).
 *
 * The senior measurement reviewer used to see only the photos and the junior
 * takeoffs, so on "front wall only" jobs it re-added side elevations it could
 * see in the photos (3 of 4 reviews, CHANGELOG 2026-11-08). The customer's
 * answers define the job's scope, so the reviewer gets them verbatim, labelled
 * with the business's own question text. Nothing here is trade-specific: the
 * labels and options come from the business's form configuration.
 */

export interface ScopeAnswer {
  fieldId: string
  value: unknown
}

export interface ScopeField {
  fieldId: string
  label?: string
  /** Widget fields carry {value,label}; draft suggested fields carry plain strings */
  options?: Array<{ value: string; label: string } | string>
}

/** Internal fields that are free-text descriptions rather than form questions */
const DESCRIPTION_FIELD_IDS = new Set(['_project_description', 'description', 'notes'])
const MAX_DESCRIPTION_CHARS = 600
const MAX_VALUE_CHARS = 200

function optionLabel(field: ScopeField | undefined, raw: string): string {
  const option = field?.options?.find((o) => (typeof o === 'string' ? o : o.value) === raw)
  if (!option) return raw
  return typeof option === 'string' ? option : option.label || raw
}

function formatValue(field: ScopeField | undefined, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    const parts = value.map((v) => optionLabel(field, String(v))).filter((v) => v.trim() !== '')
    return parts.length > 0 ? parts.join(', ') : null
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const text = optionLabel(field, String(value)).trim()
  return text === '' ? null : text
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * One line per answered question ("Which sides to paint?: Front only"), plus
 * the customer's description. Internal `_` fields other than the description
 * are skipped; answers to unknown fields keep their id as the label.
 */
export function formatScopeAnswers(answers: ScopeAnswer[], fields: ScopeField[] = []): string[] {
  const byId = new Map<string, ScopeField>()
  for (const field of fields) if (!byId.has(field.fieldId)) byId.set(field.fieldId, field)

  const lines: string[] = []
  let description: string | null = null
  for (const answer of answers) {
    if (DESCRIPTION_FIELD_IDS.has(answer.fieldId)) {
      const text = formatValue(undefined, answer.value)
      if (text && !description) description = clip(text.replace(/\s+/g, ' '), MAX_DESCRIPTION_CHARS)
      continue
    }
    if (answer.fieldId.startsWith('_')) continue
    const field = byId.get(answer.fieldId)
    const text = formatValue(field, answer.value)
    if (!text) continue
    lines.push(`- ${field?.label?.trim() || answer.fieldId}: ${clip(text, MAX_VALUE_CHARS)}`)
  }
  if (description) lines.push(`- Customer's description: "${description}"`)
  return lines
}
