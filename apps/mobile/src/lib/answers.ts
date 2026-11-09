/**
 * Form answers for an on-site quote (pure, no React Native imports).
 *
 * The app renders the same fields the website widget shows (from the
 * public widget config), so the engine receives answers in exactly the shape
 * it already prices (AD-002: what the business types is a customer-grade
 * answer, confidence 1).
 */

export type FieldOption = { value: string; label: string } | string

export interface AppField {
  fieldId: string
  label: string
  type?: string
  required?: boolean
  criticalForPricing?: boolean
  options?: FieldOption[]
  helpText?: string
}

export type RawAnswers = Record<string, string | boolean | undefined>

export interface SubmissionAnswer {
  fieldId: string
  value: string | number | boolean
}

export const optionValue = (o: FieldOption): string => (typeof o === 'string' ? o : o.value)
export const optionLabel = (o: FieldOption): string => (typeof o === 'string' ? o : o.label || o.value)

/** Internal widget fields the app handles itself (description, files). */
export function visibleFields(fields: AppField[]): AppField[] {
  return fields.filter((f) => !f.fieldId.startsWith('_') && f.type !== 'file')
}

/** Labels of required/critical fields still unanswered (mirrors the public API's check). */
export function missingRequired(fields: AppField[], raw: RawAnswers): string[] {
  return visibleFields(fields)
    .filter((f) => f.required || f.criticalForPricing)
    .filter((f) => {
      const v = raw[f.fieldId]
      if (v === undefined || v === '') return true
      if (f.type === 'number') return !Number.isFinite(Number(v))
      return false
    })
    .map((f) => f.label)
}

/** Typed answers: numbers as numbers, booleans as booleans, blanks dropped. */
export function toSubmissionAnswers(fields: AppField[], raw: RawAnswers, description: string): SubmissionAnswer[] {
  const out: SubmissionAnswer[] = []
  if (description.trim()) out.push({ fieldId: '_project_description', value: description.trim() })
  for (const field of visibleFields(fields)) {
    const v = raw[field.fieldId]
    if (v === undefined || v === '') continue
    if (field.type === 'number') {
      const n = Number(String(v).replace(/,/g, ''))
      if (Number.isFinite(n)) out.push({ fieldId: field.fieldId, value: n })
    } else if (field.type === 'boolean') {
      out.push({ fieldId: field.fieldId, value: v === true || v === 'true' })
    } else {
      out.push({ fieldId: field.fieldId, value: String(v) })
    }
  }
  return out
}
