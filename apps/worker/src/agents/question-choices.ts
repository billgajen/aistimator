/**
 * T-188: what a question can be answered with, built in code (pure).
 *
 * A question about a quote is never open ("What should we allow for?"). Its
 * choices come from the business's own configuration and from the line the
 * question is about:
 *
 *   - the doubted answer belongs to a question with options  → those options
 *   - it is a yes or no that switches a line on              → keep that line, or not
 *   - it is a number                                         → the number given, the
 *     one the evidence points to (when there is one), and a box for another
 *
 * Nothing here knows a trade, a service or a question's words: a choice is
 * worded from the business's own names (a field's option, a step's name, the
 * unit of a step) and three plain words of ours (keep, add, no).
 *
 * A doubt that is tied to no answer the business configured cannot be turned
 * into a choice, and no answer to it could change the price. It is not asked:
 * `doubtQuestion` returns null and the quality gate hands the doubt to the
 * business as a note on the quote.
 *
 * Who is asked changes the words, never the choices (T-186: a quote the
 * business made asks the business; a customer's asks the customer).
 */
import { unitWords } from '@qolumns/shared'
import type { WorkStepConfig } from '@qolumns/shared'
import { fieldOptions, type OptionField } from '../answer-options'

export type Audience = 'business' | 'customer'

export interface QuestionField extends OptionField {
  type?: string
}

export interface ChoiceContext {
  /** The request's fields: the form's own, then the service's suggested ones */
  fields: QuestionField[]
  workSteps: WorkStepConfig[]
  addons: Array<{ id: string; label: string }>
  /** The answers given with the request */
  answers: Array<{ fieldId: string; value: unknown }>
  /** The values the service allows for a thing it reads from a job (its expected signals), by key */
  allowedValues?: Record<string, readonly string[]>
  audience: Audience
}

export interface Choice {
  label: string
  value: string
}

export interface BuiltAnswer {
  /** What is asked after the doubt is stated: "Keep Wallpaper removal?", "Which is right?" */
  ask: string
  choices: Choice[]
  /** The choices are every possible answer */
  closed: boolean
  answerKind?: 'number'
}

const YES = new Set(['true', 'yes', '1', 'on'])
const NO = new Set(['false', 'no', '0', 'off'])
const word = (value: unknown): string => String(value ?? '').trim().toLowerCase()
const isYes = (value: unknown): boolean => value === true || YES.has(word(value))
const isNo = (value: unknown): boolean => value === false || NO.has(word(value))

/** A number as a person typed it ("1,500", " 3 "), or null */
export function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/,(?=\d{3}\b)/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return parseFloat(cleaned)
}

/** The first number in a sentence the wording layer suggested ("about 3 rooms" → 3), or null */
export function suggestedNumber(text: string | null | undefined): number | null {
  const direct = numberOf(text ?? '')
  if (direct !== null) return direct
  const found = /(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])/.exec(text ?? '')
  return found ? numberOf(found[0]) : null
}

/** The line a field switches on or sizes: the step with a condition on it, the step it is the quantity of, or the extra it selects */
export function lineOf(fieldId: string, ctx: Pick<ChoiceContext, 'workSteps' | 'addons'>): { name: string; unit?: string; step?: WorkStepConfig; addonId?: string; switched: boolean } | null {
  const sized = ctx.workSteps.find((s) => s.quantitySource?.type === 'form_field' && s.quantitySource.fieldId === fieldId)
  if (sized) return { name: sized.name, unit: sized.unitLabel, step: sized, switched: false }
  const switched = ctx.workSteps.find((s) => s.when?.fieldId === fieldId)
  if (switched) return { name: switched.name, unit: switched.unitLabel, step: switched, switched: true }
  const addon = ctx.addons.find((a) => a.id === fieldId)
  if (addon) return { name: addon.label, addonId: addon.id, switched: true }
  return null
}

const which = 'Which is right?'

/**
 * The choices for a doubt about one of the request's answers. `suggested` is
 * what the evidence points to, in the wording layer's words (a number is read
 * out of it; anything else is ignored). Null when the doubt names no answer
 * the business configured.
 */
