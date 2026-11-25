/**
 * T-204, item 29: a quote whose photos could not be read is held for the business, never sent.
 *
 * T-203 found that a BUSY provider let a request be priced without its photos being read, and
 * stopped that (the run is not saved; the job is put back). This is every other way a photo
 * reading can fail: an error, a timeout, an answer that cannot be used, a photo that will not
 * open, no model to ask. Each step still falls back as it always did; what is new is that the
 * step says so, and the processor then holds the quote with "Photos could not be read".
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PHOTOS_UNREAD_NOTE, photosUnreadReason } from '@qolumns/shared'
import type { ExpectedSignalConfig, ModelRoute } from '@qolumns/shared'
import { PhotoReadLog, failureKind } from '../ai/photo-read'
import { measureQuantities } from '../ai/measurement'
import { identificationTargets, identifyFromLabels } from '../ai/identification'
import { extractSignals, extractStructuredSignals } from '../ai/signals'
import type { AiClient } from '../ai/client'
import { AiCallTimeoutError } from '../ai/timeouts'

const src = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')
const image = [{ mimeType: 'image/jpeg', base64: 'AAAA' }]
const route: ModelRoute = { provider: 'gemini', model: 'model-under-test' }

/** A client whose every call does the same thing */
function client(does: () => Promise<unknown>): AiClient {
  const call = vi.fn(does)
  return { route, generateText: call as never, generateWithImages: call as never, generateWithSchema: call as never, generateWithImagesAndSchema: call as never }
}

describe('T-204 item 29: the run’s log of what could not be read', () => {
  it('starts empty; keeps each failed step once; carries the step and the kind of failure, never the provider’s words', () => {
    const log = new PhotoReadLog()
    expect(log.failed).toBe(false)
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    log.missed('photos', 'timeout')
    log.missed('photos', 'timeout')
    log.missed('label', 'error')
    expect(log.failed).toBe(true)
    expect(log.record(new Date('2026-11-25T10:00:00Z'))).toEqual({ steps: [{ step: 'photos', why: 'timeout' }, { step: 'label', why: 'error' }], at: '2026-11-25T10:00:00.000Z' })
    // what it logs names the step and the kind, nothing else
    expect(quiet.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining(['[Photos] photos could not be read (timeout); the quote will be held for the business']))
    quiet.mockRestore()
  })

  it('tells a timeout from an unusable answer from any other error', () => {
    expect(failureKind(new AiCallTimeoutError('addons', 20_000))).toBe('timeout')
    expect(failureKind(new Error('identification timed out after 25000 ms'))).toBe('timeout')
    expect(failureKind(new SyntaxError('Unexpected token'))).toBe('bad_answer')
    expect(failureKind(new Error('Gemini API error: 500 internal'))).toBe('error')
    expect(failureKind('nothing')).toBe('error')
  })

  it('the hold’s reason leads with the note', () => {
    expect(photosUnreadReason({ steps: [{ step: 'photos', why: 'error' }] }).startsWith(`${PHOTOS_UNREAD_NOTE}. Qolumns could not read the photos (the reading failed)`)).toBe(true)
  })
})

describe('T-204 item 29: each photo step says when it failed', () => {
  it('the general reading: an unusable answer on both tries, or an error on both, is said (it used to return defaults quietly)', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const said: string[] = []
    const context = { serviceName: 'Service', expectedSignals: [{ signalKey: 'size', type: 'number', description: 'size' }] as ExpectedSignalConfig[], onUnread: (why: string) => said.push(why) }
    const broken = await extractStructuredSignals(client(async () => { throw new Error('Gemini API error: 500') }), image, context)
    expect(said).toEqual(['error'])
    expect(broken.structured.overallConfidence).toBe(0)

    said.length = 0
    let calls = 0
    // a schema answer that throws, then text that is not JSON
    const garbled = client(async () => {
      calls += 1
      if (calls === 1) throw new Error('schema refused')
      return 'I could not see the photos clearly.'
    })
    await extractStructuredSignals(garbled, image, context)
    expect(said.length).toBe(1)

    // the older reading without expected signals: text that is not JSON
    said.length = 0
    await extractSignals(client(async () => 'not json at all'), image, { serviceName: 'Service', onUnread: (why: string) => said.push(why) })
    expect(said).toEqual(['bad_answer'])

    // a good answer says nothing
    said.length = 0
    await extractSignals(client(async () => JSON.stringify({ category: 'x', materials: [], condition: { rating: 'good' }, complexity: { level: 'low', factors: [] }, access: { difficulty: 'easy' }, observations: [], warnings: [], confidence: 0.8, siteVisitRecommended: false })), image, { serviceName: 'Service', onUnread: (why: string) => said.push(why) })
    expect(said).toEqual([])
    quiet.mockRestore()
    log.mockRestore()
  })

  it('the measurement: every pass failing is said; one pass that answers is not', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const targets = [{ signalKey: 'wall_area', description: 'wall area', unit: 'sqm' }]
    const failed = vi.fn()
    const none = await measureQuantities({ gemini: null, images: image, targets, passes: 3, runPass: async () => { throw new Error('measurement timed out') }, onAllPassesFailed: failed })
    expect(none).toEqual([])
    expect(failed).toHaveBeenCalledTimes(1)
    expect(failureKind(failed.mock.calls[0]![0])).toBe('timeout')

    const partly = vi.fn()
    let n = 0
    await measureQuantities({
      gemini: null,
      images: image,
      targets,
      passes: 3,
      runPass: async () => {
        n += 1
        if (n < 3) throw new Error('500')
        return [{ targetKey: 'wall_area', feasible: true, directValue: 40 }]
      },
      onAllPassesFailed: partly,
    })
    expect(partly).not.toHaveBeenCalled()

    // "not visible in the photos" from every pass is an answer, not a failure
    const unseen = vi.fn()
    await measureQuantities({ gemini: null, images: image, targets, passes: 2, runPass: async () => [{ targetKey: 'wall_area', feasible: false }], onAllPassesFailed: unseen })
    expect(unseen).not.toHaveBeenCalled()
    quiet.mockRestore()
    log.mockRestore()
  })

  it('the label reading: an error and a timeout are told apart from "nothing legible"', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const targets = identificationTargets([
      { signalKey: 'unit_size', type: 'enum', possibleValues: ['Small', 'Large'], description: 'size', identify: { readFrom: 'the rating plate', transcribe: 'the model number', decode: [{ pattern: '(\\d{2})', map: { '24': 'Small', '48': 'Large' }, label: 'size digits' }] } },
    ] as unknown as ExpectedSignalConfig[])
    expect(targets.length).toBe(1)
    expect((await identifyFromLabels({ ai: null, images: image, targets, run: async () => { throw new Error('500') } })).failed).toBe('error')
    expect((await identifyFromLabels({ ai: null, images: image, targets, timeoutMs: 20, run: () => new Promise(() => undefined) })).failed).toBe('timeout')
    const nothing = await identifyFromLabels({ ai: null, images: image, targets, run: async () => ({ readings: [] }) })
    expect(nothing.failed).toBeUndefined()
    expect(nothing.resolved).toEqual([])
    quiet.mockRestore()
  })
})

