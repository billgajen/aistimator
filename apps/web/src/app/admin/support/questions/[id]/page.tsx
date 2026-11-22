'use client'

/**
 * T-198: one question a business put to the Help assistant: the question,
 * the answer it was given, the guide entries the answer rested on, what the
 * business said about it, and the owner's own mark and private note.
 *
 * Platform admin only. Nothing here reaches the business. "Guide updated"
 * and "Nothing to do" only take the question off the list of ones to look at.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ASK_COPY, ASK_KEEP_DAYS, ageWords, type AskReview } from '@qolumns/shared'
import type { QuestionDetail } from '@/lib/help-admin'
import { ADMIN_FIELD, ADMIN_MAIN, ADMIN_QUIET, CARD, CARD_TITLE, act } from '@/components/admin/SupportParts'

const C = ASK_COPY

export default function QuestionPage({ params }: { params: { id: string } }) {
  const url = `/api/admin/support/questions/${params.id}`
  const [question, setQuestion] = useState<QuestionDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [ownerNote, setOwnerNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) return setState('missing')
      const data = (await response.json()) as { question: QuestionDetail }
      setQuestion(data.question)
      setOwnerNote(data.question.ownerNote)
      setState('ready')
    } catch {
      setState('missing')
    }
  }, [url])
  useEffect(() => {
    void load()
  }, [load])

  const save = async (body: { review?: AskReview; note?: string }, done: string) => {
    setBusy(true)
    setNote(null)
    const result = await act(url, body)
    setBusy(false)
    setNote(result.ok ? { text: done, tone: 'ok' } : { text: result.message ?? 'That could not be saved.', tone: 'error' })
    if (result.ok) await load()
  }

  if (state === 'loading') return <p className="text-text-muted">Loading…</p>
  if (state === 'missing' || !question) return <p role="alert" className="rounded-xl bg-danger-light p-4 text-danger">That question could not be found.</p>

  return (
    <div className="space-y-6" data-testid="question-page">
      <div>
        <Link href="/admin/support" className="text-sm font-semibold text-primary underline underline-offset-2">
          Back to the inbox
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-text-primary" data-testid="question-text">{question.question}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
          <span data-testid="question-business">
            {question.business}
            {question.plan ? ` (${question.plan})` : ''}
          </span>
          <span>· {ageWords(question.createdAt)} old</span>
          {question.page && <span>· asked from <span className="figure">{question.page}</span></span>}
          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold text-text-primary" data-testid="question-outcome" data-outcome={question.outcome}>
            {C.outcome[question.outcome]}
          </span>
          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold text-text-primary" data-testid="question-review" data-review={question.review}>
            {C.review[question.review]}
          </span>
        </div>
      </div>

      {note && (
        <p role={note.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm ${note.tone === 'error' ? 'bg-danger-light text-danger' : 'border border-secondary-line bg-secondary-light text-secondary'}`} data-testid="question-note">
          {note.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="answer" data-testid="question-answer">
          <h2 id="answer" className={CARD_TITLE}>The answer it was given</h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm text-text-primary">{question.answer ?? 'No answer came (a failure, or more than twenty seconds).'}</p>
          <p className="mt-4 text-sm text-text-secondary" data-testid="question-rating">
            {C.rating.ask} <span className="font-semibold text-text-primary">{question.rating ? C.ratingLabel[question.rating] : 'The business has not said.'}</span>
          </p>
          {question.reportId && (
            <p className="mt-2 text-sm text-text-secondary">
              The business sent this conversation to the team:{' '}
              <Link href={`/admin/support/problems/${question.reportId}`} className="font-semibold text-primary underline underline-offset-2" data-testid="question-report-link">
                open the report
              </Link>
              .
            </p>
          )}
        </section>

        <section className={CARD} aria-labelledby="entries" data-testid="question-entries">
          <h2 id="entries" className={CARD_TITLE}>Guide entries the answer used</h2>
          {question.entries.length === 0 ? (
            <p className="mt-3 text-sm text-text-secondary">None. Either the guide does not cover it, or the answer came from the business’s own state.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {question.entries.map((entry) => (
                <li key={entry.id} data-testid="question-entry">
                  <span className="text-text-primary">{entry.question ?? 'No longer in the guide'}</span>
                  <span className="block text-xs text-text-muted">
                    <span className="figure">{entry.id}</span>
                    {entry.file && <> · Docs/help, {entry.file}</>}
                    {entry.page && <> · <span className="figure">{entry.page}</span></>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {question.conversation.length > 1 && (
        <section className={CARD} aria-labelledby="sitting" data-testid="question-conversation">
          <h2 id="sitting" className={CARD_TITLE}>The same sitting</h2>
          <ol className="mt-3 space-y-1.5 text-sm">
            {question.conversation.map((other) => (
              <li key={other.id} className="flex flex-wrap items-baseline gap-2">
                {other.id === question.id ? (
                  <span className="font-semibold text-text-primary">{other.question}</span>
                ) : (
                  <Link href={`/admin/support/questions/${other.id}`} className="text-primary underline underline-offset-2">
                    {other.question}
                  </Link>
                )}
                <span className="text-xs text-text-muted">{C.outcome[other.outcome]}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={CARD} aria-labelledby="yours" data-testid="question-actions">
        <h2 id="yours" className={CARD_TITLE}>Yours</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy || question.review === 'guide_updated'} onClick={() => save({ review: 'guide_updated' }, 'Marked “Guide updated”.')} className={question.review === 'guide_updated' ? ADMIN_MAIN : ADMIN_QUIET} data-testid="mark-guide-updated">
            {C.review.guide_updated}
          </button>
          <button type="button" disabled={busy || question.review === 'nothing_to_do'} onClick={() => save({ review: 'nothing_to_do' }, 'Marked “Nothing to do”.')} className={question.review === 'nothing_to_do' ? ADMIN_MAIN : ADMIN_QUIET} data-testid="mark-nothing-to-do">
            {C.review.nothing_to_do}
          </button>
          {question.review !== 'open' && (
            <button type="button" disabled={busy} onClick={() => save({ review: 'open' }, 'Back on the list to look at.')} className={ADMIN_QUIET} data-testid="mark-open">
              Put back
            </button>
          )}
        </div>
        <label htmlFor="question-owner-note" className="mt-5 block text-sm font-semibold text-text-primary">Private note</label>
        <textarea id="question-owner-note" value={ownerNote} onChange={(e) => setOwnerNote(e.target.value)} rows={3} className={`${ADMIN_FIELD} mt-1.5`} data-testid="question-owner-note" />
        <button type="button" disabled={busy} onClick={() => save({ note: ownerNote }, 'Note saved.')} className={`${ADMIN_QUIET} mt-3`} data-testid="question-owner-note-save">
          Save note
        </button>
        <p className="mt-4 text-xs text-text-muted">The business never sees this. The question and its answer are deleted <span className="figure">{ASK_KEEP_DAYS}</span> days after it was asked.</p>
      </section>
    </div>
  )
}