export function doubtChoices(fieldId: string | undefined, suggested: string | null | undefined, ctx: ChoiceContext): BuiltAnswer | null {
  if (!fieldId) return null
  const field = ctx.fields.find((f) => f.fieldId === fieldId)
  const line = lineOf(fieldId, ctx)
  if (!field && !line) return null
  const stated = ctx.answers.find((a) => a.fieldId === fieldId)?.value
  const forBusiness = ctx.audience === 'business'

  // 1. A question with options: its own options, as the business wrote them
  const options = fieldOptions(fieldId, ctx.fields)
  if (options.length > 0) return { ask: which, choices: options.map((o) => ({ label: o.label, value: o.value })), closed: true }

  // 2. A yes or no. With a line behind it, the choice is that line: keep it (or add it), or not.
  // (A number is never read as a yes or no: "1 room" is a count.)
  const counted = field?.type === 'number' || Boolean(line && !line.switched)
  const saidYesOrNo = typeof stated === 'boolean' || ['true', 'false', 'yes', 'no'].includes(word(stated))
  const yesNo = !counted && (field?.type === 'boolean' || field?.type === 'checkbox' || saidYesOrNo || Boolean(line?.addonId))
  if (yesNo) {
    if (line && line.switched) {
      // The value that switches the line on is the business's own: the step's condition, or the
      // extra's id. (A step whose condition is a "no" is switched on by "No".)
      const condition = line.step?.when?.equals ?? line.step?.when?.value
      const onByNo = condition !== undefined && isNo(condition)
      const onValue = line.addonId ?? (onByNo ? 'No' : condition !== undefined ? String(condition) : 'Yes')
      const offValue = onByNo ? 'Yes' : 'No'
      const applies = onByNo ? isNo(stated) : isYes(stated) || stated === line.addonId || (condition !== undefined && word(stated) === word(condition))
      const verb = applies ? 'Keep' : 'Add'
      return {
        ask: forBusiness ? `${verb} ${line.name}?` : which,
        choices: [
          { label: `${verb} ${line.name}`, value: onValue },
          { label: `No ${line.name}`, value: offValue },
        ],
        closed: true,
      }
    }
    return { ask: which, choices: [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }], closed: true }
  }

  // 3. A number: the one given, the one the evidence points to, and room for another
  const given = numberOf(stated)
  if (field?.type === 'number' || given !== null || (line && !line.switched)) {
    const shown = (n: number) => `${n.toLocaleString('en-US')} ${unitWords(line?.unit, n)}`.trim()
    const choices: Choice[] = []
    if (given !== null) choices.push({ label: `Keep ${shown(given)}`, value: String(given) })
    const hint = suggestedNumber(suggested)
    if (hint !== null && hint >= 0 && hint !== given) choices.push(hint === 0 && line ? { label: `No ${line.name}`, value: '0' } : { label: shown(hint), value: String(hint) })
    return { ask: which, choices, closed: false, answerKind: 'number' }
  }

  // anything else (a written answer) has no choices to offer
  return null
}

/**
 * What a question that asks for something nobody gave can be answered with:
 * the options of the field it fills, when that field has options; the values
 * the service allows for it, when it lists them; otherwise a number, when it
 * fills a quantity. Null when the key is none of these.
 */
export function missingChoices(key: string, ctx: Pick<ChoiceContext, 'fields' | 'workSteps' | 'allowedValues'>, quantity: boolean): Pick<BuiltAnswer, 'choices' | 'closed' | 'answerKind'> | null {
  const options = fieldOptions(key, ctx.fields)
  if (options.length > 0) return { choices: options.map((o) => ({ label: o.label, value: o.value })), closed: true }
  // the service's own list of what the thing can be
  const allowed = (ctx.allowedValues?.[key] ?? []).filter((v) => typeof v === 'string' && v.trim() !== '')
  if (allowed.length > 0) return { choices: allowed.map((v) => ({ label: v, value: v })), closed: true }
  const field = ctx.fields.find((f) => f.fieldId === key)
  if (quantity || field?.type === 'number') return { choices: [], closed: false, answerKind: 'number' }
  return null
}
