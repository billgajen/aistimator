/**
 * Form answers for an on-site quote (pure, no React Native imports).
 *
 * The app renders the same fields the website form shows (from the public
 * form config), so the engine receives answers in exactly the shape it
 * already prices (AD-002: what the business types is a customer-grade
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
  placeholder?: string
}

/** A tick-box question keeps a list; a yes/no question a boolean; everything else text */
export type RawAnswer = string | boolean | string[] | undefined
export type RawAnswers = Record<string, RawAnswer>

export interface SubmissionAnswer {
  fieldId: string
  value: string | number | boolean | string[]
}

export const optionValue = (o: FieldOption): string => (typeof o === 'string' ? o : o.value)
export const optionLabel = (o: FieldOption): string => (typeof o === 'string' ? o : o.label || o.value)

/**
 * How a question is answered on the phone, the way the website form asks it
 * (apps/web/src/components/embed/steps/QuestionsStep.tsx):
 *   choice  one of a list: rows to tap
 *   multi   any of a list (tick boxes): rows to tap, several can be on
 *   yesno   a yes/no question: two rows
 *   number  a number pad
 *   long    several lines of text
 *   text    one line of text
 */
export type FieldKind = 'choice' | 'multi' | 'yesno' | 'number' | 'long' | 'text'

export function fieldKind(field: Pick<AppField, 'type' | 'options'>): FieldKind {
  const hasOptions = (field.options?.length ?? 0) > 0
  if (field.type === 'checkbox' && hasOptions) return 'multi'
  if (field.type === 'boolean' || (field.type === 'checkbox' && !hasOptions)) return 'yesno'
  if (hasOptions) return 'choice'
  if (field.type === 'number') return 'number'
  if (field.type === 'textarea') return 'long'
  return 'text'
}

/** Internal form fields the app handles itself (description, files). */
export function visibleFields(fields: AppField[]): AppField[] {
  return fields.filter((f) => !f.fieldId.startsWith('_') && f.type !== 'file')
}

/** Is there an answer? A number that is not a number is not one. */
export function isAnswered(field: AppField, value: RawAnswer): boolean {
  if (value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (fieldKind(field) === 'number') return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(/,/g, '')))
  return true
}

const mustAnswer = (field: AppField) => Boolean(field.required || field.criticalForPricing)

/** Labels of required/critical fields still unanswered (mirrors the public API's check). */
export function missingRequired(fields: AppField[], raw: RawAnswers): string[] {
  return visibleFields(fields)
    .filter(mustAnswer)
    .filter((f) => !isAnswered(f, raw[f.fieldId]))
    .map((f) => f.label)
}

/** Typed answers: numbers as numbers, booleans as booleans, lists as lists, blanks dropped. */
export function toSubmissionAnswers(fields: AppField[], raw: RawAnswers, description: string): SubmissionAnswer[] {
  const out: SubmissionAnswer[] = []
  if (description.trim()) out.push({ fieldId: '_project_description', value: description.trim() })
  for (const field of visibleFields(fields)) {
    const v = raw[field.fieldId]
    if (v === undefined || v === '') continue
    const kind = fieldKind(field)
    if (kind === 'multi') {
      const list = Array.isArray(v) ? v : [String(v)]
      if (list.length > 0) out.push({ fieldId: field.fieldId, value: list })
    } else if (kind === 'number') {
      const n = Number(String(v).replace(/,/g, ''))
      if (Number.isFinite(n)) out.push({ fieldId: field.fieldId, value: n })
    } else if (kind === 'yesno') {
      out.push({ fieldId: field.fieldId, value: v === true || v === 'true' })
    } else {
      out.push({ fieldId: field.fieldId, value: Array.isArray(v) ? v.join(', ') : String(v) })
    }
  }
  return out
}

/** Turn one option of a tick-box question on or off */
export function toggleOption(current: RawAnswer, value: string): string[] {
  const list = Array.isArray(current) ? current : []
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
