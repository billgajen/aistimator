'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ClarificationQuestion } from '@estimator/shared'

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
          setError('Could not load quote details')
          setLoading(false)
          return
        }

        const data = await res.json()

        if (data.status !== 'awaiting_clarification') {
          setError('This quote is no longer awaiting clarification')
          setLoading(false)
          return
        }

        if (data.clarificationQuestions && data.clarificationQuestions.length > 0) {
          setQuestions(data.clarificationQuestions)
        } else {
          setError('No questions found for this quote')
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
        <p className="text-zinc-500">Loading...</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-zinc-900 mb-4">Thank you!</h1>
          <p className="text-zinc-600">
            Your answers have been received. Your updated quote will be ready shortly.
            You will receive an email when it is ready.
          </p>
        </div>
      </div>
    )
  }

  if (error && questions.length === 0) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-zinc-900 mb-4">Unable to load</h1>
          <p className="text-zinc-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-lg shadow-[0_0_0_1px_rgba(0,0,0,0.08)] p-8">
          <h1 className="text-2xl font-extrabold text-zinc-900 mb-2">
            Quick questions about your quote
          </h1>
          <p className="text-zinc-500 mb-8">
            We need a little more information to finalize your quote. It will only take a moment.
          </p>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md mb-6 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {questions.map((q) => (
              <div key={q.id} className="space-y-2">
                <label className="block text-sm font-semibold text-zinc-900">
                  {q.question}
                </label>

                {q.type === 'confirm_value' && q.aiValue !== undefined ? (
                  /* T-108: one-tap confirmation of the AI's extracted value */
                  <div className="space-y-2">
                    {q.evidence && (
                      <p className="text-xs text-zinc-500 italic">
                        What we saw: {q.evidence}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAnswers(prev => ({ ...prev, [q.id]: String(q.aiValue) }))}
                        className={`flex-1 px-4 py-3 rounded-md border text-sm font-semibold transition-colors ${
                          answers[q.id] === String(q.aiValue)
                            ? 'border-green-600 bg-green-50 text-green-800'
                            : 'border-zinc-200 text-zinc-900 hover:border-zinc-400'
                        }`}
                      >
                        ✓ Yes, {String(q.aiValue)} is right
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswers(prev => ({ ...prev, [q.id]: prev[q.id] === String(q.aiValue) || prev[q.id] === undefined ? '' : prev[q.id] || '' }))}
                        className={`flex-1 px-4 py-3 rounded-md border text-sm font-semibold transition-colors ${
                          answers[q.id] !== undefined && answers[q.id] !== String(q.aiValue)
                            ? 'border-zinc-900 bg-zinc-50 text-zinc-900'
                            : 'border-zinc-200 text-zinc-900 hover:border-zinc-400'
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
                                className="w-4 h-4 text-zinc-900 border-zinc-300"
                              />
                              <span className="text-sm text-zinc-700">{option}</span>
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
                          className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
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
                          className="w-4 h-4 text-zinc-900 border-zinc-300"
                        />
                        <span className="text-sm text-zinc-700">{option}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name={q.id}
                        value="_other"
                        checked={answers[q.id] !== undefined && !q.options.includes(answers[q.id] || '')}
                        onChange={() => setAnswers(prev => ({ ...prev, [q.id]: '' }))}
                        className="w-4 h-4 text-zinc-900 border-zinc-300"
                      />
                      <span className="text-sm text-zinc-700">Other</span>
                    </label>
                    {answers[q.id] !== undefined && !q.options.includes(answers[q.id] || '') && (
                      <input
                        type="text"
                        placeholder="Please specify..."
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                        className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      />
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Your answer..."
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                    className="w-full px-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                )}
              </div>
            ))}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-zinc-900 text-white font-semibold rounded-md hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit answers'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