describe('T-204 item 29: the processor holds such a quote, and the customer is told nothing of the failure', () => {
  const processor = src('quote-processor.ts')

  it('every photo step reports into the run’s one log', () => {
    expect(processor).toContain('const photoRead = new PhotoReadLog()')
    for (const report of [
      "onUnread: (why) => photoRead.missed('photos', why)",
      "photoRead.missed('measurement', failureKind(measureError))",
      "onAllPassesFailed: (lastError) => photoRead.missed('measurement', failureKind(lastError))",
      "if (images.length === 0) photoRead.missed('photos', 'not_loaded')",
      "if (identification.failed) photoRead.missed('label', identification.failed)",
      "if (!aiStandInOn(env)) photoRead.missed('photos', 'no_model')",
      "if (fetchedImages.length > 0) photoRead.missed('photos', failureKind(error))",
      "photoRead.missed('extras', failureKind(error))",
    ]) expect(processor, report).toContain(report)
  })

  it('a failed reading is decided before the question gate: held for review, no clarification round, no "shown early"', () => {
    const hold = processor.indexOf('if (photoRead.failed) {')
    const gate = processor.indexOf("evaluateQualityGate(", hold)
    const decision = processor.indexOf('const reviewDecision = decideReviewHold({')
    expect(hold).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(hold)
    expect(decision).toBeGreaterThan(gate)
    const block = processor.slice(hold, processor.indexOf('} else if (wordingReason) {', hold))
    expect(block).toContain("finalStatus = 'pending_review'")
    expect(block).toContain("action: 'require_review'")
    expect(block).toContain('reason: photosUnreadReason(photoRead.record(), wordingReason)')
    // the gate (which can ask the customer a question) is the last branch of the same chain
    expect(processor.slice(hold, gate)).toMatch(/\} else if \(wordingReason\) \{[\s\S]*\} else if \(structuredSignals && textAi\) \{/)
  })

  it('what failed is kept on the quote for the dashboard, the approval page and the review email', () => {
    expect(processor).toContain('...(photoRead.failed && { photosUnread: photoRead.record() }),')
  })

  it('the provider’s words no longer go into the quote’s notes, which the customer reads', () => {
    expect(processor).not.toContain('AI image analysis failed')
    expect(processor).not.toContain('AI image analysis temporarily unavailable')
    expect(processor).not.toContain('images were uploaded but could not be analyzed')
  })

  it('the local checks’ stand-in (no model is asked, on purpose) is not a failure, and neither is a preview or a section', () => {
    expect(processor).toContain("if (!aiStandInOn(env)) photoRead.missed('photos', 'no_model')")
    // a section or preview run has no photos at all: the branch that reads them is not entered
    expect(processor).toContain('quoteData.assets = []')
  })

  it('a busy provider is still T-203’s case: the run stops before anything is decided', () => {
    const readPhotos = processor.indexOf("timer.time('signals', () => extractSignalsFromImages(")
    const stop = processor.indexOf('busy.throwIfExhausted()', readPhotos)
    const missed = processor.indexOf("if (images.length === 0) photoRead.missed('photos', 'not_loaded')")
    expect(stop).toBeGreaterThan(readPhotos)
    expect(missed).toBeGreaterThan(stop)
  })
})
