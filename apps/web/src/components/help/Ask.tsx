'use client'

/**
 * T-198: "Ask Qolumns" in the Help panel: the box that comes first, and the
 * conversation it opens.
 *
 * The assistant reads and answers. Its buttons are links to a dashboard page
 * and the panel's own forms; none of them does a step for the business.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ASK_COPY, ASK_MAX_QUESTION, type AskAction, type AskSuggestion } from '@qolumns/shared'
import type { AskTurnView } from './ask-store'
import { FIELD, FormError, MAIN_BUTTON, QUIET_BUTTON } from './parts'

const C = ASK_COPY

/** The question box. `compact` is the one under a conversation. */
function AskInput({ onAsk, busy, autoFocus = false, id }: { onAsk: (question: string) => void; busy: boolean; autoFocus?: boolean; id: string }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!text.trim()) return setError(C.required)
    if (text.trim().length > ASK_MAX_QUESTION) return setError(C.tooLong)
    setError(null)
    onAsk(text)
    setText('')
  }
  return (
    <form onSubmit={submit} noValidate data-testid="ask-form">
      <label htmlFor={id} className="sr-only">
        {C.label}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter asks; Shift+Enter is a new line
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
          }}
          rows={2}
          maxLength={ASK_MAX_QUESTION + 200}
          placeholder={C.placeholder}
          autoFocus={autoFocus}
          className={`${FIELD} min-h-[44px] resize-none`}
          data-testid="ask-input"
        />
        <button type="submit" disabled={busy} className={`${MAIN_BUTTON} shrink-0`} data-testid="ask-send">
          {C.send}
        </button>
      </div>
      {error && (
        <div className="mt-2">
          <FormError message={error} />
        </div>
      )}
    </form>
  )
}

