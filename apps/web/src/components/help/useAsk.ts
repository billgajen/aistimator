'use client'

/**
 * T-198: asking "Ask Qolumns" from the Help panel: the conversation, and the
 * answer arriving piece by piece. Every failure ends in the same place: "I
 * couldn't answer just now." with the report form offered; nothing here can
 * break the panel.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ASK_COPY, ASK_TIMEOUT_MS, type AskAction, type AskEvent, type AskRating } from '@qolumns/shared'
import { clearConversation, loadConversation, newConversation, saveConversation, type AskConversation, type AskTurnView } from './ask-store'
import { postJson } from './parts'

const FAILED_ACTIONS: AskAction[] = [{ kind: 'problem', label: ASK_COPY.actions.problem }]
/** The server gives up at twenty seconds; the browser waits a little longer for it to say so */
const BROWSER_WAIT_MS = ASK_TIMEOUT_MS + 5_000

export function useAsk(pathname: string) {
  const [conversation, setConversation] = useState<AskConversation>({ id: '', turns: [] })
  const [busy, setBusy] = useState(false)
  const current = useRef(conversation)
  current.current = conversation

  // the stored conversation is read after the page has drawn (never while the server draws it)
  useEffect(() => setConversation(loadConversation()), [])

  const update = useCallback((change: (now: AskConversation) => AskConversation) => {
    setConversation((now) => {
      const next = change(now)
      saveConversation(next)
      return next
    })
  }, [])
  const patch = useCallback(
    (key: string, change: Partial<AskTurnView> | ((turn: AskTurnView) => Partial<AskTurnView>)) =>
      update((now) => ({ ...now, turns: now.turns.map((turn) => (turn.key === key ? { ...turn, ...(typeof change === 'function' ? change(turn) : change) } : turn)) })),
    [update]
  )

  const ask = useCallback(
    async (words: string) => {
      const question = words.trim()
      if (!question || busy) return
      const key = crypto.randomUUID()
      const id = current.current.id || newConversation().id
      update((now) => ({ id, turns: [...now.turns, { key, id: null, question, text: '', outcome: null, actions: [], rate: false, rating: null, sent: false }] }))
      setBusy(true)
      const failed = (text: string = ASK_COPY.failed, actions: AskAction[] = FAILED_ACTIONS) => patch(key, { outcome: 'failed', text, actions, rate: false })
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), BROWSER_WAIT_MS)
      try {
        const response = await fetch('/api/support/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, conversationId: id, page: pathname }),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          const said = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
          // over the day's limit, or a question that is too long: said plainly, with nothing to report
          if (said?.error?.message && (response.status === 429 || response.status === 400)) failed(said.error.message, [])
          else failed()
          return
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        let finished = false
        const take = (line: string) => {
          if (!line.trim()) return
          const event = JSON.parse(line) as AskEvent
          if (event.t === 'text') patch(key, (turn) => ({ text: turn.text + event.v }))
          else if (event.t === 'done') {
            finished = true
            patch(key, { id: event.id, outcome: event.outcome, text: event.text, actions: event.actions, rate: event.rate })
          }
        }
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          pending += decoder.decode(value, { stream: true })
          const lines = pending.split('\n')
          pending = lines.pop() ?? ''
          lines.forEach(take)
        }
        take(pending)
        if (!finished) failed()
      } catch {
        failed()
      } finally {
        window.clearTimeout(timer)
        setBusy(false)
      }
    },
    [busy, pathname, patch, update]
  )

  /** "Did this answer it?" The mark shows at once; a rating that could not be kept is not worth an error. */
  const rate = useCallback(
    (turn: AskTurnView, rating: AskRating) => {
      patch(turn.key, { rating })
      if (turn.id) void postJson(`/api/support/ask/${turn.id}`, { rating })
    },
    [patch]
  )

  /** "Send this to the team": the conversation becomes one of the business's own reports */
  const sendToTeam = useCallback(
    async (turn: AskTurnView, context: unknown): Promise<boolean> => {
      const now = current.current
      const result = await postJson('/api/support/reports', {
        kind: 'problem',
        fromAssistant: now.id,
        turns: now.turns.filter((t) => t.outcome !== null).map((t) => ({ question: t.question, answer: t.text })),
        context,
      })
      if (result.ok) patch(turn.key, { sent: true })
      return result.ok
    },
    [patch]
  )

  const startAgain = useCallback(() => {
    clearConversation()
    setConversation(newConversation())
  }, [])

  return { conversation, busy, ask, rate, sendToTeam, startAgain }
}

/** The business's words and the conversation, for the report form ("Report a problem" under an answer) */
export function problemText(turn: AskTurnView, turns: readonly AskTurnView[]): string {
  const said = turns
    .filter((t) => t.outcome !== null)
    .slice(-6)
    .map((t) => `Question: ${t.question}\nAnswer: ${t.text}`)
    .join('\n\n')
  return `${turn.question}\n\nMy conversation with the assistant:\n${said}`.slice(0, 3800)
}
