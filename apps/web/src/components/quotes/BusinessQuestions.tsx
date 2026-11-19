'use client'

import { useState } from 'react'
import { QUOTE_TURN_COPY, allAnswered, chosenChoice, isTypedAnswer, questionChoices } from '@qolumns/shared'

export interface BusinessQuestion {
  id: string
  question: string
  type?: string
  aiValue?: string | number
  evidence?: string
  options?: string[]
}

const CHOICE = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors'
const CHOSEN = 'border-primary bg-mint text-text-primary'
const NOT_CHOSEN = 'border-field bg-background text-text-primary hover:bg-surface'

/**
 * T-186: the questions on a quote the business made itself. No customer was
 * asked them: the business answers here, and the quote is priced again from
 * the answers (the same route the on-site app uses).
 *
 * A question with clear choices is answered by pressing one; typing is behind
 * "Other". Which choices a question has is decided by the shared
 * `questionChoices`, so this card and the app offer the same answers.
 */
export function BusinessQuestions({ quoteId, questions, onAnswered }: { quoteId: string; questions: BusinessQuestion[]; onAnswered: () => Promise<void> | void }) {
  const C = QUOTE_TURN_COPY.questions
  const [answers, setAnswers] = useState<Record<string, string | undefined>>({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  if (questions.length === 0) return null

  const set = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }))

  async function send() {
    setSaving(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/app/quotes/${encodeURIComponent(quoteId)}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: questions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? '').trim() })) }),
      })
      if (!response.ok) {
        setFailed(true)
        return
      }
      await onAnswered()
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-primary bg-white p-5 shadow-warm-md" aria-labelledby="business-questions-title" data-testid="business-questions">
      <h2 id="business-questions-title" className="text-sm font-semibold text-text-primary">
        {C.title(questions.length)}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{C.note}</p>

      <div className="mt-4 space-y-5">
        {questions.map((q) => {
          const { choices, otherLabel, numeric } = questionChoices(q)
          const answer = answers[q.id]
          const chosen = chosenChoice(choices, answer)
          const typed = isTypedAnswer(choices, answer)
          return (
            <fieldset key={q.id} data-testid="business-question">
              <legend className="text-base font-semibold text-text-primary">{q.question}</legend>
              {choices.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {choices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={chosen?.value === choice.value}
                      onClick={() => set(q.id, choice.value)}
                      className={`${CHOICE} ${chosen?.value === choice.value ? CHOSEN : NOT_CHOSEN}`}
                      data-testid="question-choice"
                    >
                      {choice.label}
                    </button>
                  ))}
                  {otherLabel && (
                    <button type="button" aria-pressed={typed} onClick={() => set(q.id, '')} className={`${CHOICE} ${typed ? CHOSEN : NOT_CHOSEN}`} data-testid="question-other">
                      {otherLabel}
                    </button>
                  )}
                </div>
              )}
              {typed && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-sm text-text-secondary">{C.otherLabel}</span>
                  <input
                    type="text"
                    inputMode={numeric ? 'decimal' : 'text'}
                    value={answer ?? ''}
                    onChange={(event) => set(q.id, event.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-field bg-background px-3 py-2 text-base text-text-primary focus:outline-none focus:ring-2 sm:max-w-sm"
                    data-testid="question-typed"
                  />
                </label>
              )}
            </fieldset>
          )
        })}
      </div>

      {failed && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {C.failed}
        </p>
      )}
      <button
        type="button"
        onClick={send}
        disabled={saving || !allAnswered(questions, answers)}
        className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 sm:min-h-[40px]"
        data-testid="business-questions-send"
      >
        {saving ? QUOTE_TURN_COPY.pageButtons.givingAnswers : QUOTE_TURN_COPY.pageButtons.giveAnswers}
      </button>
    </section>
  )
}
