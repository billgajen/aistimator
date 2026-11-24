/**
 * T-201: what "Describe your pricing" could not keep (pure).
 *
 * One service holds a set number of price lines, questions, add-ons and
 * adjustments from a description. Anything past that was dropped without a
 * word, so a business that pasted a long price list saw ten lines and never
 * learned the eleventh was gone. The limits are unchanged; now the result
 * names what was left out, and the review shows it before "Apply This
 * Pricing".
 *
 * Only what the compiler wrote and this app then cut is listed. Relative
 * imports only.
 */

/** How many of each one service keeps from a description */
export const COMPILE_KEEPS = { lines: 10, questions: 10, addons: 10, adjustments: 8 } as const

export interface LeftOut {
  /** Names of the price lines that did not fit */
  lines: string[]
  /** Labels of the questions that did not fit */
  questions: string[]
  /** Names of the add-ons that did not fit */
  addons: string[]
  /** How many adjustments did not fit (an adjustment has no name) */
  adjustments: number
}

/** Everything the compiler wrote, in its order, before any limit */
export interface Compiled {
  lines: readonly string[]
  questions: readonly string[]
  addons: readonly string[]
  adjustments: number
}

/** What falls past the limits, or null when everything fitted */
export function leftOutOf(all: Compiled): LeftOut | null {
  const out: LeftOut = {
    lines: all.lines.slice(COMPILE_KEEPS.lines),
    questions: all.questions.slice(COMPILE_KEEPS.questions),
    addons: all.addons.slice(COMPILE_KEEPS.addons),
    adjustments: Math.max(0, all.adjustments - COMPILE_KEEPS.adjustments),
  }
  return out.lines.length || out.questions.length || out.addons.length || out.adjustments ? out : null
}

/** Whether a compile result carries anything that was left out (it may come from an older server: no field) */
export function hasLeftOut(leftOut: LeftOut | null | undefined): leftOut is LeftOut {
  return Boolean(leftOut && (leftOut.lines?.length || leftOut.questions?.length || leftOut.addons?.length || leftOut.adjustments))
}

/** The review's lines: one per kind that lost something, naming each thing lost */
export function leftOutLines(leftOut: LeftOut): Array<{ title: string; names: string[] }> {
  const part = (kept: number, one: string, many: string, names: string[]) => ({
    title: `${names.length} ${names.length === 1 ? one : many} left out (a service keeps ${kept})`,
    names,
  })
  const out: Array<{ title: string; names: string[] }> = []
  if (leftOut.lines?.length) out.push(part(COMPILE_KEEPS.lines, 'price line', 'price lines', leftOut.lines))
  if (leftOut.questions?.length) out.push(part(COMPILE_KEEPS.questions, 'question', 'questions', leftOut.questions))
  if (leftOut.addons?.length) out.push(part(COMPILE_KEEPS.addons, 'add-on', 'add-ons', leftOut.addons))
  if (leftOut.adjustments) {
    out.push({ title: `${leftOut.adjustments} ${leftOut.adjustments === 1 ? 'adjustment' : 'adjustments'} left out (a service keeps ${COMPILE_KEEPS.adjustments})`, names: [] })
  }
  return out
}

/** What to do about it, in one sentence */
export const LEFT_OUT_ADVICE = 'Nothing below includes them. Put them in a second service, or describe fewer here.'
