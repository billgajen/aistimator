// T-204, the "dashboard" section of verify-t204: Home and Quotes that update by themselves (17), the
// pricing trace that shows the quote as sent (18), the Branding preview (19), unfinished requests as
// one entry per person per service (21), Analytics (22), the final invoice question (23), more than
// one trade in setup (24) and the QR code as SVG (25). Local stack only; no model is asked (the
// worker runs with its AI stand-in), no email is sent. Some parts run in a browser.
//
// What it proves
//   17  the pulse needs a sign-in, is steady while nothing happens, moves when a request arrives,
//       when an estimate is approved, opened, accepted or declined, when someone starts and does
//       not finish, and never for another business's changes; in a browser, Home and the Quotes
//       list show a new request without a reload, and a typed search stays as it was
//   18  a line added with "Edit" is in the trace, marked, with the quote's own total; the service
//       has its name; the version reads "v1"; the first price is kept beside it
//   19  the preview is the business's own: its currency, its tax name and rate or none, a sample
//       from its own service, and no badge on the free start
//   21  the form takes an open request up again instead of saving a second row; rows saved before
//       collapse in the list and in every count; "Done" clears the whole entry
//   22  "Quote Outcomes by Service": a quote edited twice is one quote and one change, a declined
//       quote was sent, a test is in no figure; the four figures agree
//   23  a saved final invoice comes back on the next read; in a browser, an amount under half the
//       quote is asked about first and saved only on "Yes"
//   24  several trades are saved in the one column and validated; in a browser, setup offers each
//       picked trade's services under its name
//   25  "Download SVG" saves a vector that draws exactly the code the page shows, and ticks the
//       share step like the PNG
import { readFileSync } from 'node:fs'
import type { Harness, Row } from '../t201/harness.mts'
import { browserDeps } from '../browser.mjs'
import { listPacks } from '../../../apps/web/src/lib/vertical-packs/index'
import { qrMatrix, svgToMatrix } from '../../../apps/web/src/lib/qr'
import { FINAL_INVOICE_ASK } from '../../../packages/shared/src/accuracy'
import { PULSE_INTERVAL_MS } from '../../../apps/web/src/lib/dashboard-pulse'

type Biz = Awaited<ReturnType<Harness['business']>>

