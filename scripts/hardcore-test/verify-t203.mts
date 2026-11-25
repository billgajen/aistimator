// T-203 check: a busy AI provider is waited for, then overflowed, then the job is put back.
//
// No model is asked and nothing here touches production. The two providers are stand-ins this
// script starts itself (one small HTTP server, port 8791), and the worker's own code is run
// in-process against them and against the local database:
//
//   A. the worker's real clients over real HTTP: busy then an answer, Retry-After, busy then the
//      overflow model, busy on both, a real error, and a busy photo read that a caller swallowed
//   B. the queue rules with the real quote row: put back without using a real try, the count kept
//      on the quote, the two bounds, and the quote marked failed at the end
//   C. a request priced by the real worker stores the two counts in its timings
//   D. the 5-minute check counts a window from the database and emails once an hour (counts only)
//   E. the queue's settings, and the load test's refusal of production
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t203.mts
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off (part C). The harness is T-201's.
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { h, finish } from './t201/harness.mts'
import { ROOT } from './lib.mjs'
import { AiUsageMeter, overflowCandidate, resolveModelRoute } from '../../packages/shared/src/ai-models'
import { AI_BUSY_ALERT_RETRIES, busyAlertDue } from '../../packages/shared/src/ops-alerts'
import { createAiClient } from '../../apps/worker/src/ai/factory'
import { AiBusyError, AiBusyLog, AiProviderError, BusyRetryClient } from '../../apps/worker/src/ai/busy'
import { extractStructuredSignals } from '../../apps/worker/src/ai/signals'
import { handleQuoteJob, MAX_BUSY_REQUEUES, MAX_DELIVERY_RETRIES, MAX_RETRIES, type BusyState, type JobMessage } from '../../apps/worker/src/queue-consumer'
import { readBusyState, saveBusyState } from '../../apps/worker/src/busy-state'
import { markQuoteFailed } from '../../apps/worker/src/failed-quote'
import { checkBusy } from '../../apps/worker/src/ops-alert'
import { getSupabaseClient } from '../../apps/worker/src/supabase'

const { check, section, rows, cfg } = h
const PORT = 8791
const candidate = overflowCandidate()
if (!candidate) {
  console.error('The registry names no overflow candidate (packages/shared/src/ai-models.json, overflowCandidate).')
  process.exit(2)
}
const OVERFLOW = `${candidate.provider}:${candidate.model}`

// ---------------------------------------------------------------------------
// The stand-in for both providers. A request's path names its case:
//   /gemini/<case>/<model>:generateContent        /second/<case>/v1/messages
// and each case has a script of answers: a status and body, used in order (the last one repeats).
// ---------------------------------------------------------------------------
type Answer = { status: number; body: string; headers?: Record<string, string> }
const scripts = new Map<string, Answer[]>()
const seen = new Map<string, Array<{ at: number; model: string; text: string }>>()
const hits = (key: string) => seen.get(key) ?? []

const geminiOk = (text: string): Answer => ({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 } }) })
const secondOk = (text: string): Answer => ({ status: 200, body: JSON.stringify({ id: 'msg_stand_in', type: 'message', role: 'assistant', model: candidate.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 140, output_tokens: 40 } }) })
const tooMany = (retryAfter?: string): Answer => ({ status: 429, body: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota"}}', ...(retryAfter && { headers: { 'Retry-After': retryAfter } }) })
const overloaded: Answer = { status: 503, body: '{"error":{"code":503,"status":"UNAVAILABLE","message":"The model is overloaded. Please try again later."}}' }
const secondBusy: Answer = { status: 529, body: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }
const badRequest: Answer = { status: 400, body: '{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"bad"}}' }

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const [, provider, name] = (req.url ?? '').split('?')[0]!.split('/')
    const key = `${provider}/${name}`
    const list = seen.get(key) ?? []
    const script = scripts.get(key) ?? [{ status: 500, body: '{"error":"no script for this case"}' }]
    const answer = script[Math.min(list.length, script.length - 1)]!
    let model = ''
    try {
      model = provider === 'second' ? String((JSON.parse(raw) as { model?: string }).model ?? '') : decodeURIComponent((req.url ?? '').split('/').pop()!.split(':')[0] ?? '')
    } catch {
      /* not JSON: the model stays unknown */
    }
    list.push({ at: Date.now(), model, text: raw })
    seen.set(key, list)
    res.writeHead(answer.status, { 'Content-Type': 'application/json', ...(answer.headers ?? {}) })
    res.end(answer.body)
  })
})
await new Promise<void>((resolve, reject) => server.once('error', reject).listen(PORT, '127.0.0.1', resolve))

