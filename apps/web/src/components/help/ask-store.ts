/**
 * T-198: the conversation with "Ask Qolumns", kept in the browser for the
 * session: it stays while the user is signed in on this tab, and is cleared
 * by "Start again" and by signing out. Nothing here can throw into a page: a
 * browser that will not store it simply forgets the conversation on reload.
 */
import type { AskAction, AskRating, StoredAskOutcome } from '@qolumns/shared'

export interface AskTurnView {
  key: string
  /** The stored question's id, once the answer is kept (null when it was not kept) */
  id: string | null
  question: string
  text: string
  /** Null while the answer is being written */
  outcome: StoredAskOutcome | null
  actions: AskAction[]
  rate: boolean
  rating: AskRating | null
  /** "Send this to the team" was pressed and went through */
  sent: boolean
}

export interface AskConversation {
  id: string
  turns: AskTurnView[]
}

const KEY = 'help-ask-conversation'

export function newConversation(): AskConversation {
  return { id: crypto.randomUUID(), turns: [] }
}

export function loadConversation(): AskConversation {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const kept = raw ? (JSON.parse(raw) as AskConversation) : null
    if (kept && typeof kept.id === 'string' && Array.isArray(kept.turns)) {
      // an answer that was still being written when the page was left never finished
      return { id: kept.id, turns: kept.turns.filter((turn) => turn && turn.outcome !== null).slice(-30) }
    }
  } catch {
    // no stored conversation
  }
  return newConversation()
}

export function saveConversation(conversation: AskConversation): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ id: conversation.id, turns: conversation.turns.slice(-30) }))
  } catch {
    // the conversation still shows; it is not kept across a reload
  }
}

export function clearConversation(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
