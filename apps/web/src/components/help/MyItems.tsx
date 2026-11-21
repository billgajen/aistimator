'use client'

/**
 * T-197: "Your reports and requests": the business's own items, newest
 * first, each with its status; a report opens to its thread, with any reply
 * from us and a box to answer. Every user of the business sees the same list.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SUPPORT_COPY } from '@qolumns/shared'
import type { MyReport, MyRequest, ThreadMessage } from '@/lib/support'
import { NEEDS_YOU_MARK } from '@/lib/status-tone'
import { NeedsYouDot } from '@/components/quotes/NeedsYouDot'
import { FIELD, FeatureStatusPill, FormError, MAIN_BUTTON, StatusPill, postJson, shortDate } from './parts'

const C = SUPPORT_COPY

/** What a report is called in the list: its words, else what was ticked */
export function reportTitle(report: Pick<MyReport, 'body' | 'choices' | 'kind'>): string {
  const words = report.body.replace(/\s+/g, ' ').trim()
  if (words) return words
  const ticked = report.choices.map((choice) => C.choices[choice]).join(', ')
  return ticked || C.reportKind[report.kind]
}

export function MyItems({ reports, requests, onOpen }: { reports: MyReport[]; requests: MyRequest[]; onOpen: (reportId: string) => void }) {
  type Item = { at: string; report?: MyReport; request?: MyRequest }
  const items: Item[] = [...reports.map((report) => ({ at: report.createdAt, report })), ...requests.map((request) => ({ at: request.createdAt, request }))].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  )
  if (items.length === 0) return <p className="text-sm text-text-secondary" data-testid="help-empty">{C.yoursEmpty}</p>
  return (
    <ul className="divide-y divide-border" data-testid="help-items">
      {items.map((item) =>
        item.report ? (
          <li key={`r-${item.report.id}`}>
            <button
              type="button"
              onClick={() => onOpen(item.report!.id)}
              className="flex min-h-[44px] w-full items-start gap-3 py-3 text-left transition-colors hover:bg-surface"
              data-testid="help-item"
              data-kind="report"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-text-muted">
                  {item.report.kind === 'estimate' ? 'Estimate report' : 'Problem'} · <span className="figure">{shortDate(item.report.createdAt)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-text-primary">{reportTitle(item.report)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <StatusPill status={item.report.status} />
                {item.report.unread && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${NEEDS_YOU_MARK}`} data-testid="help-item-unread">
                    <NeedsYouDot />
                    New reply
                  </span>
                )}
              </span>
            </button>
          </li>
        ) : (
          <li key={`f-${item.request!.id}`} className="flex items-start gap-3 py-3" data-testid="help-item" data-kind="request">
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-text-muted">
                Feature request · <span className="figure">{shortDate(item.request!.createdAt)}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 block text-sm text-text-primary">{item.request!.text}</span>
            </span>
            <FeatureStatusPill status={item.request!.status} />
          </li>
        )
      )}
    </ul>
  )
}

/** One report: what was sent, the possibility we may point to in the business's own prices, and the thread */
export function ReportThread({ reportId, onRead }: { reportId: string; onRead: () => void }) {
  const [report, setReport] = useState<MyReport | null>(null)
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/support/reports/${reportId}`)
      if (!response.ok) {
        setState('missing')
        return
      }
      const data = (await response.json()) as { report: MyReport; messages: ThreadMessage[] }
      setReport(data.report)
      setMessages(data.messages)
      setState('ready')
      // opening it is what marks our reply as read
      onRead()
    } catch {
      setState('missing')
    }
  }, [reportId, onRead])
  useEffect(() => {
    void load()
  }, [load])

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    setError(null)
    const result = await postJson<{ message?: ThreadMessage }>(`/api/support/reports/${reportId}/messages`, { body: reply })
    setSending(false)
    if (!result.ok || !result.data?.message) {
      setError(result.data?.error?.message ?? C.failed)
      return
    }
    setMessages((current) => [...current, result.data!.message!])
    setReply('')
  }

  if (state === 'loading') return <p className="text-sm text-text-muted">Loading…</p>
  if (state === 'missing' || !report) return <p className="text-sm text-text-secondary" data-testid="help-missing">That report could not be found.</p>

  return (
    <div className="space-y-5" data-testid="report-thread">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={report.status} />
        <span className="text-xs text-text-muted">
          {report.kind === 'estimate' ? 'Estimate report' : 'Problem'} · <span className="figure">{shortDate(report.createdAt)}</span>
        </span>
        {report.isTest && <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted">{C.estimate.test}</span>}
      </div>

      <div className="rounded-xl bg-surface px-4 py-3">
        <p className="text-xs font-semibold text-text-muted">What you sent us</p>
        {report.choices.length > 0 && <p className="mt-1 text-sm text-text-primary">{report.choices.map((choice) => C.choices[choice]).join(', ')}</p>}
        {report.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{report.body}</p>}
        {report.quoteId && (
          <Link href={`/app/quotes/${report.quoteId}`} className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-2">
            Open the estimate
          </Link>
        )}
      </div>

      {report.setupHint && (
        <p className="rounded-xl border border-tertiary-line bg-white px-4 py-3 text-sm text-text-primary" data-testid="setup-hint">
          {C.setupHint(report.setupHint.line, report.setupHint.rate)}{' '}
          <Link href="/app/services" className="font-semibold text-primary underline underline-offset-2">
            {C.setupHintLink}
          </Link>
        </p>
      )}

      {messages.length > 0 && (
        <ol className="space-y-3" data-testid="thread">
          {messages.map((message) => (
            <li key={message.id} className={`rounded-xl px-4 py-3 ${message.from === 'team' ? 'bg-mint' : 'border border-border bg-white'}`} data-testid="thread-message" data-from={message.from}>
              <p className="text-xs font-semibold text-text-secondary">
                {message.from === 'team' ? C.reply.fromUs : C.reply.fromYou} · <span className="figure font-normal">{shortDate(message.createdAt)}</span>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{message.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={send} className="space-y-3" data-testid="reply-form">
        <label htmlFor="help-reply" className="block text-sm font-semibold text-text-primary">
          {C.reply.label}
        </label>
        <textarea id="help-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={4000} className={FIELD} data-testid="reply-text" />
        <FormError message={error} />
        <button type="submit" disabled={sending || !reply.trim()} className={MAIN_BUTTON} data-testid="reply-send">
          {sending ? C.problem.sending : C.reply.send}
        </button>
      </form>
    </div>
  )
}
