/**
 * T-169: the dashboard shows what the AI understood and the customer's
 * photos, and the phone layout is fixed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { quoteUnderstanding, understoodNothing, UNDERSTOOD_COPY, SHOW_WORTH_CHECKING, type UnderstandingInput } from '@/lib/quote-understanding'
import { assetIdsOf, photosInOrder, quotePhotoUrl, DASHBOARD_PHOTO_URL_SECONDS } from '@/lib/quote-photos'
import { homeNumbers, homeSeries, seriesSummary, HOME_SERIES_STEP_DAYS, type HomeQuoteRow } from '@/lib/home-numbers'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const nothing: UnderstandingInput = {
  photoCount: 0,
  signals: { signals: [] },
  content: {},
  pricing: { total: 375, breakdown: [{ label: 'Rooms', amount: 375 }] },
  questions: null,
  answers: null,
  expectedSignals: [],
  checker: null,
}
const READING = 'Read from the tank\'s rating label (photo 1): "CAPACITY 50 U.S. GAL" → 50 gal (capacity printed on the label)'
const MEASURED = 'Measured across 2 independent passes (spread ±5%), anchored to entry door height'
/** "Worth checking" is switched off; its rules are held here with it switched on, for the day it is */
const ON = { worthChecking: true }
const allText = (u: ReturnType<typeof quoteUnderstanding>) =>
  [...u.photos, ...u.words, ...u.alsoNoted, ...u.checks].map((i) => `${i.text} ${i.detail ?? ''}`).join(' | ') +
  u.asked.map((q) => `${q.question} ${q.answer ?? ''}`).join(' | ')

