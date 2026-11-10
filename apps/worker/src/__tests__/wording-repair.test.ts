/**
 * T-148: banned customer words in generated wording are repaired in code —
 * rewrite (one call), then remove, then hold — and business text is untouched.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  repairCustomerWording,
  businessPhrasesFrom,
  findOffendingSentences,
  isAcceptableRewrite,
  splitSentences,
  findConfidenceLanguageInPayload,
} from '@estimator/shared'
import type { SentenceRewriter } from '@estimator/shared'
import { createSentenceRewriter, parseRewrites } from '../ai/wording-repair'
import type { AiClient } from '../ai/client'

const NO_BUSINESS: string[] = []

const dirty = () => ({
  scopeSummary: 'Replace the single garage door. We will confirm the exact dimensions before ordering.',
  assumptions: ['The opening is standard size', 'This firm price assumes easy access.'],
  exclusions: ['Framing repairs'],
  notes: 'Thanks for asking. This is a preliminary figure.',
})

/** A rewriter that returns a fixed text for every sentence it is given */
const rewriteAll = (fn: (s: string) => string): SentenceRewriter =>
  async (sentences) => Object.fromEntries(sentences.map((s) => [s.id, fn(s.sentence)]))

describe('T-148: finding offending sentences', () => {
  it('finds every sentence that trips the guard, by field', () => {
    const found = findOffendingSentences(dirty(), NO_BUSINESS)
    expect(found.map((f) => f.field)).toEqual(['scopeSummary', 'assumptions[1]', 'notes'])
    expect(found[0]!.sentence).toBe('We will confirm the exact dimensions before ordering.')
  })

  it('a clean quote has nothing to repair and makes no call', async () => {
    const rewrite = vi.fn<SentenceRewriter>()
    const clean = { scopeSummary: 'Replace the door.', assumptions: ['Standard opening'], notes: 'Thanks!' }
    const result = await repairCustomerWording(clean, { businessPhrases: NO_BUSINESS, path: 'generation', rewrite })
    expect(rewrite).not.toHaveBeenCalled()
    expect(result.record.found).toBe(0)
    expect(result.wording).toEqual(clean)
  })

  it('splits sentences without breaking decimals or money', () => {
    expect(splitSentences('About 646.2 sqft. Costs $1,400.00 in total. Done!')).toEqual([
      'About 646.2 sqft.',
      'Costs $1,400.00 in total.',
      'Done!',
    ])
  })
})

describe('T-148 step a: rewrite', () => {
  it('rewrites the offending sentences in place with ONE call, and the result passes the guard', async () => {
    const rewrite = vi.fn(rewriteAll((s) => s.replace(/\bexact /, '').replace(/\bfirm /, '').replace(/a preliminary figure/, 'our estimate')))
    const input = dirty()
    const result = await repairCustomerWording(input, { businessPhrases: NO_BUSINESS, path: 'generation', rewrite })
    expect(rewrite).toHaveBeenCalledTimes(1)
    expect(result.wording.scopeSummary).toBe('Replace the single garage door. We will confirm the dimensions before ordering.')
    expect(result.wording.assumptions).toEqual(['The opening is standard size', 'This price assumes easy access.'])
    expect(result.wording.notes).toBe('Thanks for asking. This is our estimate.')
    expect(result.record.rewritten).toHaveLength(3)
    expect(result.record.removed).toHaveLength(0)
    expect(result.unresolved).toEqual([])
    expect(findConfidenceLanguageInPayload(result.wording)).toEqual([])
    // the input is not mutated
    expect(input.notes).toContain('preliminary')
  })

  it('rejects a rewrite that adds a number (wording only, never a price)', () => {
    expect(isAcceptableRewrite('We will confirm the exact size.', 'We will confirm the size, about $200 more.', NO_BUSINESS)).toBe(false)
    expect(isAcceptableRewrite('About 646.2 sqft, exact.', 'About 646.2 sqft.', NO_BUSINESS)).toBe(true)
  })

  it('rejects a rewrite that still trips, is empty, or balloons', () => {
    expect(isAcceptableRewrite('An exact price.', 'A firm price.', NO_BUSINESS)).toBe(false)
    expect(isAcceptableRewrite('An exact price.', '   ', NO_BUSINESS)).toBe(false)
    expect(isAcceptableRewrite('An exact price.', 'x'.repeat(200), NO_BUSINESS)).toBe(false)
    expect(isAcceptableRewrite('An exact price.', undefined, NO_BUSINESS)).toBe(false)
  })
})

