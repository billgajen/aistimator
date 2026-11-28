'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTurnstile } from '@/components/embed/useTurnstile'
import { checkContact, type ContactRequirement } from '@/lib/contact-rules'
import { VoiceCall, deviceId, pricesOf, type CallStart } from '@/lib/voice/call-client'
import { ASSISTANT_NAME, CALL_LIMIT_SECONDS, ENGINE_NAMES, THINGS_TO_TRY, WRAP_UP_SECONDS, callNotice, type Engine } from '@/lib/voice/config'
import { callCost, median, minuteCost, usdText, worst } from '@/lib/voice/cost'
import type { GuardStatus } from '@/lib/voice/guard'
import { VOICE_GUARD } from '@/lib/voice/guard-config'
import { bannedWordsSaid, delaysOf, forTheTeam, moneySaid, plainDelaysOf, priceChecks, repeatedSentences, resultsText, toolDelaysOf, type CallResults } from '@/lib/voice/results'

/**
 * T-210, T-211: the private voice test page. One call at a time: give the details a customer
 * would, pick a business, an engine and a voice, talk, and read what the call found. Nothing is
 * stored as a quote, a lead or a booking: the results live on this page until it is left, and
 * "Copy results" puts them on the clipboard as plain text.
 */
export interface EngineChoice {
  id: Engine
  model: string
  voices: string[]
  defaultVoice: string
}