describe('T-169: what Qolumns understood — only what the AI produced', () => {
  it('is empty for a quote the AI produced nothing for (the page then shows no panel)', () => {
    const u = quoteUnderstanding(nothing)
    expect(understoodNothing(u)).toBe(true)
    expect(u).toEqual({ photos: [], words: [], alsoNoted: [], asked: [], checks: [], checksBeforeChange: false })
  })

  it('is empty for missing, null or malformed stored data, and never throws', () => {
    for (const bad of [null, undefined, 'x', 3, [], { signals: 'x' }]) {
      const u = quoteUnderstanding({ ...nothing, signals: bad, content: bad, pricing: bad, questions: bad, answers: bad, expectedSignals: bad, checker: { issues: bad, checkedTotal: bad } })
      expect(understoodNothing(u)).toBe(true)
    }
  })

  it('a customer’s own form answers are not the AI’s reading', () => {
    const u = quoteUnderstanding({
      ...nothing,
      photoCount: 2,
      signals: { signals: [{ key: 'door_size', value: 'Single', source: 'form', evidence: 'Customer-provided: Door size', confidence: 1 }] },
    })
    expect(understoodNothing(u)).toBe(true)
  })

  it('a label reading says where it was read, the value, and the words it was read from', () => {
    const u = quoteUnderstanding({
      ...nothing,
      photoCount: 1,
      signals: { signals: [{ key: 'tank_capacity', value: '50 gal', source: 'vision', basis: 'identified', evidence: READING }] },
    })
    expect(u.photos).toEqual([{ text: 'From the tank\'s rating label: 50 gal', detail: 'It read “CAPACITY 50 U.S. GAL” in photo 1.' }])
  })

  it('a reading the customer confirmed is still shown, once, from the question that showed it to them', () => {
    const u = quoteUnderstanding({
      ...nothing,
      photoCount: 1,
      // after the answer the signal is the customer's, and the takeoff carries the same reading
      signals: { signals: [{ key: 'tank_capacity', value: '50 gal', source: 'form', evidence: 'Confirmed by the customer' }] },
      content: { takeoff: [{ item: 'Tank', amount: 1450, method: 'Selected for 50 gal, as you confirmed', evidence: READING }] },
      questions: [{ id: 'q1', targetSignalKey: 'tank_capacity', type: 'confirm_value', aiValue: '50 gal', evidence: READING, question: 'Capacity: we read 50 gal from the tank\'s rating label. Is that right?' }],
      answers: [{ questionId: 'q1', answer: '50 gal' }],
    })
    expect(u.photos).toHaveLength(1)
    expect(u.photos[0]!.text).toBe('From the tank\'s rating label: 50 gal')
    expect(u.asked).toEqual([{ question: 'Capacity: we read 50 gal from the tank\'s rating label. Is that right?', answer: '50 gal' }])
  })

  it('a reading with no transcription, or in a shape it does not know, is shown as it was stored', () => {
    const plain = quoteUnderstanding({ ...nothing, photoCount: 1, signals: { signals: [{ key: 'fuel', value: 'Natural gas', source: 'vision', basis: 'identified', evidence: 'Read from the rating plate: Natural gas' }] } })
    expect(plain.photos).toEqual([{ text: 'From the rating plate: Natural gas' }])
  })

  it('a quantity measured from the photos is named from the service’s own signal, with how it was measured', () => {
    const u = quoteUnderstanding({
      ...nothing,
      photoCount: 3,
      signals: { signals: [{ key: 'wall_area_sqft', value: 919.13, source: 'vision', basis: 'measured', evidence: MEASURED }] },
      expectedSignals: [{ signalKey: 'wall_area_sqft', description: 'Total exterior wall area in square feet. Use a door as a scale reference.' }],
    })
    expect(u.photos).toEqual([{ text: 'From the photos: about 919.1 (total exterior wall area in square feet)', detail: `${MEASURED}.` }])
  })

  it('a measurement the customer then corrected is still shown, from the question', () => {
    const u = quoteUnderstanding({
      ...nothing,
      photoCount: 3,
      signals: { signals: [{ key: 'wall_area_sqft', value: 1000, source: 'form', evidence: 'Confirmed by the customer' }] },
      questions: [{ id: 'q1', targetSignalKey: 'wall_area_sqft', type: 'confirm_value', aiValue: 919.1, evidence: MEASURED, question: 'We estimated wall area sqft: 919.1. Is that right?' }],
      answers: [{ questionId: 'q1', answer: '1000' }],
    })
    expect(u.photos[0]!.text).toBe('From the photos: about 919.1')
    expect(u.asked[0]!.answer).toBe('1000')
  })

  it('notes from the photos need photos, and a bare quantity is not a note', () => {
    const signals = {
      signals: [
        { key: 'condition_rating', value: 'good', source: 'vision', evidence: 'Panel label is intact, clean and legible.' },
        { key: 'item_count', value: 1, source: 'vision', evidence: '1 count' },
        { key: 'surface_area', value: 12, source: 'vision', evidence: '12 sqm' },
        { key: 'access', value: 'hard', source: 'inferred', evidence: 'Customer stated: "third floor, no lift"' },
      ],
    }
    expect(quoteUnderstanding({ ...nothing, photoCount: 0, signals }).photos).toEqual([])
    expect(quoteUnderstanding({ ...nothing, photoCount: 2, signals }).photos).toEqual([{ text: 'Noted from the photos: Panel label is intact, clean and legible' }])
  })

  it('lists at most four notes from the photos', () => {
    const signals = { signals: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, value: 'x', source: 'vision', evidence: `Something seen in the photos number ${i}` })) }
    expect(quoteUnderstanding({ ...nothing, photoCount: 1, signals }).photos).toHaveLength(4)
  })

  it('an extra picked up from the customer’s words is named, with no amount (AD-001: the price is the business’s)', () => {
    const u = quoteUnderstanding({
      ...nothing,
      pricing: {
        total: 2127.05,
        breakdown: [
          { label: 'Exterior wall painting', amount: 1777.05 },
          { label: 'Trim, fascia, and doors', amount: 350, autoRecommended: true, recommendationReason: 'Detected from your description' },
        ],
      },
    })
    expect(u.words).toEqual([{ text: 'Picked up from their words: Trim, fascia, and doors. Added at your price.' }])
    expect(allText(u)).not.toMatch(/350|1777|2127/)
  })

  it('work the customer may also need is listed with no price', () => {
    const u = quoteUnderstanding({
      ...nothing,
      content: { signalRecommendations: [{ workDescription: 'potential load assessment', evidence: 'panel capacity may need review.', estimatedCost: 150, costBreakdown: 'x' }] },
    })
    expect(u.alsoNoted).toEqual([{ text: 'Potential load assessment', detail: 'Panel capacity may need review.' }])
    expect(allText(u)).not.toContain('150')
  })

  it('an unanswered question says so', () => {
    const u = quoteUnderstanding({ ...nothing, questions: [{ id: 'q1', targetSignalKey: 'length', question: 'Roughly how long is the fence?' }], answers: [] })
    expect(u.asked).toEqual([{ question: 'Roughly how long is the fence?', answer: null }])
  })

  it('the checker’s findings are notes: the description only, once each', () => {
    const issue = { id: 'ISSUE-001', check: 'CHECK 3a', severity: 'medium', description: 'the scope mentions removal, which no line prices.', found: 'x', expected: 'Total should be £500', suggestedConfigFix: 'Add a £125 removal step', autoFixable: true }
    const u = quoteUnderstanding({ ...nothing, checker: { issues: [issue, { ...issue, id: 'ISSUE-002' }], checkedTotal: 375 } }, ON)
    expect(u.checks).toEqual([{ text: 'The scope mentions removal, which no line prices.' }])
    // what the checker "expected" and its suggested fix can name an amount: they are never shown
    expect(allText(u)).not.toMatch(/500|125/)
    expect(u.checksBeforeChange).toBe(false)
  })

  it('a finding the quote proves wrong is not shown: the business’s own minimum charge is not "unconfigured"', () => {
    const unconfigured = { check: 'CHECK 7b: NO INVENTED FEES', description: "An unconfigured fee/line item 'Minimum charge applied: £25' was added to the quote pricing breakdown." }
    const invented = { check: 'CHECK 7: DISCOUNTS/UNAUTHORIZED CHANGES - b) NO INVENTED FEES', description: 'Total price is higher than the expected sum of configured work steps due to an invented fee.' }
    const other = { check: 'CHECK 2: SCOPE TEXT VALIDATION', description: 'The scope mentions removal, which no line prices.' }
    const withMinimum = { total: 400, breakdown: [{ label: 'Rooms', amount: 375 }, { label: 'Minimum charge applied', amount: 25, kind: 'minimum', minimumCharge: 400 }] }
    const u = quoteUnderstanding({ ...nothing, pricing: withMinimum, checker: { issues: [unconfigured, invented, other], checkedTotal: 400 } }, ON)
    expect(u.checks).toEqual([{ text: 'The scope mentions removal, which no line prices.' }])
    // a quote stored before the marker carries the same entry by its label
    const oldWay = { total: 400, breakdown: [{ label: 'Rooms', amount: 375 }, { label: 'Minimum charge applied', amount: 25 }] }
    expect(quoteUnderstanding({ ...nothing, pricing: oldWay, checker: { issues: [unconfigured], checkedTotal: 400 } }, ON).checks).toEqual([])
    // with no minimum on the quote nothing is filtered: the finding stands as written
    expect(quoteUnderstanding({ ...nothing, checker: { issues: [unconfigured, invented, other], checkedTotal: 375 } }, ON).checks).toHaveLength(3)
  })

  it('says when the quote has changed since the checker read it', () => {
    const issue = { description: 'Something to look at.' }
    expect(quoteUnderstanding({ ...nothing, checker: { issues: [issue], checkedTotal: 400 } }, ON).checksBeforeChange).toBe(true)
    expect(quoteUnderstanding({ ...nothing, checker: { issues: [], checkedTotal: 400 } }, ON).checksBeforeChange).toBe(false)
  })

  it('the function changes nothing it is given (AD-001, AD-049)', () => {
    const input = {
      ...nothing,
      pricing: { total: 375, breakdown: [{ label: 'Rooms', amount: 375, autoRecommended: true }] },
      checker: { issues: [{ description: 'A note.' }], checkedTotal: 375 },
    }
    const before = JSON.stringify(input)
    quoteUnderstanding(input)
    quoteUnderstanding(input, ON)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('"Worth checking" is switched off: one flag, and with it off no finding is built or shown', () => {
    expect(SHOW_WORTH_CHECKING).toBe(false)
    const lib = code('apps/web/src/lib/quote-understanding.ts')
    expect(lib.match(/SHOW_WORTH_CHECKING = /g)).toHaveLength(1)
    const finding = { check: 'CHECK 2: SCOPE TEXT VALIDATION', description: 'The scope mentions removal, which no line prices.' }
    // a quote whose only AI output is a checker finding: nothing to show, so no panel
    const only = quoteUnderstanding({ ...nothing, checker: { issues: [finding], checkedTotal: 400 } })
    expect(only.checks).toEqual([])
    expect(only.checksBeforeChange).toBe(false)
    expect(understoodNothing(only)).toBe(true)
    // everything else in the panel stays
    const rest = quoteUnderstanding({
      ...nothing,
      photoCount: 1,
      signals: { signals: [{ key: 'tank_capacity', value: 50, source: 'vision', basis: 'identified', evidence: READING }] },
      pricing: { total: 375, breakdown: [{ label: 'Rooms', amount: 375 }, { label: 'Trim', amount: 90, autoRecommended: true, recommendationReason: 'detected from your description' }] },
      questions: [{ id: 'q1', question: 'Is 50 gal right?' }],
      answers: [{ questionId: 'q1', answer: '50 gal' }],
      checker: { issues: [finding], checkedTotal: 375 },
    })
    expect(rest.photos).toHaveLength(1)
    expect(rest.words).toHaveLength(1)
    expect(rest.asked).toEqual([{ question: 'Is 50 gal right?', answer: '50 gal' }])
    expect(rest.checks).toEqual([])
    expect(allText(rest)).not.toContain('removal')
    // the panel renders the group only from what the server sends, and has no switch of its own
    const panel = code('apps/web/src/components/quotes/UnderstoodPanel.tsx')
    expect(panel).toContain('u.checks.length > 0')
    expect(panel).not.toContain('SHOW_WORTH_CHECKING')
  })

  it('the panel says the prices are the business’s, and that the check changed nothing', () => {
    expect(UNDERSTOOD_COPY.title).toBe('What Qolumns understood')
    expect(UNDERSTOOD_COPY.intro).toContain('your price list')
    expect(UNDERSTOOD_COPY.checksTitle).toBe('Worth checking')
    expect(UNDERSTOOD_COPY.checksNote).toContain('changed nothing')
  })
})

