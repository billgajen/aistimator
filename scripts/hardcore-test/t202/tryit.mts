// T-202, the "tryit" section of verify-t202: the test estimate a business makes from inside its
// dashboard (item 3) and the "Share your quote link" tick (item 5). Local stack only; no model is
// asked, no email is sent. One part runs in a browser (the form really sending the request).
//
// What it proves
//   Item 3
//   A. where it is offered: not without a service, on Home until the first real request; the page
//      inside the dashboard needs a sign-in; the public quote page has no test mode whatever its
//      address says
//   B. who can make a test: only the body saying so TOGETHER with that business's own session.
//      Without a session, with another business's session, with the old link's code, or with
//      anything but `true`: refused, and nothing is saved. A signed-in business sending an ordinary
//      request is an ordinary, counted request.
//   C. a test counts nowhere: not on the plan, not in Analytics, not as "won", not on Home's figures,
//      not as a "first real request"; it does show in Quotes, marked as a test
//   D. five in 24 hours: the fifth is taken, the sixth is refused with the time the next one frees
//      up, the button and the page say so beforehand; a test refused before it was saved gives its
//      place back; a business cannot write its own count
//   E. deleting: only the business's own test; a real quote and another business's test are refused;
//      the request, the estimate and its files go; the day's count does not go down
//   F. in a browser: Home's "Try it yourself" opens the form in test mode, the form's own request is
//      a test, the quote page offers "Delete this test", asks first, and Cancel changes nothing
//   Item 5
//   G. opening the link ticks nothing (customer, signed-in owner, old "?own=1"); Share ticks it (the
//      dashboard's cookie or the phone app's bearer sign-in); so does the first real request; a tick
//      from before T-202 stays
import type { Harness, Row } from '../t201/harness.mts'
import { TEST_ESTIMATES_PER_DAY, TRY_IT_COPY, TRY_IT_PATH } from '../../../apps/web/src/lib/try-it-copy'

type Biz = Awaited<ReturnType<Harness['business']>>

