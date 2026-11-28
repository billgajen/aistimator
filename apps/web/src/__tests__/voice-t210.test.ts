/**
 * T-210: the private voice test ("Oumn test call"). What has not changed since: the made-up
 * slots, the cost of a call, the amounts read out of what she said, the registry, and the audio
 * worklets. Round two (T-211) rewrote her tools, her instructions and the call's protection:
 * those are in voice-t211.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LIVE_VOICE, LIVE_VOICES, getLivePrice, resolveModelRoute } from '@qolumns/shared'
import registry from '../../../../packages/shared/src/ai-models.json'
import { NO_TOKENS, addUsage, callCost, median, worst } from '@/lib/voice/cost'
import { TEST_SLOT_DAYS, TEST_SLOT_HOURS, isTestSlot, testSlots } from '@/lib/voice/slots'
import { checkSpokenPrice, spokenAmounts, wordsToNumber } from '@/lib/voice/spoken'
import { runTool, toolResponse } from '@/lib/voice/tools'
import { VOICE_WORKLETS } from '@/lib/voice/worklets'
import { NOW, call, priced, session } from './voice-fixture'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const VOICE_DIR = 'apps/web/src/lib/voice'
const VOICE_FILES = readdirSync(join(ROOT, VOICE_DIR)).map((f) => `${VOICE_DIR}/${f}`)
const ROUTES = ['apps/web/src/app/api/admin/voice-test/session/route.ts', 'apps/web/src/app/api/admin/voice-test/tool/route.ts', 'apps/web/src/app/api/admin/voice-test/guard/route.ts']
const PAGE = 'apps/web/src/app/admin/voice-test/page.tsx'
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('T-210 get_estimate writes nothing', () => {
  it('her tools have one way out, the pricing worker’s /preview, and no way to write', async () => {
    const tools = code(`${VOICE_DIR}/tools.ts`)
    expect(tools).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(|createAdminClient|createClient|fetch\(|sendEmail|postmark/i)
    // the only thing a tool is handed that can reach outside is `price`
    expect(tools).toContain('const priced = await deps.price({ tenantId: b.id, service: service.row, rules: service.rules, fields: service.fields, answers: read.answers })')
    expect(code(ROUTES[1]!)).toContain("import { previewPriceNow } from '@/lib/pricing-preview'")
    expect(code('apps/web/src/lib/pricing-preview.ts')).toContain('`${workerUrl}/preview`')
  })

  it('it is the same path as Test your pricing: the worker’s preview, which runs the pipeline and writes nothing', () => {
    expect(code('apps/web/src/app/api/services/preview-price/route.ts')).toContain('const priced = await previewPriceNow(input)')
    const preview = code('apps/worker/src/preview-pricing.ts')
    expect(preview).toContain("processQuote('preview', '', supabase, env, undefined, { preview: { data } })")
    expect(preview).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/)
  })

  it('nothing in the voice test writes a row: the loader, the routes and the page only read', () => {
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, 'apps/web/src/components/voice-test/VoiceTest.tsx']) {
      // (the `.update(` in these files is a signature or a hash being computed, over a template string; strikes and
      // call counts go to Upstash with an expiry, through guard-store.ts, and are not rows)
      expect(code(file), file).not.toMatch(/\.(insert|upsert|delete|rpc)\(|\.update\((?!`qolumns:voice-)/)
    }
    const loader = code(`${VOICE_DIR}/business.ts`)
    expect(loader.match(/admin\.from\('/g)).toHaveLength(4)
    expect(loader.match(/\.select\(/g)).toHaveLength(4)
    // nothing of a call is logged
    for (const file of ROUTES) expect(code(file), file).not.toMatch(/console\.(log|info|warn)\(|logAdminActivity/)
  })
})


describe('T-210 the made-up free times (test data)', () => {
  it('weekdays only, from tomorrow, four two-hour windows a day', () => {
    const free = testSlots({ timeZone: 'America/New_York', now: NOW }) // Friday 27 Nov in New York
    expect(free.testData).toBe(true)
    expect(free.slots).toHaveLength(TEST_SLOT_DAYS * TEST_SLOT_HOURS.length)
    expect([...new Set(free.slots.map((s) => s.date))]).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
    expect([...new Set(free.slots.map((s) => s.weekday))]).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    expect(free.slots.slice(0, 4).map((s) => [s.id, s.start, s.end, s.label])).toEqual([
      ['2026-11-30T08:00', '08:00', '10:00', 'Monday, November 30, 8 am to 10 am'],
      ['2026-11-30T10:00', '10:00', '12:00', 'Monday, November 30, 10 am to 12 pm'],
      ['2026-11-30T13:00', '13:00', '15:00', 'Monday, November 30, 1 pm to 3 pm'],
      ['2026-11-30T15:00', '15:00', '17:00', 'Monday, November 30, 3 pm to 5 pm'],
    ])
    for (const s of free.slots) expect(Number(s.end.slice(0, 2)) - Number(s.start.slice(0, 2))).toBe(2)
  })

  it('"tomorrow" is the business’s tomorrow, not the server’s', () => {
    const lateUtc = new Date('2026-11-25T03:30:00Z') // Tuesday 24 Nov, 10:30 pm in New York; Wednesday 25 Nov, 3:30 am in London
    expect(testSlots({ timeZone: 'America/New_York', now: lateUtc }).slots[0]!.date).toBe('2026-11-25')
    expect(testSlots({ timeZone: 'Europe/London', now: lateUtc }).slots[0]!.date).toBe('2026-11-26')
    expect(testSlots({ timeZone: 'Pacific/Auckland', now: lateUtc }).slots[0]!.date).toBe('2026-11-26')
    expect(testSlots({ timeZone: 'Europe/London', locale: 'en-GB', now: lateUtc }).slots[0]!.label).toBe('Thursday 26 November, 8 am to 10 am')
  })

  it('a later first day is kept; an earlier one, or today, is moved to tomorrow', () => {
    expect(testSlots({ fromDate: '2026-12-12', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-12-14') // the 12th is a Saturday
    expect(testSlots({ fromDate: '2026-12-09', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-12-09')
    expect(testSlots({ fromDate: '2020-01-01', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-11-30')
    expect(testSlots({ fromDate: '2026-11-27', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-11-30')
    expect(testSlots({ fromDate: 'not a date', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-11-30')
  })

  it('only a slot on offer can be booked', () => {
    expect(isTestSlot('2026-11-30T08:00', { timeZone: 'America/New_York', now: NOW })?.label).toBe('Monday, November 30, 8 am to 10 am')
    for (const bad of ['2026-11-29T08:00', '2026-11-30T09:00', '2026-11-27T08:00', '2020-01-06T08:00', 'tomorrow', '', null, 5]) expect(isTestSlot(bad, { timeZone: 'America/New_York', now: NOW }), String(bad)).toBeNull()
  })

  it('the code says it is test data, and get_free_times uses nothing else', async () => {
    expect(read(`${VOICE_DIR}/slots.ts`)).toMatch(/FAKE free times[\s\S]*TEST DATA\. No calendar exists yet/)
    const outcome = await runTool(call(), 'get_free_times', {}, { price: async () => priced(), now: () => NOW })
    expect(outcome).toMatchObject({ ok: true, wouldDo: 'TEST DATA: 20 made-up free times from 2026-11-30' })
    expect((toolResponse(outcome, session().notes) as { freeTimes: unknown[] }).freeTimes[0]).toEqual({ id: '2026-11-30T08:00', when: 'Monday, November 30, 8 am to 10 am' })
  })
})


describe('T-210 what a call cost', () => {
  const price = getLivePrice(resolveModelRoute('voice_call').model)!

  it('adds each turn’s usage by modality; what has no modality is text', () => {
    // the two shapes the Live API sent on 27 Nov 2026: a tool call's turn, and a spoken turn
    let sum = addUsage(NO_TOKENS, { promptTokenCount: 609, responseTokenCount: 6, totalTokenCount: 615, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 370 }, { modality: 'AUDIO', tokenCount: 194 }], thoughtsTokenCount: 54 })
    expect(sum).toEqual({ turns: 1, textIn: 415, audioIn: 194, otherIn: 0, textOut: 6, audioOut: 0, thoughts: 54 })
    sum = addUsage(sum, { promptTokenCount: 596, responseTokenCount: 68, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 357 }, { modality: 'AUDIO', tokenCount: 194 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 68 }], thoughtsTokenCount: 27 })
    expect(sum).toEqual({ turns: 2, textIn: 817, audioIn: 388, otherIn: 0, textOut: 6, audioOut: 68, thoughts: 81 })
    expect(addUsage(NO_TOKENS, {})).toEqual({ ...NO_TOKENS, turns: 1 })
    expect(addUsage(NO_TOKENS, { promptTokenCount: 10, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 4 }], toolUsePromptTokenCount: 3 })).toMatchObject({ textIn: 9, otherIn: 4 })
  })

  it('charges each kind at the registry’s price, and thinking as text out', () => {
    const tokens = { turns: 4, textIn: 1_000_000, audioIn: 1_000_000, otherIn: 0, textOut: 1_000_000, audioOut: 1_000_000, thoughts: 1_000_000 }
    const cost = callCost(tokens, price, 120)!
    expect(cost).toMatchObject({ textInUsd: price.textInPerMTok, audioInUsd: price.audioInPerMTok, textOutUsd: price.textOutPerMTok, audioOutUsd: price.audioOutPerMTok, thoughtsUsd: price.textOutPerMTok })
    expect(cost.totalUsd).toBeCloseTo(price.textInPerMTok + price.audioInPerMTok + 2 * price.textOutPerMTok + price.audioOutPerMTok, 9)
    expect(cost.perMinuteUsd).toBeCloseTo(cost.totalUsd / 2, 9)
  })

  it('a minute of her speech and a minute of the caller’s, at the registry’s prices', () => {
    // 25 tokens a second of audio: 1,500 a minute each way
    const cost = callCost({ ...NO_TOKENS, audioIn: 1500, audioOut: 1500 }, { ...price, textInPerMTok: 0.75, audioInPerMTok: 3, textOutPerMTok: 4.5, audioOutPerMTok: 12 }, 60)!
    expect(cost.audioInUsd).toBeCloseTo(0.0045, 6)
    expect(cost.audioOutUsd).toBeCloseTo(0.018, 6)
    expect(cost.perMinuteUsd).toBeCloseTo(0.0225, 6)
  })

  it('no price in the registry, no cost; no time yet, no per-minute figure', () => {
    expect(callCost(NO_TOKENS, null, 60)).toBeNull()
    expect(callCost({ ...NO_TOKENS, audioOut: 100 }, price, 0)!.perMinuteUsd).toBeNull()
    expect(callCost({ ...NO_TOKENS, otherIn: 7 }, price, 10)).toMatchObject({ totalUsd: 0, unpricedTokens: 7 })
  })

  it('the median and the worst of the delays', () => {
    expect([median([]), worst([])]).toEqual([null, null])
    expect([median([900]), median([1200, 600, 900]), median([400, 1000, 600, 800])]).toEqual([900, 900, 700])
    expect(worst([900, 2400, 650])).toBe(2400)
  })
})


describe('T-210 the amounts she said, against the engine’s total', () => {
  const amounts = (speech: string) => spokenAmounts(speech).map((a) => [a.amount, a.money ? a.currency : null])

  it('reads an amount said in words, in figures, and with either currency', () => {
    expect(amounts('That comes to four hundred and fifty dollars.')).toEqual([[450, 'USD']])
    expect(amounts('It is $450.')).toEqual([[450, 'USD']])
    expect(amounts('About 450 pounds.')).toEqual([[450, 'GBP']])
    expect(amounts('£450.00 in all')).toEqual([[450, 'GBP']])
    expect(amounts('four hundred fifty dollars')).toEqual([[450, 'USD']])
    expect(amounts('four fifty dollars')).toEqual([[450, 'USD']])
    expect(amounts('$7,347.00 USD')).toEqual([[7347, 'USD']])
    expect(amounts('seven thousand three hundred and forty-seven dollars')).toEqual([[7347, 'USD']])
    expect(amounts('twelve hundred and fifty dollars and fifty cents')).toEqual([[1250.5, 'USD']])
    expect(amounts('one thousand two hundred fifty pounds and 50 pence')).toEqual([[1250.5, 'GBP']])
    expect(amounts('a hundred dollars')).toEqual([[100, 'USD']])
    expect(amounts('2 thousand dollars')).toEqual([[2000, 'USD']])
    expect(amounts('four hundred fifty point five zero dollars')).toEqual([[450.5, 'USD']])
    expect(amounts('ninety nine euros')).toEqual([[99, 'EUR']])
  })

  it('a number that is not money is not taken for a price', () => {
    expect(spokenAmounts('I can do Monday, 8 am to 10 am, for 2 rooms. Call 555 201 3434.').filter((a) => a.money)).toEqual([])
    expect(spokenAmounts('One moment while I check.').filter((a) => a.money)).toEqual([])
    expect(wordsToNumber(['one', 'two', 'three'])).toBeNull()
    expect([wordsToNumber(['twenty', 'five']), wordsToNumber(['nine', 'ninety', 'nine']), wordsToNumber(['twelve', 'fifty']), wordsToNumber(['a', 'thousand'])]).toEqual([25, 999, 1250, 1000])
  })

  it('match: she said the engine’s total, in any of those ways', () => {
    const engine = { currency: 'USD', total: 450, subtotal: 450, taxAmount: 0, lines: [75, 375] }
    for (const speech of ['That is four hundred and fifty dollars.', 'An estimate of $450.', '$450.00, which they will confirm.', 'It comes to four fifty dollars.', 'It comes to four hundred and fifty.']) expect(checkSpokenPrice(engine, speech).verdict, speech).toBe('match')
    // the lines, the subtotal and the tax are the engine's too
    const lines = checkSpokenPrice({ currency: 'USD', total: 487.13, subtotal: 450, taxAmount: 37.13, lines: [75, 375] }, 'Seventy five dollars base and three hundred seventy five dollars for the work, $450 before tax, $37.13 sales tax, so $487.13.')
    expect(lines.verdict).toBe('match')
    expect(lines.said.map((s) => s.is)).toEqual(['line', 'line', 'subtotal', 'tax', 'total'])
  })

  it('mismatch: she said an amount of money the engine did not give, or the wrong currency', () => {
    const engine = { currency: 'USD', total: 452.38, subtotal: 452.38, taxAmount: 0, lines: [452.38] }
    expect(checkSpokenPrice(engine, 'That is about four hundred and fifty dollars.')).toMatchObject({ verdict: 'mismatch', said: [{ amount: 450, is: 'not_the_engines' }] })
    expect(checkSpokenPrice(engine, 'That is $452.38, or $500 with a second coat.').verdict).toBe('mismatch')
    expect(checkSpokenPrice({ ...engine, total: 450, lines: [450] }, 'That is 450 pounds.')).toMatchObject({ verdict: 'mismatch', said: [{ is: 'total', wrongCurrency: true }] })
    expect(checkSpokenPrice({ ...engine, total: 450, currency: 'GBP', lines: [450] }, 'That is 450 pounds.').verdict).toBe('match')
  })

  it('not said: no amount yet, or only a line', () => {
    const engine = { currency: 'USD', total: 450, lines: [75, 375] }
    expect(checkSpokenPrice(engine, 'Let me check that for you.')).toEqual({ verdict: 'not_said', said: [] })
    expect(checkSpokenPrice(engine, 'The base fee is $75.').verdict).toBe('not_said')
  })
})

describe('T-210 the registry holds the model, the prices and the voices', () => {
  it('the task "voice_call" has a Live model, switched by AI_MODEL_VOICE_CALL', () => {
    expect(registry.tasks.voice_call).toEqual({ provider: 'gemini', model: resolveModelRoute('voice_call').model, overflow: 'none' })
    expect(resolveModelRoute('voice_call').model).toMatch(/live/)
    expect(resolveModelRoute('voice_call', { AI_MODEL_VOICE_CALL: 'another-live-model' })).toEqual({ provider: 'gemini', model: 'another-live-model' })
  })

  it('the Live API prices are beside it, per modality, with the date and the page they were read from', () => {
    const price = getLivePrice(resolveModelRoute('voice_call').model)!
    for (const key of ['textInPerMTok', 'audioInPerMTok', 'textOutPerMTok', 'audioOutPerMTok'] as const) expect(price[key], key).toBeGreaterThan(0)
    expect(price.audioOutPerMTok).toBeGreaterThan(price.audioInPerMTok)
    expect(price.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(price.source).toMatch(/^aistudio\.google\.com\//)
    expect(getLivePrice('a-model-with-no-live-price')).toBeNull()
  })

  it('the voices are the registry’s list, and the default is Aoede', () => {
    expect(DEFAULT_LIVE_VOICE).toBe('Aoede')
    expect(LIVE_VOICES).toContain('Aoede')
    expect(LIVE_VOICES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(LIVE_VOICES).size).toBe(LIVE_VOICES.length)
  })

  it('no model name, voice or price is written in the voice test’s code', () => {
    const names = new RegExp(`gemini-\\d|${LIVE_VOICES.filter((v) => v !== 'Aoede').join('|')}`)
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, 'apps/web/src/components/voice-test/VoiceTest.tsx']) {
      expect(code(file), file).not.toMatch(names)
      expect(code(file), file).not.toMatch(/PerMTok\s*[:=]\s*\d/)
      expect(code(file), file).not.toContain("'Aoede'")
    }
  })
})


describe('T-210 the audio worklets', () => {
  /** Load the worklet source the way an audio thread does, at a given device rate */
  function load(deviceRate: number) {
    const registered: Record<string, new (options: unknown) => { port: { posted: unknown[]; onmessage: ((e: { data: unknown }) => void) | null }; process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean }> = {}
    class AudioWorkletProcessor {
      port = { posted: [] as unknown[], onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(message: unknown) { this.posted.push(message) } }
    }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', VOICE_WORKLETS)(AudioWorkletProcessor, (name: string, cls: never) => { registered[name] = cls }, deviceRate)
    return registered
  }

  it('the microphone goes up at 16 kHz in pieces of 40 ms, whatever the device’s rate', () => {
    for (const rate of [48000, 44100, 16000]) {
      const Capture = load(rate)['voice-capture']!
      const capture = new Capture({ processorOptions: { outRate: 16000, chunkSamples: 640 } })
      // one second of a 440 Hz tone, in the 128-sample blocks an audio thread hands over
      for (let start = 0; start < rate; start += 128) {
        const block = new Float32Array(Math.min(128, rate - start))
        for (let i = 0; i < block.length; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (start + i)) / rate)
        capture.process([[block]], [])
      }
      const pieces = capture.port.posted as Array<{ pcm: ArrayBuffer; rms: number }>
      expect(pieces.length, String(rate)).toBeGreaterThanOrEqual(24)
      expect(pieces.length, String(rate)).toBeLessThanOrEqual(25)
      for (const piece of pieces) {
        expect(piece.pcm.byteLength).toBe(1280)
        expect(piece.rms).toBeGreaterThan(0.3)
        expect(piece.rms).toBeLessThan(0.4)
      }
      const samples = new Int16Array(pieces[3]!.pcm)
      expect(Math.max(...samples)).toBeGreaterThan(15000)
      expect(Math.max(...samples)).toBeLessThanOrEqual(16384)
    }
  })

  it('her 24 kHz audio is played in order at the device’s rate, and a flush drops what is waiting', () => {
    const Playback = load(48000)['voice-playback']!
    const playback = new Playback({ processorOptions: { inRate: 24000 } })
    const ramp = Int16Array.from({ length: 240 }, (_, i) => i * 100)
    playback.port.onmessage!({ data: { pcm: ramp.buffer } })
    const out = [new Float32Array(128)]
    playback.process([], [out])
    // two device samples for each of hers, rising as hers do
    expect(out[0]![0]).toBe(0)
    expect(out[0]![2]).toBeCloseTo(100 / 32768, 6)
    expect(out[0]![1]).toBeCloseTo(50 / 32768, 6)
    expect(playback.port.posted).toEqual([{ playing: true }])
    playback.port.onmessage!({ data: { flush: true } })
    const after = [new Float32Array(128)]
    playback.process([], [after])
    expect([...after[0]!].every((s) => s === 0)).toBe(true)
    expect(playback.port.posted).toEqual([{ playing: true }, { playing: false }])
  })
})