describe('T-169: the customer’s photos', () => {
  it('a photo is a path on our own site, never a storage address', () => {
    expect(quotePhotoUrl('qte_1', 'ast_9')).toBe('/api/quotes/qte_1/photos/ast_9')
  })

  it('keeps the customer’s order and leaves out documents and unknown ids', () => {
    expect(photosInOrder('q', ['a', 'doc', 'b', 'gone'], new Set(['b', 'a']))).toEqual([
      { id: 'a', url: '/api/quotes/q/photos/a' },
      { id: 'b', url: '/api/quotes/q/photos/b' },
    ])
  })

  it('reads asset ids from either shape of the join, and from nothing', () => {
    expect(assetIdsOf({ asset_ids: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(assetIdsOf([{ asset_ids: ['a', 3, ''] }])).toEqual(['a'])
    expect(assetIdsOf(null)).toEqual([])
    expect(assetIdsOf({ asset_ids: 'a' })).toEqual([])
  })

  it('the signed address lasts minutes, not hours', () => {
    expect(DASHBOARD_PHOTO_URL_SECONDS).toBeLessThanOrEqual(600)
  })

  it('the photo route checks the sign-in, the tenant twice and the quote, and logs no address', () => {
    const route = code('apps/web/src/app/api/quotes/[quoteId]/photos/[assetId]/route.ts')
    expect(route).toContain('supabase.auth.getUser()')
    expect(route.match(/\.eq\('tenant_id', profile\.tenant_id\)/g)).toHaveLength(2)
    expect(route).toContain(".eq('type', 'image')")
    expect(route).toContain('.includes(assetId)')
    expect(route).not.toContain('createAdminClient')
    // nothing logged but the error's name
    const logs = route.match(/console\.\w+\([^)]*\)/g) ?? []
    expect(logs).toHaveLength(1)
    expect(logs[0]).not.toMatch(/signedUrl|r2_key|assetId|message/)
  })

  it('every photo lookup is filtered by the tenant', () => {
    const lib = code('apps/web/src/lib/quote-photos.ts')
    expect(lib).toContain(".eq('tenant_id', tenantId).eq('type', 'image')")
    expect(lib).not.toMatch(/console\./)
  })

  it('the thumbnails open a real dialog and every one has a name', () => {
    const photos = code('apps/web/src/components/quotes/CustomerPhotos.tsx')
    expect(photos).toContain('<dialog')
    expect(photos).toContain('showModal()')
    expect(photos).toMatch(/aria-label=\{`Photo \$\{i \+ 1\} of \$\{count\}\. Open larger\.`\}/)
    expect(photos).toContain("e.key === 'ArrowRight'")
    // dashboard motion is feedback only: nothing in the viewer animates
    expect(photos).not.toMatch(/animate-|transition-(all|opacity|transform)/)
  })
})

describe('T-169: the quote page', () => {
  const page = code('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx')

  it('reads in one order: next step, what the AI understood, pricing, then the rest', () => {
    const order = ['<NextStepBox', '<UnderstoodPanel', 'data-testid="pricing"', 'data-testid="quote-rest"'].map((s) => page.indexOf(s))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('the total is the mono figure, at the dashboard’s largest size', () => {
    expect(page).toMatch(/className="figure text-4xl[^"]*" data-testid="quote-total"/)
  })

  it('the back arrow has a name', () => {
    expect(page).toContain('aria-label="Back to quotes"')
  })

  it('the panel renders nothing when there is nothing', () => {
    const panel = code('apps/web/src/components/quotes/UnderstoodPanel.tsx')
    expect(panel).toContain('if (nothing && photos.length === 0) return null')
  })

  it('the detail API builds the panel on the server, for this tenant only', () => {
    const route = code('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    const log = route.slice(route.indexOf(".from('quote_validation_logs')"), route.indexOf('.maybeSingle()', route.indexOf(".from('quote_validation_logs')")))
    expect(log).toContain(".eq('quote_id', quoteId)")
    expect(log).toContain(".eq('tenant_id', auth.tenantId)")
    expect(route).toContain('understanding,')
    // the log is read only while "Worth checking" is switched on
    expect(route).toMatch(/SHOW_WORTH_CHECKING\s*\?\s*supabase\s*\.from\('quote_validation_logs'\)/)
    // the checker's log is read, never written, by the web app
    expect(route).not.toMatch(/from\('quote_validation_logs'\)\s*\.(insert|update|delete|upsert)/)
  })
})

describe('T-169: Services on a phone, names, and no raw colours', () => {
  const services = code('apps/web/src/app/(dashboard)/app/services/page.tsx')

  it('the list is not a table that cuts its actions off', () => {
    const list = services.slice(services.indexOf('data-testid="services-list"') - 400, services.indexOf('{/* Modal */}') > 0 ? undefined : undefined)
    expect(services).not.toMatch(/<table className="min-w-full">/)
    expect(list).toContain('data-testid="service-edit"')
    expect(list).toContain('data-testid="service-toggle"')
    expect(list).toContain('data-testid="service-delete"')
  })

  it('Delete sits apart from Edit and Disable, behind a rule', () => {
    expect(services).toMatch(/ml-auto flex items-center border-l border-border-strong pl-3[^"]*">\s*<button\s+onClick=\{\(\) => deleteService\(service\)\}/)
  })

  it('the three actions are 44 px tall on a phone and each names its service', () => {
    for (const id of ['service-edit', 'service-toggle', 'service-delete']) {
      const at = services.indexOf(`data-testid="${id}"`)
      const button = services.slice(services.lastIndexOf('<button', at), at)
      expect(button).toContain('min-h-[44px]')
      expect(button).toContain('aria-label={`')
    }
  })

  it('the page header lets its actions wrap', () => {
    expect(code('apps/web/src/components/ui/PageHeader.tsx')).toContain('flex flex-wrap items-start justify-between')
  })

  it('the form builder’s icon-only buttons have names', () => {
    const builder = code('apps/web/src/components/share/FormFieldsBuilder.tsx')
    for (const label of ['aria-label={`Move ${field.label} up`}', 'aria-label={`Move ${field.label} down`}', 'aria-label={`Remove ${field.label}`}', 'aria-label="Dismiss this message"']) {
      expect(builder).toContain(label)
    }
  })

  it('Analytics uses no raw palette colour', () => {
    expect(code('apps/web/src/app/(dashboard)/app/analytics/page.tsx')).not.toMatch(/\b(bg|text|border)-(blue|red|green|zinc|gray|slate|indigo|amber)-\d{2,3}\b/)
  })
})

describe('T-169: Home’s small lines', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = new Date('2026-11-15T12:00:00Z')
  const since = new Date(now.getTime() - 30 * DAY)
  const before = new Date(now.getTime() - 60 * DAY)
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString()
  const rows: HomeQuoteRow[] = [
    { status: 'accepted', created_at: at(2), sent_at: at(2), accepted_at: at(1), pricing_json: { total: 400 } },
    { status: 'sent', created_at: at(12), sent_at: at(11), accepted_at: null, pricing_json: { total: 900 } },
    { status: 'paid', created_at: at(40), sent_at: at(39), accepted_at: at(38), pricing_json: { total: 250.4 } },
    { status: 'sent', created_at: at(3), sent_at: at(3), accepted_at: null, pricing_json: { total: 100 }, is_test: true },
  ]

  it('has twelve points: six for the 30 days before, six for the last 30', () => {
    const series = homeSeries(rows, before, now)
    expect(HOME_SERIES_STEP_DAYS).toBe(5)
    for (const key of ['requests', 'sent', 'accepted', 'valueAccepted'] as const) expect(series[key]).toHaveLength(12)
  })

  it('each half adds up to that period’s figure (setup tests never count)', () => {
    const series = homeSeries(rows, before, now)
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
    const current = homeNumbers(rows, since)
    const previous = homeNumbers(rows, before, since)
    expect(sum(series.requests.slice(6))).toBe(current.requests)
    expect(sum(series.requests.slice(0, 6))).toBe(previous.requests)
    expect(sum(series.accepted.slice(6))).toBe(current.accepted)
    expect(sum(series.valueAccepted.slice(6))).toBe(Math.round(current.valueAccepted))
    expect(sum(series.valueAccepted.slice(0, 6))).toBe(Math.round(previous.valueAccepted))
    expect(current.requests).toBe(2)
  })

  it('a screen reader gets the points as a sentence', () => {
    expect(seriesSummary([0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1], 30)).toBe(
      'In 5-day steps. The 30 days before: 0, 1, 0, 0, 0, 0. The last 30 days: 0, 0, 0, 1, 0, 1.'
    )
  })

  it('the line is hidden from screen readers and the direction is a shape as well as words', () => {
    const spark = code('apps/web/src/components/home/Sparkline.tsx')
    expect(spark).toContain('aria-hidden="true"')
    expect(spark).toContain('className="sr-only"')
    expect(spark).toContain("direction === 'up' && <path")
    expect(spark).toContain("direction === 'down' && <path")
    expect(spark).not.toMatch(/animate|transition/)
    const home = code('apps/web/src/app/(dashboard)/app/page.tsx')
    expect(home).toContain('<TrendMark direction={change.direction} />')
    expect(home).toContain('{changeWords(change, format)}')
  })
})

describe('T-169: the hero demo’s frame headers fit', () => {
  it('the business name is not cut: it wraps', () => {
    const demo = code('apps/web/src/components/marketing/home/HeroDemo.tsx')
    const at = demo.indexOf('data-testid="demo-business-name"')
    const tag = demo.slice(demo.lastIndexOf('<p', at), at)
    expect(tag).not.toContain('truncate')
    expect(tag).toContain('text-balance')
  })
})

describe('T-169: the record', () => {
  it('the capabilities list says where the business sees each reading', () => {
    expect(existsSync(join(ROOT, 'Docs/design/ai-capabilities.md'))).toBe(true)
    expect(read('Docs/design/ai-capabilities.md')).toContain('What Qolumns understood')
  })
})
