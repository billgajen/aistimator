// T-202, the small fixes (items 1, 4 and 6). Local stack only; no model is asked, no email is sent.
//
// What it proves:
//   1  "Try again" as the phone app calls it: the app's own sign-in (a bearer token, no cookie) reads a
//      request that could not be priced and is told how many tries are left; it presses "Try again"
//      five times (the request is priced each time and failed again by hand, the way a failed run
//      leaves it); the sixth is refused with the dashboard's sentence; the plan's count never moves
//   4  "Clear" on "Scope & Photos", in a browser: it asks first and lists what it would empty with the
//      real numbers; "Cancel" changes nothing; "Empty the setup" empties the form and saves nothing
//   6  what a business is told about its plan ending: the payment-failed email's sentence, from the
//      business's real rows (free quotes left, then none), and the same on the billing page, in a browser
//
// No phone runs here: the app's screen itself is unit tests (apps/mobile/src/__tests__/try-again-t202.test.ts).
// The payment-failed email is sent only when Stripe reports a failed payment: verify-t180 (full level).
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT } from '../lib.mjs'
import type { Harness, Row } from '../t201/harness.mts'
import { BUSINESS_RETRY_LIMIT, RETRY_COPY } from '../../../packages/shared/src/quote-retry'
import { freeAllowance } from '../../../packages/shared/src/plans'
import { readAllowanceAfterPlan } from '../../../apps/web/src/lib/plan-limits'
import { afterPlanEndsLine, paymentFailedEmail } from '../../../apps/web/src/lib/billing-emails'
import { planEndedNote } from '../../../apps/web/src/lib/plan-ended'

type AppView = { status?: string; tryAgain?: { left: number }; pricing?: { total?: number }; customer?: { email?: string | null; phone?: string | null } }