/** The first thing in the Help panel: the box, the caution, and three questions to start from */
export function AskBox({ pathname, turns, busy, onAsk, onResume }: { pathname: string; turns: number; busy: boolean; onAsk: (question: string) => void; onResume: () => void }) {
  const [suggestions, setSuggestions] = useState<AskSuggestion[]>([])
  useEffect(() => {
    let live = true
    fetch(`/api/support/ask?page=${encodeURIComponent(pathname)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { suggestions?: AskSuggestion[] } | null) => {
        if (live && Array.isArray(json?.suggestions)) setSuggestions(json.suggestions.slice(0, 3))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [pathname])

  return (
    <section className="mb-5 rounded-2xl border border-border bg-surface p-4" aria-labelledby="ask-title" data-testid="ask-box">
      <h3 id="ask-title" className="font-display text-base font-bold text-text-primary">
        {C.title}
      </h3>
      <p className="mb-3 mt-0.5 text-sm text-text-secondary" data-testid="ask-caution">
        {C.caution}
      </p>
      <AskInput id="ask-question" onAsk={onAsk} busy={busy} />
      {suggestions.length > 0 && (
        <div className="mt-3" data-testid="ask-suggestions">
          <p className="mb-1.5 text-xs font-semibold text-text-secondary">{C.suggestions}</p>
          <ul className="space-y-1.5">
            {suggestions.map((suggestion) => (
              <li key={suggestion.entry}>
                <button
                  type="button"
                  onClick={() => onAsk(suggestion.question)}
                  disabled={busy}
                  className={QUESTION_BUTTON}
                  data-testid="ask-suggestion"
                >
                  {suggestion.question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {turns > 0 && (
        <button type="button" onClick={onResume} className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline underline-offset-2" data-testid="ask-resume">
          {C.resume}
        </button>
      )}
    </section>
  )
}

const ACTION = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-field bg-white px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface'
/** A question to ask with one press: the three to start from, and (T-200) the choices under a question asked back */
const QUESTION_BUTTON = 'flex min-h-[44px] w-full items-center rounded-lg border border-field bg-white px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-white hover:border-primary'

function Turn({
  turn,
  busy,
  onAsk,
  onOpen,
  onAction,
  onRate,
}: {
  turn: AskTurnView
  busy: boolean
  /** T-200: a choice under a question that was asked back is asked as the next question */
  onAsk: (question: string) => void
  /** A page button was pressed: the panel closes and the page opens */
  onOpen: () => void
  onAction: (kind: 'team' | 'feature' | 'problem', turn: AskTurnView) => Promise<boolean> | void
  onRate: (turn: AskTurnView, rating: 'yes' | 'no') => void
}) {
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const waiting = turn.outcome === null
  // "No" offers the team, when the answer did not already
  const all: AskAction[] = turn.rating === 'no' && !turn.actions.some((a) => a.kind === 'team') ? [...turn.actions, { kind: 'team', label: C.actions.team }] : turn.actions
  // T-200: the choices of a question asked back are a list of their own, one to a row
  const choices = all.filter((a) => a.kind === 'ask')
  const actions = all.filter((a): a is Exclude<AskAction, { kind: 'ask' }> => a.kind !== 'ask')

  const press = async (kind: 'team' | 'feature' | 'problem') => {
    if (kind !== 'team') return void onAction(kind, turn)
    setSending(true)
    setSendFailed(false)
    const ok = await onAction('team', turn)
    setSending(false)
    if (ok === false) setSendFailed(true)
  }

  return (
    <li className="space-y-2" data-testid="ask-turn" data-outcome={turn.outcome ?? 'waiting'}>
      <div className="ml-8 rounded-2xl rounded-br-md bg-mint px-3.5 py-2.5 text-sm text-text-primary" data-testid="ask-question-shown">
        <span className="sr-only">{C.you}: </span>
        {turn.question}
      </div>
      <div className="mr-4 rounded-2xl rounded-bl-md border border-border bg-white px-3.5 py-3 text-sm text-text-primary" data-testid="ask-answer" aria-live="polite" aria-busy={waiting}>
        <span className="sr-only">{C.title}: </span>
        {turn.text ? <p className="whitespace-pre-wrap break-words">{turn.text}</p> : <p className="text-text-secondary">{C.thinking}</p>}

        {!waiting && choices.length > 0 && (
          <ul className="mt-3 space-y-1.5" data-testid="ask-choices">
            {choices.map((choice) => (
              <li key={choice.label}>
                <button type="button" onClick={() => onAsk(choice.label)} disabled={busy} className={QUESTION_BUTTON} data-testid="ask-choice">
                  {choice.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {!waiting && actions.length > 0 && !turn.sent && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="ask-actions">
            {actions.map((action) =>
              action.kind === 'open' ? (
                <Link key={action.href} href={action.href} onClick={onOpen} className={ACTION} data-testid="ask-open" data-href={action.href}>
                  {action.label}
                </Link>
              ) : (
                <button key={action.kind} type="button" onClick={() => void press(action.kind)} disabled={sending} className={ACTION} data-testid={`ask-${action.kind}`}>
                  {action.label}
                </button>
              )
            )}
          </div>
        )}
        {turn.sent && (
          <p role="status" className="mt-3 rounded-lg border border-secondary-line bg-secondary-light px-3.5 py-2.5 text-secondary" data-testid="ask-sent">
            {C.sent}
          </p>
        )}
        {sendFailed && (
          <div className="mt-3">
            <FormError message={C.sendFailed} />
          </div>
        )}

        {!waiting && turn.rate && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm text-text-secondary" data-testid="ask-rating">
            {turn.rating === null ? (
              <>
                <span>{C.rating.ask}</span>
                <button type="button" onClick={() => onRate(turn, 'yes')} className={`${QUIET_BUTTON} px-3`} data-testid="ask-rate-yes">
                  {C.rating.yes}
                </button>
                <button type="button" onClick={() => onRate(turn, 'no')} className={`${QUIET_BUTTON} px-3`} data-testid="ask-rate-no">
                  {C.rating.no}
                </button>
              </>
            ) : (
              <span role="status" data-testid="ask-rated" data-rating={turn.rating}>
                {turn.rating === 'yes' ? C.rating.thanksYes : C.rating.thanksNo}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** The conversation: every question and answer of this sitting, a box for the next one, and "Start again" */
export function AskThread({
  turns,
  busy,
  onAsk,
  onOpen,
  onAction,
  onRate,
  onStartAgain,
}: {
  turns: AskTurnView[]
  busy: boolean
  onAsk: (question: string) => void
  onOpen: () => void
  onAction: (kind: 'team' | 'feature' | 'problem', turn: AskTurnView) => Promise<boolean> | void
  onRate: (turn: AskTurnView, rating: 'yes' | 'no') => void
  onStartAgain: () => void
}) {
  const end = useRef<HTMLDivElement>(null)
  const last = turns[turns.length - 1]
  // keep the newest words in view as they arrive
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns.length, last?.text, last?.outcome])

  return (
    <div className="flex min-h-full flex-col" data-testid="ask-thread">
      <p className="mb-4 text-sm text-text-secondary" data-testid="ask-caution">
        {C.caution}
      </p>
      <ol className="flex-1 space-y-5">
        {turns.map((turn) => (
          <Turn key={turn.key} turn={turn} busy={busy} onAsk={onAsk} onOpen={onOpen} onAction={onAction} onRate={onRate} />
        ))}
      </ol>
      <div className="mt-5 border-t border-border pt-4">
        <AskInput id="ask-next" onAsk={onAsk} busy={busy} autoFocus />
        {turns.length > 0 && (
          <button type="button" onClick={onStartAgain} disabled={busy} className="mt-2 inline-flex min-h-[44px] items-center text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary" data-testid="ask-start-again">
            {C.again}
          </button>
        )}
      </div>
      <div ref={end} />
    </div>
  )
}
