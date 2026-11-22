/**
 * T-171: the customer's pages (the request form, the question, the quote
 * page, accept), the billing page, and three small leftovers.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findConfidenceLanguage, offeredPlans } from '@qolumns/shared'
import { customerReadLines, parseReading, readingQuestion, yourPlace } from '@/lib/customer-read'
import { brandStyleVars, contrastRatio, readableTextOn } from '@/lib/color'
import { usesTapRows, TAP_ROWS_MAX } from '@/components/embed/steps/QuestionsStep'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'
import { planLines } from '@/lib/marketing/plan-claims'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const READING = 'Read from the tank\'s rating label (photo 1): "CAPACITY 50 U.S. GAL MODEL NO. EX-50-NG-DEMO" → 50 gal (capacity printed on the label)'
const FUEL = 'Read from the tank\'s rating label (photo 1): "GAS TYPE NATURAL GAS" → Natural gas (gas type on the label)'
const base = { signals: { signals: [] }, questions: null, answers: null, takeoff: null, locale: 'en-US' }

describe('T-171: what was read, in the customer’s terms', () => {
  it('a label reading is taken apart without its label text or its rule', () => {
    expect(parseReading(READING)).toEqual({ where: "the tank's rating label", value: '50 gal' })
    expect(parseReading('Read from the panel label: 200 A')).toEqual({ where: 'the panel label', value: '200 A' })
    expect(parseReading('Measured across 2 independent passes (spread ±5%)')).toBeNull()
    expect(parseReading(undefined)).toBeNull()
    expect(yourPlace("the tank's rating label")).toBe("your tank's rating label")
    expect(yourPlace('your photos')).toBe('your photos')
  })

  it('the question is one plain sentence, and the marketing screens say the same one', () => {
    expect(readingQuestion('50 gal', "the tank's rating label")).toBe("We read 50 gal from your tank's rating label. Is that right?")
    expect(SCREEN_WORDS.question.ask('50 gal', "the tank's rating label")).toBe(readingQuestion('50 gal', "the tank's rating label"))
    const clarify = code('apps/web/src/app/q/[quoteId]/clarify/page.tsx')
    expect(clarify).toContain('reading ? readingQuestion(String(q.aiValue), reading.where) : q.question')
    // the raw line is never shown: no "What we saw", and the evidence is only ever parsed
    expect(clarify).not.toMatch(/What we saw/)
    expect(clarify.match(/q\.evidence/g)).toHaveLength(1)
    expect(clarify).toContain('parseReading(q.evidence)')
    // T-146: at this point it is an estimate
    expect(clarify).not.toMatch(/your quote|finalize/i)
  })

  it('a reading the customer said was right is shown, grouped by the label it came from', () => {
    const lines = customerReadLines({
      ...base,
      // after the answer the capacity signal is the customer's; the fuel was used as it was read
      signals: { signals: [{ key: 'tank_capacity', value: '50 gal', source: 'form', confidence: 1 }, { key: 'fuel', value: 'Natural gas', source: 'vision', basis: 'identified', evidence: FUEL }] },
      questions: [{ id: 'q1', type: 'confirm_value', aiValue: '50 gal', evidence: READING, targetSignalKey: 'tank_capacity' }],
      answers: [{ questionId: 'q1', answer: '50 gal' }],
    })
    expect(lines).toEqual(["From your tank's rating label: 50 gal, Natural gas"])
    for (const line of lines) expect(line).not.toMatch(/CAPACITY|MODEL|→|photo \d|printed/)
  })

  it('a reading the customer corrected is not shown: the quote uses their answer, not the reading', () => {
    const lines = customerReadLines({
      ...base,
      questions: [{ id: 'q1', type: 'confirm_value', aiValue: '50 gal', evidence: READING, targetSignalKey: 'tank_capacity' }],
      answers: [{ questionId: 'q1', answer: '40 gal' }],
    })
    expect(lines).toEqual([])
    // and one that has not been answered yet is not in the quote either
    expect(customerReadLines({ ...base, questions: [{ id: 'q1', type: 'confirm_value', aiValue: '50 gal', evidence: READING, targetSignalKey: 'tank_capacity' }] })).toEqual([])
  })

  it('a quantity measured from photos is one sentence with no amount; nothing else of the takeoff is shown', () => {
    const lines = customerReadLines({
      ...base,
      takeoff: [
        { item: 'Exterior walls', quantity: 919.1, unit: 'sqft', rate: 2.5, amount: 2297.75, method: 'From your photos', evidence: 'Measured across 2 independent passes (spread ±5%)' },
        { item: 'Ladders & staging', amount: 250, method: 'Fixed quantity' },
        { item: 'Front door repaint', quantity: 1, unit: 'item', rate: 120, amount: 120, method: 'Quantity provided by you' },
        { item: 'Rooms', quantity: 2, unit: 'room', rate: 375, amount: 750, method: 'From your answers' },
        { item: 'Call-out', amount: 75, method: 'Standard charge for every job' },
        { item: 'Minimum charge applied', amount: 25, method: 'Fixed price' },
        { item: 'Living room', quantity: 412, unit: 'sqft', rate: 2, amount: 824, method: 'From the on-site room scan' },
      ],
    })
    expect(lines).toEqual(['From your photos: about 919.1 sq ft (Exterior walls)', 'From the on-site room scan: 412 sq ft (Living room)'])
    for (const line of lines) {
      expect(line).not.toMatch(/[$£€]|2297|2\.5|×|passes|spread|Fixed/)
      expect(findConfidenceLanguage(line)).toEqual([])
    }
  })

  it('nothing read means nothing shown, and bad input never throws', () => {
    expect(customerReadLines(base)).toEqual([])
    for (const bad of [null, undefined, 'x', 7, [], [null], { signals: 'x' }]) {
      expect(customerReadLines({ signals: bad, questions: bad, answers: bad, takeoff: bad, locale: 'en-US' })).toEqual([])
    }
    // a line that would carry a word a customer must not see, or an amount, is left out
    expect(customerReadLines({ ...base, takeoff: [{ item: 'Exact wall area', quantity: 10, unit: 'sqft', method: 'From your photos' }] })).toEqual([])
    expect(customerReadLines({ ...base, takeoff: [{ item: 'Walls at $2.50', quantity: 10, unit: 'sqft', method: 'From your photos' }] })).toEqual([])
  })

  it('the public quote API sends the lines, withheld while the price is a range; the page shows them once, with no amounts', () => {
    const route = code('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    expect(route).toContain('const read = isProvisional')
    expect(route).toContain('...(read.length > 0 && { read }),')
    const page = code('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('const readLines = quote.read ?? []')
    expect(page).toContain('{readLines.length > 0 && (')
    const block = page.slice(page.indexOf('data-testid="what-was-read"'), page.indexOf('pricing.availableAddons'))
    expect(block).toContain('Measurement &amp; takeoff')
    expect(block).toContain(SCREEN_WORDS.estimate.takeoffLead)
    expect(block).not.toMatch(/formatCurrency|entry\.|rate|amount/)
    // the takeoff's rows, with their amounts and their methods, are no longer drawn at all
    expect(page).not.toMatch(/takeoffRows|entry\.method|entry\.amount/)
  })
})

describe('T-171: the customer quote page', () => {
  const page = code('apps/web/src/app/q/[quoteId]/page.tsx')

  it('no status pill', () => {
    expect(page).not.toMatch(/StatusBadge|statusConfig|'Under review'|label: 'Viewed'/)
    expect(page).toContain('`Reviewed and confirmed by ${business.name}.`')
  })

  it('every word on the price panel is the on-colour at full strength, and the panel carries none of our yellows', () => {
    expect(page).not.toMatch(/text-on-primary\/\d/)
    expect(page).not.toMatch(/bg-butter text-ink|bg-accent|text-accent/)
    expect(page).toContain('bg-on-primary text-primary')
  })

  it('the on-colour reaches 4.5:1 on any business colour', () => {
    // a sweep of the colour cube, and the colours a business is likely to pick
    const picks = ['#1D3557', '#F4D35E', '#3B82F6', '#F97316', '#EF4444', '#8B5CF6', '#14B8A6', '#2563EB', '#3E6B4F', '#FFFFFF', '#000000', '#808080', '#205E56', '#FFC53D']
    const sweep: string[] = []
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) sweep.push(`#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`)
    for (const hex of [...picks, ...sweep]) expect(contrastRatio(hex, readableTextOn(hex)), hex).toBeGreaterThanOrEqual(4.5)
    // white where white reaches it, dark where the colour is light, black only where neither does
    expect(readableTextOn('#1D3557')).toBe('#ffffff')
    expect(readableTextOn('#F4D35E')).toBe('#1B2823')
    expect(readableTextOn('#F97316')).toBe('#1B2823')
    expect(readableTextOn('#3B82F6')).toBe('#000000')
    expect((brandStyleVars('#3B82F6') as Record<string, string>)['--color-on-primary-rgb']).toBe('0 0 0')
    expect((brandStyleVars('#F4D35E') as Record<string, string>)['--color-on-primary-rgb']).toBe('27 40 35')
    // the business's own colour is what is set; ours never replaces it
    expect((brandStyleVars('#F97316') as Record<string, string>)['--color-primary']).toBe('#F97316')
  })

  it('accept: scrolled to and focused; one short confirmation; what happens next in three steps', () => {
    const form = code('apps/web/src/components/quote/AcceptDetailsForm.tsx')
    expect(form).toContain("root.current?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })")
    expect(form).toContain('first.current?.focus({ preventScroll: true })')
    expect(form).toContain('ref={i === 0 ? first : undefined}')
    // a field's edge can be seen, and the timing note has a label of its own
    expect(form).toContain('border border-field rounded-xl bg-white')
    expect(form).toContain('<label htmlFor="timing-note" className="mt-3 block')
    expect(form).not.toContain('placeholder="Anything about timing')
    expect(page).toContain("${justAccepted ? 'animate-fade-in-up' : ''}")
    expect(page).toContain('data-testid="what-happens-next"')
    expect((page.match(/title: /g) ?? []).length).toBe(3)
    // the entrance is the system's own: 250 ms, opacity and a small rise, and reduced motion stills it
    const css = read('apps/web/src/app/globals.css')
    expect(css).toMatch(/--motion-enter:\s*250ms/)
    expect(css).toMatch(/\.animate-fade-in-up \{\s*animation: fade-in-up var\(--motion-enter\) var\(--ease-enter\);/)
  })

  it('"Prepared with" and "Powered by" are 12 px in a colour that reaches 4.5:1', () => {
    expect(page).toContain('<p className="text-xs text-text-muted" data-testid="prepared-with">')
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toContain('<span className="figure text-xs text-text-muted">Powered by {PRODUCT_NAME}</span>')
    expect(widget).not.toMatch(/text-\[10px\] text-text-muted">Powered/)
    // text-muted on white and on paper
    expect(contrastRatio('#626C66', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#626C66', '#FAF9F6')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('T-171: the request form', () => {
  // read whole: the comment stripper takes the chat's `accept="image/*"` for the start of a comment
  const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
  const questions = code('apps/web/src/components/embed/steps/QuestionsStep.tsx')

  it('a photo marks an item only when the customer tapped that item to add it', () => {
    // both ways of adding go through one picker; the general Add names no item
    expect(widget).toContain('onClick={() => openPickerForAngle(null)}')
    expect(widget).toContain('onClick={() => !filled && canAddPhotos && openPickerForAngle(angle.id)}')
    expect(widget).toMatch(/const angleId = pendingAngleRef\.current\s*pendingAngleRef\.current = null/)
    // the file input is no longer inside a label that opens it without clearing the item
    expect(widget).not.toMatch(/<label[^>]*>\s*<input\s+ref=\{fileInputRef\}/)
    // of several photos chosen at once, only the first is the item's
    expect(widget).toContain('const fileAngleId = isImage && isFirst ? (angleId ?? undefined) : undefined')
    // no wording that implies we checked what a photo shows
    expect(widget).toContain('Photos that help. Tap one to add it')
    expect(widget).not.toMatch(/most accurate|we need these shots|photo verified|looks right|we checked/i)
    expect(questions).not.toMatch(/more accurate/)
  })

  it('the step bar: one line with "Step N of M" under 640 px, labels under their numbers above', () => {
    expect(widget).toContain('Step {currentStep + 1} of {steps.length}')
    expect(widget).toContain('<div className="sm:hidden" data-testid="step-bar-compact">')
    expect(widget).toContain('<ol className="hidden sm:grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} data-testid="step-bar-full">')
  })

  it('two to five choices are rows to tap; a longer list keeps its picker', () => {
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Choice ${i}` }))
    expect(TAP_ROWS_MAX).toBe(5)
    for (const n of [2, 3, 4, 5]) expect(usesTapRows({ type: 'select', options: opts(n) }), String(n)).toBe(true)
    for (const n of [0, 1, 6, 12]) expect(usesTapRows({ type: 'select', options: opts(n) }), String(n)).toBe(false)
    expect(usesTapRows({ type: 'radio', options: opts(7) })).toBe(true)
    expect(usesTapRows({ type: 'text' })).toBe(false)
    expect(questions).toContain("{field.type === 'select' && field.options && !usesTapRows(field) && (")
    expect(questions).toContain('flex min-h-[48px] items-center')
    // the rows are in the business's colour, not a colour of ours
    expect(questions).not.toMatch(/accent-\[#205E56\]/)
    expect(code('apps/web/src/components/quote/AcceptDetailsForm.tsx')).not.toMatch(/accent-\[#205E56\]/)
  })

  it('edge to edge on a phone; a real h1 on the quote link page; required said in words', () => {
    expect(widget).toContain("bg-white font-body sm:bg-background sm:px-6 sm:py-10")
    expect(widget).toContain('sm:rounded-3xl sm:border sm:border-border sm:shadow-warm-lg')
    expect(widget).toContain("<Letterhead as={hosted ? 'h1' : 'h2'} name={widgetData.tenantName} />")
    expect(widget).toContain("<StepHeadingLevel.Provider value={hosted ? 'h2' : 'h3'}>")
    const title = code('apps/web/src/components/embed/StepTitle.tsx')
    expect(title).toContain('> (required)</span>')
    for (const step of ['QuestionsStep', 'ContactStep', 'JobDetailsStep']) {
      const src = code(`apps/web/src/components/embed/steps/${step}.tsx`)
      expect(src, step).toContain('<RequiredMark />')
      expect(src, step).not.toMatch(/text-danger[^"]*">\s*\*<\/span>/)
    }
  })

  it('the last button reads "Get my estimate", as the marketing pictures of the form do', () => {
    const last = read('apps/web/src/components/embed/steps/JobDetailsStep.tsx')
    expect(last).toMatch(/>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?Get my estimate\s*<\/button>/)
    expect(last).not.toContain('Get Quote')
    expect(read('apps/web/src/components/marketing/home/RequestFormScreen.tsx')).toContain("buttonLabel = 'Get my estimate'")
    // no page of the app or script still names the old label
    for (const f of ['apps/web/src/components/embed/EstimateWidget.tsx', 'scripts/hardcore-test/verify-t162.mts', 'scripts/hardcore-test/verify-t171.mts']) expect(read(f), f).not.toContain('Get Quote')
  })

  it('nothing in the form opens a new tab; the quote link page moves straight on; a framed form shows the estimate itself', () => {
    expect(widget).not.toMatch(/target="_blank"/)
    expect(widget).toContain("const sameTab = framed ? { target: '_top' } : {}")
    // T-199: the same move, kept on the business's own address when the customer is on it
    expect(widget).toContain('if (!hosted || !destination) return')
    expect(widget).toContain('window.location.assign(onSameAddress(destination, here,')
    expect(widget).toContain('data-testid="finished-estimate"')
    expect(widget).toContain('hosted={hosted} shownBelow={Boolean(demo)}')
    // T-146: "estimate" until the business has reviewed it
    expect(widget).toContain("const noun = estimate?.reviewed ? 'quote' : 'estimate'")
    // the clarify page and the quote page do not open a tab for the question either
    expect(code('apps/web/src/app/q/[quoteId]/page.tsx')).toMatch(/href=\{`\/q\/\$\{quoteId\}\/clarify\?token=\$\{token\}`\}\s*className=/)
  })
})

describe('T-171: the billing page, and the small leftovers', () => {
  it('the billing page lists a plan’s lines from the list the public Pricing page reads', () => {
    const billing = code('apps/web/src/app/(dashboard)/app/settings/billing/page.tsx')
    // T-187: the mark reads "Coming soon" (it read "Coming later"); still one constant for every page
    expect(billing).toContain("import { COMING_SOON, PLUS_TAX, planLines } from '@/lib/marketing/plan-claims'")
    expect(billing).toContain('const lines = definition ? planLines(definition) : []')
    expect(billing).toContain('{COMING_SOON}')
    // its own list of feature names is gone, so the two pages cannot disagree
    expect(billing).not.toMatch(/FeatureItem|label="LiDAR scanning"|label="Quoting by text/)
    // Business stays on offer there, with its lines marked
    const business = offeredPlans().find((p) => p.id === 'plan_us_business')!
    // T-181: text messages are no longer on any page. T-199: seven, with the mobile app (every plan) and its own address
    expect(planLines(business).filter((l) => !l.live).length).toBe(7)
    expect(read('apps/web/src/app/api/billing/route.ts')).toContain('offeredPlans().map((p) => toPlanInfo(p))')
  })

  it('login and sign-up fields are 44 px tall, and the link to the other page is a clear link', () => {
    // T-173: the account pages share their field and link classes (components/auth/auth-form.tsx)
    const shared = code('apps/web/src/components/auth/auth-form.tsx')
    expect(shared).toContain("AUTH_INPUT =\n  'w-full min-h-[44px] rounded-xl border border-field bg-white")
    expect(shared).toContain("AUTH_LINK = 'inline-flex min-h-[24px] items-center font-semibold text-primary underline underline-offset-4'")
    for (const f of ['login', 'signup', 'forgot-password', 'reset-password']) {
      const src = code(`apps/web/src/app/(auth)/${f}/page.tsx`)
      expect(src, f).toContain('className={AUTH_INPUT}')
      expect(src, f).toContain('className={AUTH_LINK}')
      expect(src, f).not.toMatch(/className="text-primary hover:underline"/)
    }
  })

  it('header and footer links are at least 24 px tall on a computer', () => {
    expect(code('apps/web/src/components/marketing/SiteFooter.tsx')).toContain('sm:min-h-[24px]')
    const nav = code('apps/web/src/components/marketing/SiteNav.tsx')
    expect(nav).toContain('className="inline-flex min-h-[44px] items-center text-sm font-medium text-text-secondary')
    expect(nav).toContain('md:inline-flex')
  })
})
