/**
 * T-186: how a question on a quote is answered.
 *
 * A question that carries clear choices is answered by pressing one: the
 * figure it asks to confirm ("Yes, 4"), or the options it came with. Typing
 * is offered only behind "Other". A question with no choices is answered in
 * words. The on-site app and the dashboard both draw a question from this, so
 * they offer the same answers; what an answer does (it merges as a confirmed
 * answer and the quote is priced again) is unchanged.
 *
 * Pure. No question's text is known here: the choices are the ones the
 * question itself carries.
 */

import { QUOTE_TURN_COPY } from './quote-turn'

export interface ChoiceQuestion {
  /** 'confirm_value' asks to confirm `aiValue` */
  type?: string | null
  aiValue?: string | number | null
  options?: readonly string[] | null
}

export interface QuestionChoice {
  /** The words on the button */
  label: string
  /** The answer sent when it is pressed */
  value: string
}

export interface QuestionChoices {
  /** The buttons, in order; empty when the question has no clear choices */
  choices: QuestionChoice[]
  /** The words on the button that opens a typed answer; null when the question is typed anyway */
  otherLabel: string | null
  /** The typed answer is a number */
  numeric: boolean
}

export function questionChoices(question: ChoiceQuestion): QuestionChoices {
  const seen = new Set<string>()
  const choices: QuestionChoice[] = []
  const add = (label: string, value: string) => {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    choices.push({ label, value })
  }
  const confirm = question.aiValue !== undefined && question.aiValue !== null && String(question.aiValue).trim() !== ''
  if (confirm) add(QUOTE_TURN_COPY.questions.yes(String(question.aiValue)), String(question.aiValue))
  for (const option of question.options ?? []) {
    if (typeof option === 'string') add(option.trim(), option.trim())
  }
  return {
    choices,
    otherLabel: choices.length > 0 ? QUOTE_TURN_COPY.questions.other : null,
    numeric: typeof question.aiValue === 'number',
  }
}

/** The choice an answer is, or null when it was typed (or nothing is answered yet) */
export function chosenChoice(choices: readonly QuestionChoice[], answer: string | null | undefined): QuestionChoice | null {
  if (answer === null || answer === undefined) return null
  return choices.find((choice) => choice.value === answer) ?? null
}

/**
 * Is the typed box open? It is for a question with no choices, and for one
 * whose answer is set and is none of the choices ("Other" was pressed, which
 * sets the answer to empty text until something is typed).
 */
export function isTypedAnswer(choices: readonly QuestionChoice[], answer: string | null | undefined): boolean {
  if (choices.length === 0) return true
  return answer !== null && answer !== undefined && chosenChoice(choices, answer) === null
}

/** Every question has an answer that is not blank */
export function allAnswered(questions: ReadonlyArray<{ id: string }>, answers: Readonly<Record<string, string | undefined>>): boolean {
  return questions.every((question) => (answers[question.id] ?? '').trim() !== '')
}
