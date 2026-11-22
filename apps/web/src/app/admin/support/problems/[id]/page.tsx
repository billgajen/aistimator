'use client'

/**
 * T-197: one problem in the support inbox: the business and its plan, its
 * words and screenshot, what was attached, the estimate and its pricing
 * trace (for an estimate report), the AI's sorting with the draft fix
 * ticket, the thread, and the owner's actions. The AI's part is advice: a
 * look-alike is only suggested as a merge, and nothing is sent to a business
 * until the owner presses the button for it.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { MINIMUM_ENTRY_LABEL, SUPPORT_COPY, SUPPORT_STATUSES, ageWords, formatMoney, rateWords, type SupportStatus } from '@qolumns/shared'
import type { ProblemDetail } from '@/lib/support-admin'
import { StatusPill, shortDate } from '@/components/help/parts'
import { ADMIN_FIELD, ADMIN_MAIN, ADMIN_QUIET, ADMIN_SELECT, CARD, CARD_TITLE, ConfirmSend, CopyButton, SeverityMark, act, type SendPreview } from '@/components/admin/SupportParts'

const C = SUPPORT_COPY

export default function ProblemPage({ params }: { params: { id: string } }) {
  const url = `/api/admin/support/problems/${params.id}`
  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [ownerNote, setOwnerNote] = useState('')
  const [mergeInto, setMergeInto] = useState('')
  const [fixedMessage, setFixedMessage] = useState('')
  const [preview, setPreview] = useState<SendPreview | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) return setState('missing')
      const data = (await response.json()) as { problem: ProblemDetail }
      setProblem(data.problem)
      setOwnerNote(data.problem.ownerNote)
      setState('ready')
    } catch {
      setState('missing')
    }
  }, [url])
  useEffect(() => {
    void load()
  }, [load])

  /** Run one action, say what happened, and read the problem again */
  const run = async (name: string, body: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(name)
    setNote(null)
    const result = await act<Record<string, unknown>>(url, body)
    setBusy(null)
    setNote(result.ok ? { text: done, tone: 'ok' } : { text: result.message ?? 'That could not be done.', tone: 'error' })
    if (result.ok) await load()
    return result.ok
  }

  if (state === 'loading') return <p className="text-text-muted">Loading…</p>
  if (state === 'missing' || !problem) return <p role="alert" className="rounded-xl bg-danger-light p-4 text-danger">That problem could not be found.</p>

  const { row, sorting, estimate } = problem
  const money = (amount: number) => formatMoney(amount, estimate?.currency ?? problem.currency ?? 'USD')

  const askFixed = async () => {
    setBusy('fixed')
    setNote(null)
    const result = await act<{ preview?: SendPreview }>(url, { action: 'fixed', message: fixedMessage, confirm: false })
    setBusy(null)
    if (result.ok && result.data?.preview) setPreview(result.data.preview)
    else setNote({ text: result.message ?? 'The email could not be prepared.', tone: 'error' })
  }
  const confirmFixed = async () => {
    setBusy('fixed-confirm')
    const result = await act<{ businesses?: number; emailed?: number }>(url, { action: 'fixed', message: fixedMessage, confirm: true })
    setBusy(null)
    if (!result.ok) return setNote({ text: result.message ?? 'That could not be done.', tone: 'error' })
    setPreview(null)
    setFixedMessage('')
    setNote({ text: `Set to fixed. ${result.data?.businesses ?? 0} told in their Help panel; ${result.data?.emailed ?? 0} emailed.`, tone: 'ok' })
    await load()
  }

  return (
    <div className="space-y-6" data-testid="problem-page">
      <div>
        <Link href="/admin/support" className="text-sm font-semibold text-primary underline underline-offset-2">
          Back to the inbox
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-text-primary" data-testid="problem-title">{row.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <StatusPill status={row.status} owner />
          <SeverityMark severity={row.severity} />
          <span>{C.reportKind[row.reportKind]}{row.aiKind ? `: ${C.aiKind[row.aiKind]}` : ''}</span>
          <span>
            · <span className="figure">{row.businesses}</span> {row.businesses === 1 ? 'business' : 'businesses'} affected
          </span>
          <span>· {ageWords(row.createdAt)} old</span>
          {row.isTest && <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted">Test estimate</span>}
        </div>
        {problem.mergedInto && (
          <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-secondary" data-testid="merged-into">
            Merged into{' '}
            <Link href={`/admin/support/problems/${problem.mergedInto.id}`} className="font-semibold text-primary underline underline-offset-2">
              {problem.mergedInto.title}
            </Link>
            .{' '}
            <button type="button" onClick={() => run('unmerge', { action: 'unmerge' }, 'The merge is undone.')} className="font-semibold text-primary underline underline-offset-2" data-testid="unmerge">
              Undo the merge
            </button>
          </p>
        )}
      </div>

      {note && (
        <p role={note.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${note.tone === 'error' ? 'border-danger-line bg-danger-light text-danger' : 'border-secondary-line bg-secondary-light text-secondary'}`} data-testid="admin-note">
          {note.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="who" data-testid="problem-business">
          <h2 id="who" className={CARD_TITLE}>The business</h2>
          <p className="mt-2 text-base font-semibold text-text-primary">{problem.business.name}</p>
          <p className="text-sm text-text-secondary">
            Plan: {problem.business.plan ?? 'none'} {problem.business.paying ? '(paying)' : '(not paying)'} · <code className="text-xs">{problem.business.id}</code>
          </p>

          <h3 className="mt-5 text-sm font-semibold text-text-primary">Their words</h3>
          {problem.choices.length > 0 && <p className="mt-1 text-sm text-text-primary" data-testid="problem-choices">{problem.choices.map((c) => C.choices[c]).join(', ')}</p>}
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary" data-testid="problem-words">{problem.body || '(no words)'}</p>
          {problem.expectedTotal !== null && (
            <p className="mt-2 text-sm text-text-secondary" data-testid="problem-expected">
              They say the total should have been <span className="figure text-text-primary">{money(problem.expectedTotal)}</span>. Recorded only: it changes no price.
            </p>
          )}
          {problem.hasScreenshot &&
            (problem.screenshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived address from private storage
              <img src={problem.screenshotUrl} alt="The screenshot the business attached" className="mt-3 max-h-80 rounded-lg border border-border" data-testid="problem-screenshot-image" />
            ) : (
              <p className="mt-3 text-sm text-text-muted">A screenshot is attached. It cannot be shown here because file storage is not set up in this environment.</p>
            ))}

          {problem.context.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-text-primary">What was attached</h3>
              <dl className="mt-1 space-y-1 text-sm" data-testid="problem-context">
                {problem.context.map((line) => (
                  <div key={line.label} className="flex flex-wrap gap-x-2">
                    <dt className="text-text-muted">{line.label}</dt>
                    <dd className="min-w-0 break-words text-text-secondary">{line.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {problem.setupHint && (
            <p className="mt-4 rounded-lg border border-tertiary-line bg-white px-3 py-2 text-sm text-text-secondary" data-testid="problem-hint-shown">
              The business is shown: “{C.setupHint(problem.setupHint.line, problem.setupHint.rate)}”
            </p>
          )}
        </section>

        <section className={CARD} aria-labelledby="sorting" data-testid="problem-sorting">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="sorting" className={CARD_TITLE}>The AI’s sorting</h2>
            <button type="button" onClick={() => run('sort', { action: 'sort' }, 'Asked for it to be sorted again. Reload in a few seconds.')} disabled={busy !== null} className={ADMIN_QUIET} data-testid="sort-again">
              {busy === 'sort' ? 'Asking…' : 'Sort again'}
            </button>
          </div>
          {sorting.state === 'failed' && <p className="mt-3 rounded-lg bg-danger-light px-3 py-2 text-sm text-danger" data-testid="sort-failed">Sorting failed or ran out of time. The report is kept as it was sent. It is not retried by itself.</p>}
          {sorting.state === 'waiting' && <p className="mt-3 text-sm text-text-muted" data-testid="sort-waiting">Waiting to be sorted.</p>}
          {sorting.state === 'sorted' && (
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-text-primary" data-testid="sort-summary">{sorting.summary}</p>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                <dt className="text-text-muted">Kind</dt>
                <dd className="text-text-primary" data-testid="sort-kind">{row.aiKind ? C.aiKind[row.aiKind] : 'Not given'}</dd>
                <dt className="text-text-muted">Severity</dt>
                <dd><SeverityMark severity={row.severity} /></dd>
                {row.likelyCause && (
                  <>
                    <dt className="text-text-muted">Likely cause</dt>
                    <dd className="text-text-primary" data-testid="sort-cause" data-cause={row.likelyCause}>{C.cause[row.likelyCause]}</dd>
                  </>
                )}
                {sorting.evidence && (
                  <>
                    <dt className="text-text-muted">Evidence</dt>
                    <dd className="text-text-secondary" data-testid="sort-evidence">{sorting.evidence}</dd>
                  </>
                )}
              </dl>
              {sorting.similar.length > 0 && (
                <div data-testid="sort-similar">
                  <p className="font-semibold text-text-primary">Looks like</p>
                  <ul className="mt-1 space-y-1.5">
                    {sorting.similar.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/support/problems/${s.id}`} className="text-primary underline underline-offset-2">{s.title}</Link>
                        <span className="figure text-text-muted">{Math.round(s.confidence * 100)}%</span>
                        {s.suggestMerge && !problem.mergedInto && (
                          <button type="button" onClick={() => run('merge', { action: 'merge', into: s.id }, 'Merged.')} disabled={busy !== null} className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent" data-testid="suggested-merge">
                            Suggested: merge into this
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-text-muted">Sorted <span className="figure">{sorting.sortedAt ? shortDate(sorting.sortedAt) : ''}</span>, try <span className="figure">{sorting.attempts}</span>.</p>
            </div>
          )}
        </section>
      </div>

      {sorting.fixTicket && (
        <section className={CARD} aria-labelledby="ticket" data-testid="fix-ticket">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ticket" className={CARD_TITLE}>Draft fix ticket</h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input type="checkbox" checked={Boolean(problem.approvedAt)} onChange={(e) => run('approve', { action: 'approve', approved: e.target.checked }, e.target.checked ? 'Approved for fixing.' : 'Approval removed.')} className="h-4 w-4 accent-primary" data-testid="approve" />
                Approved for fixing
                {problem.approvedAt && <span className="figure text-text-muted" data-testid="approved-date">{shortDate(problem.approvedAt)}</span>}
              </label>
              <CopyButton text={sorting.fixTicket} label="Copy fix ticket" />
            </div>
          </div>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-4 text-sm text-text-primary" data-testid="fix-ticket-text">{sorting.fixTicket}</pre>
        </section>
      )}

      {/* T-198: not a fault, so no fix ticket: a draft reply instead. It goes nowhere until the owner sends it. */}
      {sorting.draftReply && (
        <section className={CARD} aria-labelledby="draft-reply" data-testid="draft-reply">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="draft-reply" className={CARD_TITLE}>Draft reply</h2>
            <button
              type="button"
              onClick={() => {
                setReply(sorting.draftReply ?? '')
                setNote({ text: 'The draft is in the reply box below. Edit it, then press Send reply.', tone: 'ok' })
                document.getElementById('admin-reply')?.focus()
              }}
              className={ADMIN_QUIET}
              data-testid="use-draft-reply"
            >
              Use this reply
            </button>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-surface p-4 text-sm text-text-primary" data-testid="draft-reply-text">{sorting.draftReply}</p>
          <p className="mt-2 text-xs text-text-muted">Written by the AI from the report and what was attached. Nothing is sent until you press Send reply.</p>
        </section>
      )}

      {estimate && (
        <section className={CARD} aria-labelledby="estimate" data-testid="problem-estimate">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="estimate" className={CARD_TITLE}>The estimate and its pricing trace</h2>
            <Link href={`/admin/quotes?search=${encodeURIComponent(estimate.quoteId)}`} className="text-sm font-semibold text-primary underline underline-offset-2" data-testid="problem-quote-link">
              Open the quote ({estimate.quoteId})
            </Link>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {estimate.serviceName ?? 'Service'}
            {row.serviceTemplate ? ` (template: ${row.serviceTemplate})` : ''} · total <span className="figure text-text-primary">{estimate.total !== null ? money(estimate.total) : 'none'}</span>
            {estimate.grade ? ` · grade ${estimate.grade}` : ''}
            {estimate.minimumApplied ? ` · ${MINIMUM_ENTRY_LABEL}` : ''}
          </p>
          {estimate.steps.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="problem-trace">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                    <th className="py-1.5 pr-4 font-semibold">Line</th>
                    <th className="py-1.5 pr-4 font-semibold">How it was worked out</th>
                    <th className="py-1.5 pr-4 font-semibold">Quantity from</th>
                    <th className="py-1.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {estimate.steps.map((step, index) => (
                    <tr key={index}>
                      <td className="py-1.5 pr-4 text-text-primary">{step.line}</td>
                      <td className="figure py-1.5 pr-4 text-text-secondary">{step.sum}</td>
                      <td className="py-1.5 pr-4 text-text-secondary">{step.quantityFrom ?? ''}{step.trusted === false ? ' (estimated)' : ''}</td>
                      <td className="figure py-1.5 text-right text-text-primary">{money(step.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {estimate.setup.length > 0 && (
            <p className="mt-3 text-sm text-text-secondary" data-testid="problem-setup">
              The business’s own prices: {estimate.setup.map((line) => `${line.name} ${rateWords(line, estimate.currency)}`).join('; ')}
            </p>
          )}
        </section>
      )}

      <section className={CARD} aria-labelledby="thread" data-testid="problem-thread">
        <h2 id="thread" className={CARD_TITLE}>Thread</h2>
        {problem.messages.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No replies yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {problem.messages.map((message) => (
              <li key={message.id} className={`rounded-xl px-4 py-3 ${message.from === 'team' ? 'bg-mint' : 'border border-border bg-white'}`} data-testid="admin-thread-message" data-from={message.from}>
                <p className="text-xs font-semibold text-text-secondary">
                  {message.from === 'team' ? 'You' : problem.business.name} · <span className="figure font-normal">{shortDate(message.createdAt)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{message.body}</p>
              </li>
            ))}
          </ol>
        )}
        <form
          className="mt-4 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault()
            if (await run('reply', { action: 'reply', body: reply }, 'Reply sent to the business’s Help panel, and by email where an address was found.')) setReply('')
          }}
        >
          <label htmlFor="admin-reply" className="block text-sm font-semibold text-text-primary">Reply</label>
          <textarea id="admin-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={4} className={ADMIN_FIELD} data-testid="admin-reply-text" />
          <p className="text-xs text-text-muted">Goes to the business’s Help panel and by email to the user who reported it. The email says to reply in the dashboard.</p>
          <button type="submit" disabled={busy !== null || !reply.trim()} className={ADMIN_MAIN} data-testid="admin-reply-send">
            {busy === 'reply' ? 'Sending…' : 'Send reply'}
          </button>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="status" data-testid="problem-status">
          <h2 id="status" className={CARD_TITLE}>Status</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUPPORT_STATUSES.filter((s) => s !== 'fixed').map((s: SupportStatus) => (
              <button key={s} type="button" disabled={busy !== null || row.status === s} onClick={() => run('status', { action: 'status', status: s }, `Set to “${C.ownerStatus[s]}”.`)} className={row.status === s ? ADMIN_MAIN : ADMIN_QUIET} data-testid="set-status" data-status={s}>
                {C.ownerStatus[s]}
              </button>
            ))}
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <label htmlFor="fixed-message" className="block text-sm font-semibold text-text-primary">Fixed: a line for the businesses (optional)</label>
            <textarea id="fixed-message" value={fixedMessage} onChange={(e) => setFixedMessage(e.target.value)} rows={2} className={`${ADMIN_FIELD} mt-1.5`} data-testid="fixed-message" />
            <button type="button" onClick={askFixed} disabled={busy !== null} className={`${ADMIN_QUIET} mt-3`} data-testid="set-fixed">
              {busy === 'fixed' ? 'Preparing…' : 'Set to fixed…'}
            </button>
            {preview && <ConfirmSend preview={preview} action="fixed" busy={busy === 'fixed-confirm'} onConfirm={confirmFixed} onCancel={() => setPreview(null)} />}
          </div>
        </section>

        <section className={CARD} aria-labelledby="owner" data-testid="problem-owner">
          <h2 id="owner" className={CARD_TITLE}>Merge and note</h2>
          {!problem.mergedInto && (
            <div className="mt-3 flex flex-wrap gap-2">
              <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={`${ADMIN_SELECT} min-w-0 flex-1`} aria-label="Merge into another problem" data-testid="merge-select">
                <option value="">Merge into another problem…</option>
                {problem.mergeTargets.map((target) => (
                  <option key={target.id} value={target.id}>{target.title}</option>
                ))}
              </select>
              <button type="button" disabled={busy !== null || !mergeInto} onClick={() => run('merge', { action: 'merge', into: mergeInto }, 'Merged. Its businesses now count towards the one it joined.')} className={ADMIN_QUIET} data-testid="merge-button">
                Merge
              </button>
            </div>
          )}
          {problem.merged.length > 0 && (
            <div className="mt-4" data-testid="merged-list">
              <p className="text-sm font-semibold text-text-primary">Merged into this one</p>
              <ul className="mt-1 space-y-1 text-sm">
                {problem.merged.map((m) => (
                  <li key={m.id}>
                    <Link href={`/admin/support/problems/${m.id}`} className="text-primary underline underline-offset-2">{m.business}</Link>
                    <span className="text-text-secondary">: {m.body.slice(0, 120) || '(no words)'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label htmlFor="owner-note" className="mt-5 block text-sm font-semibold text-text-primary">Your note</label>
          <textarea id="owner-note" value={ownerNote} onChange={(e) => setOwnerNote(e.target.value)} rows={3} className={`${ADMIN_FIELD} mt-1.5`} data-testid="owner-note" />
          <p className="mt-1 text-xs text-text-muted">Private. Never shown to the business.</p>
          <button type="button" disabled={busy !== null} onClick={() => run('note', { action: 'note', note: ownerNote }, 'Note saved.')} className={`${ADMIN_QUIET} mt-3`} data-testid="owner-note-save">
            Save note
          </button>
        </section>
      </div>
    </div>
  )
}