describe('T-148 step b: remove', () => {
  it('a failed rewrite call removes the sentences and the estimate stays clean', async () => {
    const rewrite: SentenceRewriter = async () => { throw new Error('model down') }
    const result = await repairCustomerWording(dirty(), { businessPhrases: NO_BUSINESS, path: 'generation', rewrite })
    expect(result.wording.scopeSummary).toBe('Replace the single garage door.')
    expect(result.wording.assumptions).toEqual(['The opening is standard size'])
    expect(result.wording.notes).toBe('Thanks for asking.')
    expect(result.record.removed).toHaveLength(3)
    expect(result.record.rewriteError).toBe('model down')
    expect(result.unresolved).toEqual([])
  })

  it('a rewrite that still trips is removed instead', async () => {
    const result = await repairCustomerWording(dirty(), { businessPhrases: NO_BUSINESS, path: 'generation', rewrite: rewriteAll(() => 'A guaranteed firm figure.') })
    expect(result.record.rewritten).toHaveLength(0)
    expect(result.record.removed).toHaveLength(3)
    expect(findConfidenceLanguageInPayload(result.wording)).toEqual([])
  })

  it('reprice and approval paths make no call and go straight to removal', async () => {
    for (const path of ['reprice', 'approval'] as const) {
      const result = await repairCustomerWording(dirty(), { businessPhrases: NO_BUSINESS, path })
      expect(result.record.rewriteCalled).toBe(false)
      expect(result.record.removed).toHaveLength(3)
      expect(result.unresolved).toEqual([])
    }
  })

  it('repairs recommendations and cross-service text too, dropping a recommendation left empty', async () => {
    const result = await repairCustomerWording(
      {
        scopeSummary: 'Replace the door.',
        signalRecommendations: [
          { workDescription: 'Exact spring check', costBreakdown: 'May need parts.', evidence: 'Spring looks worn.' },
          { workDescription: 'Track alignment', costBreakdown: 'Firm quote on site.', evidence: 'Gap at the side.' },
        ],
        crossServicePricing: [{ reason: 'You mentioned the opener.', note: 'This is a preliminary figure.', extractedDetails: ['exact model unknown', 'belt drive'] }],
      },
      { businessPhrases: NO_BUSINESS, path: 'reprice' }
    )
    expect(result.wording.signalRecommendations).toEqual([{ workDescription: 'Track alignment', costBreakdown: '', evidence: 'Gap at the side.' }])
    expect(result.wording.crossServicePricing?.[0]).toEqual({ reason: 'You mentioned the opener.', note: '', extractedDetails: ['belt drive'] })
    expect(findConfidenceLanguageInPayload(result.wording)).toEqual([])
  })
})

describe('T-148 step c: hold only if removal cannot fix it', () => {
  it('a scope summary that would be left empty is unresolved and kept as written', async () => {
    const result = await repairCustomerWording(
      { scopeSummary: 'An exact replacement of your door.', notes: 'Thanks.' },
      { businessPhrases: NO_BUSINESS, path: 'generation', rewrite: async () => ({}) }
    )
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0]).toMatch(/^scopeSummary: "exact"/)
    expect(result.wording.scopeSummary).toBe('An exact replacement of your door.')
    expect(result.record.removed).toEqual([])
  })

  it('…but a rewrite of that scope sentence resolves it', async () => {
    const result = await repairCustomerWording(
      { scopeSummary: 'An exact replacement of your door.' },
      { businessPhrases: NO_BUSINESS, path: 'generation', rewrite: rewriteAll(() => 'A like-for-like replacement of your door.') }
    )
    expect(result.unresolved).toEqual([])
    expect(result.wording.scopeSummary).toBe('A like-for-like replacement of your door.')
  })
})

