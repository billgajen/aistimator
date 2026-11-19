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
import type { ClarificationQuestion } from './database.types'

export interface ChoiceQuestion {
  /** 'confirm_value' asks to confirm `aiValue` */
  type?: string | null
  aiValue?: string | number | null
  options?: readonly string[] | null
  /** T-188: the choices the worker built from the business's own rules; they win over `options` */
  choices?: ReadonlyArray<{ label: string; value: string }> | null
  /** T-188: the choices are every possible answer, so no typed answer is offered */
  closed?: boolean | null
  /** T-188: a typed answer is a number */
  answerKind?: string | null
}

/**
 * T-188: a question as it is sent to whoever answers it (the on-site app, the
 * dashboard, the customer's page): its words, and what it can be answered
 * with. Nothing else of the stored question travels (the key it fills is the
 * worker's business).
 */
export interface AskedQuestion {
  id: string
  question: string
  type?: 'confirm_value' | 'text'
  aiValue?: string | number
  evidence?: string
  options?: string[]
  choices?: Array<{ label: string; value: string }>
  closed?: boolean
  answerKind?: 'number'
}

export function askedQuestion(q: ClarificationQuestion): AskedQuestion {
  return {
    id: q.id,
    question: q.question,
    ...(q.type && { type: q.type }),
    ...(q.aiValue !== undefined && { aiValue: q.aiValue }),
    ...(q.evidence && { evidence: q.evidence }),
    ...(q.options && { options: q.options }),
    ...(q.choices && q.choices.length > 0 && { choices: q.choices }),
    ...(q.closed === true && { closed: true }),
    ...(q.answerKind && { answerKind: q.answerKind }),
  }
}

/** The stored questions of a quote, as they are sent to whoever answers them */
export function askedQuestions(stored: unknown): AskedQuestion[] {
  return (Array.isArray(stored) ? stored : [])
    .filter((q): q is ClarificationQuestion => typeof q === 'object' && q !== null && typeof (q as ClarificationQuestion).id === 'string' && typeof (q as ClarificationQuestion).question === 'string')
    .map(askedQuestion)
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
  const built = (question.choices ?? []).filter((c) => c && typeof c.label === 'string' && typeof c.value === 'string')
  if (built.length > 0) {
    // T-188: the worker's own choices, worded from the business's rules
    for (const choice of built) add(choice.label.trim(), choice.value)
  } else {
    const confirm = question.aiValue !== undefined && question.aiValue !== null && String(question.aiValue).trim() !== ''
    if (confirm) add(QUOTE_TURN_COPY.questions.yes(String(question.aiValue)), String(question.aiValue))
    for (const option of question.options ?? []) {
      if (typeof option === 'string') add(option.trim(), option.trim())
    }
  }
  return {
    choices,
    // "Other" opens a typed answer. Not offered when the choices are every possible answer.
    otherLabel: choices.length > 0 && question.closed !== true ? QUOTE_TURN_COPY.questions.other : null,
    numeric: question.answerKind === 'number' || typeof question.aiValue === 'number',
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

/**
 * T-190: a question card has at most one text box.
 * - With choices: the buttons, and the optional note ("Why (for your records)").
 * - "Other" pressed: the typed answer is the one box, and the note is not asked.
 * - No choices (older quotes, or a quantity with no list): the answer box only, no note.
 */
export function questionTextBox(choices: readonly QuestionChoice[], answer: string | null | undefined): 'answer' | 'note' {
  return isTypedAnswer(choices, answer) ? 'answer' : 'note'
}

/** The note sent with an answer: only when its box is the one shown, so a hidden box never sends old words */
export function noteToSend(choices: readonly QuestionChoice[], answer: string | null | undefined, note: string | undefined): string | undefined {
  if (questionTextBox(choices, answer) !== 'note') return undefined
  const clean = (note ?? '').trim()
  return clean === '' ? undefined : clean
}

/** T-188: the longest note kept with an answer ("Why (for your records)") */
export const ANSWER_NOTE_MAX = 500

/** A note as it is stored: trimmed, one run of spaces, cut to the limit; null when there is nothing */
export function answerNote(note: unknown): string | null {
  if (typeof note !== 'string') return null
  const clean = note.replace(/\s+/g, ' ').trim().slice(0, ANSWER_NOTE_MAX)
  return clean === '' ? null : clean
}

/** Every question has an answer that is not blank */
export function allAnswered(questions: ReadonlyArray<{ id: string }>, answers: Readonly<Record<string, string | undefined>>): boolean {
  return questions.every((question) => (answers[question.id] ?? '').trim() !== '')
}
