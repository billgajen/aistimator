// T-165 live check: the home page shows the product; yellow accent; one free offer.
// Run (local stack up: supabase, web, worker):
//   npx tsx scripts/hardcore-test/verify-t165.mts
// With the browser pass, which is most of it:
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t165.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. one free offer: no "14-day" and no "trial" on any public page;
// 2. (browser, 390 and 1440) the hero demo plays once and stops on its last
//    state, "Play again" plays it once more, and with reduced motion it shows
//    the finished frames with no movement;
// 3. (browser) nothing scrolls sideways; on a phone the frames stack;
// 4. (browser) one yellow call to action per screen, with dark text and a
//    thin dark edge; no two neighbouring sections share a layout; each plan
//    card has a button; the closing band has one button and one quiet link;
// 5. (browser) login: the estimate document beside the form at desktop width,
//    the email field autofills, a skip link, tap-sized footer links;
// 6. (browser) "needs you" is the strong yellow with its marker in the
//    dashboard, and the billing page offers no trial;
// 7. the minimum charge is a floor, not an item: a job below the business's
//    minimum is stored as its real lines plus one marked entry, and (browser)
//    the customer page, the dashboard quote page and the pricing trace show
//    the lines and one note above the total; a job above the minimum shows
//    nothing about one; a quote stored the old way shows the same note; the
//    editor's note follows the edits and can be removed for good.
//
// Two requests go through the real pipeline. Names are made up.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t165-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const stalls: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)
const origin = new URL(cfg.appUrl).origin


const YELLOW = '#FFC53D'
const INK = '#1B2823'
const BUTTER = '#F7E9C6'

const rgbOf = (css: string): [number, number, number, number] => {
  const m = /rgba?\(([^)]+)\)/.exec(css)
  if (!m) return [0, 0, 0, 0]
  const parts = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
}
const hexOf = (css: string) => '#' + rgbOf(css).slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase()
const luminance = (css: string) => {
  const [r, g, b] = rgbOf(css).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}


// ====================================================================
section('1. One free offer')
// ====================================================================
const PUBLIC_PAGES = ['/', '/features', '/pricing', '/trades', '/trades/garage-doors', '/trades/hvac', '/painting', '/privacy', '/terms', '/login', '/signup', '/demo']
const visibleText = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const offending: string[] = []
for (const pathname of PUBLIC_PAGES) {
  const res = await fetch(`${cfg.appUrl}${pathname}`)
  const text = visibleText(await res.text())
  const hit = /14[- ]day|free trial|\btrial\b/i.exec(text)
  if (res.status !== 200 || hit) offending.push(`${pathname}: ${res.status} ${hit?.[0] ?? ''}`)
}
check('no public page says "14-day" or "trial" (twelve pages)', offending.length === 0, offending)
const pricingText = visibleText(await (await fetch(`${cfg.appUrl}/pricing`)).text())
check('pricing: every plan button is "Choose <plan>", and the offer is the free quotes', ['Choose Starter', 'Choose Pro', 'Choose Business'].every((b) => pricingText.includes(b)) && pricingText.includes('Try it free: 10 quotes, no card') && pricingText.includes('When do I start paying?'))

// ---------- a business with one request waiting for it ----------
async function business(name: string) {
  const id = shortId()
  const email = `owner+t165-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: cookie,
    body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const slug = (await sb.select('tenants', `id=eq.${tenantId}&select=slug`))[0].slug as string
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, email, slug }
}
type Biz = Awaited<ReturnType<typeof business>>

const a = await business('Fernhill Doors')
/** Far below any door: this business's door quotes are above their minimum */
const DOOR_MINIMUM = 100
const door = garageDoorsPackUS.services[0]!
const serviceId = (expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: a.cookie,
  body: {
    name: door.name, description: door.description, documentTypeDefault: 'instant_estimate',
    scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
    workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
    pricingRules: { baseFee: 0, minimumCharge: DOOR_MINIMUM, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
    draftConfig: door.draft,
  },
})).service.id) as string
const DOOR_ANSWERS = [
  { fieldId: '_project_description', value: 'New garage door please, single steel one' },
  { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' },
  { fieldId: 'door_style', value: 'Steel, non-insulated' },
]
async function submit(biz: Biz, customer: { name: string; email: string }, job: { serviceId: string; answers: Array<{ fieldId: string; value: string | number }> } = { serviceId, answers: DOOR_ANSWERS }) {
  // Locally the request waits for the whole pipeline, and an AI call there can
  // stall. One retry, then carry on; a second stall fails the run.
  const post = () => http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: {
      tenantKey: biz.tenantKey, serviceId: job.serviceId, customer, source: { type: 'widget' },
      job: { postcodeOrZip: '63021', answers: job.answers },
    },
    timeoutMs: 150_000,
  })
  let posted
  try {
    posted = await post()
  } catch (error) {
    stalls.push(`${customer.name}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`⏳ the submission for ${customer.name} stalled; retrying once`)
    posted = await post()
  }
  const res = expectOk('submit', posted)
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token, viewUrl: res.quoteViewUrl as string }
}
const quote = await submit(a, { name: 'Marlo Finch', email: 'marlo.finch@example.com' })
check('a request is waiting for the business (priced, awaiting approval)', (await sb.select('quotes', `id=eq.${quote.id}&select=status`))[0].status === 'pending_review')
const billing = await http('GET', `${cfg.appUrl}/api/billing`, { headers: a.cookie })
check('the billing data offers no plan with a trial', billing.ok && !/"trialDays":\s*[1-9]/.test(JSON.stringify(billing.json)), billing.status)