export async function run(h: Harness): Promise<void> {
  const { app, http, check, section, rows, expectOk } = h
  const quoteRow = async (id: string) => (await rows('quotes', `id=eq.${id}&select=*`))[0] ?? {}
  const done = (row: Row) => row.pricing_json != null && !['queued', 'generating', 'processing', 'pending', 'failed'].includes(String(row.status))

  // -------------------------------------------------------------------------
  section('Item 1. "Try again", as the phone app calls it')
  const biz = await h.business('app-retry')
  const session = (await h.sb.signIn(biz.email, biz.password)) as { access_token: string }
  // the app carries no cookie: its sign-in is a bearer token
  const asApp = { Authorization: `Bearer ${session.access_token}` }
  const key = await h.siteKey(biz)
  const serviceId = await h.paintService(biz)
  const sent = await h.submit(key, serviceId, 'Mara Quinn')
  const first = await h.waitForQuote(sent.id, done)
  const TOTAL = (first.pricing_json as { total?: number } | null)?.total
  check('a customer’s request is priced', typeof TOTAL === 'number' && TOTAL > 0, { status: first.status, total: TOTAL })

  const used = async () => (await rows('usage_counters', `tenant_id=eq.${biz.tenantId}&select=estimates_created`)).reduce((sum, r) => sum + Number(r.estimates_created), 0)
  const usedBefore = await used()
  check('it is counted once on the plan', usedBefore === 1, usedBefore)

  const appView = async () => {
    const res = await http('GET', `${app}/api/app/quotes/${sent.id}`, { headers: asApp })
    return { status: res.status, view: (res.json ?? {}) as AppView }
  }
  const tryAgain = (headers: Record<string, string> = asApp) => http('POST', `${app}/api/quotes/${sent.id}/process`, { headers, timeoutMs: 150_000 })
  /** The request as a failed pricing run leaves it: failed, its content kept, the business told once */
  const fail = async (tries: number) => {
    const row = await quoteRow(sent.id)
    const failedAt = new Date().toISOString()
    expectOk('mark failed', await h.patch('quotes', `id=eq.${sent.id}`, {
      status: 'failed',
      content_json: { ...((row.content_json as Row | null) ?? {}), error: 'The pricing worker stopped', failedAt, failedNotifiedAt: failedAt, ...(tries > 0 && { businessRetries: tries }) },
      pricing_json: { ...((row.pricing_json as Row | null) ?? {}), subtotal: 0, total: 0, breakdown: [] },
    }))
  }

  const pricedView = await appView()
  check('the app’s view of a priced request says nothing about tries', pricedView.status === 200 && pricedView.view.tryAgain === undefined, pricedView.view.tryAgain)

  const lefts: number[] = []
  const answers: number[] = []
  const totals: unknown[] = []
  for (let tries = 0; tries < BUSINESS_RETRY_LIMIT; tries++) {
    await fail(tries)
    const before = await appView()
    lefts.push(before.view.status === 'failed' ? before.view.tryAgain?.left ?? -1 : -2)
    if (tries === 0) {
      check('the app is told the request could not be priced, with five tries left', before.view.status === 'failed' && before.view.tryAgain?.left === BUSINESS_RETRY_LIMIT, before.view)
      check('…and how to reach the customer is still there', Boolean(before.view.customer?.email) && Boolean(before.view.customer?.phone), before.view.customer)
      const noSignIn = await tryAgain({})
      check('without the app’s sign-in nothing is started', noSignIn.status === 401 && (await quoteRow(sent.id)).status === 'failed', noSignIn.status)
      const stranger = await h.business('app-retry-other')
      const theirs = (await h.sb.signIn(stranger.email, stranger.password)) as { access_token: string }
      const notYours = await tryAgain({ Authorization: `Bearer ${theirs.access_token}` })
      check('another business’s app cannot try it', notYours.status === 404 && (await quoteRow(sent.id)).status === 'failed', notYours.status)
    }
    const pressed = await tryAgain()
    answers.push(pressed.status)
    if (tries === 0) check('the app presses "Try again": pricing starts (the dashboard’s route and answer)', pressed.status === 200 && pressed.json?.queued === true && pressed.json?.retried === true, [pressed.status, pressed.json])
    const again = await h.waitForQuote(sent.id, done)
    totals.push((again.pricing_json as { total?: number } | null)?.total)
    if (tries === 0) {
      const after = await appView()
      check('…the request is priced from the same answers, and the app’s view shows the price and no tries', after.view.status !== 'failed' && after.view.pricing?.total === TOTAL && after.view.tryAgain === undefined, after.view)
    }
  }
  check('each of the five tries was accepted', JSON.stringify(answers) === JSON.stringify([200, 200, 200, 200, 200]), answers)
  check('…the app was told 5, 4, 3, 2, then 1 tries left before each', JSON.stringify(lefts) === JSON.stringify([5, 4, 3, 2, 1]), lefts)
  check('…and each time the price came back the same', totals.every((total) => total === TOTAL), totals)
  check('five tries later the plan’s count has not moved', (await used()) === usedBefore, { before: usedBefore, after: await used() })
  check('…and it is still one quote for one request', (await rows('quotes', `quote_request_id=eq.${first.quote_request_id}&select=id`)).length === 1)

  await fail(BUSINESS_RETRY_LIMIT)
  const usedUp = await appView()
  check('failed a sixth time: the app is told no tries are left (the button goes)', usedUp.view.status === 'failed' && usedUp.view.tryAgain?.left === 0, usedUp.view.tryAgain)
  const sixth = await tryAgain()
  check('the sixth try is refused with the dashboard’s sentence', sixth.status === 429 && sixth.json?.error?.code === 'RETRY_LIMIT' && sixth.json?.error?.message === RETRY_COPY.limit, [sixth.status, sixth.json?.error])
  check('…nothing is started and nothing is counted', (await quoteRow(sent.id)).status === 'failed' && (await used()) === usedBefore, { status: (await quoteRow(sent.id)).status, used: await used() })
  const viaCookie = await http('POST', `${app}/api/quotes/${sent.id}/process`, { headers: biz.cookie, timeoutMs: 150_000 })
  check('…the dashboard is refused the same way: the tries are counted together', viaCookie.status === 429 && viaCookie.json?.error?.code === 'RETRY_LIMIT', [viaCookie.status, viaCookie.json?.error?.code])

  // -------------------------------------------------------------------------
  section('Item 6. What a business is told about its plan ending')
  const requireWeb = createRequire(path.join(ROOT, 'apps/web/package.json'))
  const { createClient } = requireWeb('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  const admin = createClient(h.cfg.supabaseUrl, h.cfg.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const lapsed = await h.business('lapsed')
  const free = freeAllowance('US')
  // a business that priced 6 free quotes, then 14 on a plan whose payment is now failing
  await h.sb.insert('usage_counters', { tenant_id: lapsed.tenantId, period_yyyymm: '202601', estimates_created: 20, estimates_sent: 0, plan_estimates_created: 14 })
  await h.sb.insert('subscriptions', { tenant_id: lapsed.tenantId, plan_id: 'plan_us_pro', status: 'past_due', stripe_customer_id: null, stripe_subscription_id: null })
  const withLeft = await readAllowanceAfterPlan(admin, lapsed.tenantId)
  check('read from its own rows: 4 of its 10 free quotes are left for when the plan ends', JSON.stringify(withLeft) === JSON.stringify({ per: 'total', limit: free.quotes, left: free.quotes - 6 }), withLeft)
  const mailLeft = paymentFailedEmail({ businessName: lapsed.name, billingUrl: `${app}/app/settings/billing`, afterPlan: withLeft }).html
  check('the payment-failed email says the next 4 requests are still priced, then saved', mailLeft.includes(`You still have ${free.quotes - 6} of your ${free.quotes} free quotes, so the next ${free.quotes - 6} new requests are still priced. After those, new requests are saved for you but not priced until a plan is active again.`), afterPlanEndsLine(withLeft))
  check('…it no longer says flatly that new requests "are then saved"', !mailLeft.includes('are then saved'))
  check('…and says requests are still priced while the payment is retried', mailLeft.includes('New requests are still priced meanwhile.'))

  const billing = async () => expectOk('billing', await http('GET', `${app}/api/billing`, { headers: lapsed.cookie })) as { usage: { estimatesCreated: number; planLimit: number; per: 'month' | 'total' }; subscription: { plan: unknown; endedPlanName?: string | null } }
  // the payment is never taken: the plan ends
  expectOk('plan ends', await h.patch('subscriptions', `tenant_id=eq.${lapsed.tenantId}`, { status: 'canceled' }))
  const ended = await billing()
  check('the plan has ended: the billing data shows the free quotes again, 6 of 10 used', ended.subscription.plan === null && ended.subscription.endedPlanName === 'Pro' && ended.usage.per === 'total' && ended.usage.estimatesCreated === 6 && ended.usage.planLimit === free.quotes, { usage: ended.usage, ended: ended.subscription.endedPlanName })
  check('…which is what the email had promised', free.quotes - ended.usage.estimatesCreated === withLeft?.left)
  const lapsedKey = await h.siteKey(lapsed)
  const lapsedService = await h.paintService(lapsed)
  const next = await h.submit(lapsedKey, lapsedService, 'Owen Hart')
  const nextRow = await h.waitForQuote(next.id, (row) => row.pricing_json != null && !['queued', 'generating', 'processing', 'pending'].includes(String(row.status)))
  check('…and what happens: its next request is priced, from a free quote', ((nextRow.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && (nextRow.content_json as { limitHold?: boolean } | null)?.limitHold !== true, { status: nextRow.status, total: (nextRow.pricing_json as { total?: number } | null)?.total })

  // -------------------------------------------------------------------------
  section('Items 4 and 6, in a browser: "Clear" asks first; the billing page says what happens after a plan')
  const { browserDeps } = await import('../browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  try {
    const origin = new URL(app).origin
    const signedIn = async (cookie: { Cookie: string }) => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
      await ctx.addCookies(
        cookie.Cookie.split('; ').map((pair: string) => {
          const at = pair.indexOf('=')
          return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
        })
      )
      return ctx
    }

    // ---- item 6: the billing page of the business whose plan ended
    const billingCtx = await signedIn(lapsed.cookie)
    const bp = await billingCtx.newPage()
    const endedNote = async () => {
      await bp.goto(`${app}/app/settings/billing`, { waitUntil: 'networkidle' })
      await bp.locator('[data-testid=ended-note]').waitFor({ timeout: 30_000 })
      return (await bp.locator('[data-testid=ended-note]').innerText()).replace(/\s+/g, ' ').trim()
    }
    // one more free quote was just used (Owen Hart's request): 7 of 10
    const noteLeft = await endedNote()
    check('the billing page says how many free quotes are left and that the next requests are still priced', noteLeft === planEndedNote('Pro', { used: 7, limit: free.quotes, per: 'total' }) && noteLeft.includes(`You still have ${free.quotes - 7} of your ${free.quotes} free quotes`), noteLeft)
    check('…not that new requests are saved without a price', !noteLeft.includes('New requests are saved for you but not priced until you pick a plan.'), noteLeft)
    // every free quote used
    expectOk('use the rest', await h.patch('usage_counters', `tenant_id=eq.${lapsed.tenantId}&period_yyyymm=eq.202601`, { plan_estimates_created: 11 }))
    const none = await readAllowanceAfterPlan(admin, lapsed.tenantId)
    check('with none left, the email’s sentence is the old one, now only when it is true', none?.left === 0 && afterPlanEndsLine(none) === `If it still cannot be taken, your plan ends. Your ${free.quotes} free quotes are used, so new requests are then saved for you but not priced until a plan is active again.`, [none, afterPlanEndsLine(none)])
    const noteNone = await endedNote()
    check('…and the billing page says the free quotes are used, so requests are saved', noteNone === `Your Pro plan has ended. Your ${free.quotes} free quotes are used, so new requests are saved for you but not priced until you pick a plan.`, noteNone)
    const held = await http('POST', `${app}/api/public/quotes`, {
      body: {
        tenantKey: lapsedKey, serviceId: lapsedService,
        customer: { name: 'Nadia Stone', email: 'nadia.stone@example.com', phone: '(555) 201-3434' },
        job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'Paint the outside walls' }, { fieldId: 'wall_area', value: 40 }, { fieldId: 'trim_length', value: 20 }] },
        source: { type: 'widget' },
      },
      timeoutMs: 150_000,
    })
    const heldRow = held.json?.quoteId ? await quoteRow(String(held.json.quoteId)) : {}
    check('…which is what happens: the next request is saved, not priced', held.ok && (heldRow.content_json as { limitHold?: boolean } | null)?.limitHold === true, [held.status, heldRow.status])
    await billingCtx.close()

    // ---- item 4: "Clear" on "Scope & Photos"
    const editor = await h.business('clear')
    const ctx = await signedIn(editor.cookie)
    const p = await ctx.newPage()
    const form = p.locator('[data-testid=service-form]')
    await p.goto(`${app}/app/services`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=add-from-template]').click()
    const offered = p.locator('[data-testid=template-service]').first()
    const templateName = (await offered.locator('p').first().innerText()).trim()
    await offered.getByRole('button', { name: `Add ${templateName}` }).click()
    await p.locator('[data-testid=template-prices-note]').waitFor({ timeout: 20_000 })
    const service = async () => ((await rows('services', `tenant_id=eq.${editor.tenantId}&name=eq.${encodeURIComponent(templateName)}&select=*`))[0] ?? {}) as Row & {
      scope_includes?: string[]; scope_excludes?: string[]; default_assumptions?: string[]; work_steps?: unknown[]
      media_config?: { minPhotos: number; maxPhotos: number }; draft_config?: { suggestedFields?: unknown[] }
    }
    const saved = await service()
    const questions = saved.draft_config?.suggestedFields?.length ?? -1
    const lines = saved.work_steps?.length ?? -1
    const included = saved.scope_includes?.length ?? -1
    check('a template’s service is open in the editor, with questions and price lines to lose', questions > 0 && lines > 0 && included > 0, { questions, lines, included })
    // from its prices back to "Scope & Photos"
    await p.getByRole('button', { name: 'Back', exact: true }).click()
    await p.getByRole('button', { name: 'Back', exact: true }).click()
    const stepBefore = await form.innerText()
    await p.locator('[data-testid=clear-draft]').click()
    const asking = (await p.locator('[data-testid=clear-confirm]').innerText()).replace(/’/g, "'")
    check('"Clear" asks before doing anything', asking.includes("Empty this service's setup?") && (await form.innerText()).includes(saved.scope_includes?.[0] ?? '\u0000'), asking)
    check(
      '…and says exactly what it would empty, with how much of each there is',
      asking.includes(`What's included (${included} item${included === 1 ? '' : 's'} now), what's excluded (${saved.scope_excludes?.length ?? 0}) and your assumptions (${saved.default_assumptions?.length ?? 0})`) &&
        asking.includes(`The photo settings, back to 1 to 8 photos with no guidance (${saved.media_config?.minPhotos} to ${saved.media_config?.maxPhotos} photos now`) &&
        asking.includes(`Your questions (${questions} question${questions === 1 ? '' : 's'} now)`) &&
        asking.includes(`Your price lines, and what each one measures from the photos (${lines} line${lines === 1 ? '' : 's'} now)`),
      asking
    )
    check('…what stays, and that nothing is saved until the business saves', asking.includes('Your service name, description, base fee, minimum charge, add-ons and adjustments stay as they are.') && asking.includes('Nothing is saved until you press "Save Changes".'), asking)
    await p.locator('[data-testid=clear-cancel]').click()
    check('"Cancel" closes the question', (await p.locator('[data-testid=clear-confirm]').count()) === 0)
    check('…and leaves the step exactly as it was', (await form.innerText()) === stepBefore)
    await p.getByRole('button', { name: 'Next', exact: true }).click()
    const questionsStep = await form.innerText()
    check('…the questions too', !questionsStep.includes('No questions defined yet'), questionsStep.slice(0, 300))
    await p.getByRole('button', { name: 'Back', exact: true }).click()

    // one question at a time: opening "Regenerate" closes "Clear"
    await p.locator('[data-testid=clear-draft]').click()
    await p.locator('[data-testid=regenerate]').click()
    check('asking to regenerate closes the "Clear" question (one at a time)', (await p.locator('[data-testid=clear-confirm]').count()) === 0 && (await p.locator('[data-testid=regenerate-confirm]').count()) === 1)
    await p.locator('[data-testid=regenerate-cancel]').click()

    await p.locator('[data-testid=clear-draft]').click()
    await p.locator('[data-testid=clear-yes]').click()
    const emptied = await form.innerText()
    check('"Empty the setup" empties the scope lists on the page', (await p.locator('[data-testid=clear-confirm]').count()) === 0 && !emptied.includes(saved.scope_includes?.[0] ?? '\u0000') && (await p.locator('[data-testid=clear-draft]').count()) === 0, emptied.slice(0, 300))
    await p.getByRole('button', { name: 'Next', exact: true }).click()
    check('…and the questions', (await form.innerText()).includes('No questions defined yet'), (await form.innerText()).slice(0, 300))
    const unsaved = await service()
    check('…and saves nothing by itself: the service is as it was until "Save Changes"', (unsaved.work_steps?.length ?? -1) === lines && (unsaved.draft_config?.suggestedFields?.length ?? -1) === questions && (unsaved.scope_includes?.length ?? -1) === included, { lines: unsaved.work_steps?.length, questions: unsaved.draft_config?.suggestedFields?.length })
    await p.locator('[data-testid=service-modal-close]').click()
    await ctx.close()
  } finally {
    await browser.close()
  }
}
