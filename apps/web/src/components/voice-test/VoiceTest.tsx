'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveModelPrice } from '@qolumns/shared'
import { VoiceCall, type CallStart } from '@/lib/voice/call-client'
import { ASSISTANT_NAME, CALL_LIMIT_SECONDS, THINGS_TO_TRY, WRAP_UP_SECONDS } from '@/lib/voice/config'
import { callCost, median, usdText, worst } from '@/lib/voice/cost'
import { bannedWordsSaid, delaysOf, priceChecks, resultsText, type CallResults } from '@/lib/voice/results'

/**
 * T-210: the private voice test page. One call at a time: pick a business and a voice, talk, and
 * read what the call found. Nothing is stored: the results live on this page until it is left,
 * and "Copy results" puts them on the clipboard as plain text.
 */
interface Props {
  businesses: Array<{ id: string; name: string }>
  defaultBusinessId: string
  voices: string[]
  defaultVoice: string
  model: string
  price: LiveModelPrice | null
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const CARD = 'rounded-xl bg-surface p-5 shadow-warm'
const LABEL = 'block text-sm font-medium text-text-primary'
const FIELD = 'mt-1 block w-full rounded-lg border border-field bg-surface px-3 py-2 text-sm text-text-primary disabled:opacity-60'
const HEAD = 'text-base font-semibold text-text-primary'
const SMALL = 'text-sm text-text-secondary'

/** A copy of the results, so that React sees a new value each time the call changes */
const snapshot = (r: CallResults): CallResults => ({ ...r, transcript: r.transcript.map((e) => ({ ...e })), turns: [...r.turns], tools: [...r.tools], problems: [...r.problems] })

export function VoiceTest({ businesses, defaultBusinessId, voices, defaultVoice, model, price }: Props) {
  const [businessId, setBusinessId] = useState(defaultBusinessId)
  const [voice, setVoice] = useState(defaultVoice)
  const [results, setResults] = useState<CallResults | null>(null)
  const [start, setStart] = useState<CallStart | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const call = useRef<VoiceCall | null>(null)
  const frame = useRef<number | null>(null)
  const transcriptEnd = useRef<HTMLDivElement | null>(null)

  const live = results?.status === 'live' || results?.status === 'starting'

  // Leaving the page ends the call
  useEffect(() => () => call.current?.end('the page was left'), [])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [results?.transcript.length])

  const begin = useCallback(async () => {
    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      const response = await fetch('/api/admin/voice-test/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: businessId, voice }) })
      const json = (await response.json().catch(() => null)) as (CallStart & { error?: { message?: string } }) | null
      if (!response.ok || !json?.token) {
        setError(json?.error?.message ?? `The call could not be started (${response.status}).`)
        return
      }
      setStart(json)
      const next = new VoiceCall(
        json,
        () => {
          // at most one repaint a frame, however fast the call's messages arrive
          if (frame.current !== null) return
          frame.current = requestAnimationFrame(() => {
            frame.current = null
            if (call.current) setResults(snapshot(call.current.results))
          })
        },
        navigator.userAgent
      )
      call.current = next
      setResults(snapshot(next.results))
      await next.open()
    } catch {
      setError('The call could not be started.')
    } finally {
      setBusy(false)
    }
  }, [businessId, voice])

  const end = useCallback(() => call.current?.end(), [])

  const copy = useCallback(async () => {
    if (!results) return
    try {
      await navigator.clipboard.writeText(resultsText(results, start?.prices ?? price))
      setCopied(true)
    } catch {
      setError('The results could not be copied. Select the text below and copy it by hand.')
    }
  }, [results, start, price])

  const rates = start?.prices ?? price
  const cost = results ? callCost(results.tokens, rates, results.seconds) : null
  const delays = results ? delaysOf(results.turns) : []
  const checks = results ? priceChecks(results) : []
  const banned = results ? bannedWordsSaid(results.transcript) : []
  const mid = median(delays)
  const top = worst(delays)

