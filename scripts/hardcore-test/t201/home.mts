// T-201, the "home" section of verify-t201: Home, Settings, Analytics, WhatsApp (items 13, 14, 21 to 26, 35).
// Local stack only. No model is asked, no email is sent, no browser is used.
//
// What it proves:
//   13. a business that switched every service off stays on Home (no redirect to setup) and reads the
//       notice with its link to Services; a business with no service at all still goes to setup
//   22. Analytics: "Total Quotes" leaves out a setup test
//   23. "Conversion Rate" is accepted ÷ sent, a declined quote counted in what was sent
//   24. "Quotes Viewed" counts a quote that was opened and declined later
//   35. Home's "Accepted" count and the panel's Accepted step show the same number, on-site included
//   14. change password: refused without the right current password, changed with it, the session
//       keeps working, the old password no longer logs in
//   26. a new business shares in the benchmarks; the switch turns it off and on; a business that is
//       off is in nobody's benchmark
//   21. the WhatsApp page is told whether connecting is open, with the "Coming soon" words
//
// Items 25 (no "Paid") and 30 (plan names on Branding) are pages drawn in the browser: unit tests
// (apps/web/src/__tests__/analytics-t201.test.ts, settings-t201.test.ts).
import crypto from 'node:crypto'
import type { Harness, Row } from './harness.mts'