interface Props {
  businesses: Array<{ id: string; name: string; contact: ContactRequirement }>
  defaultBusinessId: string
  engines: EngineChoice[]
  turnstileSiteKey: string | null
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const ms = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value)} ms`)
const CARD = 'rounded-xl bg-surface p-5 shadow-warm'
const LABEL = 'block text-sm font-medium text-text-primary'
const FIELD = 'mt-1 block w-full rounded-lg border border-field bg-surface px-3 py-2 text-sm text-text-primary disabled:opacity-60'
const HEAD = 'text-base font-semibold text-text-primary'
const SUB = 'text-sm font-semibold text-text-primary'
const SMALL = 'text-sm text-text-secondary'

/** A copy of the results, so that React sees a new value each time the call changes */
const snapshot = (r: CallResults): CallResults => ({ ...r, transcript: r.transcript.map((e) => ({ ...e })), turns: r.turns.map((t) => ({ ...t })), tools: [...r.tools], contexts: [...r.contexts], corrected: [...r.corrected], problems: [...r.problems] })

export function VoiceTest({ businesses, defaultBusinessId, engines, turnstileSiteKey }: Props) {
  const [businessId, setBusinessId] = useState(defaultBusinessId)
  const [engineId, setEngineId] = useState<Engine>(engines[0]!.id)
  const engine = engines.find((e) => e.id === engineId) ?? engines[0]!
  const [voice, setVoice] = useState(engine.defaultVoice)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [basedIn, setBasedIn] = useState('')
  const [advice, setAdvice] = useState(true)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'email' | 'phone', string>>>({})
  const [results, setResults] = useState<CallResults | null>(null)
  const [start, setStart] = useState<CallStart | null>(null)
  const [guard, setGuard] = useState<GuardStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const call = useRef<VoiceCall | null>(null)
  const frame = useRef<number | null>(null)
  const transcriptEnd = useRef<HTMLDivElement | null>(null)
  const { containerRef: turnstileRef, getToken } = useTurnstile(turnstileSiteKey ?? undefined)

  const business = businesses.find((b) => b.id === businessId)
  const live = results?.status === 'live' || results?.status === 'starting'

  // Leaving the page ends the call
  useEffect(() => () => call.current?.end('the page was left'), [])

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [results?.transcript.length])

  /** Where this visitor stands (strikes, a block, today's calls), and with `clear` forgetting them first */
  const readGuard = useCallback(
    async (clear = false) => {
      try {
        const response = await fetch('/api/admin/voice-test/guard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: deviceId(), tenantId: businessId, clear }) })
        const json = (await response.json().catch(() => null)) as { guard?: GuardStatus } | null
        if (json?.guard) setGuard(json.guard)
      } catch {
        /* the panel stays as it was */
      }
    },
    [businessId]
  )
  useEffect(() => {
    void readGuard()
  }, [readGuard])
  // A call's ending can add a strike: read it again
  useEffect(() => {
    if (results?.status === 'ended') void readGuard()
  }, [results?.status, readGuard])

  const pickEngine = (id: Engine) => {
    setEngineId(id)
    setVoice((engines.find((e) => e.id === id) ?? engines[0]!).defaultVoice)
  }

  const begin = useCallback(async () => {
    setError(null)
    setCopied(false)
    // The business's own contact rules, as the request form applies them
    const contact = checkContact({ name, email, phone }, business?.contact ?? 'email')
    setFieldErrors(contact.errors)
    if (!contact.ok) return
    setBusy(true)
    const next = new VoiceCall(
      engine.id,
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
    try {
      // The microphone first: a browser allows it only from the press itself
      const ready = await next.prepare()
      if (!ready) return
      const turnstileToken = await getToken()
      const response = await fetch('/api/admin/voice-test/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: businessId, engine: engine.id, voice, contact: contact.clean, basedIn, generalAdvice: advice, turnstileToken, deviceId: deviceId(), sdp: ready.sdp }),
      })
      const json = (await response.json().catch(() => null)) as (CallStart & { error?: { message?: string }; fields?: typeof fieldErrors; guard?: GuardStatus }) | null
      if (!response.ok || !json?.session) {
        if (json?.fields) setFieldErrors(json.fields)
        if (json?.guard) setGuard(json.guard)
        setError(json?.error?.message ?? `The call could not be started (${response.status}).`)
        next.end('not started')
        return
      }
      setStart(json)
      setGuard(json.guard)
      next.connect(json)
    } catch {
      setError('The call could not be started.')
      next.end('not started')
    } finally {
      setBusy(false)
    }
  }, [name, email, phone, business, engine, voice, basedIn, advice, businessId, getToken])

  const end = useCallback(() => call.current?.end(), [])
  const prices = pricesOf(start)

  const copy = useCallback(async () => {
    if (!results) return
    try {
      await navigator.clipboard.writeText(resultsText(results, pricesOf(start)))
      setCopied(true)
    } catch {
      setError('The results could not be copied. Select the text below and copy it by hand.')
    }
  }, [results, start])

  const delays = results ? delaysOf(results.turns) : []
  const checks = results ? priceChecks(results) : []
  const said = results ? moneySaid(results) : []
  const banned = results ? bannedWordsSaid(results.transcript) : []
  const repeats = results ? repeatedSentences(results.transcript) : []
  const team = results ? forTheTeam(results.transcript) : []
  const liveCost = results && results.engine === 'gemini' ? callCost(results.tokens, prices.live, results.seconds) : null
  const minuteUsage = results ? { ...results.minutes, seconds: results.minutes.seconds || results.seconds } : null
  const perMinute = results && results.engine === 'openai' && minuteUsage ? minuteCost(minuteUsage, prices.minute, prices.backend) : null
  const shownGuard = results?.guard ?? guard
  const input = (id: string, label: string, value: string, set: (v: string) => void, type: string, field: 'name' | 'email' | 'phone', autoComplete: string) => (
    <div>
      <label className={`${LABEL} mt-3`} htmlFor={id}>
        {label}
      </label>
      <input id={id} type={type} autoComplete={autoComplete} className={FIELD} value={value} onChange={(e) => set(e.target.value)} disabled={live || busy} aria-invalid={!!fieldErrors[field]} aria-describedby={fieldErrors[field] ? `${id}-error` : undefined} data-testid={id} />
      {fieldErrors[field] && (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger" data-testid={`${id}-error`}>
          {fieldErrors[field]}
        </p>
      )}
    </div>
  )

  return (
    <div data-testid="voice-test">
      <h1 className="text-2xl font-bold text-text-primary">{ASSISTANT_NAME} test call</h1>
      <p className="mt-2 max-w-3xl text-text-secondary">
        A private test of a voice assistant for a business. You talk to her through this page as a customer would. Nothing a customer or a business sees is
        changed, and a call makes no quote, no request, no booking and no email.
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
            {engines.length > 1 && (
              <>
                <label className={`${LABEL} mt-3`} htmlFor="vt-engine">
                  Engine
                </label>
                <select id="vt-engine" className={FIELD} value={engine.id} onChange={(e) => pickEngine(e.target.value as Engine)} disabled={live || busy} data-testid="vt-engine">
                  {engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {ENGINE_NAMES[e.id]}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className={`${LABEL} mt-3`} htmlFor="vt-voice">
              Voice
            </label>
            <select id="vt-voice" className={FIELD} value={voice} onChange={(e) => setVoice(e.target.value)} disabled={live || busy} data-testid="vt-voice">
              {engine.voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <h3 className={`${SUB} mt-5`}>Your details</h3>
            <p className={SMALL}>As a customer would give them before a call. She is given them and does not ask for them.</p>
            {input('vt-name', 'Name', name, setName, 'text', 'name', 'name')}
            {input('vt-email', `Email${business?.contact === 'phone' ? ' (optional)' : ''}`, email, setEmail, 'email', 'email', 'email')}
            {input('vt-phone', `Phone${business?.contact === 'email' ? ' (optional)' : ''}`, phone, setPhone, 'tel', 'phone', 'tel')}

            <h3 className={`${SUB} mt-5`}>Test only</h3>
            <label className={`${LABEL} mt-3`} htmlFor="vt-based">
              Based in (a town or city)
            </label>
            <input id="vt-based" type="text" className={FIELD} value={basedIn} onChange={(e) => setBasedIn(e.target.value)} disabled={live || busy} maxLength={80} data-testid="vt-based" />
            <p className="mt-1 text-xs text-text-muted">Used only when the business has set no service area.</p>
            <label className="mt-3 flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={advice} onChange={(e) => setAdvice(e.target.checked)} disabled={live || busy} data-testid="vt-advice" />
              General advice
            </label>

            <div ref={turnstileRef} className="mt-4" />
            <div className="mt-4 flex flex-wrap items-center gap-3">
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
            <p className={`${SMALL} mt-3`} data-testid="vt-notice">
              {callNotice(business?.name ?? 'the business')}
            </p>
            {error && (
              <p className="mt-3 text-sm text-danger" role="alert" data-testid="vt-error">
                {error}
              </p>
            )}
            <p className="mt-3 text-xs text-text-muted">
              The call stops by itself at {CALL_LIMIT_SECONDS / 60} minutes. At {WRAP_UP_SECONDS / 60} minutes she is told to wrap up. Model: <span className="figure">{engine.model}</span>.
            </p>
          </section>

          <section className={CARD} aria-labelledby="vt-guard" data-testid="vt-guard">
            <h2 id="vt-guard" className={HEAD}>
              Strikes and blocks
            </h2>
            {!shownGuard ? (
              <p className={`${SMALL} mt-2`}>Not read yet.</p>
            ) : shownGuard.unavailable ? (
              <p className={`${SMALL} mt-2`}>Nothing is being counted: the store is not set up or did not answer, so every call is allowed.</p>
            ) : (
              <ul className={`${SMALL} mt-2 space-y-1`}>
                <li>
                  Strikes in the last 24 hours: <span className="figure text-text-primary">{shownGuard.strikes}</span> of <span className="figure">{VOICE_GUARD.strikesToBlock}</span>
                </li>
                <li className={shownGuard.blocked ? 'font-semibold text-danger' : undefined}>
                  {shownGuard.blocked ? `Blocked until ${new Date((shownGuard.blockedUntil ?? 0) * 1000).toLocaleString()}` : 'Not blocked'}
                </li>
                <li>
                  Calls today: this device <span className="figure text-text-primary">{shownGuard.deviceCallsToday ?? 0}</span> of <span className="figure">{VOICE_GUARD.callsPerDevicePerDay}</span>, this business{' '}
                  <span className="figure text-text-primary">{shownGuard.businessCallsToday ?? 0}</span> of <span className="figure">{VOICE_GUARD.callsPerBusinessPerDay}</span>
                </li>
              </ul>
            )}
            <button type="button" onClick={() => void readGuard(true)} disabled={live || busy} className="mt-3 min-h-[36px] rounded-lg border border-field px-4 text-sm font-semibold text-text-primary disabled:opacity-60" data-testid="vt-clear">
              Clear my block (test only)
            </button>
            <p className="mt-2 text-xs text-text-muted">Also clears today&rsquo;s call counts for this device and this business.</p>
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
                <div data-testid="vt-summary">
                  <h3 className={SUB}>The call</h3>
                  <p className="mt-1 text-sm text-text-secondary">
                    {ENGINE_NAMES[results.engine]}, voice <span className="text-text-primary">{results.voice || voice}</span>.{' '}
                    {results.status === 'ended' ? (
                      <>
                        Ended: <span className="text-text-primary">{results.endedBecause}</span>
                        {results.endReason && (
                          <>
                            {' '}
                            (her reason: <span className="figure text-text-primary">{results.endReason}</span>)
                          </>
                        )}
                        .
                      </>
                    ) : (
                      'Not ended yet.'
                    )}
                  </p>
                </div>

                <div data-testid="vt-delay">
                  <h3 className={SUB}>Delay before she answers</h3>
                  <p className={SMALL}>From the caller&rsquo;s last sound to her first sound.</p>
                  <p className="mt-2 text-sm text-text-primary">
                    Median <span className="figure font-semibold">{ms(median(delays))}</span>, worst <span className="figure font-semibold">{ms(worst(delays))}</span>, over <span className="figure">{delays.length}</span> turns
                  </p>
                  <p className="text-sm text-text-secondary">
                    Without a tool: median <span className="figure">{ms(median(plainDelaysOf(results.turns)))}</span>. With a tool, to the answer itself: median <span className="figure">{ms(median(toolDelaysOf(results.turns)))}</span>, worst{' '}
                    <span className="figure">{ms(worst(toolDelaysOf(results.turns)))}</span>.
                  </p>
                  <ol className="mt-2 space-y-1 text-sm text-text-secondary">
                    {results.turns.map((t) => (
                      <li key={t.n}>
                        Turn <span className="figure">{t.n}</span> at <span className="figure">{clock(t.at)}</span>: {t.ms === null ? 'no caller speech before it' : <span className="figure text-text-primary">{Math.round(t.ms)} ms</span>}
                        {t.tools.length > 0 && (
                          <>
                            {' '}
                            ({t.tools.join(', ')}
                            {typeof t.answerMs === 'number' && t.answerMs !== t.ms && (
                              <>
                                : <span className="figure text-text-primary">{Math.round(t.answerMs)} ms</span> to the answer
                              </>
                            )}
                            )
                          </>
                        )}
                        {t.overlapped && <> (she began over the caller)</>}
                      </li>
                    ))}
                  </ol>
                </div>

                <div data-testid="vt-cost">
                  <h3 className={SUB}>Cost</h3>
                  {liveCost && prices.live ? (
                    <>
                      <p className="mt-2 text-sm text-text-primary">
                        This call <span className="figure font-semibold">{usdText(liveCost.totalUsd)}</span>, per minute <span className="figure font-semibold">{liveCost.perMinuteUsd === null ? 'n/a' : usdText(liveCost.perMinuteUsd)}</span>
                      </p>
                      <table className="mt-2 w-full max-w-md text-sm text-text-secondary">
                        <tbody>
                          {(
                            [
                              ['Audio in', results.tokens.audioIn, liveCost.audioInUsd],
                              ['Text in', results.tokens.textIn, liveCost.textInUsd],
                              ['Audio out', results.tokens.audioOut, liveCost.audioOutUsd],
                              ['Text out', results.tokens.textOut, liveCost.textOutUsd],
                              ['Thinking', results.tokens.thoughts, liveCost.thoughtsUsd],
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
                        Prices per 1M tokens, checked {prices.live.asOf}: text in ${prices.live.textInPerMTok}, audio in ${prices.live.audioInPerMTok}, text out ${prices.live.textOutPerMTok}, audio out ${prices.live.audioOutPerMTok}. Each
                        turn is charged for what is still in the call&rsquo;s memory; the memory is trimmed as the call goes on. Context read at each turn:{' '}
                        <span className="figure">{results.contexts.join(', ') || 'none yet'}</span>.
                      </p>
                    </>
                  ) : perMinute && prices.minute ? (
                    <>
                      <p className="mt-2 text-sm text-text-primary">
                        This call <span className="figure font-semibold">{usdText(perMinute.totalUsd)}</span>, per minute <span className="figure font-semibold">{perMinute.perMinuteUsd === null ? 'n/a' : usdText(perMinute.perMinuteUsd)}</span>
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">
                        Voice: <span className="figure">{Math.round(perMinute.billedSeconds)} s</span> charged, <span className="figure text-text-primary">{usdText(perMinute.voiceUsd)}</span>. Backend model:{' '}
                        <span className="figure">{results.minutes.backendIn.toLocaleString('en-US')}</span> tokens in, <span className="figure">{results.minutes.backendOut.toLocaleString('en-US')}</span> out,{' '}
                        <span className="figure text-text-primary">{usdText(perMinute.backendUsd)}</span>.
                      </p>
                      <p className="mt-2 text-xs text-text-muted">
                        Checked {prices.minute.asOf}: the voice is ${prices.minute.activePerMinute} a minute, and a session is charged at least {prices.minute.startSeconds} seconds. The backend model&rsquo;s tokens are charged apart.
                      </p>
                    </>
                  ) : (
                    <p className={`${SMALL} mt-2`}>The registry has no price for this model, so the cost is not worked out.</p>
                  )}
                </div>

                <div data-testid="vt-prices">
                  <h3 className={SUB}>Price check</h3>
                  <p className={SMALL}>An amount she says is valid only if it is an engine total, an engine line or a typical price returned in this call.</p>
                  {checks.length === 0 ? (
                    <p className={`${SMALL} mt-2`}>The engine has not given her a price yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-text-secondary" data-testid="vt-given">
                      {checks.map((c, i) => (
                        <li key={i}>
                          <span className="figure text-xs">{clock(c.at)}</span> {c.kind === 'typical' ? 'Typical price' : 'Estimate'}, {c.service}:{' '}
                          <span className="figure font-semibold text-text-primary">
                            {c.total.toFixed(2)} {c.currency}
                          </span>{' '}
                          {c.said ? 'said' : 'not said yet'}
                        </li>
                      ))}
                    </ul>
                  )}
                  {said.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm" data-testid="vt-said">
                      {said.map((s, i) => {
                        const wrong = s.is === 'not_the_engines' || s.wrongCurrency
                        return (
                          <li key={i} className={wrong ? 'rounded-lg border border-danger p-2 font-semibold text-danger' : 'text-text-primary'} data-verdict={wrong ? 'mismatch' : 'valid'}>
                            <span className="figure text-xs">{clock(s.at)}</span> She said &ldquo;{s.text}&rdquo; = <span className="figure">{s.amount.toFixed(2)}</span>:{' '}
                            {s.is === 'not_the_engines' ? 'Mismatch: not a figure the engine gave' : `valid (${s.is === 'total' ? 'an engine total' : s.is === 'typical' ? 'a typical price' : 'an engine line'})`}
                            {s.wrongCurrency && ', wrong currency'}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {banned.length > 0 && (
                    <p className="mt-2 text-sm font-semibold text-danger" data-testid="vt-banned">
                      Words she must not use about a price: {banned.join('; ')}
                    </p>
                  )}
                  {repeats.length > 0 && (
                    <p className="mt-2 text-sm font-semibold text-danger" data-testid="vt-repeats">
                      Sentences she said more than once: {repeats.join('; ')}
                    </p>
                  )}
                </div>

                <div data-testid="vt-recorded">
                  <h3 className={SUB}>What she recorded</h3>
                  <p className="mt-1 text-sm text-text-secondary">Not on her list, for the team to confirm (what the caller had asked each time she said so): {team.length === 0 && 'nothing'}</p>
                  {team.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-text-primary" data-testid="vt-team">
                      {team.map((item, i) => (
                        <li key={i}>
                          <span className="figure text-xs">{clock(item.at)}</span> &ldquo;{item.asked}&rdquo;
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-sm text-text-secondary">
                    Contact details corrected: {results.corrected.length === 0 ? 'none' : results.corrected.map((c) => `${c.field} is now ${c.value}`).join('; ')}
                  </p>
                  <p className="text-sm text-text-secondary" data-testid="vt-contact">
                    Details on file: {[results.contact.name, results.contact.email, results.contact.phone].filter(Boolean).join(', ') || 'none'}
                  </p>
                </div>

                <div data-testid="vt-tools">
                  <h3 className={SUB}>Her tool calls</h3>
                  {results.tools.length === 0 ? (
                    <p className={`${SMALL} mt-2`}>None yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-3 text-sm">
                      {results.tools.map((t, i) => (
                        <li key={i} className="rounded-lg border border-border p-3">
                          <p className="text-text-primary">
                            <span className="figure text-xs">{clock(t.at)}</span> <span className="figure font-semibold">{t.name}</span> {t.ok ? 'answered' : <span className="text-danger">refused</span>} in <span className="figure">{t.ms} ms</span>
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
                    {resultsText(results, prices)}
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