  return (
    <div data-testid="voice-test">
      <h1 className="text-2xl font-bold text-text-primary">{ASSISTANT_NAME} test call</h1>
      <p className="mt-2 max-w-3xl text-text-secondary">
        A private test of a voice assistant for a business. You talk to her through this page as a customer would. Nothing a customer or a business sees is
        changed, and nothing from a call is stored: no quote, no request, no booking, no email.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <section className={CARD} aria-labelledby="vt-call">
            <h2 id="vt-call" className={HEAD}>
              The call
            </h2>
            <label className={`${LABEL} mt-4`} htmlFor="vt-business">
              Business
            </label>
            <select id="vt-business" className={FIELD} value={businessId} onChange={(e) => setBusinessId(e.target.value)} disabled={live || busy} data-testid="vt-business">
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <label className={`${LABEL} mt-4`} htmlFor="vt-voice">
              Voice
            </label>
            <select id="vt-voice" className={FIELD} value={voice} onChange={(e) => setVoice(e.target.value)} disabled={live || busy} data-testid="vt-voice">
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {live ? (
                <button type="button" onClick={end} className="min-h-[44px] rounded-lg bg-danger px-5 text-sm font-semibold text-white" data-testid="vt-end">
                  End call
                </button>
              ) : (
                <button type="button" onClick={begin} disabled={busy || !businessId} className="min-h-[44px] rounded-lg bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60" data-testid="vt-start">
                  {busy ? 'Starting…' : 'Start call'}
                </button>
              )}
              {results && (
                <span className="text-sm text-text-secondary" data-testid="vt-status" aria-live="polite">
                  {results.status === 'starting' && 'Connecting…'}
                  {results.status === 'live' && (
                    <>
                      Live <span className="figure">{clock(results.seconds)}</span> of <span className="figure">{clock(CALL_LIMIT_SECONDS)}</span>
                    </>
                  )}
                  {results.status === 'ended' && (
                    <>
                      Ended at <span className="figure">{clock(results.seconds)}</span>: {results.endedBecause}
                    </>
                  )}
                </span>
              )}
            </div>
            {error && (
              <p className="mt-3 text-sm text-danger" role="alert" data-testid="vt-error">
                {error}
              </p>
            )}
            <p className={`${SMALL} mt-4`}>
              The call stops by itself at {CALL_LIMIT_SECONDS / 60} minutes. At {WRAP_UP_SECONDS / 60} minutes she is told to wrap up. Model: <span className="figure">{model}</span>.
            </p>
          </section>

          <section className={CARD} aria-labelledby="vt-try">
            <h2 id="vt-try" className={HEAD}>
              Things to try
            </h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-secondary" data-testid="vt-try-list">
              {THINGS_TO_TRY.map((thing) => (
                <li key={thing}>{thing}</li>
              ))}
            </ul>
          </section>

          {start && (
            <section className={CARD} aria-labelledby="vt-told">
              <details>
                <summary id="vt-told" className={`${HEAD} cursor-pointer`}>
                  What she was told
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-text-secondary" data-testid="vt-instruction">
                  {start.instruction}
                </pre>
              </details>
            </section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className={CARD} aria-labelledby="vt-transcript">
            <h2 id="vt-transcript" className={HEAD}>
              Transcript
            </h2>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm" data-testid="vt-transcript-list">
              {!results || results.transcript.length === 0 ? (
                <p className={SMALL}>Both sides of the call appear here as they are spoken.</p>
              ) : (
                results.transcript.map((entry, i) => (
                  <p key={i} className={entry.who === 'her' ? 'text-text-primary' : 'text-text-secondary'}>
                    <span className="figure mr-2 text-xs text-text-muted">{clock(entry.at)}</span>
                    <span className="font-semibold">{entry.who === 'her' ? ASSISTANT_NAME : 'Caller'}:</span> {entry.text}
                  </p>
                ))
              )}
              <div ref={transcriptEnd} />
            </div>
          </section>

          <section className={CARD} aria-labelledby="vt-results" data-testid="vt-results">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="vt-results" className={HEAD}>
                Results
              </h2>
              <button type="button" onClick={copy} disabled={!results} className="min-h-[36px] rounded-lg border border-field px-4 text-sm font-semibold text-text-primary disabled:opacity-60" data-testid="vt-copy">
                {copied ? 'Copied' : 'Copy results'}
              </button>
            </div>

            {!results ? (
              <p className={`${SMALL} mt-3`}>Start a call. The delay of each turn, the cost, her tool calls and the price check fill in as it runs.</p>
            ) : (
              <div className="mt-4 space-y-6">
                <div data-testid="vt-delay">
                  <h3 className="text-sm font-semibold text-text-primary">Delay before she answers</h3>
                  <p className={SMALL}>From the caller&rsquo;s last sound to her first audio.</p>
                  <p className="mt-2 text-sm text-text-primary">
                    Median <span className="figure font-semibold">{mid === null ? 'n/a' : `${Math.round(mid)} ms`}</span>, worst <span className="figure font-semibold">{top === null ? 'n/a' : `${Math.round(top)} ms`}</span>, over{' '}
                    <span className="figure">{delays.length}</span> turns
                  </p>
                  <ol className="mt-2 space-y-1 text-sm text-text-secondary">
                    {results.turns.map((t) => (
                      <li key={t.n}>
                        Turn <span className="figure">{t.n}</span> at <span className="figure">{clock(t.at)}</span>:{' '}
                        {t.ms === null ? 'no caller speech before it' : <span className="figure text-text-primary">{Math.round(t.ms)} ms</span>}
                        {t.tools.length > 0 && <> (after {t.tools.join(', ')})</>}
                        {t.overlapped && <> (she began over the caller)</>}
                      </li>
                    ))}
                  </ol>
                </div>

                <div data-testid="vt-cost">
                  <h3 className="text-sm font-semibold text-text-primary">Cost</h3>
                  {cost && rates ? (
                    <>
                      <p className="mt-2 text-sm text-text-primary">
                        This call <span className="figure font-semibold">{usdText(cost.totalUsd)}</span>, per minute <span className="figure font-semibold">{cost.perMinuteUsd === null ? 'n/a' : usdText(cost.perMinuteUsd)}</span>
                      </p>
                      <table className="mt-2 w-full max-w-md text-sm text-text-secondary">
                        <tbody>
                          {(
                            [
                              ['Audio in', results.tokens.audioIn, cost.audioInUsd],
                              ['Text in', results.tokens.textIn, cost.textInUsd],
                              ['Audio out', results.tokens.audioOut, cost.audioOutUsd],
                              ['Text out', results.tokens.textOut, cost.textOutUsd],
                              ['Thinking', results.tokens.thoughts, cost.thoughtsUsd],
                            ] as const
                          ).map(([label, tokens, amount]) => (
                            <tr key={label}>
                              <td className="py-0.5">{label}</td>
                              <td className="figure py-0.5 text-right">{tokens.toLocaleString('en-US')} tokens</td>
                              <td className="figure py-0.5 text-right text-text-primary">{usdText(amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs text-text-muted">
                        Prices per 1M tokens, checked {rates.asOf}: text in ${rates.textInPerMTok}, audio in ${rates.audioInPerMTok}, text out ${rates.textOutPerMTok}, audio out ${rates.audioOutPerMTok}. Thinking is
                        charged as text out. Each turn is charged for everything said so far.
                      </p>
                    </>
                  ) : (
                    <p className={`${SMALL} mt-2`}>The registry has no Live API price for this model, so the cost is not worked out.</p>
                  )}
                </div>

                <div data-testid="vt-prices">
                  <h3 className="text-sm font-semibold text-text-primary">Price check</h3>
                  <p className={SMALL}>The engine&rsquo;s total beside the amounts she then said.</p>
                  {checks.length === 0 ? (
                    <p className={`${SMALL} mt-2`}>She has not got an estimate yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                      {checks.map((c, i) => (
                        <li key={i} className={c.verdict === 'mismatch' ? 'rounded-lg border border-danger p-3 text-danger' : 'rounded-lg border border-border p-3 text-text-primary'} data-verdict={c.verdict}>
                          <p>
                            <span className="figure text-xs">{clock(c.at)}</span> {c.service}: the engine&rsquo;s total is{' '}
                            <span className="figure font-semibold">
                              {c.engine.total.toFixed(2)} {c.engine.currency}
                            </span>
                          </p>
                          <p className="mt-1">
                            She said:{' '}
                            {c.said.length === 0
                              ? 'no amount of money yet'
                              : c.said.map((s, k) => (
                                  <span key={k} className={s.is === 'not_the_engines' || s.wrongCurrency ? 'font-semibold text-danger' : undefined}>
                                    {k > 0 && '; '}&ldquo;{s.text}&rdquo; = <span className="figure">{s.amount.toFixed(2)}</span> ({s.is === 'not_the_engines' ? "not the engine's" : s.is}
                                    {s.wrongCurrency && ', wrong currency'})
                                  </span>
                                ))}
                          </p>
                          <p className="mt-1 font-semibold">{c.verdict === 'match' ? 'Match' : c.verdict === 'mismatch' ? 'Mismatch' : 'She has not said the total'}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {banned.length > 0 && (
                    <p className="mt-2 text-sm font-semibold text-danger" data-testid="vt-banned">
                      Words she must not use about a price: {banned.join('; ')}
                    </p>
                  )}
                </div>

                <div data-testid="vt-tools">
                  <h3 className="text-sm font-semibold text-text-primary">Her tool calls</h3>
                  {results.tools.length === 0 ? (
                    <p className={`${SMALL} mt-2`}>None yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-3 text-sm">
                      {results.tools.map((t, i) => (
                        <li key={i} className="rounded-lg border border-border p-3">
                          <p className="text-text-primary">
                            <span className="figure text-xs">{clock(t.at)}</span> <span className="figure font-semibold">{t.name}</span> {t.ok ? 'answered' : <span className="text-danger">refused</span>} in{' '}
                            <span className="figure">{t.ms} ms</span>
                          </p>
                          {t.wouldDo && <p className="mt-1 font-semibold text-text-primary">{t.wouldDo}</p>}
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-text-secondary">{`arguments: ${JSON.stringify(t.args)}\nresult: ${JSON.stringify(t.response)}`}</pre>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {results.problems.length > 0 && (
                  <div data-testid="vt-problems">
                    <h3 className="text-sm font-semibold text-danger">Problems</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
                      {results.problems.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-text-primary">The results as plain text</summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-text-secondary" data-testid="vt-results-text">
                    {resultsText(results, rates)}
                  </pre>
                </details>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