/** The worker's settings for one case: development, both providers at the stand-in, short waits */
const envFor = (name: string, extra: Record<string, string> = {}) =>
  ({
    ENVIRONMENT: 'development',
    GEMINI_API_KEY: 'local-stand-in-key',
    AI_GEMINI_BASE_URL: `http://127.0.0.1:${PORT}/gemini/${name}`,
    AI_ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}/second/${name}`,
    AI_BUSY_WAITS_MS: '40,80,120',
    ...extra,
  }) as never
const withOverflow = { ANTHROPIC_API_KEY: 'local-stand-in-key', AI_OVERFLOW_WORDING: OVERFLOW, AI_OVERFLOW_EXTRACTION_PASS: OVERFLOW }
const caught = async (run: () => Promise<unknown>) => run().then((value) => ({ value, error: undefined as unknown }), (error: unknown) => ({ value: undefined, error }))

const quietLog = console.warn
const quietError = console.error
const quietInfo = console.log
function hush<T>(run: () => Promise<T>): Promise<T> {
  // the retries log a line each; the checks below say what happened
  console.warn = () => undefined
  console.error = () => undefined
  return run().finally(() => {
    console.warn = quietLog
    console.error = quietError
  })
}

try {
  // -------------------------------------------------------------------------
  section('A. The one AI call is retried in place, then sent to the overflow model (items 1 and 2)')
  const own = resolveModelRoute('wording')

  scripts.set('gemini/a1', [tooMany(), overloaded, geminiOk('the wording')])
  const a1log = new AiBusyLog()
  const a1 = createAiClient('wording', envFor('a1'), undefined, { busy: a1log })!
  const a1started = Date.now()
  const a1answer = await hush(() => a1.generateText('Write the summary for a fence repair.'))
  check('busy (429), busy (503), then an answer: the caller gets the answer', a1 instanceof BusyRetryClient && a1answer === 'the wording', a1answer)
  check('…the same call was asked three times, of the task’s own model, with the same words', hits('gemini/a1').length === 3 && hits('gemini/a1').every((r) => r.model === own.model && r.text === hits('gemini/a1')[0]!.text), hits('gemini/a1').map((r) => r.model))
  check('…after real waits (the two short test waits, with jitter)', Date.now() - a1started >= 80 && hits('gemini/a1')[1]!.at - hits('gemini/a1')[0]!.at >= 28, Date.now() - a1started)
  check('…and the run’s log says 2 busy retries, 0 overflow calls, nothing given up', a1log.busyRetries === 2 && a1log.overflowCalls === 0 && a1log.exhaustedTasks.length === 0, a1log)

  scripts.set('gemini/a2', [tooMany('1'), geminiOk('after the wait')])
  const a2 = createAiClient('wording', envFor('a2'))!
  const a2started = Date.now()
  await hush(() => a2.generateText('p'))
  check('a Retry-After header is honoured: the retry waits the second the provider asked for', hits('gemini/a2').length === 2 && hits('gemini/a2')[1]!.at - hits('gemini/a2')[0]!.at >= 1000, hits('gemini/a2')[1]!.at - a2started)

  scripts.set('gemini/a3', [tooMany('120'), geminiOk('never reached')])
  scripts.set('second/a3', [secondOk('from the overflow model')])
  const a3 = createAiClient('wording', envFor('a3', withOverflow))!
  const a3answer = await hush(() => a3.generateText('p'))
  check('a provider that asks for two minutes is not waited for: the call goes straight to the overflow model', a3answer === 'from the overflow model' && hits('gemini/a3').length === 1 && hits('second/a3').length === 1, [a3answer, hits('gemini/a3').length])

  scripts.set('gemini/a4', [tooMany()])
  scripts.set('second/a4', [secondOk('from the overflow model')])
  const a4log = new AiBusyLog()
  const a4meter = new AiUsageMeter()
  const a4 = createAiClient('wording', envFor('a4', withOverflow), a4meter, { busy: a4log })!
  const a4answer = await hush(() => a4.generateText('Write the summary for a fence repair.'))
  check('still busy after three retries: that one call goes to the overflow model and its answer is used', a4answer === 'from the overflow model' && hits('gemini/a4').length === 4 && hits('second/a4').length === 1, [a4answer, hits('gemini/a4').length, hits('second/a4').length])
  check('…the overflow model is the one the setting names, asked the same words', hits('second/a4')[0]!.model === candidate.model && hits('second/a4')[0]!.text.includes('Write the summary for a fence repair.'), hits('second/a4')[0]!.model)
  const a4usage = a4meter.summary()
  check('…the log says 3 busy retries and 1 overflow call, and the cost is counted at the overflow model’s price', a4log.busyRetries === 3 && a4log.overflowCalls === 1 && a4usage.byTask.length === 1 && a4usage.byTask[0]!.model === candidate.model && a4usage.estimatedCostUsd > 0 && a4usage.unpricedModels.length === 0, [a4log, a4usage])

  scripts.set('gemini/a5', [tooMany()])
  scripts.set('second/a5', [secondBusy])
  const a5log = new AiBusyLog()
  const a5 = createAiClient('wording', envFor('a5', withOverflow), undefined, { busy: a5log })!
  const a5result = await hush(() => caught(() => a5.generateText('p')))
  check('busy on both providers: the call ends with the "busy" error, which names the task and nothing of the request', a5result.error instanceof AiBusyError && a5result.error.task === 'wording' && a5result.error.overflowTried && !a5result.error.message.includes('fence'), String(a5result.error))
  check('…the overflow model was asked once (no retries of its own), and the task is marked for the run', hits('second/a5').length === 1 && a5log.exhaustedTasks.join() === 'wording', [hits('second/a5').length, a5log.exhaustedTasks])
  const a5before = hits('gemini/a5').length
  const a5again = await hush(() => caught(() => a5.generateText('a second call')))
  check('…and a second call in the same run does not wait all over again', a5again.error instanceof AiBusyError && hits('gemini/a5').length === a5before && hits('second/a5').length === 1)

  scripts.set('gemini/a6', [tooMany()])
  const a6 = createAiClient('wording', envFor('a6', { AI_OVERFLOW_WORDING: OVERFLOW }))!
  const a6result = await hush(() => caught(() => a6.generateText('p')))
  check('with no key for the overflow provider, overflow is off and the retries still happen', a6result.error instanceof AiBusyError && !a6result.error.overflowTried && hits('gemini/a6').length === 4 && hits('second/a6').length === 0, [String(a6result.error), hits('gemini/a6').length])

  scripts.set('gemini/a7', [tooMany()])
  scripts.set('second/a7', [secondOk('never asked')])
  const a7 = createAiClient('wording', envFor('a7', { ...withOverflow, AI_OVERFLOW_WORDING: 'none' }))!
  const a7result = await hush(() => caught(() => a7.generateText('p')))
  check('"none" switches a task’s overflow off, key or no key', a7result.error instanceof AiBusyError && hits('second/a7').length === 0)

  scripts.set('gemini/a8', [badRequest])
  scripts.set('second/a8', [secondOk('never asked')])
  const a8log = new AiBusyLog()
  const a8 = createAiClient('wording', envFor('a8', withOverflow), undefined, { busy: a8log })!
  const a8started = Date.now()
  const a8result = await caught(() => a8.generateText('p'))
  check('a real error (400) behaves as before: thrown at once, one request, no overflow, nothing counted', a8result.error instanceof AiProviderError && !a8result.error.busy && a8result.error.message.startsWith('Gemini API error: 400') && hits('gemini/a8').length === 1 && hits('second/a8').length === 0 && a8log.busyRetries === 0 && Date.now() - a8started < 2000, String(a8result.error))

  scripts.set('gemini/a9', [tooMany()])
  scripts.set('second/a9', [{ status: 400, body: '{"type":"error","error":{"type":"invalid_request_error","message":"schema refused"}}' }])
  const a9log = new AiBusyLog()
  const a9 = createAiClient('wording', envFor('a9', withOverflow), undefined, { busy: a9log })!
  const a9result = await hush(() => caught(() => a9.generateText('p')))
  check('an overflow model that fails in a way of its own leaves the call "busy": never a worse result than no overflow', a9result.error instanceof AiBusyError && a9log.exhaustedTasks.join() === 'wording', String(a9result.error))

  // The case the ticket is about: a photo read that finds the model busy. Its caller catches every
  // error and carries on with "no photo reading" (it always did). The run's log still knows.
  scripts.set('gemini/a10', [tooMany()])
  scripts.set('second/a10', [secondBusy])
  const a10log = new AiBusyLog()
  const vision = createAiClient('extraction_pass', envFor('a10', withOverflow), undefined, { busy: a10log })!
  const pixel = { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }
  const reading = await hush(() => caught(() => extractStructuredSignals(vision, [pixel], { serviceName: 'Exterior wall painting', serviceDescription: 'Painting of exterior walls', expectedSignals: [{ key: 'wall_area', label: 'Wall area', type: 'number' }] } as never)))
  const fellBack = reading.error === undefined && reading.value !== undefined
  check('a busy photo read is swallowed by its caller, as every failed read is (it answers with "no reading")', fellBack, String(reading.error))
  let stopped: unknown
  try {
    a10log.throwIfExhausted()
  } catch (error) {
    stopped = error
  }
  check('…but the processor’s checkpoint then stops the run: nothing is priced around an unread photo', stopped instanceof AiBusyError && stopped.task === 'extraction_pass' && stopped.counts?.busyRetries === 3 && stopped.counts.overflowCalls === 1, [String(stopped), (stopped as AiBusyError | undefined)?.counts])
  check('…and the caller’s own "try the other way" did not wait a second time', hits('gemini/a10').length === 4 && hits('second/a10').length === 1, [hits('gemini/a10').length, hits('second/a10').length])

  // -------------------------------------------------------------------------
  section('C. A request priced by the real worker stores the counts in its timings (item 4)')
  const biz = await h.business('busy')
  const service = await h.paintService(biz)
  const key = await h.siteKey(biz)
  const sent = await h.submit(key, service, 'Nora Whitlock')
  const priced = await h.waitForQuote(sent.id, (row) => !['queued', 'generating'].includes(String(row.status)))
  const timings = (priced.pricing_trace_json as { timings?: Record<string, unknown> } | null)?.timings ?? {}
  check('the request was priced', typeof (priced.pricing_json as { total?: unknown } | null)?.total === 'number', priced.status)
  check('its stored timings say how many busy retries and overflow calls it used: 0 and 0', timings.busyRetries === 0 && timings.overflowCalls === 0 && !('busyRequeues' in timings), timings)
  check('…and when they were written', typeof timings.finishedAt === 'string' && Math.abs(Date.now() - Date.parse(String(timings.finishedAt))) < 10 * 60_000, timings.finishedAt)

  // -------------------------------------------------------------------------
  section('B. Busy is not a failure: the queue rules, with the real quote row (item 3)')
  const db = getSupabaseClient(cfg.supabaseUrl, cfg.serviceKey)!
  // a second request, taken back to "being priced" so the rules have a waiting quote to work on
  const waiting = await h.submit(key, service, 'Owen Farrow')
  await h.waitForQuote(waiting.id, (row) => !['queued', 'generating'].includes(String(row.status)))
  await h.patch('quotes', `id=eq.${waiting.id}`, { status: 'generating', content_json: { businessRetries: 1 } })
  type Job = { quoteId: string; tenantId: string }
  const job: Job = { quoteId: waiting.id, tenantId: biz.tenantId }
  const arrived = Date.now()
  let clock = arrived
  const failures: string[] = []
  const deliver = async (attempts: number, outcome: 'busy' | 'fault' | 'priced') => {
    const m = { body: job, attempts, timestamp: new Date(arrived), acked: 0, retried: [] as Array<number | undefined> }
    const message: JobMessage<Job> = { body: m.body, attempts: m.attempts, timestamp: m.timestamp, ack: () => void (m.acked += 1), retry: (options) => void m.retried.push(options?.delaySeconds) }
    let before: BusyState | undefined
    const result = await hush(() =>
      handleQuoteJob<Job>(message, {
        limiter: null,
        process: async (_job, _wait, busyBefore) => {
          before = busyBefore
          if (outcome === 'busy') {
            const error = new AiBusyError('extraction_pass', true)
            error.counts = { busyRetries: 3, overflowCalls: 1 }
            throw error
          }
          if (outcome === 'fault') throw new Error('the database did not answer')
          return { success: true }
        },
        markFailed: async (j, error) => {
          failures.push(error)
          await markQuoteFailed(db, {}, j.quoteId, error)
        },
        maxRetries: MAX_RETRIES,
        backoffSeconds: (n) => 30 * 2 ** n,
        busy: { read: (j) => readBusyState(db, j.quoteId), save: (j, state) => saveBusyState(db, j.quoteId, state) },
        now: () => clock,
      })
    )
    return { result, before, acked: m.acked, retried: m.retried }
  }
  const stored = async () => (await rows('quotes', `id=eq.${waiting.id}&select=status,content_json`))[0] as { status: string; content_json: { busy?: BusyState; businessRetries?: number; error?: string } }

  const first = await deliver(1, 'busy')
  const afterFirst = await stored()
  check('a run that ends busy on both providers is put back for 60 seconds, and nothing is marked failed', first.result === 'requeued_busy' && first.retried.join() === '60' && first.acked === 0 && failures.length === 0, first)
  check('…the count is kept on the quote (1 requeue, 3 busy retries, 1 overflow call), beside its other notes, and its status is unchanged', afterFirst.status === 'generating' && afterFirst.content_json.busy?.requeues === 1 && afterFirst.content_json.busy.busyRetries === 3 && afterFirst.content_json.busy.overflowCalls === 1 && afterFirst.content_json.businessRetries === 1, afterFirst)

  clock = arrived + 70_000
  const second = await deliver(2, 'busy')
  clock = arrived + 170_000
  const third = await deliver(3, 'busy')
  check('then longer: 90 seconds, then 120', second.retried.join() === '90' && third.retried.join() === '120' && third.before?.requeues === 2, [second.retried, third.retried])

  clock = arrived + 300_000
  const fault = await deliver(4, 'fault')
  check('a busy requeue does not use up a real try: after three of them, a real fault is try number one and waits 30 seconds as before', fault.result === 'retry' && fault.retried.join() === '30' && failures.length === 0 && fault.before?.requeues === 3, fault)

  // seven more busy runs reach the bound of ten
  let last = fault
  for (let n = 4; n <= MAX_BUSY_REQUEUES; n++) {
    clock = arrived + 300_000 + n * 1000
    last = await deliver(n + 2, 'busy')
  }
  const atBound = await stored()
  check(`ten busy requeues are allowed (the quote’s count reads ${MAX_BUSY_REQUEUES}), each put back, none marked failed`, last.result === 'requeued_busy' && atBound.content_json.busy?.requeues === MAX_BUSY_REQUEUES && atBound.status === 'generating' && failures.length === 0, atBound.content_json.busy)

  clock = arrived + 320_000
  const eleventh = await deliver(MAX_BUSY_REQUEUES + 3, 'busy')
  const failed = await stored()
  check('the eleventh is not: the quote is marked failed, as any failed quote is, and comes off the queue', eleventh.result === 'failed' && eleventh.acked === 1 && eleventh.retried.length === 0 && failed.status === 'failed' && failures.length === 1, [eleventh, failed.status])
  check('…with the reason stored for us: still busy after 10 requeues', /AI busy: extraction_pass .*still busy after 10 requeues/.test(String(failed.content_json.error)), failed.content_json.error)
  check(`the queue is asked for at most ${MAX_DELIVERY_RETRIES} deliveries after the first (10 busy + 3 real)`, MAX_BUSY_REQUEUES + MAX_RETRIES === MAX_DELIVERY_RETRIES && MAX_DELIVERY_RETRIES === 13)

  // the other bound, on a fresh quote: fifteen minutes from arrival
  const late = await h.submit(key, service, 'Petra Lindqvist')
  await h.waitForQuote(late.id, (row) => !['queued', 'generating'].includes(String(row.status)))
  await h.patch('quotes', `id=eq.${late.id}`, { status: 'generating', content_json: {} })
  job.quoteId = late.id
  failures.length = 0
  clock = arrived + 14 * 60_000 + 35_000
  const nearEnd = await deliver(1, 'busy')
  check('near the 15 minutes the wait is cut short, so no run starts after them', nearEnd.result === 'requeued_busy' && Number(nearEnd.retried[0]) === 25, nearEnd.retried)
  clock = arrived + 15 * 60_000
  const tooLate = await deliver(2, 'busy')
  const lateRow = (await rows('quotes', `id=eq.${late.id}&select=status,content_json`))[0] as { status: string; content_json: { error?: string } }
  check('15 minutes after the request arrived a busy run is marked failed, however few requeues it had', tooLate.result === 'failed' && lateRow.status === 'failed' && /still busy after 1 requeues and 15 minutes/.test(String(lateRow.content_json.error)), [tooLate.result, lateRow])

  // -------------------------------------------------------------------------
  section('D. The 5-minute check counts the busy answers and tells the owner once (item 4)')
  const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
  const forgetAlert = () => h.http('DELETE', `${cfg.supabaseUrl}/rest/v1/ops_alerts?kind=eq.ai_busy`, { headers: admin })
  await forgetAlert()
  // An earlier run of this script, minutes ago, left its own made-up counts on its own quotes: take them
  // off, so this run counts only what it puts there. (Only this script's businesses are named "… busy …".)
  const earlier = (await rows('tenants', `name=like.Harlow busy *&id=neq.${biz.tenantId}&select=id`)).map((t) => String(t.id))
  if (earlier.length) {
    const old = await rows('quotes', `tenant_id=in.(${earlier.join(',')})&created_at=gt.${new Date(Date.now() - 2 * 3_600_000).toISOString()}&select=id,content_json,pricing_trace_json`)
    for (const row of old) {
      const content = { ...((row.content_json as Record<string, unknown> | null) ?? {}) }
      delete content.busy
      const oldTrace = (row.pricing_trace_json as { timings?: Record<string, unknown> } | null) ?? null
      await h.patch('quotes', `id=eq.${row.id}`, { content_json: content, ...(oldTrace?.timings && { pricing_trace_json: { ...oldTrace, timings: { ...oldTrace.timings, busyRetries: 0, overflowCalls: 0 } } }) })
    }
  }
  const mails: Array<{ to: string; subject: string; textBody?: string }> = []
  const send = (async (_config: unknown, email: { to: string; subject: string; textBody?: string }) => {
    mails.push(email)
    return { success: true }
  }) as never
  const alertEnv = { ALERT_EMAIL: 'alerts@owner.test', POSTMARK_API_TOKEN: 'local-token-t203', POSTMARK_FROM_EMAIL: 'quotes@example.test', ENVIRONMENT: 'development' }
  const quiet = await hush(() => checkBusy(db, alertEnv, new Date(), send))
  // Other checks may be pricing requests beside this one. At the quick level theirs have no busy answers
  // (no model is asked); at the full level a real busy answer is possible, and is counted like any other.
  check('a window below the thresholds raises nothing', busyAlertDue(quiet.count) ? quiet.alert === 'sent' : quiet.alert === 'none' && mails.length === 0, quiet)
  await forgetAlert()
  mails.length = 0

  const trace = (priced.pricing_trace_json ?? {}) as Record<string, unknown>
  await h.patch('quotes', `id=eq.${sent.id}`, { pricing_trace_json: { ...trace, timings: { ...timings, busyRetries: AI_BUSY_ALERT_RETRIES + 4, overflowCalls: 2, finishedAt: new Date().toISOString() } } })
  await h.patch('quotes', `id=eq.${late.id}`, { content_json: { busy: { requeues: 1, busyRetries: 3, overflowCalls: 1, lastAt: new Date().toISOString(), lastRun: { busyRetries: 3, overflowCalls: 1 } } } })
  console.log = () => undefined
  const loud = await hush(() => checkBusy(db, alertEnv, new Date(), send)).finally(() => (console.log = quietInfo))
  check('a window with many busy retries is counted from what the quotes stored: the priced one and the one put back', loud.count.busyRetries >= quiet.count.busyRetries + AI_BUSY_ALERT_RETRIES + 4 + 3 && loud.count.overflowCalls >= quiet.count.overflowCalls + 3 && loud.count.requeued >= quiet.count.requeued + 1 && loud.count.quotes >= quiet.count.quotes + 2, [quiet.count, loud.count])
  const mail = mails[0]
  check('…and the owner gets one email, with the counts', loud.alert === 'sent' && mails.length === 1 && mail!.to === 'alerts@owner.test' && mail!.subject.includes('The AI providers were busy') && String(mail!.textBody).includes(`Busy retries: ${loud.count.busyRetries}`) && String(mail!.textBody).includes(`Calls sent to the overflow provider: ${loud.count.overflowCalls}`), mail)
  check('…and with nothing else: no quote, no business, no customer', !new RegExp(`${sent.id}|${late.id}|${biz.tenantId}|Whitlock|Lindqvist|qte_|tnt_`).test(String(mail?.textBody)), mail?.textBody)
  console.log = () => undefined
  const again = await hush(() => checkBusy(db, alertEnv, new Date(), send)).finally(() => (console.log = quietInfo))
  check('a second window in the same hour sends nothing (at most one an hour)', again.alert === 'held' && mails.length === 1, again.alert)
  const off = await checkBusy(db, { ...alertEnv, ALERT_EMAIL: undefined }, new Date(), send)
  check('with no alert address the check counts and stays silent', off.alert === 'off' && mails.length === 1, off.alert)
  // leave the alert row as it was found (none), and the two quotes as plain test data
  await forgetAlert()

  // -------------------------------------------------------------------------
  section('E. The queue’s settings, and the load test never runs against production (items 3 and 6)')
  const toml = readFileSync(path.join(ROOT, 'apps/worker/wrangler.toml'), 'utf8')
  const retries = [...toml.matchAll(/^max_retries = (\d+)$/gm)].map((m) => Number(m[1]))
  check(`wrangler.toml: both queues allow ${MAX_DELIVERY_RETRIES} retries, and the note says why`, retries.length === 2 && retries.every((n) => n >= MAX_DELIVERY_RETRIES) && toml.includes('max_retries must be >= MAX_DELIVERY_RETRIES'), retries)

  const run = (args: string[], env: Record<string, string> = {}) => {
    try {
      const out = execFileSync('npx', ['tsx', 'scripts/load-test/run.mts', ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
      return { code: 0, out }
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string }
      return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }
  // Each of these is refused from the address alone, before any request is made to anything.
  for (const [what, args, env] of [
    ['the live address', ['--url', 'https://qolumns.com', '--n', '1'], {}],
    ['an address under it', ['--url', 'https://www.qolumns.com', '--n', '1'], {}],
    ['the hosting address', ['--url', 'https://estimator-web-phi.vercel.app', '--n', '1'], {}],
    ['a local address with production’s database', ['--url', 'http://localhost:3000', '--n', '1'], { LOAD_SUPABASE_URL: 'https://ygsuzeveesgrafgpkrev.supabase.co', LOAD_SUPABASE_ANON_KEY: 'not-a-key', LOAD_SUPABASE_SERVICE_KEY: 'not-a-key' }],
    ['a flag that tries to force it', ['--url', 'https://qolumns.com', '--n', '1', '--force'], {}],
  ] as const) {
    const refused = run([...args], env)
    check(`the load test refuses ${what}, and creates nothing`, refused.code !== 0 && /Refused|Unknown|not a flag|Usage/i.test(refused.out) && !/Created|business made|Sending/i.test(refused.out), refused.out.slice(0, 300))
  }
} catch (error) {
  check('(the script ran to its end)', false, error instanceof Error ? `${error.message}\n${error.stack?.split('\n').slice(1, 4).join('\n')}` : String(error))
} finally {
  server.close()
}
process.exit(finish())
