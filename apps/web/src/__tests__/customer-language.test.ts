/**
 * T-146: nothing customer-facing carries a grade, a grade label or the words
 * "exact", "firm" or "preliminary". Grades stay business-only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findConfidenceLanguage, findConfidenceLanguageInPayload } from '@estimator/shared'
import { approvalBlocker } from '@/lib/quote-approval'
import { quoteTokenFilter, hashToken } from '@/lib/tokens'

const ROOT = join(__dirname, '..', '..', '..', '..')

/** Customer-facing source: quote page, clarify page, widget, customer emails */
const CUSTOMER_FILES = [
  'apps/web/src/app/q/[quoteId]/page.tsx',
  'apps/web/src/app/q/[quoteId]/clarify/page.tsx',
  'apps/web/src/app/embed/[tenantKey]/page.tsx',
  'apps/web/src/lib/postmark.ts',
  'apps/worker/src/email/templates.ts',
]

/** Code without comments — comments are for developers, not customers */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('T-146: customer-facing source has no confidence language', () => {
  it.each(CUSTOMER_FILES)('%s', (file) => {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'))
    expect(findConfidenceLanguage(code)).toEqual([])
    // No grade seal letter or grade label rendered from pricing data
    expect(code).not.toMatch(/estimate\.grade|estimate\.label|estimate\.description/)
  })
})

describe('T-146: payload guard', () => {
  it('flags a grade, a grade label and certainty words anywhere in the payload', () => {
    const bad = {
      pricing: { estimate: { grade: 'A', label: 'Confirmed', description: 'this price is exact' } },
      notes: { notes: 'This is a preliminary figure' },
      takeoff: [{ method: 'quantity from AI signal (lower confidence)' }],
    }
    const problems = findConfidenceLanguageInPayload(bad).join('\n')
    expect(problems).toMatch(/grade present/)
    expect(problems).toMatch(/grade label "Confirmed"/)
    expect(problems).toMatch(/"exact"/)
    expect(problems).toMatch(/"preliminary"/)
    expect(problems).toMatch(/"confidence"/)
  })

  it('passes the plain customer wording', () => {
    const good = {
      review: { state: 'quote' },
      estimateRange: { low: 4200, high: 5100 },
      takeoff: [
        { item: '3 ton AC system', amount: 5600, method: '3 ton — from the air conditioner’s rating plate' },
        { item: 'Wall painting', quantity: 31.5, unit: 'sqm', amount: 567, method: 'From your photos' },
      ],
      notes: { scopeSummary: 'Replace the outdoor unit and indoor coil, confirmed with you on site.' },
    }
    expect(findConfidenceLanguageInPayload(good)).toEqual([])
  })

  it('"firmly" or "confirmed by" are not banned words', () => {
    expect(findConfidenceLanguage('Fixed firmly to the wall. Reviewed and confirmed by Acme.')).toEqual([])
  })
})

describe('T-146: approval', () => {
  it('only a priced quote awaiting review can be approved', () => {
    const q = (over: Record<string, unknown>) => ({ status: 'pending_review', pricing_json: { total: 4550 }, content_json: {}, ...over })
    expect(approvalBlocker(q({}))).toBeNull()
    expect(approvalBlocker(q({ status: 'sent' }))?.code).toBe('INVALID_STATUS')
    expect(approvalBlocker(q({ pricing_json: { total: 0 } }))?.code).toBe('NOT_PRICED')
    expect(approvalBlocker(q({ content_json: { limitHold: true } }))?.code).toBe('NOT_PRICED')
  })

  it('the pre-approval link stays valid alongside the new one', () => {
    const h = hashToken('abc')
    expect(quoteTokenFilter(h)).toBe(`quote_token_hash.eq.${h},previous_token_hash.eq.${h}`)
    // anything that is not a sha256 hex digest can't inject into the filter
    expect(quoteTokenFilter('x,status.eq.sent')).not.toContain('status')
  })
})
