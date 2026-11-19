'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ClarificationQuestion } from '@qolumns/shared'
import { parseReading, readingQuestion } from '@/lib/customer-read'

/**
 * Public clarification page for customers to answer questions.
 * URL: /q/:quoteId/clarify?token=xxx
 */
export default function ClarifyPage({ params }: { params: { quoteId: string } }) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { quoteId } = params

  const [questions, setQuestions] = useState<ClarificationQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch the quote to get clarification questions
  useEffect(() => {
    if (!token) {
      setError('Missing authentication token')
      setLoading(false)
      return
    }

    async function loadQuestions() {
      try {
        const res = await fetch(`/api/public/quotes/${quoteId}?token=${token}`)
        if (!res.ok) {
          setError('We could not load this page.')
          setLoading(false)
          return
        }

        const data = await res.json()

        if (data.status !== 'awaiting_clarification') {
          setError('This question has already been answered.')
          setLoading(false)
          return
        }

        if (data.clarificationQuestions && data.clarificationQuestions.length > 0) {
          setQuestions(data.clarificationQuestions)
        } else {
          setError('There is nothing to answer here.')
        }
      } catch {
        setError('Failed to load questions')
      }
      setLoading(false)
    }

    loadQuestions()
  }, [quoteId, token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return

    // Validate all questions answered
    const unanswered = questions.filter(q => !answers[q.id])
    if (unanswered.length > 0) {
      setError('Please answer all questions')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/public/quotes/${quoteId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          answers: questions.map(q => ({
            questionId: q.id,
            answer: answers[q.id] || '',
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error?.message || 'Failed to submit answers')
        setSubmitting(false)
        return
      }

      // The re-price runs on the queue: the quote page shows "Preparing your
      // estimate" and fills in when it's ready (the thank-you is the fallback)
      if (token) {
        window.location.replace(`/q/${quoteId}?token=${encodeURIComponent(token)}`)
        return
      }
      setSubmitted(true)
    } catch {
      setError('Failed to submit answers')
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-text-muted">Loading...</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-text-primary mb-4">Thank you!</h1>
          <p className="text-text-secondary">
            We have your answer. Your estimate will be ready shortly.
          </p>
        </div>
      </div>
    )
  }

  if (error && questions.length === 0) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-text-primary mb-4">Unable to load</h1>
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.08)] p-8">
          {/* T-171: at this point the customer has an estimate, not a quote (T-146) */}
          <h1 className="font-display text-2xl font-extrabold text-text-primary mb-2">
            {questions.length === 1 ? 'One quick question about your estimate' : 'Quick questions about your estimate'}
          </h1>
          <p className="text-text-secondary mb-8">
            Your answer sets the price for your job. It only takes a moment.
          </p>

          {error && (
            <div className="bg-danger-light text-danger p-3 rounded-md mb-6 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {questions.map((q) => {
              // T-171: a label reading is asked in one plain sentence. The words read off the label and how
              // they became the value are the business's to see, not the customer's (lib/customer-read.ts).
              const reading = q.type === 'confirm_value' && q.aiValue !== undefined ? parseReading(q.evidence) : null
              return (
              <div key={q.id} className="space-y-2">
                <p className="block text-base font-semibold text-text-primary" data-testid="question-text">
                  {reading ? readingQuestion(String(q.aiValue), reading.where) : q.question}
                </p>

                {q.choices && q.choices.length > 0 ? (
                  /* T-188: the answers to press, built from the business's own rules (the worker's
                     question-choices): rows to tap (system.md, customer pages). "Another answer" opens a
                     box only where the choices are not every possible answer. */
                  <div className="space-y-2" data-testid="question-choices">
                    {q.choices.map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        aria-pressed={answers[q.id] === choice.value}
                        onClick={() => setAnswers(prev => ({ ...prev, [q.id]: choice.value }))}
                        data-testid="question-choice"
                        className={`flex min-h-[48px] w-full items-center rounded-md border px-4 py-3 text-left text-sm font-semibold transition-colors ${
                          answers[q.id] === choice.value ? 'border-secondary bg-secondary-light text-secondary' : 'border-field text-text-primary hover:border-ink'
                        }`}
                      >
                        {choice.label}
                      </button>
                    ))}
                    {!q.closed && (
                      <>
                        <button
                          type="button"
                          aria-pressed={answers[q.id] !== undefined && !q.choices.some((c) => c.value === answers[q.id])}
                          onClick={() => setAnswers(prev => ({ ...prev, [q.id]: '' }))}
                          data-testid="question-other"
                          className={`flex min-h-[48px] w-full items-center rounded-md border px-4 py-3 text-left text-sm font-semibold transition-colors ${
                            answers[q.id] !== undefined && !q.choices.some((c) => c.value === answers[q.id]) ? 'border-ink bg-surface text-text-primary' : 'border-field text-text-primary hover:border-ink'
                          }`}
                        >
                          Another answer
                        </button>
                        {answers[q.id] !== undefined && !q.choices.some((c) => c.value === answers[q.id]) && (
                          <input
                            type="text"
                            inputMode={q.answerKind === 'number' ? 'decimal' : 'text'}
                            aria-label="Your answer"
                            value={answers[q.id] || ''}
                            onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                            autoFocus
                            className="w-full px-3 py-2 border border-field rounded-md text-base focus:outline-none focus:ring-2"
                          />
                        )}
                      </>
                    )}
                  </div>
                ) : q.type === 'confirm_value' && q.aiValue !== undefined ? (
                  /* T-108: one-tap confirmation of the AI's extracted value */
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => setAnswers(prev => ({ ...prev, [q.id]: String(q.aiValue) }))}
                        data-testid="answer-yes"
                        className={`flex-1 min-h-[48px] px-4 py-3 rounded-md border text-sm font-semibold transition-colors ${
                          answers[q.id] === String(q.aiValue)
                            ? 'border-secondary bg-secondary-light text-secondary'
                            : 'border-field text-text-primary hover:border-ink'
                        }`}
                      >
                        ✓ Yes, {String(q.aiValue)} is right
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswers(prev => ({ ...prev, [q.id]: prev[q.id] === String(q.aiValue) || prev[q.id] === undefined ? '' : prev[q.id] || '' }))}
                        data-testid="answer-no"
                        className={`flex-1 min-h-[48px] px-4 py-3 rounded-md border text-sm font-semibold transition-colors ${
                          answers[q.id] !== undefined && answers[q.id] !== String(q.aiValue)
                            ? 'border-ink bg-surface text-text-primary'
                            : 'border-field text-text-primary hover:border-ink'
                        }`}
                      >
                        No, let me correct it
                      </button>
                    </div>
                    {answers[q.id] !== undefined && answers[q.id] !== String(q.aiValue) && (
                      q.options && q.options.length > 0 ? (
                        /* T-139: identified equipment — corrections come from the allowed values */
                        <div className="space-y-2 pt-1">
                          {q.options.filter((option) => option !== String(q.aiValue)).map((option) => (
                            <label key={option} className="flex items-center gap-3 cursor-pointer">
                              <input
                                type="radio"
                                name={q.id}
                                value={option}
                                checked={answers[q.id] === option}
                                onChange={() => setAnswers(prev => ({ ...prev, [q.id]: option }))}
                                className="w-4 h-4 text-text-primary border-field"
                              />
                              <span className="text-sm text-text-secondary">{option}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="text"
                          placeholder="Enter the correct value..."
                          value={answers[q.id] || ''}
                          onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                          autoFocus
                          className="w-full px-3 py-2 border border-field rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                        />
                      )
                    )}
                  </div>
                ) : q.options && q.options.length > 0 ? (
                  <div className="space-y-2">
                    {q.options.map((option) => (
                      <label key={option} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name={q.id}
                          value={option}
                          checked={answers[q.id] === option}
                          onChange={() => setAnswers(prev => ({ ...prev, [q.id]: option }))}
                          className="w-4 h-4 text-text-primary border-field"
                        />
                        <span className="text-sm text-text-secondary">{option}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name={q.id}
                        value="_other"
                        checked={answers[q.id] !== undefined && !q.options.includes(answers[q.id] || '')}
                        onChange={() => setAnswers(prev => ({ ...prev, [q.id]: '' }))}
                        className="w-4 h-4 text-text-primary border-field"
                      />
                      <span className="text-sm text-text-secondary">Other</span>
                    </label>
                    {answers[q.id] !== undefined && !q.options.includes(answers[q.id] || '') && (
                      <input
                        type="text"
                        placeholder="Please specify..."
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                        className="w-full px-3 py-2 border border-field rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                      />
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    inputMode={q.answerKind === 'number' ? 'decimal' : 'text'}
                    placeholder="Your answer..."
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                    className="w-full px-3 py-2 border border-field rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ink"
                  />
                )}
              </div>
              )
            })}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] py-3 px-4 bg-ink text-white font-semibold rounded-md hover:bg-ink-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Sending…' : questions.length === 1 ? 'Send my answer' : 'Send my answers'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
