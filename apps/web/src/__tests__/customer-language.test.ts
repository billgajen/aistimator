/**
 * T-146: nothing customer-facing carries a grade, a grade label or the words
 * "exact", "firm" or "preliminary". Grades stay business-only.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findConfidenceLanguage, findConfidenceLanguageInPayload } from '@estimator/shared'
import { approvalBlocker, wordingForApproval } from '@/lib/quote-approval'
import { quoteTokenFilter, hashToken } from '@/lib/tokens'

const ROOT = join(__dirname, '..', '..', '..', '..')

/** Customer-facing source: quote page, clarify page, widget, customer emails */
const CUSTOMER_FILES = [
  'apps/web/src/app/q/[quoteId]/page.tsx',
  'apps/web/src/app/q/[quoteId]/clarify/page.tsx',
  'apps/web/src/components/embed/EstimateWidget.tsx',
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

describe('T-148: approving without editing', () => {
  const service = {
    name: 'Garage door replacement',
    default_assumptions: ['Price is firm for 30 days'],
    service_pricing_rules: [{ rules_json: { addons: [{ id: 'seal', label: 'Exact-fit weather seal', price: 40 }] } }],
  }

  it('removes banned words from unedited generated wording and records it', async () => {
    const out = await wordingForApproval({
      version: 1,
      service,
      content: {
        scopeSummary: 'Replace the door. We will confirm the exact size on the day.',
        assumptions: ['Price is firm for 30 days'],
        notes: 'A preliminary figure.',
        signalRecommendations: [{ workDescription: 'Spring check', costBreakdown: 'Firm quote on site.', evidence: 'Worn spring.' }],
      },
    })
    expect(out.changed).toBe(true)
    expect(out.unresolved).toEqual([])
    expect(out.record?.path).toBe('approval')
    expect(out.content?.scopeSummary).toBe('Replace the door.')
    // the business's own assumption stays exactly as typed
    expect(out.content?.assumptions).toEqual(['Price is firm for 30 days'])
    expect(out.content?.notes).toBe('')
    expect(out.content?.signalRecommendations?.[0]?.costBreakdown).toBe('')
  })

  it('leaves an edited quote alone (the business wrote it)', async () => {
    const content = { scopeSummary: 'An exact replacement.' }
    const out = await wordingForApproval({ version: 2, service, content })
    expect(out).toEqual({ content, changed: false, unresolved: [] })
  })

  it('a scope that can only be fixed by deleting it must be edited', async () => {
    const out = await wordingForApproval({ version: 1, service, content: { scopeSummary: 'An exact replacement of your door.' } })
    expect(out.unresolved.length).toBe(1)
  })

  it('a clean quote is sent as it is, with no record', async () => {
    const content = { scopeSummary: 'Replace the door.', assumptions: ['Price is firm for 30 days'] }
    const out = await wordingForApproval({ version: 1, service, content })
    expect(out.changed).toBe(false)
    expect(out.record).toBeUndefined()
  })
})

describe('T-148: the repair record is business-only', () => {
  it('the public quote API never reads the pricing trace', () => {
    const code = stripComments(readFileSync(join(ROOT, 'apps/web/src/app/api/public/quotes/[quoteId]/route.ts'), 'utf8'))
    expect(code).not.toMatch(/pricing_trace_json|wordingRepair/)
    // and it selects explicit fields for the response rather than spreading the row
    expect(code).not.toMatch(/\.\.\.quote\b/)
  })
})

describe('T-148: "guaranteed" and "guarantee" are banned for customers', () => {
  it('flags both words, in any case', () => {
    expect(findConfidenceLanguage('This price is guaranteed.')).toHaveLength(1)
    expect(findConfidenceLanguage('We guarantee the total.')).toHaveLength(1)
    expect(findConfidenceLanguage('Guaranteed price')).toHaveLength(1)
    expect(findConfidenceLanguageInPayload({ notes: { notes: 'Price guarantee included' } })).toHaveLength(1)
  })

  it('does not flag other words that only contain them', () => {
    expect(findConfidenceLanguage('Guarantor details are on file.')).toEqual([])
  })

  it("generated wording with them is repaired, the business's own text is left alone", async () => {
    const service = { name: 'Garage door replacement', default_assumptions: ['Workmanship guaranteed for 12 months'] }
    const out = await wordingForApproval({
      version: 1,
      service,
      content: {
        scopeSummary: 'Replace the door. This total is guaranteed not to change.',
        assumptions: ['Workmanship guaranteed for 12 months'],
        notes: 'We guarantee a tidy finish.',
      },
    })
    expect(out.unresolved).toEqual([])
    expect(out.content?.scopeSummary).toBe('Replace the door.')
    expect(out.content?.notes).toBe('')
    expect(out.content?.assumptions).toEqual(['Workmanship guaranteed for 12 months'])
  })
})