export async function run(h: Harness): Promise<void> {
  const { app, http, expectOk, check, section, rows, sb, shortId } = h
  const page = (cookie: { Cookie: string }, path: string) => fetch(`${app}${path}`, { headers: cookie, redirect: 'manual' })
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

  // ---------------------------------------------------------------------------
  section('13. Every service switched off: Home stays Home, with a notice')
  const empty = await h.business('empty')
  const toSetup = await page(empty.cookie, '/app')
  check('a business with no service at all is still taken to setup', [302, 303, 307, 308].includes(toSetup.status) && (toSetup.headers.get('location') ?? '').includes('/app/onboarding'), [toSetup.status, toSetup.headers.get('location')])

  const biz = await h.business('home')
  const serviceId = await h.paintService(biz)
  const withService = await page(biz.cookie, '/app')
  const withServiceHtml = await withService.text()
  check('with a service switched on, Home shows and there is no notice', withService.status === 200 && !withServiceHtml.includes('data-testid="services-off-notice"'), withService.status)

  expectOk('service off', await http('PATCH', `${app}/api/services/${serviceId}`, { headers: biz.cookie, body: { active: false } }))
  const off = await page(biz.cookie, '/app')
  const offHtml = await off.text()
  check('with every service off, Home is not sent back to setup', off.status === 200 && !off.headers.get('location'), [off.status, off.headers.get('location')])
  const notice = /data-testid="services-off-notice"[\s\S]*?<\/div>/.exec(offHtml)?.[0] ?? ''
  check('Home says "All your services are off, so customers can’t get an estimate"', /All your services are off, so customers can(’|&#x27;|')t get an estimate/.test(notice), notice.slice(0, 300))
  check('…with a link to Services', notice.includes('href="/app/services"'), notice.slice(0, 300))

  expectOk('service on', await http('PATCH', `${app}/api/services/${serviceId}`, { headers: biz.cookie, body: { active: true } }))
  check('switched on again, the notice is gone', !(await (await page(biz.cookie, '/app')).text()).includes('data-testid="services-off-notice"'))

  // ---------------------------------------------------------------------------
  section('22 to 24, 35. Analytics and Home count the same quotes the same way')
  const key = await h.siteKey(biz)
  const made = await h.submit(key, serviceId, 'Megan Grant')
  const priced = await h.waitForQuote(made.id, (row) => Number((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && ['pending_review', 'sent'].includes(String(row.status)))
  check('(a request is priced, to copy)', Number((priced.pricing_json as { total?: number } | null)?.total ?? 0) > 0, { status: priced.status })

  /** A copy of the priced quote under another customer, its status and dates set by hand; `source` gives it its own request row */
  const copyOf = async (customerName: string, overrides: Row, source?: string) => {
    const { id: _id, ...quote } = priced
    let requestId = quote.quote_request_id as string
    if (source) {
      const { id: _requestId, ...request } = (await rows('quote_requests', `id=eq.${requestId}&select=*`))[0]!
      requestId = (await sb.insert('quote_requests', { ...request, customer_name: customerName, source_json: { type: source } })).id as string
    }
    const created = await sb.insert('quotes', {
      ...quote,
      quote_request_id: requestId,
      customer_json: { ...(quote.customer_json as Row), name: customerName },
      quote_token_hash: crypto.createHash('sha256').update(crypto.randomBytes(24).toString('hex')).digest('hex'),
      previous_token_hash: null,
      link_token_hashes: [],
      ...overrides,
    })
    return created.id as string
  }
  const sentDates = { approved_at: minutesAgo(30), sent_at: minutesAgo(30) }
  // Megan: a customer's request, accepted. Dana: made on site, accepted. Jordan: opened, then declined.
  // Sam: sent, never opened. Alex: still waiting for approval. And one accepted setup test.
  await h.patch('quotes', `id=eq.${made.id}`, { status: 'accepted', ...sentDates, viewed_at: minutesAgo(20), accepted_at: minutesAgo(10) })
  await copyOf('Dana Whitfield', { status: 'accepted', ...sentDates, viewed_at: minutesAgo(20), accepted_at: minutesAgo(9) }, 'app')
  await copyOf('Jordan Reyes', { status: 'declined', ...sentDates, viewed_at: minutesAgo(20), declined_at: minutesAgo(8), accepted_at: null })
  await copyOf('Sam Carter', { status: 'sent', ...sentDates, viewed_at: null, accepted_at: null })
  await copyOf('Alex Morgan', { status: 'pending_review', approved_at: null, sent_at: null, viewed_at: null, accepted_at: null })
  await copyOf('Setup Test', { status: 'accepted', ...sentDates, viewed_at: minutesAgo(20), accepted_at: minutesAgo(7), is_test: true })

  const analytics = expectOk('analytics', await http('GET', `${app}/api/analytics`, { headers: biz.cookie })) as { metrics: Record<string, number> }
  const m = analytics.metrics
  check('"Total Quotes" is 5: the accepted setup test is left out', m.totalQuotes === 5, m)
  check('"Quotes Viewed" is 3: the quote that was opened and then declined still counts', m.quotesViewed === 3, m)
  check('"Quotes Accepted" is 2 (the setup test is not one)', m.quotesAccepted === 2, m)
  check('"Conversion Rate" is 50%: 2 accepted of 4 sent, the declined one counted as sent', m.quotesSent === 4 && m.conversionRate === 50, m)
  check('the paid figure is still in the answer (the data is kept), at zero', m.quotesPaid === 0, m)

  const homeHtml = await (await page(biz.cookie, '/app')).text()
  const tile = /data-group="accepted"[\s\S]*?data-testid="stand-count">(?:<!--.*?-->)?(\d+)</.exec(homeHtml)?.[1]
  const steps = [...homeHtml.matchAll(/data-testid="won-step" data-step="(\w+)"[\s\S]*?data-testid="won-step-count">(?:<!--.*?-->)?(\d+)/g)].map((s) => `${s[1]}:${s[2]}`)
  const stepAccepted = steps.find((s) => s.startsWith('accepted:'))?.split(':')[1]
  check('Home’s "Accepted" count is 2: every estimate accepted this month, on-site included', tile === '2', { tile })
  check('the panel’s Accepted step shows the same number', stepAccepted === tile && steps.length === 4, steps)
  const note = /data-testid="won-step-note">([\s\S]*?)<\/span>\s*<\/span>/.exec(homeHtml)?.[1]?.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '') ?? ''
  check('…and says the on-site one is in it', /includes\s*1\s*made on site/.test(note), note)
  check('the headline is still customer requests alone, with the on-site line beside it', /from\s*(?:<[^>]+>)*1(?:<[^>]+>)*\s*job\b/.test(/data-testid="won-headline">([\s\S]*?)<\/p>/.exec(homeHtml)?.[1]?.replace(/<!--.*?-->/g, '') ?? '') && homeHtml.includes('data-testid="won-on-site"'))

  // ---------------------------------------------------------------------------
  section('14. Change password in Settings')
  const user = await h.business('password')
  const change = (body: Row, cookie: Record<string, string> = user.cookie) => http('POST', `${app}/api/auth/change-password`, { headers: cookie, body })
  const logIn = (password: string) => http('POST', `${h.cfg.supabaseUrl}/auth/v1/token?grant_type=password`, { headers: { apikey: h.cfg.anonKey }, body: { email: user.email, password } })
  const next = `Harbor-${shortId()}-Bb2?`

  const stranger = await change({ currentPassword: user.password, newPassword: next, confirmPassword: next }, {})
  check('nobody signed in: refused', stranger.status === 401, stranger.status)
  const wrong = await change({ currentPassword: `${user.password}x`, newPassword: next, confirmPassword: next })
  check('a wrong current password is refused, in plain words', wrong.status === 400 && wrong.json?.error?.code === 'WRONG_PASSWORD' && wrong.json?.error?.message === 'Your current password is not right.', [wrong.status, wrong.json])
  const mismatch = await change({ currentPassword: user.password, newPassword: next, confirmPassword: `${next}x` })
  check('two new passwords that differ are refused', mismatch.status === 400 && mismatch.json?.error?.message === 'The two new passwords do not match.', [mismatch.status, mismatch.json])
  const short = await change({ currentPassword: user.password, newPassword: 'short', confirmPassword: 'short' })
  check('a new password under 8 characters is refused, as at sign-up', short.status === 400 && /at least 8 characters/.test(short.json?.error?.message ?? ''), [short.status, short.json])
  check('after those refusals the old password still logs in', (await logIn(user.password)).ok)

  const changed = await change({ currentPassword: user.password, newPassword: next, confirmPassword: next })
  check('with the right current password it is changed', changed.ok && changed.json?.ok === true, [changed.status, changed.json])
  const stillIn = await http('GET', `${app}/api/tenant`, { headers: user.cookie })
  check('the person stays logged in: the same session still reads its settings', stillIn.ok && stillIn.json?.user?.email === user.email, stillIn.status)
  check('the old password no longer logs in', !(await logIn(user.password)).ok)
  check('the new password does', (await logIn(next)).ok)

  // ---------------------------------------------------------------------------
  section('26. Sharing rates in the benchmarks: a switch, on for a new business')
  // its own currency for this run's businesses would need a new one each time; NZD is used by this check alone
  const nzd = { region: 'US', currency: 'NZD' }
  const viewer = await h.business('bench-viewer', nzd)
  const others = [await h.business('bench-a', nzd), await h.business('bench-b', nzd), await h.business('bench-c', nzd)]
  for (const b of [viewer, ...others]) await h.paintService(b)

  const settings = async (b: typeof viewer) => (expectOk('tenant', await http('GET', `${app}/api/tenant`, { headers: b.cookie })) as { tenant: { benchmarksOptIn?: boolean } }).tenant
  const benchmarks = async (b: typeof viewer) => expectOk('benchmarks', await http('GET', `${app}/api/learning/benchmarks`, { headers: b.cookie })) as { optedIn: boolean; benchmarks: Array<{ unit: string; sampleTenants: number }> }
  const share = (b: typeof viewer, on: boolean) => http('PUT', `${app}/api/tenant`, { headers: b.cookie, body: { benchmarksOptIn: on } })
  const sample = async () => Math.max(0, ...(await benchmarks(viewer)).benchmarks.map((x) => x.sampleTenants))

  const stored = (await rows('tenants', `id=eq.${viewer.tenantId}&select=benchmarks_opt_in`))[0]
  check('a new business starts with sharing on', stored?.benchmarks_opt_in === true && (await settings(viewer)).benchmarksOptIn === true, stored)
  const before = await sample()
  check('it sees a range from the others who share (at least 3 businesses)', (await benchmarks(viewer)).optedIn === true && before >= 3, { before })

  const turnedOff = await share(others[0]!, false)
  check('the switch turns sharing off', turnedOff.ok && turnedOff.json?.tenant?.benchmarksOptIn === false && (await rows('tenants', `id=eq.${others[0]!.tenantId}&select=benchmarks_opt_in`))[0]?.benchmarks_opt_in === false, turnedOff.json?.tenant)
  const offView = await benchmarks(others[0]!)
  check('a business that is off sees no benchmarks', offView.optedIn === false && offView.benchmarks.length === 0, offView)
  const during = await sample()
  check('…and its rates are in nobody’s: the viewer’s range has one business fewer', during === before - 1 || (before === 3 && during === 0), { before, during })
  expectOk('share on', await share(others[0]!, true))
  check('switched on again, it is back in', (await sample()) === before && (await benchmarks(others[0]!)).optedIn === true, { before })

  // ---------------------------------------------------------------------------
  section('21. The WhatsApp page is told whether connecting is open')
  const whatsapp = expectOk('whatsapp config', await http('GET', `${app}/api/whatsapp/config`, { headers: biz.cookie })) as { config: unknown; connect: { open?: unknown; soon?: { mark?: string; text?: string; link?: string } } }
  check('a business that is not connected is told, yes or no, whether it can connect today', whatsapp.config === null && typeof whatsapp.connect.open === 'boolean', whatsapp.connect)
  check('with the words for "Coming soon" and the way to the quote link', whatsapp.connect.soon?.mark === 'Coming soon' && /not open yet/.test(whatsapp.connect.soon?.text ?? '') && whatsapp.connect.soon?.link === 'Open Quote link', whatsapp.connect.soon)
}
