/**
 * Answers to option fields (pure). Found by the US gauntlet (S39): a
 * free-text clarification answer replaced a select field's value, matched no
 * priced option, and the quote went out at $95 (the permit line alone).
 *
 * An option field's answer is only meaningful if it IS one of the options.
 * Matching ignores case, spaces and punctuation, against the option's value
 * or its label ("Please supply standard ones" ≡ "please_supply_standard_ones").
 */

export interface OptionField {
  fieldId: string
  label?: string
  options?: Array<{ value: string; label: string } | string>
}

export interface FieldOption {
  value: string
  label: string
}

const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, '')

/** Options for a field from the widget fields, else the draft's suggested fields. */
export function fieldOptions(fieldId: string, ...sources: Array<OptionField[] | undefined>): FieldOption[] {
  for (const fields of sources) {
    const field = fields?.find((f) => f.fieldId === fieldId)
    if (field?.options?.length) {
      return field.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value }))
    }
  }
  return []
}

/** The option value an answer names, or null when it names none. */
export function snapToOption(answer: unknown, options: FieldOption[]): string | null {
  if (answer === null || answer === undefined) return null
  const k = key(String(answer))
  if (!k) return null
  const hit = options.find((o) => key(o.value) === k || key(o.label) === k)
  return hit ? hit.value : null
}

/**
 * Labels of option fields whose answer is not one of their options (checked
 * per element for multi-selects). Unanswered fields and booleans are fine.
 */
export function answersOutsideOptions(
  answers: Array<{ fieldId: string; value: unknown }>,
  ...sources: Array<OptionField[] | undefined>
): string[] {
  const bad: string[] = []
  for (const answer of answers) {
    if (answer.fieldId.startsWith('_')) continue
    if (answer.value === null || answer.value === undefined || answer.value === '' || typeof answer.value === 'boolean') continue
    const options = fieldOptions(answer.fieldId, ...sources)
    if (options.length === 0) continue
    const values = Array.isArray(answer.value) ? answer.value : [answer.value]
    if (values.some((v) => snapToOption(v, options) === null)) {
      const field = sources.flatMap((s) => s || []).find((f) => f.fieldId === answer.fieldId)
      bad.push(field?.label || answer.fieldId)
    }
  }
  return bad
}