describe('T-148: business text is never rewritten or removed', () => {
  const phrases = businessPhrasesFrom({
    serviceName: 'Garage door replacement',
    defaultAssumptions: ['Price is firm for 30 days'],
    addonLabels: ['Exact-fit weather seal'],
    scopeExcludes: ['Framing repairs. Preliminary surveys are charged separately.'],
  })

  it('an echoed business assumption with a banned word is left untouched and makes no call', async () => {
    const rewrite = vi.fn<SentenceRewriter>()
    const input = {
      scopeSummary: 'We will fit your new door and the exact-fit weather seal you picked.',
      assumptions: ['Price is firm for 30 days.'],
      exclusions: ['Preliminary surveys are charged separately.'],
    }
    const result = await repairCustomerWording(input, { businessPhrases: phrases, path: 'generation', rewrite })
    expect(rewrite).not.toHaveBeenCalled()
    expect(result.wording).toEqual(input)
    expect(result.unresolved).toEqual([])
  })

  it('a generated sentence that is banned outside the business phrase is still repaired', async () => {
    const result = await repairCustomerWording(
      { scopeSummary: 'Fit the door. The exact price includes the Exact-fit weather seal.' },
      { businessPhrases: phrases, path: 'approval' }
    )
    expect(result.wording.scopeSummary).toBe('Fit the door.')
  })

  it('short phrases are ignored so a stray word cannot mask the guard', () => {
    expect(businessPhrasesFrom({ addonLabels: ['ex', ''] })).toEqual([])
  })
})

describe('T-148: the rewrite call', () => {
  const sentences = findOffendingSentences(dirty(), NO_BUSINESS)
  const client = (reply: string | Promise<string>): AiClient =>
    ({ route: { provider: 'gemini', model: 'test' }, generateText: vi.fn(async () => reply) }) as unknown as AiClient

  it('sends only the offending sentences and parses id → text', async () => {
    const c = client(JSON.stringify({ rewrites: [{ id: sentences[0]!.id, text: 'Rewritten.' }, { id: 'unknown', text: 'x' }, { id: sentences[1]!.id }] }))
    const out = await createSentenceRewriter(c)(sentences)
    expect(out).toEqual({ [sentences[0]!.id]: 'Rewritten.' })
    const [prompt, system] = (c.generateText as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(prompt).toContain('We will confirm the exact dimensions before ordering.')
    expect(prompt).not.toContain('The opening is standard size')
    expect(system).toMatch(/Do not add, remove or change any number/)
    expect(c.generateText).toHaveBeenCalledTimes(1)
  })

  it('tolerates fenced JSON', () => {
    expect(parseRewrites('```json\n{"rewrites":[{"id":"notes#1","text":"Ok."}]}\n```', [{ id: 'notes#1', field: 'notes', sentence: 'x', problems: [] }])).toEqual({ 'notes#1': 'Ok.' })
  })

  it('a slow model times out (the sentences are then removed)', async () => {
    const slow = client(new Promise<string>(() => {}))
    await expect(createSentenceRewriter(slow, 20)(sentences)).rejects.toThrow(/timed out/)
    const result = await repairCustomerWording(dirty(), { businessPhrases: NO_BUSINESS, path: 'generation', rewrite: createSentenceRewriter(slow, 20) })
    expect(result.record.rewriteError).toMatch(/timed out/)
    expect(result.unresolved).toEqual([])
  })
})