export async function run(h: Harness): Promise<void> {
  const { app, http, expectOk, check, section, rows, patch, sb } = h
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const pulse = async (b: Biz) => expectOk('pulse', await http('GET', `${app}/api/quotes/pulse`, { headers: b.cookie })) as { stamp: string; newUnfinished: number }
  const detail = async (b: Biz, id: string, query = '') => expectOk('quote detail', await http('GET', `${app}/api/quotes/${id}${query}`, { headers: b.cookie })) as { quote: Row; service: Row | null; firstPricing?: Row | null }
  const priced = (row: Row) => ['pending_review', 'sent'].includes(String(row.status))
  const cookiesFor = (b: Biz) =>
    b.cookie.Cookie.split('; ').map((pair: string) => {
      const at = pair.indexOf('=')
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: new URL(app).origin }
    })
  /** A request that is priced and approved: the customer has it */
  const sentQuote = async (b: Biz, key: string, serviceId: string, who: string) => {
    const q = await h.submit(key, serviceId, who)
    await h.waitForQuote(q.id, priced)
    const row = (await rows('quotes', `id=eq.${q.id}&select=status`))[0] ?? {}
    if (row.status === 'pending_review') expectOk('approve', await http('POST', `${app}/api/quotes/${q.id}/approve`, { headers: b.cookie }))
    return q
  }
  const lead = (key: string, serviceId: string, customer: { name: string; email?: string; phone?: string }) =>
    http('POST', `${app}/api/public/leads`, { body: { tenantKey: key, serviceId, customer, source: { type: 'widget' } } })

  // ---------------------------------------------------------------------------
  section('Dashboard 17. Home and Quotes update by themselves: the pulse')
  const biz = await h.business('pulse')
  const rival = await h.business('pulserival')
  const serviceId = await h.paintService(biz)
  const key = await h.siteKey(biz)
  await h.paintService(rival)

  check('asking "has anything changed?" needs a sign-in', (await http('GET', `${app}/api/quotes/pulse`)).status === 401)
  const quiet1 = await pulse(biz)
  const quiet2 = await pulse(biz)
  check('nothing happened: the stamp is the same, and it is a short stamp, not data', quiet1.stamp === quiet2.stamp && /^[0-9a-f]{8}$/.test(quiet1.stamp) && Object.keys(quiet1).sort().join() === 'newUnfinished,stamp', quiet1)
  const rivalBefore = await pulse(rival)

  const first = await h.submit(key, serviceId, 'Derek Hale')
  const arrived = await pulse(biz)
  check('a request arriving moves it', arrived.stamp !== quiet1.stamp, [quiet1.stamp, arrived.stamp])
  // Here a request is priced within a moment of being sent, so "arrived" may already be "priced":
  // what is held is that the stamp, once the request is priced, is not the one from before it came,
  // and that it then stays put.
  await h.waitForQuote(first.id, priced)
  const afterPriced = await pulse(biz)
  check('…and once it is priced the stamp has moved and then holds still', afterPriced.stamp !== quiet1.stamp && (await pulse(biz)).stamp === afterPriced.stamp, [quiet1.stamp, arrived.stamp, afterPriced.stamp])
  if (((await rows('quotes', `id=eq.${first.id}&select=status`))[0] ?? {}).status === 'pending_review') {
    expectOk('approve', await http('POST', `${app}/api/quotes/${first.id}/approve`, { headers: biz.cookie }))
  }
  const afterSent = await pulse(biz)
  check('approving and sending it moves it', afterSent.stamp !== afterPriced.stamp)
  const viewed = await http('GET', `${app}/api/public/quotes/${first.id}?token=${encodeURIComponent(first.token)}`)
  const afterViewed = await pulse(biz)
  check('the customer opening the estimate moves it', viewed.ok && afterViewed.stamp !== afterSent.stamp, [viewed.status, (await rows('quotes', `id=eq.${first.id}&select=status,viewed_at`))[0]])
  const accepted = await http('POST', `${app}/api/public/quotes/${first.id}/accept`, { body: { token: first.token, details: { timing: 'asap', timingNote: '', address: '12 Oak Lane, Ballwin, MO 63021', phone: '(555) 204-1212' } } })
  const afterAccepted = await pulse(biz)
  check('the customer accepting moves it', accepted.ok && afterAccepted.stamp !== afterViewed.stamp, [accepted.status, accepted.json])

  const second = await sentQuote(biz, key, serviceId, 'Megan Ortiz')
  const beforeDecline = await pulse(biz)
  const declined = await http('POST', `${app}/api/public/quotes/${second.id}/decline`, { body: { token: second.token } })
  const afterDeclined = await pulse(biz)
  check('the customer declining moves it', declined.ok && afterDeclined.stamp !== beforeDecline.stamp, [declined.status, declined.json])

  const started = await lead(key, serviceId, { name: 'Nadia Rahman', email: 'nadia.rahman@example.com' })
  const afterLead = await pulse(biz)
  check('someone starting a request and not finishing moves it, and the menu badge’s number comes with it', started.ok && afterLead.stamp !== afterDeclined.stamp && afterLead.newUnfinished === 1, [started.status, afterLead])
  check('none of that moved another business’s stamp', (await pulse(rival)).stamp === rivalBefore.stamp)

  // in a browser: no reload, no click
  {
    const browser = await browserDeps().chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
      await ctx.addCookies(cookiesFor(biz))
      const home = await ctx.newPage()
      await home.goto(`${app}/app`, { waitUntil: 'networkidle' })
      // Home's first "has anything changed?" is answered before the second tab takes its place in front
      await home.waitForResponse((r: { url(): string; ok(): boolean }) => r.url().endsWith('/api/quotes/pulse') && r.ok(), { timeout: 30_000 }).catch(() => undefined)
      const list = await ctx.newPage()
      await list.goto(`${app}/app/quotes?tab=all`, { waitUntil: 'networkidle' })
      await list.locator('[data-testid=quote-row]').first().waitFor({ timeout: 60_000 })
      const search = list.getByLabel('Search quotes by customer name or email')
      await search.fill('Okafor')
      await list.waitForFunction(() => document.querySelectorAll('[data-testid=quote-row]').length === 0, undefined, { timeout: 30_000 }).catch(() => undefined)
      const rowsBefore = await list.locator('[data-testid=quote-row]').count()
      const homeBefore = await home.locator('body').innerText()
      // "No reload" is told by a mark left on each page: a page that is loaded again loses it. (Counting
      // navigations is wrong here: a change of the address by the page itself, such as the search
      // being put into it, is a navigation too, and nothing is loaded again.)
      for (const p of [home, list]) await p.evaluate(() => { (window as unknown as { __t204Kept?: boolean }).__t204Kept = true })
      const kept = (p: typeof home) => p.evaluate(() => (window as unknown as { __t204Kept?: boolean }).__t204Kept === true)

      const third = await h.submit(key, serviceId, 'Chidi Okafor')
      await h.waitForQuote(third.id, priced)
      const within = PULSE_INTERVAL_MS * 4 + 10_000
      await home.bringToFront()
      const onHome = await home.waitForFunction(() => document.body.innerText.includes('Chidi Okafor'), undefined, { timeout: within }).then(() => true, () => false)
      check('Home shows the new request by itself, within a few seconds, with no reload', onHome && !homeBefore.includes('Chidi Okafor') && (await kept(home)), { onHome, kept: await kept(home) })
      await list.bringToFront()
      const onList = await list.locator('[data-testid=quote-row]', { hasText: 'Chidi Okafor' }).first().waitFor({ timeout: within }).then(() => true, () => false)
      check('the Quotes list shows it by itself too, and the typed search is still in the box', onList && rowsBefore === 0 && (await search.inputValue()) === 'Okafor' && (await kept(list)), { onList, rowsBefore, value: await search.inputValue(), kept: await kept(list) })
    } finally {
      await browser.close()
    }
  }

  // ---------------------------------------------------------------------------
  section('Dashboard 18. The pricing trace shows the quote as sent')
  const traced = await sentQuote(biz, key, serviceId, 'Megan Castillo')
  const before = await detail(biz, traced.id, '?trace=1')
  const firstTotal = Number((before.quote.pricing_json as Row).total)
  check('a quote never edited has no "first price" of its own, and the service comes with its name', before.firstPricing === null && before.service?.name === 'Exterior wall painting', [before.firstPricing, before.service?.name])
  const pricing = before.quote.pricing_json as { breakdown: Row[] }
  const saved = await http('PATCH', `${app}/api/quotes/${traced.id}`, {
    headers: biz.cookie,
    body: { version: before.quote.version, pricing_json: { ...pricing, breakdown: [...pricing.breakdown, { label: 'Scaffold tower hire', amount: 185 }] }, content_json: { scopeSummary: (before.quote.content_json as Row).scopeSummary }, sendToCustomer: false },
  })
  const after = await detail(biz, traced.id, '?trace=1')
  const newTotal = Number((after.quote.pricing_json as Row).total)
  check('after "Edit" adds a $185 line: the quote’s total is the new one, and the first price is kept beside it', saved.ok && Math.abs(newTotal - (firstTotal + 185)) < 0.01 && Number((after.firstPricing as Row | null)?.total) === firstTotal, [saved.status, saved.json?.error, firstTotal, newTotal, (after.firstPricing as Row | null)?.total])
  check('the page’s ordinary read does not carry the first price (only the trace asks for it)', !('firstPricing' in (await detail(biz, traced.id))))
  check('another business cannot read it', (await http('GET', `${app}/api/quotes/${traced.id}?trace=1`, { headers: rival.cookie })).status === 404)
  {
    const browser = await browserDeps().chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
      await ctx.addCookies(cookiesFor(biz))
      const p = await ctx.newPage()
      await p.goto(`${app}/app/quotes/${traced.id}/trace`, { waitUntil: 'networkidle' })
      await p.locator('[data-testid=trace-as-sent]').waitFor({ timeout: 60_000 })
      const text = await p.locator('main').innerText()
      const added = p.locator('[data-testid=trace-sent-line][data-mark=added]')
      check('the trace lists the added line, marked "Added by you"', (await added.count()) === 1 && (await added.innerText()).includes('Scaffold tower hire') && (await added.innerText()).includes('Added by you') && (await added.innerText()).includes('185'), await added.allInnerTexts())
      const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      check('its total is the quote’s own, and the first price is named as the first price', (await p.locator('[data-testid=trace-sent-total]').innerText()).includes(money(newTotal)) && (await p.locator('[data-testid=trace-edited-note]').innerText()).includes(money(firstTotal)) && text.includes('First price:'), [await p.locator('[data-testid=trace-sent-total]').innerText(), money(newTotal)])
      check('it names the service, and says "Config v1" once', (await p.locator('[data-testid=trace-service]').innerText()) === 'Exterior wall painting' && !text.includes('Unknown Service') && !/vv\d/.test(text) && /Config v1\b/.test(await p.locator('[data-testid=trace-calculated]').innerText()), [await p.locator('[data-testid=trace-service]').innerText(), await p.locator('[data-testid=trace-calculated]').innerText()])
    } finally {
      await browser.close()
    }
  }

  // ---------------------------------------------------------------------------
  section('Dashboard 19. The Branding preview is the business’s own look')
  const branding = async (b: Biz) => (expectOk('branding', await http('GET', `${app}/api/tenant/branding`, { headers: b.cookie })) as { preview: { currency: string; tax: { enabled: boolean; label: string; ratePercent: number }; badgeShown: boolean; badgeLine: string; sample: { own: boolean; serviceName: string; lines: Array<{ label: string; amount: number }> } } }).preview
  const plain = await branding(biz)
  check('its own currency, no tax line while it charges none, and a sample from its own service', plain.currency === 'USD' && plain.tax.enabled === false && plain.sample.own === true && plain.sample.serviceName === 'Exterior wall painting' && plain.sample.lines.some((l) => l.label.startsWith('Exterior walls') && l.amount === 18), plain)
  check('on the free start its estimates carry no badge, so the preview shows none and says why', plain.badgeShown === false && plain.badgeLine.startsWith('While you have free quotes left'), plain.badgeLine)
  expectOk('tax on', await http('PUT', `${app}/api/tenant`, { headers: biz.cookie, body: { taxEnabled: true, taxRate: 0.0825, taxLabel: 'Sales tax' } }))
  const taxed = await branding(biz)
  check('with tax switched on: its own name and rate (8.25%), not a fixed one', taxed.tax.enabled && taxed.tax.label === 'Sales tax' && taxed.tax.ratePercent === 8.25, taxed.tax)
  const bare = await h.business('nopreview', { region: 'GB', currency: 'GBP' })
  const empty = await branding(bare)
  check('a business with no service yet gets a neutral sketch in its own currency: no trade, no tax of ours', empty.sample.own === false && empty.currency === 'GBP' && empty.tax.enabled === false && !/kitchen/i.test(JSON.stringify(empty.sample)), empty)
  {
    const browser = await browserDeps().chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
      await ctx.addCookies(cookiesFor(biz))
      const p = await ctx.newPage()
      await p.goto(`${app}/app/settings/branding`, { waitUntil: 'networkidle' })
      const preview = p.locator('[data-testid=branding-preview]')
      await preview.waitFor({ timeout: 60_000 })
      const text = await preview.innerText()
      check('the preview on the page: its service, its tax line, dollars, and no fixed kitchen or "VAT (20%)"', text.includes('Exterior wall painting') && (await p.locator('[data-testid=branding-preview-tax]').innerText()).includes('Sales tax (8.25%)') && text.includes('$') && !/kitchen|VAT|John Smith/i.test(text), text.slice(0, 400))
      check('…and no "Prepared with" badge while the free start hides it', (await p.locator('[data-testid=branding-preview-badge]').count()) === 0 && (await p.locator('[data-testid=badge-plans-line]').innerText()).startsWith('While you have free quotes left'))
    } finally {
      await browser.close()
    }
  }
  expectOk('tax off', await http('PUT', `${app}/api/tenant`, { headers: biz.cookie, body: { taxEnabled: false, taxRate: 0 } }))

  // ---------------------------------------------------------------------------
  section('Dashboard 21. Unfinished requests: one entry per person per service')
  const shop = await h.business('leads')
  const shopService = await h.paintService(shop)
  const shopKey = await h.siteKey(shop)
  const leadRows = async () => rows('request_leads', `tenant_id=eq.${shop.tenantId}&select=id,service_id,customer_email,customer_phone,progress,job_answers,handled_at,seen_at,created_at&order=created_at.asc`)
  const listed = async () => (expectOk('leads', await http('GET', `${app}/api/leads?days=30`, { headers: shop.cookie })) as { items: Array<{ leadId: string; progress: string; answerCount: number; customerName: string; isNew: boolean }> }).items
  const newCount = async () => Number((expectOk('new count', await http('GET', `${app}/api/leads/new-count`, { headers: shop.cookie })) as { count: number }).count)
  const tabCount = async () => Number((expectOk('quotes', await http('GET', `${app}/api/quotes?group=all&limit=1`, { headers: shop.cookie })) as { counts: { unfinished: number } }).counts.unfinished)

  const try1 = expectOk('first try', await lead(shopKey, shopService, { name: 'Derek Hale', email: 'derek.hale@example.com', phone: '(555) 204-0100' })) as { leadId: string; leadToken: string }
  const moved = await http('PATCH', `${app}/api/public/leads/${try1.leadId}`, { body: { tenantKey: shopKey, leadToken: try1.leadToken, progress: 'photos', answers: [{ fieldId: 'wall_area', value: 40 }, { fieldId: 'trim_length', value: 20 }] } })
  const try2 = expectOk('second try', await lead(shopKey, shopService, { name: 'Derek Hale', email: 'derek.hale@example.com' })) as { leadId: string; leadToken: string }
  check('the same person starting again (a reload) is taken up on the same row, with a fresh token', moved.ok && try2.leadId === try1.leadId && try2.leadToken !== try1.leadToken && (await leadRows()).length === 1, [try1.leadId, try2.leadId, (await leadRows()).length])
  const oldToken = await http('PATCH', `${app}/api/public/leads/${try1.leadId}`, { body: { tenantKey: shopKey, leadToken: try1.leadToken, progress: 'details' } })
  const early = await http('PATCH', `${app}/api/public/leads/${try2.leadId}`, { body: { tenantKey: shopKey, leadToken: try2.leadToken, progress: 'contact', answers: [] } })
  const kept = (await leadRows())[0] ?? {}
  check('the furthest step is kept: the new try’s first step does not wipe the answers saved at "photos", and the old token no longer writes', oldToken.status === 404 && early.ok && kept.progress === 'photos' && Array.isArray(kept.job_answers) && (kept.job_answers as unknown[]).length === 2, [oldToken.status, early.status, kept])
  // (an email is required by default, so the third try gives another email with the same phone number, typed another way)
  const byPhone = expectOk('third try', await lead(shopKey, shopService, { name: 'D. Hale', email: 'd.hale@work.example.com', phone: '+1 555-204-0100' })) as { leadId: string }
  check('the same phone number is the same person too, however it is typed', byPhone.leadId === try1.leadId && (await leadRows()).length === 1, byPhone)

  // rows saved before T-204 (a duplicate from a second device): written by hand, as they would be found
  const earlier = new Date(Date.now() - 3 * 3_600_000).toISOString()
  await sb.insert('request_leads', { tenant_id: shop.tenantId, service_id: shopService, customer_name: 'Derek Hale', customer_email: 'D.HALE@work.example.com', progress: 'contact', lead_token_hash: `old-${h.shortId()}`, created_at: earlier, updated_at: earlier })
  await sb.insert('request_leads', { tenant_id: shop.tenantId, service_id: shopService, customer_name: 'Derek H', customer_phone: '555-204-0100', progress: 'questions', lead_token_hash: `old-${h.shortId()}`, created_at: earlier, updated_at: earlier })
  const other = expectOk('another person', await lead(shopKey, shopService, { name: 'Megan Ortiz', email: 'megan.ortiz@example.com' })) as { leadId: string }
  const items = await listed()
  check('three rows for one person and one service are ONE entry, showing the try that got furthest; another person is their own', (await leadRows()).length === 4 && items.length === 2 && items.find((i) => i.leadId === try1.leadId)?.progress === 'photos' && items.some((i) => i.leadId === other.leadId), [(await leadRows()).length, items])
  // reading the list in a browser marks them seen; before that every count says two
  check('the menu badge, Home’s banner and the tab count all say 2, not 4', (await newCount()) === 2 && (await tabCount()) === 2 && (await pulse(shop)).newUnfinished === 2 && /data-testid="unfinished-count"/.test(await (await fetch(`${app}/app`, { headers: shop.cookie })).text()), [await newCount(), await tabCount()])
  const doneIt = await http('POST', `${app}/api/leads/${try1.leadId}/done`, { headers: shop.cookie })
  const afterDone = await leadRows()
  check('"Done" clears every row of that entry, so an earlier try cannot take its place', doneIt.ok && afterDone.filter((r) => r.handled_at).length === 3 && (await listed()).length === 1 && (await newCount()) === 1, [doneIt.status, afterDone.map((r) => Boolean(r.handled_at)), await newCount()])
  const again = expectOk('after done', await lead(shopKey, shopService, { name: 'Derek Hale', email: 'derek.hale@example.com' })) as { leadId: string }
  check('a person the business marked done who comes back is a new entry', again.leadId !== try1.leadId && (await listed()).length === 2, again)
  const secondService = (expectOk('second service', await http('POST', `${app}/api/services`, { headers: shop.cookie, body: { name: 'Fence staining', description: 'Staining of a wooden fence.', scopeIncludes: [], scopeExcludes: [], defaultAssumptions: [], mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: null }, workSteps: [{ id: 'stain', name: 'Staining', description: 'Stain the fence', costType: 'fixed', defaultCost: 300, optional: false }], expectedSignals: [], pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [{ id: 'stain', name: 'Staining', description: 'Stain the fence', costType: 'fixed', defaultCost: 300, optional: false }] } } })) as { service: { id: string } }).service.id
  const otherService = expectOk('other service', await lead(shopKey, secondService, { name: 'Megan Ortiz', email: 'megan.ortiz@example.com' })) as { leadId: string }
  check('the same person asking about another service is another entry', otherService.leadId !== other.leadId && (await listed()).length === 3, otherService)

  // ---------------------------------------------------------------------------
  section('Dashboard 22. Analytics: a revised quote is one quote, and a test is in no figure')
  const stats = await h.business('outcomes')
  const statsService = await h.paintService(stats)
  const statsKey = await h.siteKey(stats)
  const outcome = async () => ((expectOk('calibration', await http('GET', `${app}/api/learning/calibration`, { headers: stats.cookie })) as { services: Array<{ serviceId: string; quotesSent: number; accepted: number; amendedCount: number }> }).services.find((s) => s.serviceId === statsService) ?? { quotesSent: -1, accepted: -1, amendedCount: -1 })
  const figures = async () => (expectOk('analytics', await http('GET', `${app}/api/analytics`, { headers: stats.cookie })) as { metrics?: { quotesSent: number; quotesAccepted: number; totalQuotes: number }; quotesSent?: number })
  const revised = await sentQuote(stats, statsKey, statsService, 'Megan Castillo')
  for (const extra of [185, 60]) {
    const now = await detail(stats, revised.id)
    const p = now.quote.pricing_json as { breakdown: Row[] }
    expectOk('edit', await http('PATCH', `${app}/api/quotes/${revised.id}`, { headers: stats.cookie, body: { version: now.quote.version, pricing_json: { ...p, breakdown: [...p.breakdown, { label: `Extra ${extra}`, amount: extra }] }, content_json: { scopeSummary: (now.quote.content_json as Row).scopeSummary }, sendToCustomer: true } }))
  }
  const revisedRow = (await rows('quotes', `id=eq.${revised.id}&select=status,version`))[0] ?? {}
  const once = await outcome()
  check('a quote revised twice is still one quote sent, and one change', revisedRow.status === 'revised' && once.quotesSent === 1 && once.amendedCount === 1, [revisedRow, once])
  const lost = await sentQuote(stats, statsKey, statsService, 'Derek Hale')
  expectOk('decline', await http('POST', `${app}/api/public/quotes/${lost.id}/decline`, { body: { token: lost.token } }))
  const testQuote = await sentQuote(stats, statsKey, statsService, 'Owner Test')
  expectOk('mark test', await patch('quotes', `id=eq.${testQuote.id}`, { is_test: true, status: 'accepted', accepted_at: new Date().toISOString() }))
  const final = await outcome()
  const four = await figures()
  const metrics = (four.metrics ?? four) as { quotesSent?: number; quotesAccepted?: number }
  check('a declined quote was sent, and a test is counted nowhere: 2 sent, 0 accepted', final.quotesSent === 2 && final.accepted === 0, final)
  check('the four figures above it count the same quotes the same way', metrics.quotesSent === final.quotesSent && metrics.quotesAccepted === final.accepted, [metrics, final])

  // ---------------------------------------------------------------------------
  section('Dashboard 23. The final invoice: kept on reload, and asked about when far from the quote')
  const invoiced = await sentQuote(biz, key, serviceId, 'Nadia Rahman')
  const quoted = Number(((await detail(biz, invoiced.id)).quote.pricing_json as Row).total)
  const put = await http('PUT', `${app}/api/quotes/${invoiced.id}/final-invoice`, { headers: biz.cookie, body: { amount: quoted, note: 'As quoted' } })
  const reread = (await detail(biz, invoiced.id)).quote
  check('a saved final invoice comes back when the quote is read again (it used to be left out)', put.ok && Number(reread.final_invoice_amount) === quoted && reread.final_invoice_note === 'As quoted' && Boolean(reread.final_invoice_recorded_at), [put.status, reread.final_invoice_amount, reread.final_invoice_note])
  expectOk('clear', await http('PUT', `${app}/api/quotes/${invoiced.id}/final-invoice`, { headers: biz.cookie, body: { amount: null } }))
  {
    const browser = await browserDeps().chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
      await ctx.addCookies(cookiesFor(biz))
      const p = await ctx.newPage()
      await p.goto(`${app}/app/quotes/${invoiced.id}`, { waitUntil: 'networkidle' })
      const card = p.locator('[data-testid=final-invoice]')
      await card.waitFor({ timeout: 60_000 })
      const stored = async () => ((await rows('quotes', `id=eq.${invoiced.id}&select=final_invoice_amount`))[0] ?? {}).final_invoice_amount
      const low = Math.floor(quoted / 4)
      await card.getByPlaceholder('0.00').fill(String(low))
      await card.getByRole('button', { name: 'Save', exact: true }).click()
      const ask = p.locator('[data-testid=final-invoice-ask]')
      await ask.waitFor({ timeout: 15_000 })
      check('an amount under half the quote is asked about first, in the ticket’s words, and nothing is saved yet', (await ask.innerText()).includes(FINAL_INVOICE_ASK) && (await ask.innerText()).includes('less than half') && (await stored()) === null, [await ask.innerText(), await stored()])
      await p.locator('[data-testid=final-invoice-change]').click()
      check('"Change the amount" puts the question away and still saves nothing', (await ask.count()) === 0 && (await stored()) === null)
      await card.getByRole('button', { name: 'Save', exact: true }).click()
      await ask.waitFor({ timeout: 15_000 })
      await p.locator('[data-testid=final-invoice-yes]').click()
      await p.waitForFunction(() => !document.querySelector('[data-testid=final-invoice-ask]'), undefined, { timeout: 15_000 })
      await card.getByText('against a quote of').waitFor({ timeout: 15_000 })
      check('"Yes, save it" saves that amount', Number(await stored()) === low, await stored())
      await card.getByPlaceholder('0.00').fill(String(quoted))
      await card.getByRole('button', { name: 'Update', exact: true }).click()
      await p.waitForTimeout(1500)
      check('an amount near the quote is saved at once, with no question', (await ask.count()) === 0 && Number(await stored()) === quoted, await stored())
      await p.reload({ waitUntil: 'networkidle' })
      check('after a reload the card still shows what was saved', (await p.locator('[data-testid=final-invoice]').getByPlaceholder('0.00').inputValue()) === String(quoted))
    } finally {
      await browser.close()
    }
  }

  // ---------------------------------------------------------------------------
  section('Dashboard 24. Setup takes more than one trade')
  const packs = listPacks('US').filter((p) => p.region === 'US')
  const [packA, packB] = [packs[0]!, packs[1]!]
  const setup = await h.business('trades')
  const tradeOf = async () => ((await rows('tenants', `id=eq.${setup.tenantId}&select=trade,trade_other`))[0] ?? {}) as { trade?: string | null; trade_other?: string | null }
  const putTrade = (body: Row) => http('PUT', `${app}/api/tenant`, { headers: setup.cookie, body })
  const two = await putTrade({ trades: [packA.id, packB.id] })
  check('two trades are saved in the one column, in the order picked', two.ok && (await tradeOf()).trade === `${packA.id},${packB.id}`, [two.status, await tradeOf()])
  const bad = [await putTrade({ trades: [packA.id, 'no-such-trade'] }), await putTrade({ trades: [packA.id, 'other'] }), await putTrade({ trades: packs.slice(0, 5).map((p) => p.id) })]
  check('an unknown trade, a trade with "Something else", and more than four are refused, and nothing changes', bad.every((r) => r.status === 400) && (await tradeOf()).trade === `${packA.id},${packB.id}`, bad.map((r) => [r.status, r.json?.error?.message]))
  const one = await putTrade({ trade: packB.id })
  check('one trade is saved as it always was', one.ok && (await tradeOf()).trade === packB.id, await tradeOf())
  const own = await putTrade({ trades: ['other'], tradeOther: 'Chimney sweeping' })
  check('"Something else" stands alone, with the business’s own words', own.ok && (await tradeOf()).trade === 'other' && (await tradeOf()).trade_other === 'Chimney sweeping', await tradeOf())
  {
    const fresh = await h.business('twotrades')
    const browser = await browserDeps().chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
      await ctx.addCookies(cookiesFor(fresh))
      const p = await ctx.newPage()
      await p.goto(`${app}/app/onboarding`, { waitUntil: 'networkidle' })
      await p.getByRole('checkbox', { name: new RegExp(`^${packA.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click()
      await p.getByRole('checkbox', { name: new RegExp(`^${packB.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click()
      const ticked = await p.locator('[data-testid=trade-option][aria-checked=true]').count()
      await p.getByRole('button', { name: 'Continue' }).click()
      await p.getByText("Here's what we found").first().waitFor({ timeout: 30_000 })
      const text = await p.locator('main').innerText()
      const headings = await p.locator('[data-testid=setup-trade-heading]').allInnerTexts()
      check('two trades can be ticked, and "Here’s what we found" offers the services of each, under its name', ticked === 2 && headings.join('|') === `${packA.name}|${packB.name}` && [...packA.services, ...packB.services].every((s) => text.includes(s.name)), { ticked, headings })
      check('…and both are saved for the business', ((await rows('tenants', `id=eq.${fresh.tenantId}&select=trade`))[0] ?? {}).trade === `${packA.id},${packB.id}`)
    } finally {
      await browser.close()
    }
  }

  // ---------------------------------------------------------------------------
  section('Dashboard 25. The QR code as SVG')
  {
    const printer = await h.business('vector')
    await h.paintService(printer)
    const tenantRow = async () => (await rows('tenants', `id=eq.${printer.tenantId}&select=slug,quote_link_copied_at`))[0] ?? {}
    const browser = await browserDeps().chromium.launch()
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
      await ctx.addCookies(cookiesFor(printer))
      const p = await ctx.newPage()
      await p.goto(`${app}/app/quote-link`, { waitUntil: 'networkidle' })
      const png = p.locator('[data-testid=qr-download]')
      const svgButton = p.locator('[data-testid=qr-download-svg]')
      await svgButton.waitFor({ timeout: 60_000 })
      check('"Download SVG" sits beside "Download PNG", and looking at them ticks nothing', (await png.innerText()) === 'Download PNG' && (await svgButton.innerText()) === 'Download SVG' && !(await tenantRow()).quote_link_copied_at)
      const [download, told] = await Promise.all([
        p.waitForEvent('download', { timeout: 30_000 }),
        p.waitForResponse((r: { url(): string; request(): { method(): string } }) => r.url().endsWith('/api/tenant/share-event') && r.request().method() === 'POST', { timeout: 30_000 }),
        svgButton.click(),
      ])
      const file = readFileSync(await download.path(), 'utf8')
      const label = (await p.locator('canvas[role=img]').getAttribute('aria-label')) ?? ''
      const link = label.replace(/^QR code for /, '')
      check('it saves a vector file named like the picture, and tells the server "qr"', download.suggestedFilename().endsWith('-quote-qr.svg') && file.startsWith('<?xml') && file.includes('<svg xmlns="http://www.w3.org/2000/svg"') && told.ok() && told.request().postData() === JSON.stringify({ event: 'qr' }), [download.suggestedFilename(), file.slice(0, 80), told.status()])
      check('the vector draws exactly the code for the business’s own link', link.includes(String((await tenantRow()).slug)) && JSON.stringify(svgToMatrix(file)) === JSON.stringify(qrMatrix(link)), link)
      check('downloading the SVG ticks "Share your quote link", like the PNG', Boolean((await tenantRow()).quote_link_copied_at), await tenantRow())
    } finally {
      await browser.close()
    }
  }
}
