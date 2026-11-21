'use client'

/**
 * T-197: "Suggest a feature". One box. Before it is saved the server looks
 * for requests that mean the same; if it finds any the business chooses:
 * add its vote to one, or say its own is different. The business is never
 * shown who else asked or how many.
 */
import { useState } from 'react'
import { SUPPORT_COPY } from '@qolumns/shared'
import { FIELD, FormError, LABEL, MAIN_BUTTON, QUIET_BUTTON, Thanks, postJson } from './parts'

const C = SUPPORT_COPY.feature

interface Match {
  id: string
  title: string
  summary: string
}
interface Answer {
  step?: 'match' | 'saved'
  matches?: Match[]
  message?: string
}

export function FeatureForm({ onSent, onDone }: { onSent: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState<string | null>(null)

  const send = async (extra: { voteFor?: string; different?: true }, mark: string) => {
    if (!text.trim()) {
      setError(C.required)
      return
    }
    setBusy(mark)
    setError(null)
    const result = await postJson<Answer>('/api/support/features', { text, ...extra })
    setBusy(null)
    if (!result.ok) {
      // "You've already asked for this." is an answer, not a fault
      setError(result.data?.error?.message ?? SUPPORT_COPY.failed)
      return
    }
    if (result.data?.step === 'match' && result.data.matches?.length) {
      setMatches(result.data.matches)
      return
    }
    onSent()
    setThanks(result.data?.message ?? C.thanks)
  }

  if (thanks) return <Thanks message={thanks} onDone={onDone} />

  if (matches) {
    return (
      <div className="space-y-4" data-testid="feature-match">
        <p className="text-sm font-semibold text-text-primary">{C.similar}</p>
        <ul className="space-y-3">
          {matches.map((match) => (
            <li key={match.id} className="rounded-xl border border-border bg-white p-4" data-testid="feature-match-item">
              <p className="text-sm font-semibold text-text-primary">{match.title}</p>
              {match.summary && <p className="mt-1 text-sm text-text-secondary">{match.summary}</p>}
              <button type="button" disabled={busy !== null} onClick={() => send({ voteFor: match.id }, match.id)} className={`${MAIN_BUTTON} mt-3`} data-testid="feature-vote">
                {busy === match.id ? C.looking : C.yes}
              </button>
            </li>
          ))}
        </ul>
        <FormError message={error} />
        <button type="button" disabled={busy !== null} onClick={() => send({ different: true }, 'different')} className={QUIET_BUTTON} data-testid="feature-different">
          {busy === 'different' ? C.looking : C.no}
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send({}, 'send')
      }}
      className="space-y-5"
      data-testid="feature-form"
      noValidate
    >
      <div>
        <label htmlFor="help-feature" className={LABEL}>
          {C.label} <span className="font-normal text-text-muted">(required)</span>
        </label>
        <textarea id="help-feature" value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} className={FIELD} data-testid="feature-text" />
      </div>
      <FormError message={error} />
      <button type="submit" disabled={busy !== null} className={MAIN_BUTTON} data-testid="feature-send">
        {busy ? C.looking : C.send}
      </button>
    </form>
  )
}
