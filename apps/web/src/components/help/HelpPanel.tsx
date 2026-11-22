'use client'

/**
 * T-197: the Help panel. A side panel on a wide screen, a full-screen sheet
 * on a phone, opened from the menu's Help item on every dashboard page.
 *
 * It is an extra: it loads nothing until it is opened, and a fault inside it
 * never reaches the page behind it (the layout wraps it in an error
 * boundary).
 *
 * T-198: "Ask Qolumns" comes first: a box, three questions to start from,
 * and the conversation it opens. The other three options stay below it. If
 * the assistant fails, the options below still work.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ASK_COPY, SUPPORT_COPY, SUPPORT_EMAIL } from '@qolumns/shared'
import type { MyReport, MyRequest } from '@/lib/support'
import { NEEDS_YOU_MARK } from '@/lib/status-tone'
import { NeedsYouDot } from '@/components/quotes/NeedsYouDot'
import { ProblemForm } from './ProblemForm'
import { FeatureForm } from './FeatureForm'
import { MyItems, ReportThread } from './MyItems'
import { AskBox, AskThread } from './Ask'
import { problemText, useAsk } from './useAsk'
import type { AskTurnView } from './ask-store'
import { gatherContext, lastShownError } from '@/lib/help-context'

const C = SUPPORT_COPY

/** `text`: words carried into the problem or feature form from a conversation with the assistant */
export type HelpView = { name: 'menu' | 'list' | 'ask' | 'problem' | 'feature'; text?: string } | { name: 'report'; id: string }

interface Mine {
  plan: string | null
  reports: MyReport[]
  requests: MyRequest[]
}

/** The panel's entries, in order, under "Ask Qolumns" */
const ENTRIES: Array<{ view: 'problem' | 'feature' | 'list'; label: string; hint?: string }> = [
  { view: 'problem', label: C.reportProblem, hint: C.reportProblemHint },
  { view: 'feature', label: C.suggestFeature, hint: C.suggestFeatureHint },
  { view: 'list', label: C.yours },
]

const TITLES: Record<HelpView['name'], string> = {
  menu: C.panelTitle,
  ask: ASK_COPY.title,
  problem: C.reportProblem,
  feature: C.suggestFeature,
  list: C.yours,
  report: C.yours,
}

export function HelpPanel({
  open,
  initial,
  pathname,
  onClose,
  onUnread,
}: {
  open: boolean
  /** Where to open: the menu, or one of the business's own reports (a link from an email) */
  initial: HelpView
  pathname: string
  onClose: () => void
  /** The number of reports with a reply nobody has opened, whenever the panel learns it */
  onUnread: (count: number) => void
}) {
  const [view, setView] = useState<HelpView>(initial)
  const [mine, setMine] = useState<Mine | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // T-198: the conversation lives here, so it is still there when the panel is opened again
  const assistant = useAsk(pathname)
  const askAndShow = (question: string) => {
    setView({ name: 'ask' })
    void assistant.ask(question)
  }
  const onAskAction = (kind: 'team' | 'feature' | 'problem', turn: AskTurnView): Promise<boolean> | void => {
    if (kind === 'feature') return setView({ name: 'feature', text: turn.question })
    if (kind === 'problem') return setView({ name: 'problem', text: problemText(turn, assistant.conversation.turns) })
    const context = gatherContext({ pathname, userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight, lastError: lastShownError(document), plan: mine?.plan ?? null })
    return assistant.sendToTeam(turn, context).then((ok) => {
      if (ok) void load()
      return ok
    })
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/support')
      if (!response.ok) return
      const data = (await response.json()) as Mine & { unread?: number }
      setMine({ plan: data.plan ?? null, reports: data.reports ?? [], requests: data.requests ?? [] })
      onUnread(typeof data.unread === 'number' ? data.unread : 0)
    } catch {
      // the forms still work; the list says nothing yet
    }
  }, [onUnread])

  useEffect(() => {
    if (!open) return
    setView(initial)
    void load()
  }, [open, initial, load])

  // The panel is a dialog: Escape closes it, and its heading takes the focus when a screen opens
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  useEffect(() => {
    if (open) heading.current?.focus()
  }, [open, view.name])

  if (!open) return null
  const unread = mine?.reports.filter((r) => r.unread).length ?? 0
  const toMenu = () => setView({ name: 'menu' })

  return (
    <div className="fixed inset-0 z-[60]" data-help-panel data-testid="help-panel">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="absolute inset-0 flex flex-col bg-white sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[26rem] sm:rounded-2xl sm:shadow-warm-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {view.name !== 'menu' && (
            <button
              type="button"
              onClick={() => (view.name === 'report' ? setView({ name: 'list' }) : toMenu())}
              aria-label={C.back}
              className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
              data-testid="help-back"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h2 id="help-title" ref={heading} tabIndex={-1} className="min-w-0 flex-1 font-display text-lg font-bold text-text-primary focus:outline-none">
            {TITLES[view.name]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={C.close}
            className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
            data-testid="help-close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          {view.name === 'menu' && (
            <div data-testid="help-menu">
              <AskBox pathname={pathname} turns={assistant.conversation.turns.length} busy={assistant.busy} onAsk={askAndShow} onResume={() => setView({ name: 'ask' })} />
              <ul className="space-y-2">
                {ENTRIES.map((entry) => (
                  <li key={entry.view}>
                    <button
                      type="button"
                      onClick={() => setView({ name: entry.view })}
                      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left transition-colors hover:bg-surface"
                      data-testid="help-entry"
                      data-view={entry.view}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-text-primary">{entry.label}</span>
                        {entry.hint && <span className="mt-0.5 block text-sm text-text-secondary">{entry.hint}</span>}
                      </span>
                      {entry.view === 'list' && unread > 0 && (
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${NEEDS_YOU_MARK}`} data-testid="help-unread">
                          <NeedsYouDot />
                          <span className="figure">{unread}</span> new
                        </span>
                      )}
                      <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-text-secondary" data-testid="help-email">
                Or email{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-primary underline underline-offset-2">
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </div>
          )}
          {view.name === 'ask' && (
            <AskThread
              turns={assistant.conversation.turns}
              busy={assistant.busy}
              onAsk={(question) => void assistant.ask(question)}
              onOpen={onClose}
              onAction={onAskAction}
              onRate={assistant.rate}
              onStartAgain={assistant.startAgain}
            />
          )}
          {view.name === 'problem' && <ProblemForm key={view.text ?? ''} pathname={pathname} plan={mine?.plan ?? null} initialText={view.text} onSent={load} onDone={toMenu} />}
          {view.name === 'feature' && <FeatureForm key={view.text ?? ''} initialText={view.text} onSent={load} onDone={toMenu} />}
          {view.name === 'list' && <MyItems reports={mine?.reports ?? []} requests={mine?.requests ?? []} onOpen={(id) => setView({ name: 'report', id })} />}
          {view.name === 'report' && <ReportThread reportId={view.id} onRead={load} />}
        </div>
      </div>
    </div>
  )
}