// ====================================================================
section('7. The minimum charge is a floor, not an item')
// ====================================================================
type Line = { label: string; amount: number; kind?: string; minimumCharge?: number }
type Pricing = { currency: string; subtotal: number; taxAmount: number; total: number; breakdown: Line[]; notes?: string[] }
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patchRow = (table: string, query: string, body: unknown) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=representation' }, body })
const pricingOf = async (id: string) => ((await sb.select('quotes', `id=eq.${id}&select=pricing_json`))[0].pricing_json) as Pricing
const sumOf = (lines: Line[]) => Math.round(lines.reduce((total, line) => total + line.amount, 0) * 100) / 100
const saysMinimum = (value: unknown) => /minimum/i.test(JSON.stringify(value))

// "$375 per room", and this business's minimum charge is $400
const ROOM_MINIMUM = 400
const roomSteps = [
  { id: 'rooms', name: 'Rooms', description: 'Prepare and paint each room', costType: 'per_unit', defaultCost: 375, optional: false, unitLabel: 'room', quantitySource: { type: 'form_field', fieldId: 'room_count' } },
]
const roomServiceId = (expectOk('room service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: a.cookie,
  body: {
    name: 'Interior room painting', description: 'Painting of interior rooms, priced per room.', documentTypeDefault: 'instant_estimate',
    scopeIncludes: ['Preparation and two coats on walls'], scopeExcludes: ['Ceilings'], defaultAssumptions: ['Rooms are empty and walls are sound'],
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: 'A photo of each room', requiredAngles: [] },
    workSteps: roomSteps, expectedSignals: [],
    suggestedFields: [{ fieldId: 'room_count', label: 'How many rooms?', type: 'number', required: true, criticalForPricing: true }],
    pricingRules: { baseFee: 0, minimumCharge: ROOM_MINIMUM, addons: [], multipliers: [], workSteps: roomSteps },
  },
})).service.id) as string
const small = await submit(a, { name: 'Odalys Brandt', email: 'odalys.brandt@example.com' }, {
  serviceId: roomServiceId,
  answers: [{ fieldId: '_project_description', value: 'One small bedroom to repaint, walls only' }, { fieldId: 'room_count', value: 1 }],
})
const smallPricing = await pricingOf(small.id)
const smallLines = smallPricing.breakdown.filter((line) => line.kind !== 'minimum')
const smallMarked = smallPricing.breakdown.filter((line) => line.kind === 'minimum')
check('below the minimum: the job’s real line is stored with its own amount ($375)', smallLines.length === 1 && smallLines[0]!.amount === 375 && smallLines[0]!.label.startsWith('Rooms'), smallPricing.breakdown)
check('below the minimum: the top-up is one entry, marked as the minimum, with the business’s minimum charge', smallMarked.length === 1 && smallMarked[0]!.amount === 25 && smallMarked[0]!.minimumCharge === ROOM_MINIMUM, smallMarked)
check('below the minimum: lines + the minimum entry = subtotal = the minimum; the total is the minimum (no tax)', sumOf(smallPricing.breakdown) === ROOM_MINIMUM && smallPricing.subtotal === ROOM_MINIMUM && smallPricing.total === ROOM_MINIMUM, { subtotal: smallPricing.subtotal, total: smallPricing.total })
check('below the minimum: the sentence is not repeated among the stored notes', !(smallPricing.notes ?? []).some((note) => /minimum charge/i.test(note)), smallPricing.notes)
const doorPricing = await pricingOf(quote.id)
check(`above the minimum (a door, minimum $${DOOR_MINIMUM}): nothing about a minimum is stored, and the lines are the subtotal`, doorPricing.subtotal > DOOR_MINIMUM && sumOf(doorPricing.breakdown) === doorPricing.subtotal && !saysMinimum(doorPricing.breakdown) && !saysMinimum(doorPricing.notes ?? []), { subtotal: doorPricing.subtotal })
const smallTrace = ((await sb.select('quotes', `id=eq.${small.id}&select=pricing_trace_json`))[0].pricing_trace_json ?? {}) as { summary?: { minimumApplied?: boolean; total?: number } }
check('the pricing trace records that the minimum applied, with the same total', smallTrace.summary?.minimumApplied === true && smallTrace.summary?.total === ROOM_MINIMUM, smallTrace.summary)
// the business approves both, so the customer has the full estimate
expectOk('approve the small job', await http('POST', `${cfg.appUrl}/api/quotes/${small.id}/approve`, { headers: a.cookie }))
const viewOf = async (id: string, token: string) => (await http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}&poll=1`)).json as { pricing: Pricing }
check('the customer’s data for the small job carries the same marked entry and total', JSON.stringify((await viewOf(small.id, small.token)).pricing.breakdown) === JSON.stringify(smallPricing.breakdown) && (await viewOf(small.id, small.token)).pricing.total === ROOM_MINIMUM)

if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Everything a browser paints: the demo playing once and stopping, reduced motion, sideways scroll, one yellow call to action per screen, neighbouring layouts, login, and "needs you" in the dashboard. Set PLAYWRIGHT_DIR to run the browser pass.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const contextFor = async (biz: Biz | null, opts: { width?: number; height?: number; reducedMotion?: 'reduce' | 'no-preference' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 }, reducedMotion: opts.reducedMotion ?? 'no-preference' })
    if (biz) {
      await ctx.addCookies(biz.cookieHeader.split('; ').map((pair) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      }))
    }
    return ctx
  }
  type Ctx = Awaited<ReturnType<typeof contextFor>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  const shot = (p: Page, name: string, fullPage = true) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage })
  const style = (p: Page, selector: string, prop: string) => p.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop)
  /** What the demo looks like right now: is each late element in, and is anything still moving? */
  const demoState = (p: Page) => p.evaluate(() => {
    // (no named helper in here: the page cannot run the wrapper tsx puts around one)
    const o = ['demo-answer', 'demo-photo', 'estimate-total', 'demo-lead', 'demo-sent', 'demo-confirmed'].map((id) => Number(getComputedStyle(document.querySelector(`[data-testid=${id}]`)!).opacity))
    const stage = document.querySelector('[data-testid=hero-demo-stage]')!
    const moving = document.getAnimations().filter((an) => an.playState === 'running' && stage.contains((an.effect as KeyframeEffect | null)?.target ?? null)).length
    const cover = getComputedStyle(document.querySelector('[data-testid=demo-tape-cover]')!).transform
    return { answer: o[0]!, photo: o[1]!, total: o[2]!, lead: o[3]!, sent: o[4]!, confirmed: o[5]!, tapeCovered: !/^matrix\(0,/.test(cover), moving }
  })
  const done = (s: Awaited<ReturnType<typeof demoState>>) => s.answer === 1 && s.photo === 1 && s.total === 1 && s.lead === 1 && s.sent === 1 && s.confirmed === 1 && !s.tapeCovered && s.moving === 0

  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    // ==================================================================
    section(`2. The hero demo at ${width}`)
    // ==================================================================
    const ctx = await contextFor(null, { width, height })
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('pageerror', (e) => errors.push(String(e)))
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await p.goto(`${cfg.appUrl}/`, { waitUntil: 'domcontentloaded' })
    await p.locator('[data-testid=demo-sent]').waitFor({ state: 'attached', timeout: 30_000 })
    const early = await demoState(p)
    check(`${width}: at the start the price has not landed and nothing is sent yet`, early.total < 0.5 && early.lead < 0.5 && early.sent < 0.5 && early.tapeCovered && early.moving > 0, early)
    await p.waitForTimeout(3300)
    const middle = await demoState(p)
    check(`${width}: part-way, the customer has answered and added the photo, and the price is landing or has landed; nothing is sent yet`, middle.answer === 1 && middle.photo === 1 && middle.sent < 1, middle)
    await p.waitForTimeout(3700)
    const end = await demoState(p)
    check(`${width}: it ends on its last state: the price is in, the tape is drawn, Approve & send has turned to Sent, the quote is confirmed`, done(end), end)
    await p.waitForTimeout(2500)
    const later = await demoState(p)
    check(`${width}: it played once: later it is the same, and nothing is moving`, done(later) && JSON.stringify(later) === JSON.stringify(end), later)
    check(`${width}: the last frames read "Sent", "Your quote" and "Reviewed and confirmed"`, (await p.locator('[data-testid=demo-sent]').innerText()).includes('Sent') && (await p.locator('[data-testid=demo-confirmed]').innerText()).startsWith('Reviewed and confirmed by'))
    await shot(p, `home-${width}-demo-end`, false)

    await p.locator('[data-testid=demo-replay]').scrollIntoViewIfNeeded()
    await p.click('[data-testid=demo-replay]')
    await p.waitForTimeout(250)
    const again = await demoState(p)
    check(`${width}: "Play again" starts it once more`, again.total < 0.5 && again.sent < 0.5 && again.moving > 0, again)
    await p.waitForTimeout(7000)
    check(`${width}: …and it stops on the last state again`, done(await demoState(p)))

    // ==================================================================
    section(`3. Layout at ${width}`)
    // ==================================================================
    await p.evaluate(() => window.scrollTo(0, 0))
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`${width}: the home page does not scroll sideways`, sideways <= 1, sideways)
    const frames = await p.locator('[data-testid=demo-frame]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top + window.scrollY), width: Math.round(r.width) } }))
    const strip = await p.locator('[data-testid=hero] *').evaluateAll((els) => els.filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1).length)
    if (width < 500) {
      check(`${width}: the three frames stack, each the full width, with no sideways strip`, frames.length === 3 && frames[0]!.top < frames[1]!.top && frames[1]!.top < frames[2]!.top && frames.every((f) => f.left === frames[0]!.left && f.width >= width - 40) && strip === 0, { frames, strip })
    } else {
      check(`${width}: the three frames sit side by side at true size (each over 320 px wide)`, frames.length === 3 && frames[0]!.left < frames[1]!.left && frames[1]!.left < frames[2]!.left && frames.every((f) => f.width >= 320) && strip === 0, frames)
    }
    const sizes = await p.evaluate(() => ({
      field: parseFloat(getComputedStyle(document.querySelector('[data-testid=demo-answer]')!).fontSize),
      total: parseFloat(getComputedStyle(document.querySelector('[data-testid=estimate-total]')!).fontSize),
      smallest: Math.min(...[...document.querySelectorAll('[data-testid=hero-demo-frames] *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())).map((el) => parseFloat(getComputedStyle(el).fontSize))),
    }))
    check(`${width}: the screens are at true size (field text 15 px, the total 48 px, nothing under 11 px)`, sizes.field >= 15 && sizes.total >= 48 && sizes.smallest >= 11, sizes)

    // ==================================================================
    section(`4. Calls to action and sections at ${width}`)
    // ==================================================================
    const cta = { bg: await style(p, '[data-testid=hero-signup]', 'background-color'), text: await style(p, '[data-testid=hero-signup]', 'color'), edge: await style(p, '[data-testid=hero-signup]', 'border-top-color'), edgeWidth: await style(p, '[data-testid=hero-signup]', 'border-top-width') }
    check(`${width}: the main button is yellow with dark text and a thin dark edge`, hexOf(cta.bg) === YELLOW && hexOf(cta.text) === INK && hexOf(cta.edge) === INK && cta.edgeWidth === '1px' && contrast(cta.text, cta.bg) >= 4.5, { ...cta, ratio: contrast(cta.text, cta.bg) })
    // walk the page a third of a screen at a time: count the yellow buttons in view
    const perScreen = await p.evaluate(async (yellow) => {
      const counts: number[] = []
      const max = document.documentElement.scrollHeight - innerHeight
      for (let y = 0; y <= max + innerHeight / 3; y += innerHeight / 3) {
        window.scrollTo(0, Math.min(y, max))
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        counts.push([...document.querySelectorAll('a, button')].filter((el) => {
          const r = el.getBoundingClientRect()
          return ('#' + (getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()) === yellow && r.height > 0 && r.bottom > 0 && r.top < innerHeight
        }).length)
      }
      window.scrollTo(0, 0)
      return counts
    }, YELLOW)
    check(`${width}: one yellow call to action per screen, never two (the first screen has the hero’s, a later one the closing band’s)`, Math.max(...perScreen) === 1 && perScreen[0] === 1 && perScreen.slice(Math.floor(perScreen.length / 2)).includes(1), { screens: perScreen.length, max: Math.max(...perScreen) })
    const yellowTotal = await p.locator('a, button').evaluateAll((els, yellow) => els.filter((el) => { const m = getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []; return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() === yellow }).map((el) => (el as HTMLElement).innerText.trim()), YELLOW)
    check(`${width}: the yellow buttons are the hero's and the closing band's, both the free offer`, yellowTotal.length === 2 && yellowTotal.every((t) => t === 'Try it free: 10 quotes, no card'), yellowTotal)
    check(`${width}: the header button keeps its own style (juniper)`, hexOf(await style(p, '[data-testid=nav-signup]', 'background-color')) === '#205E56')
    check(`${width}: the header button reads "Try it free"; the hero button keeps the full offer`, (await p.locator('[data-testid=nav-signup]').innerText()).trim() === 'Try it free' && (await p.locator('[data-testid=hero-signup]').innerText()).trim() === 'Try it free: 10 quotes, no card')

    if (width >= 1000) {
      // the shape of each section: how many equal columns its widest row has, and what they hold
      const shapes = await p.evaluate(() => [...document.querySelectorAll('main > section')].map((sec) => {
        let best = { cols: 1, kind: 'text' }
        for (const el of sec.querySelectorAll('*')) {
          const kids = [...el.children].filter((k) => k.getBoundingClientRect().width > 120)
          if (kids.length < 2) continue
          const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top))
          const widths = kids.map((k) => Math.round(k.getBoundingClientRect().width))
          const sameRow = tops.every((t) => Math.abs(t - tops[0]!) < 4)
          const equal = widths.every((w) => Math.abs(w - widths[0]!) < 12)
          const wide = widths.reduce((s, w) => s + w, 0) > innerWidth * 0.55
          if (sameRow && wide && kids.length >= best.cols) {
            const boxed = kids.every((k) => { const cs = getComputedStyle(k); return cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none' || !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor) })
            best = { cols: kids.length, kind: `${equal ? 'equal' : 'unequal'}-${boxed ? 'boxes' : 'open'}` }
          }
        }
        return `${best.cols} ${best.kind}`
      }))
      const repeats = shapes.filter((s, i) => i > 0 && s === shapes[i - 1] && !s.startsWith('1 '))
      check(`${width}: no two neighbouring sections share a layout`, shapes.length >= 8 && repeats.length === 0, shapes)
      const boxRows = shapes.filter((s) => /^[34] equal-boxes$/.test(s)).length
      check(`${width}: at most one section is a row of equal boxes (it was five)`, boxRows <= 1, boxRows)
    }
    check(`${width}: each plan card has its own button`, (await p.locator('[data-testid=plan-card]').count()) === 3 && (await p.locator('[data-testid=plan-card] [data-testid=plan-button]').count()) === 3)
    const closing = await p.locator('[data-testid=closing] a').evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.trim(), boxed: getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' })))
    check(`${width}: the closing band has one button and one quiet link`, closing.length === 2 && closing.filter((c) => c.boxed).length === 1 && closing[1]!.text === 'Or try it as a customer first', closing)
    check(`${width}: "Set up in minutes" shows three steps, each with its screen; "How it works" is gone`, (await p.locator('[data-testid=setup-step]').count()) === 3 && (await p.locator('[data-testid^=setup-screen-]').count()) === 3 && !(await p.locator('main').innerText()).includes('How it works'))
    check(`${width}: "Add it anywhere" shows a QR code, the quote page on a phone and the form on a website`, (await p.locator('[data-testid=add-it] [data-testid=qr-svg]').count()) === 1 && (await p.locator('[data-testid=add-it-phone] [data-testid=request-form-screen]').count()) === 1 && (await p.locator('[data-testid=add-it-site] [data-testid=request-form-screen]').count()) === 1)
    const stats = await p.locator('[data-testid=statistics] figure').evaluateAll((els) => els.map((el) => ({ size: parseFloat(getComputedStyle(el.querySelector('p')!).fontSize), source: el.querySelector('a')?.getAttribute('href') ?? '' })))
    check(`${width}: three big figures, each with its source still linked`, stats.length === 3 && stats.every((s) => s.size >= 52 && s.source.startsWith('https://')), stats.map((s) => s.size))
    // T-167: the order of Home changed, and the trades row moved into step 1 of "Set up in minutes"
    const order = await p.locator('main > section').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? el.querySelector('h2')?.textContent ?? '').filter(Boolean))
    check(`${width}: the sections are in the T-167 order: hero, the figures, "What it notices", your prices, setup, add it anywhere, plans, questions, the closing band`, JSON.stringify(order) === JSON.stringify(['hero', 'homeowners', 'notices', 'control', 'setup', 'Add it anywhere', 'plans', 'Questions', 'closing']), order)
    const pills = await p.locator('[data-testid=setup-step]').first().locator('[data-testid=trades-row] a').allInnerTexts()
    check(`${width}: the trade links sit inside "Choose your trade", ending with "Other trades"; there is no trades row of its own`, (await p.locator('[data-testid=trades-row]').count()) === 1 && pills.length === 7 && pills[6]!.trim() === 'Other trades: describe your prices in plain English', pills.length)

    // the one moment: the price lines land when the section comes into view, and stay
    await p.locator('[data-testid=price-sentence]').scrollIntoViewIfNeeded()
    await p.waitForTimeout(2800)
    const lines = await p.locator('[data-testid=price-lines] li').evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), opacity: getComputedStyle(el).opacity })))
    const sentenceWords = (await p.locator('[data-testid=price-sentence-words]').innerText()).replace(/\s+/g, ' ').trim()
    check(`${width}: the price sentence is two prices and becomes two price lines, and they stay`, lines.length === 2 && lines.every((l) => l.opacity === '1') && lines[0]!.text.includes('$375.00') && lines[1]!.text.includes('$250.00') && sentenceWords.includes('$375 per room, heavy prep adds $250.'), lines)
    check(`${width}: the price sentence section says nothing about a minimum`, !/minimum/i.test(await p.locator('[data-testid=price-sentence]').innerText()))
    await shot(p, `home-${width}`)

    // the footer and the skip link
    const footLinks = await p.locator('footer a').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
    if (width < 500) check(`${width}: every footer link is 44 px tall`, footLinks.length === 13 && Math.min(...footLinks) >= 44, Math.min(...footLinks))
    // a fresh load, so Tab starts from the top of the page
    await p.goto(`${cfg.appUrl}/`, { waitUntil: 'domcontentloaded' })
    await p.locator('[data-testid=skip-link]').waitFor({ state: 'attached' })
    await p.keyboard.press('Tab')
    const first = await p.evaluate(() => ({ text: (document.activeElement as HTMLElement).innerText, visible: document.activeElement!.getBoundingClientRect().width > 40 }))
    await p.keyboard.press('Enter')
    await p.waitForTimeout(200)
    check(`${width}: the first Tab stop is "Skip to content", it shows when focused, and it lands after the header`, first.text === 'Skip to content' && first.visible && new URL(p.url()).hash === '#content', first)
    check(`${width}: no error in the console`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()

    // ---- reduced motion: the finished frames, still
    const calm = await contextFor(null, { width, height, reducedMotion: 'reduce' })
    const c = await calm.newPage()
    await c.goto(`${cfg.appUrl}/`, { waitUntil: 'domcontentloaded' })
    await c.locator('[data-testid=demo-sent]').waitFor({ state: 'attached', timeout: 30_000 })
    await c.waitForTimeout(400)
    const still = await demoState(c)
    check(`${width}, reduced motion: the finished frames show at once, with no movement`, done(still), still)
    await c.locator('[data-testid=price-sentence]').scrollIntoViewIfNeeded()
    await c.waitForTimeout(300)
    check(`${width}, reduced motion: the price lines are simply there`, (await c.locator('[data-testid=price-lines] li').evaluateAll((els) => els.every((el) => getComputedStyle(el).opacity === '1'))) && (await c.getAttribute('[data-testid=price-sentence]', 'data-moment')) === 'still')
    await shot(c, `home-${width}-reduced-motion`, false)
    await calm.close()

    // ==================================================================
    section(`5. Login and pricing at ${width}`)
    // ==================================================================
    const l = await (await contextFor(null, { width, height })).newPage()
    await l.goto(`${cfg.appUrl}/login`)
    await l.waitForLoadState('networkidle').catch(() => {})
    const doc = l.locator('[data-testid=login-document]')
    if (width >= 1024) {
      const box = await doc.boundingBox()
      const form = await l.locator('form').boundingBox()
      check(`${width}: login shows the estimate document beside the form`, (await doc.isVisible()) && box !== null && form !== null && box.x > form.x + form.width && (await doc.locator('[data-testid=estimate-total]').innerText()).includes('$'), box && { x: Math.round(box.x), width: Math.round(box.width) })
    } else {
      check(`${width}: on a phone login is the form alone`, !(await doc.isVisible()))
    }
    check(`${width}: the email field autofills (autocomplete="email")`, (await l.getAttribute('input[type=email]', 'autocomplete')) === 'email' && (await l.getAttribute('input[type=password]', 'autocomplete')) === 'current-password')
    check(`${width}: login does not scroll sideways`, (await l.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1)
    await shot(l, `login-${width}`)
    await l.goto(`${cfg.appUrl}/signup`)
    check(`${width}: sign-up keeps its single column (no document)`, (await l.locator('[data-testid=login-document]').count()) === 0)
    await l.goto(`${cfg.appUrl}/pricing`)
    await l.waitForLoadState('networkidle').catch(() => {})
    const pricingScreens = await l.evaluate(async (yellow) => {
      const counts: number[] = []
      const max = document.documentElement.scrollHeight - innerHeight
      for (let y = 0; y <= max + innerHeight / 3; y += innerHeight / 3) {
        window.scrollTo(0, Math.min(y, max))
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        counts.push([...document.querySelectorAll('a, button')].filter((el) => { const r = el.getBoundingClientRect(); return ('#' + (getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()) === yellow && r.bottom > 0 && r.top < innerHeight }).length)
      }
      return counts
    }, YELLOW)
    check(`${width}: pricing has one yellow call to action per screen, never two`, Math.max(...pricingScreens) === 1 && pricingScreens[0] === 1, Math.max(...pricingScreens))
    check(`${width}: pricing says nothing about a trial`, !/14[- ]day|trial/i.test(await l.locator('main').innerText()))
    await l.context().close()
  }

  // ====================================================================
  section('6. The dashboard: "needs you" is the strong yellow')
  // ====================================================================
  const signedIn = await contextFor(a)
  const d = await signedIn.newPage()
  await d.goto(`${cfg.appUrl}/app/quotes?tab=needs_you`)
  await d.locator('[data-testid=turn-label]').first().waitFor({ timeout: 20_000 })
  const pill = { bg: await style(d, '[data-testid=turn-label]', 'background-color'), text: await style(d, '[data-testid=turn-label]', 'color'), dot: await d.locator('[data-testid=turn-label] [data-testid=needs-you-dot]').count() }
  check('quotes list: "Needs your approval" is the strong yellow with dark text and the small marker, not a pale tint and not butter', hexOf(pill.bg) === YELLOW && hexOf(pill.text) === INK && pill.dot === 1 && hexOf(pill.bg) !== BUTTER && contrast(pill.text, pill.bg) >= 4.5, { bg: hexOf(pill.bg), ratio: contrast(pill.text, pill.bg), dot: pill.dot })
  await shot(d, 'dashboard-quotes')
  await d.goto(`${cfg.appUrl}/app`)
  await d.locator('[data-testid=stand-tile]').first().waitFor({ timeout: 20_000 })
  const count = { bg: await style(d, '[data-testid=stand-tile][data-group=needs_you] [data-testid=stand-mark]', 'background-color'), dot: await d.locator('[data-testid=stand-tile][data-group=needs_you] [data-testid=needs-you-dot]').count(), tile: await style(d, '[data-testid=stand-tile][data-group=needs_you]', 'background-color') }
  check('Home: the "Needs you" count sits on the strong yellow with the marker; the tile itself is white', hexOf(count.bg) === YELLOW && count.dot === 1 && hexOf(count.tile) === '#FFFFFF', { count: hexOf(count.bg), tile: hexOf(count.tile) })
  const homePill = await style(d, '[data-testid=waiting-for-you] [data-testid=turn-label]', 'background-color')
  check('Home: the "Waiting for you" row’s pill is the strong yellow too', hexOf(homePill) === YELLOW, hexOf(homePill))
  const dashButtons = await d.locator('main button, main a').evaluateAll((els, yellow) => els.filter((el) => { const m = getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []; return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() === yellow }).length, YELLOW)
  check('dashboard buttons did not change: none is yellow ("Approve & send" is juniper)', dashButtons === 0 && hexOf(await d.getByRole('button', { name: 'Approve & send' }).first().evaluate((el) => getComputedStyle(el).backgroundColor)) === '#205E56', dashButtons)
  check('the dashboard’s wordmark is the name in the display font', (await d.locator('[data-testid=wordmark]').first().innerText()) === 'Qolumns' && /Bricolage/i.test(await style(d, '[data-testid=wordmark]', 'font-family')))
  await shot(d, 'dashboard-home')
  await d.goto(`${cfg.appUrl}/app/settings/billing`)
  await d.waitForLoadState('networkidle').catch(() => {})
  await d.getByText('Pro', { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => {})
  const billingText = await d.locator('main').innerText()
  check('billing page: no trial is offered (no "14-day", no "trial"; Pro is "Select Plan")', !/14[- ]day|trial/i.test(billingText) && billingText.includes('Select Plan'), billingText.match(/[^.\n]*trial[^.\n]*/i)?.[0])
  await shot(d, 'dashboard-billing')
  await signedIn.close()

  // ====================================================================
  section('7 (browser). The minimum charge on the customer page, the dashboard and in the editor')
  // ====================================================================
  const NOTE = `Minimum charge of $${ROOM_MINIMUM}.00 applied`
  /** What a page shows about the price: its text, the note, and where the note sits */
  const priceOn = async (p: Page) => {
    const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
    const notes = await p.locator('[data-testid=minimum-note]').allInnerTexts()
    const noteTop = notes.length ? (await p.locator('[data-testid=minimum-note]').first().boundingBox())?.y ?? -1 : -1
    return { body, notes: notes.map((n) => n.trim()), noteTop }
  }
  const topOf = async (p: Page, text: string | RegExp) => (await p.getByText(text).first().boundingBox())?.y ?? -1
  const customerPage = async (id: string, token: string) => {
    const p = await (await contextFor(null)).newPage()
    await p.goto(`${cfg.appUrl}/q/${id}?token=${token}`, { waitUntil: 'networkidle' })
    await p.getByText('Price breakdown').first().waitFor({ timeout: 30_000 })
    return p
  }
  const staff = await contextFor(a)
  const dashPage = async (id: string) => {
    const p = await staff.newPage()
    await p.goto(`${cfg.appUrl}/app/quotes/${id}`, { waitUntil: 'networkidle' })
    await p.getByTestId('quote-tracker').waitFor({ timeout: 30_000 })
    return p
  }
  /** The checks every page that shows this quote must pass while its minimum applies */
  const showsTheNote = async (p: Page, where: string) => {
    const shown = await priceOn(p)
    const lineTop = await topOf(p, /^Rooms/)
    const totalTop = await topOf(p, /^Total$/)
    check(`${where}: the job’s real line ($375.00) is shown`, /Rooms/.test(shown.body) && shown.body.includes('$375.00'))
    check(`${where}: one note, "${NOTE}", below the lines and above the total`, shown.notes.length === 1 && shown.notes[0] === NOTE && shown.noteTop > lineTop && shown.noteTop < totalTop, { notes: shown.notes, lineTop, noteTop: shown.noteTop, totalTop })
    check(`${where}: the minimum is not a line (no "Minimum charge applied" row, no $25.00 amount) and the sentence appears once`, !shown.body.includes('Minimum charge applied') && !shown.body.includes('$25.00') && shown.body.split(NOTE).length === 2, shown.body.match(/.{0,40}\$25\.00.{0,20}/)?.[0])
    check(`${where}: the total is the minimum ($400.00)`, shown.body.includes('$400.00'))
  }

  const cSmall = await customerPage(small.id, small.token)
  await showsTheNote(cSmall, 'customer page, below the minimum')
  await shot(cSmall, 'minimum-customer-below')
  await cSmall.context().close()
  const dSmall = await dashPage(small.id)
  await showsTheNote(dSmall, 'dashboard quote page, below the minimum')
  await shot(dSmall, 'minimum-dashboard-below')
  await dSmall.goto(`${cfg.appUrl}/app/quotes/${small.id}/trace`, { waitUntil: 'networkidle' })
  await dSmall.getByText('Calculation Steps').waitFor({ timeout: 30_000 })
  const traceShown = await priceOn(dSmall)
  check('pricing trace: the minimum step and the summary read as the same sentence, not "Minimum Charge"', traceShown.notes[0] === NOTE && traceShown.body.split(NOTE).length === 3 && !traceShown.body.includes('Minimum charge applied'), traceShown.notes)
  await dSmall.close()

  // above the minimum: nothing about a minimum, anywhere
  expectOk('approve the door', await http('POST', `${cfg.appUrl}/api/quotes/${quote.id}/approve`, { headers: a.cookie }))
  const cDoor = await customerPage(quote.id, quote.token)
  const doorCustomer = await priceOn(cDoor)
  check('customer page, above the minimum: no note and the word "minimum" nowhere on the page', doorCustomer.notes.length === 0 && !/minimum/i.test(doorCustomer.body), doorCustomer.body.match(/.{0,40}minimum.{0,40}/i)?.[0])
  await cDoor.context().close()
  const dDoor = await dashPage(quote.id)
  const doorDash = await priceOn(dDoor)
  check('dashboard quote page, above the minimum: no note and the word "minimum" nowhere on the page', doorDash.notes.length === 0 && !/minimum/i.test(doorDash.body), doorDash.body.match(/.{0,40}minimum.{0,40}/i)?.[0])
  await dDoor.goto(`${cfg.appUrl}/app/quotes/${quote.id}/trace`, { waitUntil: 'networkidle' })
  await dDoor.getByText('Calculation Steps').waitFor({ timeout: 30_000 })
  check('pricing trace, above the minimum: nothing about a minimum', !/minimum/i.test(await dDoor.locator('main').innerText()))
  await dDoor.close()

  // a quote stored before this change: the top-up as an ordinary line, the sentence among the notes
  const legacy: Pricing = {
    ...smallPricing,
    breakdown: smallPricing.breakdown.map((line) => (line.kind === 'minimum' ? { label: 'Minimum charge applied', amount: line.amount } : line)),
    notes: [...(smallPricing.notes ?? []), NOTE],
  }
  expectOk('store the old shape', await patchRow('quotes', `id=eq.${small.id}`, { pricing_json: legacy }))
  const cOld = await customerPage(small.id, small.token)
  await showsTheNote(cOld, 'customer page, a quote stored the old way')
  await cOld.context().close()
  const dOld = await dashPage(small.id)
  await showsTheNote(dOld, 'dashboard quote page, a quote stored the old way')

  // the editor: the note follows the edits
  const editorState = async (p: Page) => ({
    lines: await p.locator('input[placeholder="Line item label"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
    note: (await p.locator('[data-testid=editor-minimum] [data-testid=minimum-note]').allInnerTexts())[0]?.trim() ?? null,
    linesTotal: (await p.locator('[data-testid=editor-lines-total]').allInnerTexts())[0] ?? null,
    adds: (await p.locator('[data-testid=editor-minimum-amount]').allInnerTexts())[0] ?? null,
    removed: await p.locator('[data-testid=editor-minimum-removed]').count(),
    subtotal: ((await p.locator('body').innerText()).replace(/\s+/g, ' ').match(/Subtotal \$([\d,.]+)/) ?? [])[1] ?? null,
  })
  const openEditor = async (p: Page) => {
    await p.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await p.getByText('Editing Quote').waitFor({ timeout: 30_000 })
  }
  const amount = (p: Page) => p.locator('input[type="number"]').first()
  const saveEditor = async (p: Page) => {
    await p.getByRole('button', { name: 'Save', exact: true }).first().click()
    await p.getByTestId('quote-tracker').waitFor({ timeout: 30_000 })
  }
  await openEditor(dOld)
  const e0 = await editorState(dOld)
  check('editor: the minimum is not an editable line; it is the note with its amount (lines $375.00, + $25.00, subtotal $400.00)', e0.lines.length === 1 && e0.lines[0]!.startsWith('Rooms') && e0.note === NOTE && e0.linesTotal === '$375.00' && e0.adds === '+ $25.00' && e0.subtotal === '400.00', e0)
  await amount(dOld).fill('390')
  const e1 = await editorState(dOld)
  check('editor: a line goes up but stays below the minimum: the lines read $390.00, the note adds $10.00, and the subtotal has not moved', e1.note === NOTE && e1.linesTotal === '$390.00' && e1.adds === '+ $10.00' && e1.subtotal === '400.00', e1)
  await amount(dOld).fill('450')
  const e2 = await editorState(dOld)
  check('editor: the lines pass the minimum: the note is gone and the subtotal follows the lines ($450.00)', e2.note === null && e2.adds === null && e2.subtotal === '450.00' && !/minimum/i.test(await dOld.locator('main').innerText()), e2)
  await amount(dOld).fill('380')
  const e3 = await editorState(dOld)
  check('editor: the lines drop below again: the note is back, adding $20.00, subtotal $400.00', e3.note === NOTE && e3.adds === '+ $20.00' && e3.subtotal === '400.00', e3)
  await shot(dOld, 'minimum-editor')
  await saveEditor(dOld)
  const saved1 = await pricingOf(small.id)
  check('editor, saved below the minimum: stored as the line ($380) plus the marked entry ($20, minimum $400); they add up to the subtotal', saved1.breakdown.length === 2 && saved1.breakdown[0]!.amount === 380 && saved1.breakdown[1]!.kind === 'minimum' && saved1.breakdown[1]!.amount === 20 && saved1.breakdown[1]!.minimumCharge === ROOM_MINIMUM && sumOf(saved1.breakdown) === 400 && saved1.subtotal === 400 && saved1.total === 400, saved1.breakdown)
  check('editor, saved: the old copy of the sentence is no longer among the notes', !(saved1.notes ?? []).some((note) => /minimum charge/i.test(note)), saved1.notes)

  // the business removes the minimum from this quote: it stays removed
  await openEditor(dOld)
  await dOld.locator('[data-testid=editor-minimum-remove]').click()
  const r1 = await editorState(dOld)
  check('editor: "Remove" takes the minimum off this quote: no note, and the subtotal is the lines ($380.00)', r1.note === null && r1.removed === 1 && r1.subtotal === '380.00', r1)
  await amount(dOld).fill('370')
  const r2 = await editorState(dOld)
  check('editor: editing a line afterwards does not bring the minimum back (subtotal $370.00)', r2.note === null && r2.removed === 1 && r2.subtotal === '370.00', r2)
  await saveEditor(dOld)
  const saved2 = await pricingOf(small.id)
  check('editor, saved after "Remove": only the line is stored, and the total is the line ($370)', saved2.breakdown.length === 1 && saved2.breakdown[0]!.amount === 370 && !saysMinimum(saved2.breakdown) && saved2.subtotal === 370 && saved2.total === 370, saved2.breakdown)
  await openEditor(dOld)
  await amount(dOld).fill('200')
  const r3 = await editorState(dOld)
  check('editor, opened again: the minimum is still removed, whatever the lines come to; nothing about a minimum is shown', r3.note === null && r3.removed === 0 && r3.subtotal === '200.00' && !/minimum/i.test(await dOld.locator('main').innerText()), r3)
  await dOld.close()
  const cWaived = await customerPage(small.id, small.token)
  const waived = await priceOn(cWaived)
  check('customer page after "Remove": no note, the word "minimum" nowhere, and the total is $370.00', waived.notes.length === 0 && !/minimum/i.test(waived.body) && waived.body.includes('$370.00'), waived.body.match(/.{0,40}minimum.{0,40}/i)?.[0])
  await cWaived.context().close()

  // a quote that never carried a minimum is not given one by the editor
  const dDoorEdit = await dashPage(quote.id)
  await openEditor(dDoorEdit)
  await amount(dDoorEdit).fill('50')
  const n1 = await editorState(dDoorEdit)
  check(`editor, a quote without a minimum: lowering a line below the business’s minimum ($${DOOR_MINIMUM}) adds nothing and shows nothing about one`, n1.note === null && n1.removed === 0 && !/minimum/i.test(await dDoorEdit.locator('main').innerText()), n1)
  await dDoorEdit.close()
  await staff.close()

  const design = await (await contextFor(null)).newPage()
  await design.goto(`${cfg.appUrl}/design`)
  await design.waitForLoadState('networkidle').catch(() => {})
  check('/design: the accent switch and the second wordmark are gone; the accent swatch is yellow', (await design.locator('[data-testid=accent-switch]').count()) === 0 && (await design.locator('[data-testid=section-wordmark] [data-testid=wordmark]').count()) === 2 && (await design.locator('[data-testid=swatch-accent] .figure').innerText()).toUpperCase() === YELLOW)
  await design.context().close()
  await browser.close()
}

// ====================================================================
const failed = checks.filter((c) => !c.pass)
saveJson(outDir, 'checks.json', { checks, notChecked, stalls })
if (stalls.length) console.log(`\nStalled and retried:\n${stalls.map((s) => `  • ${s}`).join('\n')}`)
if (notChecked.length) console.log(`\nNot checked here:\n${notChecked.map((s) => `  • ${s}`).join('\n')}`)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
