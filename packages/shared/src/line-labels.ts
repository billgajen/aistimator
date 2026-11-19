/**
 * T-183: the name of a price line that comes from an adjustment rule.
 *
 * A line is named from the business's own words, in this order:
 *   1. the label the business gave the rule
 *   2. the label of the question the rule tests, with the label of the option
 *      it tests for: "<question>: <option> (+15%)"
 *   3. the question's id made readable, when the form's question is not known
 *
 * It is never named from the answer text alone: "Please supply it surcharge"
 * was an option's text with a word stuck on the end. Nothing here knows any
 * business's words; every word in a name is the business's own, plus the
 * percentage.
 *
 * Pure. The pricing engine is the only caller that names a line; the
 * dashboard's rule descriptions use the same question and option lookups.
 */

/** A question of the request form, as far as naming needs it */
export interface LabelField {
  fieldId: string
  label?: string | null
  options?: ReadonlyArray<{ value: string; label?: string | null }> | null
}

/** An adjustment rule, as far as naming needs it */
export interface AdjustmentRuleLike {
  when: {
    subject?: 'field' | 'subtotal'
    fieldId?: string
    operator?: string
    equals?: string | number | boolean
    value?: string | number
  }
  multiplier: number
  label?: string | null
}

/** " (+15%)" or " (-10%)" */
export function percentSuffix(multiplier: number): string {
  const pct = Math.round((multiplier - 1) * 100)
  return pct >= 0 ? ` (+${pct}%)` : ` (-${Math.abs(pct)}%)`
}

/** An id such as "paint_supply_select" as words: "Paint supply" */
export function readableId(id: string): string {
  return id
    .replace(/_(input|select|field|dropdown|choice)$/i, '')
    .replace(/^(is|has|needs|requires)_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** A question's label as the start of a line name: no question mark, colon or "(optional)" at the end */
export function questionName(label: string): string {
  return label
    .replace(/\s*\((optional|required)\)\s*$/i, '')
    .replace(/[\s?:.]+$/, '')
    .trim()
}

const isYes = (value: unknown) => value === true || /^(true|yes)$/i.test(String(value))
const isNo = (value: unknown) => value === false || /^(false|no)$/i.test(String(value))
/** A stored value that is an id, not words: lower case with underscores or hyphens, no spaces */
const looksLikeId = (value: string) => /^[a-z0-9]+([_-][a-z0-9]+)+$/.test(value) || /^[a-z0-9]+$/.test(value)

const RELATION: Record<string, string> = { gt: 'over', gte: 'at least', lt: 'under', lte: 'at most' }

/** The option the rule tests for, in the business's words */
function optionName(field: LabelField | undefined, tested: string | number | boolean): string {
  const option = field?.options?.find((o) => String(o.value) === String(tested))
  const label = option?.label?.trim()
  if (label) return label
  const text = String(tested).trim()
  return looksLikeId(text) ? readableId(text) : text
}

/**
 * The name of the line an adjustment rule adds.
 * `fields` are the questions of the service's request form (any that are known).
 */
export function adjustmentLineLabel(rule: AdjustmentRuleLike, fields: readonly LabelField[] = []): string {
  const own = rule.label?.trim()
  if (own) return own

  const suffix = percentSuffix(rule.multiplier)
  const tested = rule.when.equals ?? rule.when.value
  const operator = rule.when.operator || 'equals'

  // A rule on the job's own total has no question
  if (rule.when.subject === 'subtotal' || !rule.when.fieldId) {
    const relation = operator === 'lt' || operator === 'lte' ? 'under' : 'over'
    return `${rule.multiplier >= 1 ? 'Adjustment' : 'Discount'} for jobs ${relation} ${tested ?? ''}`.trim() + suffix
  }

  const field = fields.find((f) => f.fieldId === rule.when.fieldId)
  const question = questionName(field?.label?.trim() || '') || readableId(rule.when.fieldId)

  // A yes/no question answered yes is the question itself: "Deep clean (+50%)"
  if (tested === undefined || isYes(tested)) return `${question}${suffix}`
  if (isNo(tested)) return `${question}: No${suffix}`
  const relation = RELATION[operator]
  if (relation) return `${question} ${relation} ${tested}${suffix}`
  return `${question}: ${optionName(field, tested)}${suffix}`
}

/**
 * T-184: an answer as a person reads it. A choice is stored as the option's
 * value ("standard_(8_ft)"); what is shown is the option's label ("Standard
 * (8 ft)"), from the same form the customer filled in. Used wherever an
 * answer is shown: the dashboard, the on-site app, emails.
 *
 * Yes and no are said in words; several choices are joined with commas. A
 * stored value with no known option is tidied (underscores to spaces) only
 * when it is plainly an id and not something a person typed.
 */
export function answerText(field: LabelField | null | undefined, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((item) => answerText(field, item)).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const option = field?.options?.find((o) => String(o.value) === text)
  const label = option?.label?.trim()
  if (label) return label
  // an id with no label on file: "standard_(8_ft)" reads as "Standard (8 ft)"
  if (text.includes('_') && !text.includes(' ')) return readableId(text)
  return text
}
