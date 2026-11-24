// T-201, items 29 and 31 to 34, against the real servers (local stack; the worker's AI stand-in).
//
// What it proves:
//   29  a "County/State" service area is checked from the customer's ZIP code: another state is
//       turned away, the right state and a place that cannot be told are let through
//   31  the "Prepared with" line stays off while a plan's payment is being retried
//   33  the free quotes count only quotes priced on the free start: the database's own claim, the
//       billing page's number, and a business whose plan has ended
//   32  a request saved at the limit is priced through the plan once there is one, counted once
//       against the plan, and cannot be priced twice
//   34  the address an email's logo is served from serves a business's own logo and nothing else
//
// Not reachable here: the run that starts by itself when Stripe says a plan was bought (it needs a
// Stripe event; verify-t180 is the one that talks to Stripe), and the emails themselves (no email
// is sent on this machine). Both are unit tests: apps/web/src/__tests__/billing-t201.test.ts and
// apps/worker/src/__tests__/customer-email-t201.test.ts.
import type { Harness, Row } from './harness.mts'

export async function run(h: Harness): Promise<void> {
  const { app, cfg, check, section, http, rows, expectOk } = h
  const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
  const rpc = async (fn: string, args: Row) => {
    const res = await http('POST', `${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { headers: admin, body: args })
    const row = (Array.isArray(res.json) ? res.json[0] : res.json) as { claimed?: boolean; used?: number; reason?: string } | null
    return { ok: res.ok, status: res.status, row }
  }
  const period = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const usage = async (tenantId: string) => {
    const list = await rows('usage_counters', `tenant_id=eq.${tenantId}&select=estimates_created,plan_estimates_created`)
    return { priced: list.reduce((n, r) => n + Number(r.estimates_created), 0), onPlan: list.reduce((n, r) => n + Number(r.plan_estimates_created), 0) }
  }
  /** One customer request, with the ZIP code this check wants (the harness's own sends a fixed one) */
  const request = (tenantKey: string, serviceId: string, name: string, postcodeOrZip?: string) =>
    http('POST', `${app}/api/public/quotes`, {
      body: {
        tenantKey,
        serviceId,
        customer: { name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-3434' },
        job: {
          ...(postcodeOrZip && { postcodeOrZip }),
          answers: [
            { fieldId: '_project_description', value: 'Paint the outside walls and the trim' },
            { fieldId: 'wall_area', value: 40 },
            { fieldId: 'trim_length', value: 20 },
          ],
        },
        source: { type: 'widget' },
      },
      timeoutMs: 150_000,
    })
  const tokenOf = (res: { json: Row | null }) => {
    const url = String(res.json?.quoteViewUrl ?? '')
    return url ? new URL(url, app).searchParams.get('token') ?? '' : ''
  }
  const setArea = async (biz: { cookie: Record<string, string> }, mode: string, values: string[]) =>
    expectOk('service area', await http('PUT', `${app}/api/tenant`, { headers: biz.cookie, body: { serviceAreaMode: mode, serviceAreaValues: values } }))

  // -------------------------------------------------------------------------
  section('29. A "County/State" service area is checked')
  const area = await h.business('area')
  const areaKey = await h.siteKey(area)
  const areaService = await h.paintService(area)

  await setArea(area, 'county_state', ['Texas'])
  const saved = (await rows('tenants', `id=eq.${area.tenantId}&select=service_area_mode,service_area_values`))[0]
  check('Settings saves the area as states', saved?.service_area_mode === 'county_state' && JSON.stringify(saved.service_area_values) === JSON.stringify(['Texas']), saved)
  const otherState = await request(areaKey, areaService, 'Dev Raman', '90210')
  check('a ZIP code in another state is turned away (400 OUTSIDE_SERVICE_AREA), and nothing is saved', otherState.status === 400 && otherState.json?.error?.code === 'OUTSIDE_SERVICE_AREA' && (await rows('quotes', `tenant_id=eq.${area.tenantId}&select=id`)).length === 0, [otherState.status, otherState.json?.error?.code])
  const rightState = await request(areaKey, areaService, 'Maya Ortiz', '77002')
  check('a ZIP code in that state is accepted', rightState.ok && typeof rightState.json?.quoteId === 'string', [rightState.status, rightState.json?.error])
  const noZip = await request(areaKey, areaService, 'Sam Whitlock')
  check('a customer who gives no ZIP code is not blocked by the area', noZip.ok && typeof noZip.json?.quoteId === 'string', [noZip.status, noZip.json?.error?.code])

  await setArea(area, 'county_state', ['Harris County, TX'])
  const countyOtherState = await request(areaKey, areaService, 'Lena Brooks', '90210')
  check('a county written with its state turns away another state', countyOtherState.status === 400 && countyOtherState.json?.error?.code === 'OUTSIDE_SERVICE_AREA', [countyOtherState.status, countyOtherState.json?.error?.code])
  await setArea(area, 'county_state', ['Harris County'])
  const countyAlone = await request(areaKey, areaService, 'Owen Park', '90210')
  check('a county with no state cannot be told from a ZIP code, so the customer is let through', countyAlone.ok && typeof countyAlone.json?.quoteId === 'string', [countyAlone.status, countyAlone.json?.error])
  await setArea(area, 'postcode_allowlist', ['770'])
  const listOut = await request(areaKey, areaService, 'Ivy Chen', '90210')
  check('the ZIP code list still works as before', listOut.status === 400 && listOut.json?.error?.code === 'OUTSIDE_SERVICE_AREA', [listOut.status, listOut.json?.error?.code])

  // -------------------------------------------------------------------------
  section('31. The "Prepared with" line while a payment is being retried')
  const badge = await h.business('badge')
  const badgeKey = await h.siteKey(badge)
  const formBadge = async () => (await http('GET', `${app}/api/public/widget/config?tenantKey=${badgeKey}`)).json?.branding?.showPoweredBy
  // a free test row: no Stripe customer, so nothing is billed
  await h.sb.insert('subscriptions', { tenant_id: badge.tenantId, plan_id: 'plan_us_pro', status: 'active', stripe_customer_id: null, stripe_subscription_id: null })
  check('on Pro the request form has no "Powered by" line', (await formBadge()) === false, await formBadge())
  await h.patch('subscriptions', `tenant_id=eq.${badge.tenantId}`, { status: 'past_due' })
  check('…and it stays off while the payment is being retried', (await formBadge()) === false, await formBadge())
  await h.patch('subscriptions', `tenant_id=eq.${badge.tenantId}`, { status: 'canceled' })
  check('…and comes back when the plan has ended', (await formBadge()) === true, await formBadge())
  await h.patch('subscriptions', `tenant_id=eq.${badge.tenantId}`, { plan_id: 'plan_us_starter', status: 'past_due' })
  check('Starter shows the line, retried payment or not', (await formBadge()) === true, await formBadge())

  // -------------------------------------------------------------------------
  section('33. The free quotes count only quotes priced on the free start')
  const counted = await h.business('count')
  const claim = (per: 'month' | 'total', limit: number) => rpc('claim_plan_quote', { p_tenant_id: counted.tenantId, p_period: period, p_limit: limit, p_per: per })
  const free: boolean[] = []
  for (let i = 0; i < 4; i++) free.push((await claim('total', 10)).row?.claimed === true)
  check('four free quotes are counted as free ones', free.every(Boolean) && JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 4, onPlan: 0 }), await usage(counted.tenantId))
  const plan: boolean[] = []
  for (let i = 0; i < 9; i++) plan.push((await claim('month', 50)).row?.claimed === true)
  check('nine quotes on a plan are counted in the month, and noted as the plan\'s', plan.every(Boolean) && JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 13, onPlan: 9 }), await usage(counted.tenantId))
  const afterPlan = await claim('total', 10)
  check('with the plan gone, the next free quote is the 5th of 10, not refused as the 14th', afterPlan.row?.claimed === true && afterPlan.row.used === 5, afterPlan.row)
  for (let i = 0; i < 5; i++) await claim('total', 10)
  const eleventh = await claim('total', 10)
  check('the free quotes still stop at 10', eleventh.row?.claimed === false && eleventh.row.reason === 'limit' && eleventh.row.used === 10 && JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 19, onPlan: 9 }), [eleventh.row, await usage(counted.tenantId)])
  await rpc('release_plan_quote', { p_tenant_id: counted.tenantId, p_period: period, p_per: 'month' })
  check('a plan quote given back takes one from both counts', JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 18, onPlan: 8 }), await usage(counted.tenantId))
  await rpc('release_plan_quote', { p_tenant_id: counted.tenantId, p_period: period, p_per: 'total' })
  check('a free quote given back takes one from the free count only', JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 17, onPlan: 8 }) && (await claim('total', 10)).row?.used === 10, await usage(counted.tenantId))
  await rpc('release_plan_quote', { p_tenant_id: counted.tenantId, p_period: period })
  check('given back the old way (no kind said), the plan\'s share never passes the month\'s count', (await usage(counted.tenantId)).onPlan <= (await usage(counted.tenantId)).priced, await usage(counted.tenantId))

  const billing = async (biz: { cookie: Record<string, string> }) => expectOk('billing', await http('GET', `${app}/api/billing`, { headers: biz.cookie })) as { usage: { estimatesCreated: number; planLimit: number; per: string; heldLeads?: number }; subscription: { plan: Row | null } }
  // the business as its billing page sees it: a plan that has ended, and 60 quotes priced in its time,
  // 9 of them as free ones (3 this month, 6 of an earlier month's 57)
  await h.patch('usage_counters', `tenant_id=eq.${counted.tenantId}`, { estimates_created: 3, plan_estimates_created: 0 })
  await h.sb.insert('usage_counters', { tenant_id: counted.tenantId, period_yyyymm: '202601', estimates_created: 57, estimates_sent: 0, plan_estimates_created: 51 })
  await h.sb.insert('subscriptions', { tenant_id: counted.tenantId, plan_id: 'plan_us_starter', status: 'canceled', stripe_customer_id: null, stripe_subscription_id: null })
  const ended = await billing(counted)
  check('the billing page of a business whose plan ended says 9 of 10 free quotes used, though it priced 60', ended.subscription.plan === null && ended.usage.per === 'total' && ended.usage.estimatesCreated === 9 && ended.usage.planLimit === 10, ended.usage)

  // -------------------------------------------------------------------------
  section('33 and 32. After the plan: one free quote left, then requests are saved; a plan prices them')
  const countedKey = await h.siteKey(counted)
  const countedService = await h.paintService(counted)
  const tenth = await request(countedKey, countedService, 'Nora Fields', '63021')
  check('its next request is priced: the last of its free quotes', tenth.ok && tenth.json?.status !== 'held' && JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 61, onPlan: 51 }), [tenth.json?.status, await usage(counted.tenantId)])
  const saved11 = await request(countedKey, countedService, 'Paul Varga', '63021')
  const heldId = String(saved11.json?.quoteId ?? '')
  const heldRow = async () => (await rows('quotes', `id=eq.${heldId}&select=status,content_json,pricing_json`))[0] ?? {}
  check('the one after is saved without a price, and not counted', saved11.ok && saved11.json?.status === 'held' && (await heldRow()).status === 'pending_review' && ((await heldRow()).content_json as Row)?.limitHold === true && (await usage(counted.tenantId)).priced === 61, [saved11.json?.status, await usage(counted.tenantId)])
  const tooEarly = await http('POST', `${app}/api/quotes/${heldId}/process`, { headers: counted.cookie })
  check('without a plan it cannot be priced (402), and trying counts nothing', tooEarly.status === 402 && tooEarly.json?.error?.code === 'PLAN_LIMIT_REACHED' && (await usage(counted.tenantId)).priced === 61, [tooEarly.status, tooEarly.json?.error?.code])

  // the plan is back (a free test row): the same steps the run after a purchase takes, one request at a time
  await h.patch('subscriptions', `tenant_id=eq.${counted.tenantId}`, { status: 'active' })
  const priceIt = await http('POST', `${app}/api/quotes/${heldId}/process`, { headers: counted.cookie, timeoutMs: 150_000 })
  check('with a plan, the saved request is sent for pricing', priceIt.ok && priceIt.json?.queued === true, [priceIt.status, priceIt.json])
  const priced = await h.waitForQuote(heldId, (row) => !['queued', 'processing'].includes(String(row.status)) && (row.content_json as Row | null)?.limitHold !== true)
  check('…the worker prices it like any other request', Number((priced.pricing_json as Row | null)?.total ?? 0) > 0 && ['sent', 'pending_review'].includes(String(priced.status)), { status: priced.status, total: (priced.pricing_json as Row | null)?.total })
  check('…counted once, against the plan (its free quotes are untouched)', JSON.stringify(await usage(counted.tenantId)) === JSON.stringify({ priced: 62, onPlan: 52 }), await usage(counted.tenantId))
  const again = await http('POST', `${app}/api/quotes/${heldId}/process`, { headers: counted.cookie })
  check('…and it cannot be priced a second time (400 NOT_HELD), nor counted twice', again.status === 400 && again.json?.error?.code === 'NOT_HELD' && (await usage(counted.tenantId)).priced === 62, [again.status, again.json?.error?.code, await usage(counted.tenantId)])
  const onPlanBilling = await billing(counted)
  check('on the plan, the billing page counts this month against the plan\'s own number: 5 of 50', onPlanBilling.usage.per === 'month' && onPlanBilling.usage.planLimit === 50 && onPlanBilling.usage.estimatesCreated === 5, onPlanBilling.usage)
  console.log('   (The run that starts by itself on a purchase needs a Stripe event: unit tests, and verify-t180 for the purchase.)')

  // -------------------------------------------------------------------------
  section('34. The address an email\'s logo is served from')
  const logoAt = (id: string) => fetch(`${app}/api/public/logo/${id}`, { redirect: 'manual' })
  check('an id that is nobody\'s is 404', (await logoAt(`ast_${h.shortId()}${h.shortId()}`)).status === 404)
  check('a malformed id is 404', (await logoAt('..%2F..%2Fetc')).status === 404)
  const brand = await h.business('brand')
  const picture = await h.sb.insert('assets', { tenant_id: brand.tenantId, type: 'image', file_name: 'logo.png', content_type: 'image/png', size_bytes: 1200, r2_key: `${brand.tenantId}/branding/logo-t201.png` })
  const pictureId = String(picture.id)
  check('a picture that is not a business\'s logo is 404 (a customer\'s photo cannot be fetched this way)', (await logoAt(pictureId)).status === 404)
  const tenantRow = (await rows('tenants', `id=eq.${brand.tenantId}&select=branding_json`))[0]
  await h.patch('tenants', `id=eq.${brand.tenantId}`, { branding_json: { ...((tenantRow?.branding_json as Row | null) ?? {}), logoAssetId: pictureId } })
  const served = await logoAt(pictureId)
  const location = served.headers.get('location') ?? ''
  check('the business\'s own logo is served: the reader is sent on to the picture', served.status === 302 && /^https?:\/\//.test(location) && location.includes('logo-t201.png'), [served.status, location.slice(0, 80)])
  check('…with no cookie set, and an answer that may be reused for a few minutes only', !served.headers.get('set-cookie') && /max-age=600/.test(served.headers.get('cache-control') ?? ''), served.headers.get('cache-control'))
  await h.patch('tenants', `id=eq.${brand.tenantId}`, { branding_json: { ...((tenantRow?.branding_json as Row | null) ?? {}), logoAssetId: null } })
  check('once the business removes its logo, the address stops serving it', (await logoAt(pictureId)).status === 404)

  // the badge on the estimate page itself (the page an email links to), for the business on a retried payment
  const pageKey = badgeKey
  const pageService = await h.paintService(badge)
  await h.patch('subscriptions', `tenant_id=eq.${badge.tenantId}`, { plan_id: 'plan_us_pro', status: 'past_due' })
  const forPage = await request(pageKey, pageService, 'Rosa Lind', '63021')
  const pageToken = tokenOf(forPage)
  const page = await http('GET', `${app}/api/public/quotes/${forPage.json?.quoteId}?token=${pageToken}`)
  check('the estimate page of a Pro business on a retried payment has no "Prepared with" line (the emails ask the same rule)', page.ok && page.json?.branding?.showPoweredBy === false, [page.status, page.json?.branding?.showPoweredBy])
}