export async function run(h: Harness): Promise<void> {
  const { app, cfg, http, expectOk, check, section, rows, patch, sb } = h
  const page = (path: string, cookie?: { Cookie: string }) => fetch(`${app}${path}`, { headers: cookie ?? {}, redirect: 'manual' })
  const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()
  const tenant = async (b: Biz) => (await rows('tenants', `id=eq.${b.tenantId}&select=slug,quote_link_copied_at,quote_link_first_visit_at,test_estimate_times`))[0] ?? {}
  const quotesOf = async (b: Biz) => rows('quotes', `tenant_id=eq.${b.tenantId}&select=id,is_test,status,quote_request_id&order=created_at.asc`)
  const allowance = async (b: Biz) => expectOk('allowance', await http('GET', `${app}/api/test-estimates`, { headers: b.cookie })) as { canStart: boolean; reason: string | null; limit: number; used: number; availableAt: string | null; url: string; now: string }
  const setTimes = async (b: Biz, times: string[]) => expectOk('set times', await patch('tenants', `id=eq.${b.tenantId}`, { test_estimate_times: times }))
  const shareDone = async (b: Biz) => /data-testid="checklist-share"[^>]*data-done="(\w+)"/.exec(await (await page('/app', b.cookie)).text())?.[1] ?? 'no checklist'
  const home = async (b: Biz) => (await page('/app', b.cookie)).text()

  /** A request through the public route, as the form sends it; `extra` is what is being tried */
  const send = (tenantKey: string, serviceId: string, who: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    http('POST', `${app}/api/public/quotes`, {
      headers,
      body: {
        tenantKey,
        serviceId,
        customer: { name: who, email: `${who.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 202-3434' },
        job: {
          postcodeOrZip: '63021',
          answers: [
            { fieldId: '_project_description', value: 'Paint the outside walls and the trim' },
            { fieldId: 'wall_area', value: 40 },
            { fieldId: 'trim_length', value: 20 },
          ],
        },
        source: { type: 'widget' },
        ...extra,
      },
      timeoutMs: 150_000,
    })

  // ---------------------------------------------------------------------------
  section('Try it A. Where "Try it yourself" is offered (item 3)')
  const biz = await h.business('tryit')
  const rival = await h.business('rival')
  check('asking whether a test can start needs a sign-in', (await http('GET', `${app}/api/test-estimates`)).status === 401)
  const before = await allowance(biz)
  check('with no service switched on it cannot start, and says why', before.canStart === false && before.reason === 'no_service', before)

  const serviceId = await h.paintService(biz)
  const tenantKey = await h.siteKey(biz)
  const rivalService = await h.paintService(rival)
  const rivalKey = await h.siteKey(rival)
  const ready = await allowance(biz)
  check(`with a service on: it can start, none of the ${TEST_ESTIMATES_PER_DAY} used, and the page is inside the dashboard`, ready.canStart && ready.used === 0 && ready.limit === 5 && ready.url === TRY_IT_PATH && TRY_IT_PATH === '/app/try-it', ready)
  check('the answer carries no code of any kind (nothing to put in an address)', !/token|test=/i.test(JSON.stringify(ready)), ready)

  const homeFirst = await home(biz)
  check('Home offers "Try it yourself" with "See what your customers see"', homeFirst.includes('data-testid="home-try-it"') && homeFirst.includes(TRY_IT_COPY.title) && homeFirst.includes(TRY_IT_COPY.line), homeFirst.includes('data-testid="home-try-it"'))

  const signedOut = await page(TRY_IT_PATH)
  check('the test page needs a sign-in (a visitor is sent to the log-in page)', [302, 303, 307, 308].includes(signedOut.status) && (signedOut.headers.get('location') ?? '').includes('/login'), [signedOut.status, signedOut.headers.get('location')])
  const tryPage = await page(TRY_IT_PATH, biz.cookie)
  const tryHtml = await tryPage.text()
  check('signed in, it shows the request form in test mode', tryPage.status === 200 && tryHtml.includes('data-testid="test-mode-note"') && tryHtml.includes('data-testid="request-form"'), tryPage.status)

  const slug = String((await tenant(biz)).slug)
  for (const [what, address] of [
    ['the plain link', `/quote/${slug}`],
    ['the link with "?test=1"', `/quote/${slug}?test=1`],
    ['the link with "?ownTest=true"', `/quote/${slug}?ownTest=true`],
  ] as const) {
    const opened = await page(address, biz.cookie)
    const html = await opened.text()
    check(`the public quote page has no test mode: ${what}, even opened by the signed-in owner`, opened.status === 200 && html.includes('data-testid="request-form"') && !html.includes('data-testid="test-mode-note"'), opened.status)
  }

  // ---------------------------------------------------------------------------
  section('Try it B. Who can make a test request (item 3)')
  const noSession = await send(tenantKey, serviceId, 'Nell Varga', { ownTest: true })
  check('the body says "test" with no sign-in (what any customer could send): refused', noSession.status === 403 && noSession.json?.error?.code === 'TEST_NOT_SIGNED_IN' && noSession.json?.error?.message === TRY_IT_COPY.notSignedIn, [noSession.status, noSession.json?.error])
  const otherSession = await send(tenantKey, serviceId, 'Odile Marsh', { ownTest: true }, rival.cookie)
  check('…with ANOTHER business signed in: refused', otherSession.status === 403 && otherSession.json?.error?.code === 'TEST_NOT_SIGNED_IN', [otherSession.status, otherSession.json?.error])
  const notTrue = await send(tenantKey, serviceId, 'Petra Lund', { ownTest: 'true' }, biz.cookie)
  check('…with anything but `true`, even signed in: refused', notTrue.status === 403, [notTrue.status, notTrue.json?.error])
  const oldCode = await send(tenantKey, serviceId, 'Quinn Abara', { testToken: 'eyJ0IjoidG50X3gifQ.c2lnbmF0dXJl' }, biz.cookie)
  check('the old test link’s code is refused, and says to start again from the dashboard', oldCode.status === 403 && oldCode.json?.error?.code === 'TEST_LINK_INVALID' && oldCode.json?.error?.message === TRY_IT_COPY.oldLink, [oldCode.status, oldCode.json?.error])
  const inSource = await send(tenantKey, serviceId, 'Rhea Stone', { source: { type: 'widget', ownTest: true, isTest: true, test: true } })
  const sourceQuote = (await quotesOf(biz)).find((q) => q.id === inSource.json?.quoteId)
  check('a "test" mark hidden in `source` makes an ordinary, counted request (it is ignored)', inSource.ok && sourceQuote?.is_test === false, [inSource.status, sourceQuote])
  check('none of the refused tries saved anything, and none used one of the day’s tests', (await quotesOf(biz)).length === 1 && (await allowance(biz)).used === 0, { quotes: (await quotesOf(biz)).length })
  // that ordinary request is this business's first real one: once it is priced, put it aside so the parts below start clean
  await h.waitForQuote(String(inSource.json?.quoteId), (row) => !['queued', 'generating'].includes(String(row.status)))
  expectOk('clear', await http('DELETE', `${cfg.supabaseUrl}/rest/v1/quotes?id=eq.${inSource.json?.quoteId}`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` } }))
  expectOk('clear usage', await http('DELETE', `${cfg.supabaseUrl}/rest/v1/usage_counters?tenant_id=eq.${biz.tenantId}`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` } }))

  const leadNoSession = await http('POST', `${app}/api/public/leads`, { body: { tenantKey, serviceId, customer: { name: 'Sami Roe', email: 'sami.roe@example.com' }, ownTest: true } })
  const leadOwn = await http('POST', `${app}/api/public/leads`, { headers: biz.cookie, body: { tenantKey, serviceId, customer: { name: 'Sami Roe', email: 'sami.roe@example.com' }, ownTest: true } })
  check('an unfinished request: "test" without the session is refused; with it nothing is saved (a test is never a lead)', leadNoSession.status === 403 && leadOwn.ok && leadOwn.json?.skipped === true && (await rows('request_leads', `tenant_id=eq.${biz.tenantId}&select=id`)).length === 0, [leadNoSession.status, leadOwn.json])

  const test = await send(tenantKey, serviceId, 'Tess Ward', { ownTest: true }, biz.cookie)
  const testId = String(test.json?.quoteId ?? '')
  check('the body says "test" AND the business’s own session is there: a test', test.ok && Boolean(testId) && (await quotesOf(biz)).find((q) => q.id === testId)?.is_test === true, [test.status, test.json?.error])
  check('…and it used one of the day’s five', (await allowance(biz)).used === 1 && ((await tenant(biz)).test_estimate_times as string[]).length === 1, await allowance(biz))
  const priced = await h.waitForQuote(testId, (row) => !['queued', 'generating'].includes(String(row.status)))
  check('…and it is priced like any request', Number((priced.pricing_json as { total?: number } | null)?.total ?? 0) > 0, [priced.status, priced.pricing_json])

  // ---------------------------------------------------------------------------
  section('Try it C. A test counts nowhere (item 3)')
  const usage = await rows('usage_counters', `tenant_id=eq.${biz.tenantId}&select=estimates_created,estimates_sent,plan_estimates_created`)
  check('not on the plan: no quote was counted as made or sent', usage.every((u) => !u.estimates_created && !u.estimates_sent && !u.plan_estimates_created), usage)
  const billing = expectOk('billing', await http('GET', `${app}/api/billing`, { headers: biz.cookie })) as { usage?: { estimatesCreated?: number; estimatesSent?: number } }
  check('…and the billing page says none of the free quotes is used', billing.usage?.estimatesCreated === 0 && billing.usage?.estimatesSent === 0, billing.usage)
  // an accepted test would be the first thing "won": accept it by hand, then look
  expectOk('accept', await patch('quotes', `id=eq.${testId}`, { status: 'accepted', sent_at: hoursAgo(0.2), viewed_at: hoursAgo(0.1), accepted_at: new Date().toISOString() }))
  const analytics = expectOk('analytics', await http('GET', `${app}/api/analytics`, { headers: biz.cookie })) as { metrics?: Record<string, number>; usage?: { estimatesCreated?: number } }
  const figures = analytics.metrics ?? {}
  check('not in Analytics: every figure is zero, for a test that was sent, opened and accepted', ['totalQuotes', 'quotesSent', 'quotesViewed', 'quotesAccepted', 'conversionRate'].every((key) => figures[key] === 0) && analytics.usage?.estimatesCreated === 0, analytics)
  const homeWithTest = await home(biz)
  check('not in "Won through Qolumns": the panel is not shown for an accepted test', !homeWithTest.includes('data-testid="won-panel"'))
  check('not a "first real request": Home still offers "Try it yourself", and step 4 is not ticked', homeWithTest.includes('data-testid="home-try-it"') && /data-testid="checklist-first_request"[^>]*data-done="false"/.test(homeWithTest))
  check('…and it does not tick "Share your quote link" either', (await shareDone(biz)) === 'false')
  const list = expectOk('list', await http('GET', `${app}/api/quotes?limit=50&group=all`, { headers: biz.cookie })) as { items?: Array<{ quoteId?: string; isTest?: boolean }> }
  check('it does show in Quotes, marked as a test', (list.items ?? []).find((q) => q.quoteId === testId)?.isTest === true, list.items?.length)
  const detail = expectOk('detail', await http('GET', `${app}/api/quotes/${testId}`, { headers: biz.cookie })) as { quote?: { is_test?: boolean } }
  check('…and on its own page', detail.quote?.is_test === true, Object.keys(detail).slice(0, 12))

  const real = await send(tenantKey, serviceId, 'Una Field', {}, biz.cookie)
  const realId = String(real.json?.quoteId ?? '')
  check('the signed-in business sending an ORDINARY request (no "test" in the body) makes a real one: the session alone is not a test', real.ok && (await quotesOf(biz)).find((q) => q.id === realId)?.is_test === false, [real.status, real.json?.error])
  const counted = await rows('usage_counters', `tenant_id=eq.${biz.tenantId}&select=estimates_created`)
  check('…and that one is counted on the plan', counted.reduce((sum, u) => sum + Number(u.estimates_created ?? 0), 0) === 1, counted)
  const homeAfterReal = await home(biz)
  check('after the first real request Home stops offering "Try it yourself"', !homeAfterReal.includes('data-testid="home-try-it"'))

  // ---------------------------------------------------------------------------
  section('Try it D. Five in 24 hours (item 3)')
  await setTimes(biz, [hoursAgo(23), hoursAgo(3), hoursAgo(2), hoursAgo(1)])
  check('four made in the last day: one more can start', (await allowance(biz)).canStart === true && (await allowance(biz)).used === 4, await allowance(biz))
  const unsaved = await send(tenantKey, 'svc_does_not_exist', 'Vera Pine', { ownTest: true }, biz.cookie)
  check('a test refused before it was saved (no such service) gives its place back', !unsaved.ok && (await allowance(biz)).used === 4, [unsaved.status, (await allowance(biz)).used])
  const fifth = await send(tenantKey, serviceId, 'Wren Hale', { ownTest: true }, biz.cookie)
  check('the fifth is taken', fifth.ok && (await quotesOf(biz)).find((q) => q.id === fifth.json?.quoteId)?.is_test === true, [fifth.status, fifth.json?.error])
  const full = await allowance(biz)
  const frees = Date.parse(String(full.availableAt))
  check('then no more can start, and the answer says when: 24 hours after the oldest of the five', full.canStart === false && full.reason === 'limit' && Math.abs(frees - (Date.now() + 3_600_000)) < 120_000, full)
  const quotesBefore = (await quotesOf(biz)).length
  const sixth = await send(tenantKey, serviceId, 'Xan Reyes', { ownTest: true }, biz.cookie)
  check('the sixth is refused with that time, and nothing is saved', sixth.status === 429 && sixth.json?.error?.code === 'TEST_LIMIT_REACHED' && Math.abs(Date.parse(String(sixth.json?.error?.availableAt)) - frees) < 2000 && (await quotesOf(biz)).length === quotesBefore, [sixth.status, sixth.json?.error])
  const stopPage = await (await page(TRY_IT_PATH, biz.cookie)).text()
  check('the test page says so instead of showing the form, with the time for the reader’s clock', stopPage.includes('data-testid="try-it-stop"') && stopPage.includes('data-reason="limit"') && stopPage.includes(`data-available-at="${full.availableAt}"`) && !stopPage.includes('data-testid="request-form"'), stopPage.includes('try-it-stop'))
  check('a real request is still taken at the limit (the limit is on tests only)', (await send(tenantKey, serviceId, 'Yara Voss')).ok)
  await setTimes(biz, [hoursAgo(30), hoursAgo(25), hoursAgo(3), hoursAgo(2), hoursAgo(1)])
  check('tests older than 24 hours no longer count', (await allowance(biz)).canStart === true && (await allowance(biz)).used === 3, await allowance(biz))

  const session = await sb.signIn(biz.email, biz.password)
  const asBusiness = { apikey: cfg.anonKey as string, Authorization: `Bearer ${session.access_token}` }
  const emptied = await http('PATCH', `${cfg.supabaseUrl}/rest/v1/tenants?id=eq.${biz.tenantId}`, { headers: { ...asBusiness, Prefer: 'return=representation' }, body: { test_estimate_times: [] } })
  check('a business cannot empty its own count in the database', !emptied.ok && ((await tenant(biz)).test_estimate_times as string[]).length === 5, [emptied.status, emptied.json])
  const ownClaim = await http('POST', `${cfg.supabaseUrl}/rest/v1/rpc/release_test_estimate`, { headers: asBusiness, body: { p_tenant_id: biz.tenantId, p_claimed_at: ((await tenant(biz)).test_estimate_times as string[])[4] } })
  check('…nor give itself one back, nor take one, through the database’s own functions', !ownClaim.ok && !(await http('POST', `${cfg.supabaseUrl}/rest/v1/rpc/claim_test_estimate`, { headers: asBusiness, body: { p_tenant_id: biz.tenantId, p_limit: 99 } })).ok && ((await tenant(biz)).test_estimate_times as string[]).length === 5, [ownClaim.status, ownClaim.json])
  const stillOwnRow = await http('PATCH', `${cfg.supabaseUrl}/rest/v1/tenants?id=eq.${biz.tenantId}`, { headers: { ...asBusiness, Prefer: 'return=representation' }, body: { quote_link_copied_at: null } })
  check('(the business can still change the rest of its own row)', stillOwnRow.ok, [stillOwnRow.status, stillOwnRow.json])

  // ---------------------------------------------------------------------------
  section('Try it E. Deleting a test (item 3)')
  const usedBefore = (await allowance(biz)).used
  const testRow = (await quotesOf(biz)).find((q) => q.id === testId)!
  const asset = await sb.insert('assets', { tenant_id: biz.tenantId, quote_request_id: testRow.quote_request_id, type: 'image', file_name: 'wall.jpg', content_type: 'image/jpeg', size_bytes: 1200, r2_key: `t202/${biz.tenantId}/wall.jpg` })
  check('deleting needs a sign-in', (await http('DELETE', `${app}/api/quotes/${testId}`)).status === 401)
  const byRival = await http('DELETE', `${app}/api/quotes/${testId}`, { headers: rival.cookie })
  check('another business cannot delete it (not found for them), and it is still there', byRival.status === 404 && (await quotesOf(biz)).some((q) => q.id === testId), byRival.status)
  const realDelete = await http('DELETE', `${app}/api/quotes/${realId}`, { headers: biz.cookie })
  check('a real quote is refused: only a test can be deleted', realDelete.status === 409 && realDelete.json?.error?.code === 'NOT_A_TEST' && (await quotesOf(biz)).some((q) => q.id === realId), [realDelete.status, realDelete.json?.error])
  const deleted = await http('DELETE', `${app}/api/quotes/${testId}`, { headers: biz.cookie })
  check('the business deletes its own test', deleted.ok && deleted.json?.deleted === true, [deleted.status, deleted.json])
  check('…the estimate, the request it came from and its photo are gone', !(await quotesOf(biz)).some((q) => q.id === testId) && (await rows('quote_requests', `id=eq.${testRow.quote_request_id}&select=id`)).length === 0 && (await rows('assets', `id=eq.${asset.id}&select=id`)).length === 0)
  check('…the real quotes are untouched', (await quotesOf(biz)).some((q) => q.id === realId) && (await quotesOf(biz)).filter((q) => q.is_test === false).length === 2, (await quotesOf(biz)).length)
  check('…and the day’s count did not go down: a deleted test still counts', (await allowance(biz)).used === usedBefore, [usedBefore, (await allowance(biz)).used])
  check('deleting it a second time finds nothing', (await http('DELETE', `${app}/api/quotes/${testId}`, { headers: biz.cookie })).status === 404)

  // ---------------------------------------------------------------------------
  section('Try it F. In a browser: Home’s button, the form in test mode, and "Delete this test" (item 3)')
  const shop = await h.business('shop')
  const shopService = await h.paintService(shop)
  await h.siteKey(shop)
  const { browserDeps } = await import('../browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    const origin = new URL(app).origin
    await ctx.addCookies(
      shop.cookie.Cookie.split('; ').map((pair: string) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      })
    )
    const p = await ctx.newPage()
    await p.goto(`${app}/app`, { waitUntil: 'networkidle' })
    const card = p.locator('[data-testid=home-try-it]')
    check('Home shows the card: "Try it yourself", "See what your customers see"', (await card.count()) === 1 && (await card.innerText()).includes(TRY_IT_COPY.title) && (await card.innerText()).includes(TRY_IT_COPY.line), await card.innerText().catch(() => ''))

    const [form] = await Promise.all([ctx.waitForEvent('page', { timeout: 30_000 }), card.locator('[data-testid=try-it-button]').click()])
    await form.waitForURL(new RegExp(`${TRY_IT_PATH}$`), { timeout: 60_000 })
    check('the button opens the form in a new tab, at an address that carries nothing', new URL(form.url()).pathname === TRY_IT_PATH && new URL(form.url()).search === '', form.url())
    await form.locator('[data-testid=test-mode-note]').waitFor({ timeout: 60_000 })
    check('the form says it is in test mode and does not count toward the plan', (await form.locator('[data-testid=test-mode-note]').innerText()).includes(TRY_IT_COPY.banner))

    await form.getByLabel('Your name').waitFor({ timeout: 60_000 })
    await form.getByLabel('Your name').fill('Zora Quill')
    await form.getByLabel('Email').fill('zora.quill@example.com')
    await form.getByLabel('Phone').fill('(555) 202-7788')
    await form.getByRole('button', { name: 'Continue' }).click()
    const numbers = form.locator('[data-testid=request-form] input[type=number]')
    await numbers.first().waitFor({ timeout: 30_000 })
    await numbers.nth(0).fill('40')
    await numbers.nth(1).fill('20')
    // whatever steps this form has left (photos are optional here), go on until the last one
    const sendButton = form.getByRole('button', { name: 'Get my estimate' })
    for (let step = 0; step < 4 && (await sendButton.count()) === 0; step++) {
      await form.getByRole('button', { name: 'Continue' }).click({ timeout: 30_000 })
      await form.waitForTimeout(600)
    }
    const zip = form.getByLabel('ZIP code')
    if (await zip.count()) await zip.fill('63021')
    const description = form.locator('[data-testid=request-form] textarea')
    if ((await description.count()) && !(await description.first().inputValue())) await description.first().fill('Paint the outside walls and the trim')
    const [posted] = await Promise.all([
      form.waitForRequest((r) => r.url().endsWith('/api/public/quotes') && r.method() === 'POST', { timeout: 60_000 }),
      sendButton.click(),
    ])
    const sentBody = JSON.parse(posted.postData() ?? '{}') as { ownTest?: unknown; testToken?: unknown }
    check('the form’s own request says "ownTest: true" in its body and carries no code', sentBody.ownTest === true && sentBody.testToken === undefined, Object.keys(sentBody))
    await form.waitForURL(/\/q\/qte_[^/]+(\/clarify)?\?token=/, { timeout: 180_000 }).catch(() => undefined)
    let made: Row | undefined
    for (let i = 0; i < 30 && !made; i++) {
      made = (await quotesOf(shop))[0]
      if (!made) await form.waitForTimeout(1000)
    }
    check('the request it made is a test, and it lands on the estimate page a customer gets', made?.is_test === true && /\/q\/qte_/.test(form.url()), [made, form.url()])
    check('…counted against the day’s five and not against the plan', (await allowance(shop)).used === 1 && (await rows('usage_counters', `tenant_id=eq.${shop.tenantId}&select=estimates_created`)).every((u) => !u.estimates_created))
    await form.close()

    const quoteId = String(made?.id ?? '')
    await h.waitForQuote(quoteId, (row) => !['queued', 'generating'].includes(String(row.status)))
    await p.goto(`${app}/app/quotes`, { waitUntil: 'networkidle' })
    check('Quotes lists it with the "Test" tag', (await p.locator('[data-testid=test-tag]').count()) === 1)
    await p.goto(`${app}/app/quotes/${quoteId}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=delete-test-button]').waitFor({ timeout: 60_000 })
    check('its page says "Test" and offers "Delete this test"', (await p.locator('[data-testid=test-tag]').count()) === 1 && (await p.locator('[data-testid=delete-test-button]').innerText()) === TRY_IT_COPY.delete.button)
    await p.locator('[data-testid=delete-test-button]').click()
    const ask = p.locator('[data-testid=delete-test-confirm]')
    const asked = (await ask.innerText()).replace(/\s+/g, ' ')
    check('it asks first, saying exactly what goes and that the day’s count stays', asked.includes(TRY_IT_COPY.delete.title) && asked.includes(TRY_IT_COPY.delete.body) && asked.includes(TRY_IT_COPY.delete.counted), asked.slice(0, 300))
    await p.locator('[data-testid=delete-test-cancel]').click()
    check('"Cancel" leaves everything as it was', (await ask.count()) === 0 && (await quotesOf(shop)).some((q) => q.id === quoteId))
    await p.locator('[data-testid=delete-test-button]').click()
    await p.locator('[data-testid=delete-test-yes]').click()
    await p.waitForURL(/\/app\/quotes$/, { timeout: 60_000 }).catch(() => undefined)
    check('confirmed, the test is gone and the business is back on its quote list', new URL(p.url()).pathname === '/app/quotes' && (await quotesOf(shop)).length === 0, p.url())
    check('…with one of the day’s five still used', (await allowance(shop)).used === 1)

    // a real quote's page has no such button
    const realOne = expectOk('real', await send(String((await rows('tenant_sites', `tenant_id=eq.${shop.tenantId}&select=tenant_key`))[0]?.tenant_key), shopService, 'Abel Nordin'))
    await h.waitForQuote(String(realOne.quoteId), (row) => !['queued', 'generating'].includes(String(row.status)))
    await p.goto(`${app}/app/quotes/${realOne.quoteId}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=back-to-quotes]').waitFor({ timeout: 60_000 })
    check('a real quote’s page has no "Delete this test" and no "Test" tag', (await p.locator('[data-testid=delete-test]').count()) === 0 && (await p.locator('[data-testid=test-tag]').count()) === 0)
  } finally {
    await browser.close()
  }

  // ---------------------------------------------------------------------------
  section('Share G. "Share your quote link" is ticked by Copy, Share or the first real request, never by a visit (item 5)')
  const sharer = await h.business('share')
  const sharerService = await h.paintService(sharer)
  const sharerKey = await h.siteKey(sharer)
  const link = `/quote/${String((await tenant(sharer)).slug)}`
  check('the step starts unticked', (await shareDone(sharer)) === 'false' && !(await tenant(sharer)).quote_link_copied_at && !(await tenant(sharer)).quote_link_first_visit_at, await tenant(sharer))
  const visits = [await page(link), await page(link, sharer.cookie), await page(`${link}?own=1`), await page(link, rival.cookie)]
  check('opening the link ticks nothing: a customer, the signed-in owner, the old "?own=1" mark, another business', visits.every((v) => v.status === 200) && (await shareDone(sharer)) === 'false' && !(await tenant(sharer)).quote_link_first_visit_at, [visits.map((v) => v.status), await tenant(sharer)])
  check('…and the "?own=1" mark is no longer put on the "Open" buttons', !(await home(sharer)).includes('own=1'))

  check('telling the server "shared" needs a sign-in, and only "copied", "shared" or "qr" is taken', (await http('POST', `${app}/api/tenant/share-event`, { body: { event: 'shared' } })).status === 401 && (await http('POST', `${app}/api/tenant/share-event`, { headers: sharer.cookie, body: { event: 'opened' } })).status === 400 && (await shareDone(sharer)) === 'false')
  expectOk('shared', await http('POST', `${app}/api/tenant/share-event`, { headers: sharer.cookie, body: { event: 'shared' } }))
  check('pressing Share in the dashboard ticks it', (await shareDone(sharer)) === 'true' && Boolean((await tenant(sharer)).quote_link_copied_at))

  const phone = await h.business('phone')
  await h.paintService(phone)
  const phoneSession = await sb.signIn(phone.email, phone.password)
  const fromApp = await http('POST', `${app}/api/tenant/share-event`, { headers: { Authorization: `Bearer ${phoneSession.access_token}` }, body: { event: 'copied' } })
  check('pressing Copy or Send in the phone app (its bearer sign-in, no cookie) ticks it too', fromApp.ok && (await shareDone(phone)) === 'true', [fromApp.status, fromApp.json])

  // the owner's decision of 25 Nov 2026: downloading the QR code is a share too
  const printer = await h.business('printer')
  await h.paintService(printer)
  const qrBrowser = await (await import('../browser.mjs')).browserDeps().chromium.launch()
  try {
    const ctx = await qrBrowser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
    await ctx.addCookies(
      printer.cookie.Cookie.split('; ').map((pair: string) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: new URL(app).origin }
      })
    )
    const p = await ctx.newPage()
    await p.goto(`${app}/app/quote-link`, { waitUntil: 'networkidle' })
    const button = p.locator('[data-testid=qr-download]')
    await button.waitFor({ timeout: 60_000 })
    check('looking at the QR code on the Quote link page ticks nothing', (await shareDone(printer)) === 'false' && !(await tenant(printer)).quote_link_copied_at)
    const [download, told] = await Promise.all([
      p.waitForEvent('download', { timeout: 30_000 }),
      p.waitForResponse((r) => r.url().endsWith('/api/tenant/share-event') && r.request().method() === 'POST', { timeout: 30_000 }),
      button.click(),
    ])
    check('"Download PNG" saves the picture and tells the server "qr"', download.suggestedFilename().endsWith('-quote-qr.png') && told.ok() && told.request().postData() === JSON.stringify({ event: 'qr' }), [download.suggestedFilename(), told.status(), told.request().postData()])
    check('downloading the QR code ticks "Share your quote link"', (await shareDone(printer)) === 'true' && Boolean((await tenant(printer)).quote_link_copied_at), await tenant(printer))
  } finally {
    await qrBrowser.close()
  }

  const quiet = await h.business('quiet')
  const quietService = await h.paintService(quiet)
  const quietKey = await h.siteKey(quiet)
  expectOk('a test', await send(quietKey, quietService, 'Bryn Olsen', { ownTest: true }, quiet.cookie))
  check('a test request does not tick it', (await shareDone(quiet)) === 'false')
  expectOk('a real request', await send(quietKey, quietService, 'Cleo Marsh'))
  check('the first real customer request ticks it, though nobody pressed Copy or Share', (await shareDone(quiet)) === 'true' && !(await tenant(quiet)).quote_link_copied_at, await tenant(quiet))

  const early = await h.business('early')
  await h.paintService(early)
  expectOk('old tick', await patch('tenants', `id=eq.${early.tenantId}`, { quote_link_first_visit_at: hoursAgo(72) }))
  check('a business ticked by a visit before T-202 stays ticked', (await shareDone(early)) === 'true')
  void sharerService
  void sharerKey
  void rivalService
  void rivalKey
}
