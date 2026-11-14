/**
 * T-160: a sectioned menu, a fuller Home, unfinished requests that clear, and
 * the sign-in line.
 *
 * Covered here: the seen/handled rules, the activity feed builder, the 30-day
 * comparison, the empty state, the menu and the renames.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { QUOTE_TURN_COPY, agoWords, quoteActivityLine } from '@estimator/shared'
import {
  HOME_ACTIVITY_LIMIT,
  buildHomeActivity,
  changeWords,
  compareHomeNumbers,
  homeNumbers,
  numberChange,
  type HomeQuoteRow,
} from '@/lib/home-numbers'
import {
  LEAD_ID,
  UNFINISHED_WINDOW_DAYS,
  isUnfinishedListed,
  isUnfinishedNew,
  unfinishedFilter,
  unfinishedSince,
} from '@/lib/unfinished-leads'
import { buildChecklist } from '@/lib/setup-checklist'
import { HERO } from '@/lib/marketing/home-copy'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = join(ROOT, 'apps/web')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const now = new Date('2026-11-13T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 60 * 60 * 1000).toISOString()

// ---------------------------------------------------------------------------
describe('unfinished requests: seen and handled', () => {
  const lead = (extra: Partial<{ created_at: string; completed_at: string | null; handled_at: string | null; seen_at: string | null }> = {}) => ({
    created_at: ago(2),
    completed_at: null,
    handled_at: null,
    seen_at: null,
    ...extra,
  })

  it('a person who started and did not finish is listed, and new until the business sees them', () => {
    expect(isUnfinishedListed(lead(), now)).toBe(true)
    expect(isUnfinishedNew(lead(), now)).toBe(true)
  })

  it('seen: still listed, no longer new (the banner and the badge clear)', () => {
    const seen = lead({ seen_at: ago(1) })
    expect(isUnfinishedListed(seen, now)).toBe(true)
    expect(isUnfinishedNew(seen, now)).toBe(false)
  })

  it('done: off the list and out of every count, seen or not', () => {
    expect(isUnfinishedListed(lead({ handled_at: ago(0) }), now)).toBe(false)
    expect(isUnfinishedNew(lead({ handled_at: ago(0) }), now)).toBe(false)
    expect(isUnfinishedListed(lead({ handled_at: ago(0), seen_at: ago(1) }), now)).toBe(false)
  })

  it('finished (it became a quote): never listed', () => {
    expect(isUnfinishedListed(lead({ completed_at: ago(1) }), now)).toBe(false)
    expect(isUnfinishedNew(lead({ completed_at: ago(1) }), now)).toBe(false)
  })

  it(`older than ${UNFINISHED_WINDOW_DAYS} days: off the list, and not counted as new`, () => {
    expect(isUnfinishedListed(lead({ created_at: ago(UNFINISHED_WINDOW_DAYS - 1) }), now)).toBe(true)
    expect(isUnfinishedListed(lead({ created_at: ago(UNFINISHED_WINDOW_DAYS + 1) }), now)).toBe(false)
    expect(isUnfinishedNew(lead({ created_at: ago(UNFINISHED_WINDOW_DAYS + 1) }), now)).toBe(false)
  })

  it('a new person after the list was opened counts again', () => {
    const people = [lead({ created_at: ago(3), seen_at: ago(1) }), lead({ created_at: ago(2), seen_at: ago(1) }), lead({ created_at: ago(0, 1) })]
    expect(people.filter((p) => isUnfinishedNew(p, now))).toHaveLength(1)
    expect(people.filter((p) => isUnfinishedListed(p, now))).toHaveLength(3)
  })

  /** A stand-in for the query builder that records the filters put on it */
  function recorder() {
    const calls: string[] = []
    const q = {
      calls,
      eq(column: string, value: string) {
        calls.push(`eq ${column} ${value}`)
        return q
      },
      is(column: string, value: null) {
        calls.push(`is ${column} ${value}`)
        return q
      },
      gte(column: string, value: string) {
        calls.push(`gte ${column} ${value}`)
        return q
      },
    }
    return q
  }

  it('the database filter is the same rule, always for one tenant', () => {
    const listed = unfinishedFilter(recorder(), 'tnt_a', { now })
    expect(listed.calls).toEqual([
      'eq tenant_id tnt_a',
      'is completed_at null',
      'is handled_at null',
      `gte created_at ${unfinishedSince(now)}`,
    ])
    const fresh = unfinishedFilter(recorder(), 'tnt_a', { now, newOnly: true })
    expect(fresh.calls).toEqual([...listed.calls, 'is seen_at null'])
    expect(unfinishedSince(now)).toBe(ago(UNFINISHED_WINDOW_DAYS))
  })

  it('every reader uses that one rule: the list, its tab count, the menu badge and Home', () => {
    for (const path of [
      'apps/web/src/app/api/leads/route.ts',
      'apps/web/src/app/api/leads/new-count/route.ts',
      'apps/web/src/app/api/quotes/route.ts',
      'apps/web/src/app/(dashboard)/app/page.tsx',
    ]) {
      const source = read(path)
      expect(source, path).toContain('unfinishedFilter(')
      // no reader filters the table by hand
      expect(source, path).not.toMatch(/from\('request_leads'\)[\s\S]{0,200}\.is\('completed_at', null\)/)
    }
    expect(read('apps/web/src/app/api/leads/new-count/route.ts')).toContain('newOnly: true')
    expect(read('apps/web/src/app/(dashboard)/app/page.tsx')).toMatch(/unfinishedFilter\([\s\S]{0,200}newOnly: true/)
    // the list and its tab count show everyone, seen or not
    expect(read('apps/web/src/app/api/leads/route.ts')).not.toContain('newOnly')
    expect(read('apps/web/src/app/api/quotes/route.ts')).not.toContain('newOnly')
  })

  it('reading the list changes nothing; marking is a separate signed-in, tenant-scoped write', () => {
    const list = read('apps/web/src/app/api/leads/route.ts')
    expect(list).not.toMatch(/\.update\(|createAdminClient/)

    const seen = read('apps/web/src/app/api/leads/seen/route.ts')
    expect(seen).toContain('requireTenant()')
    expect(seen.indexOf('requireTenant()')).toBeLessThan(seen.indexOf('createAdminClient()'))
    expect(seen).toMatch(/unfinishedFilter\([\s\S]*auth\.tenantId,\s*\{ newOnly: true/)
    // only the people who were on the screen
    expect(seen).toContain(".lte('created_at', asOf.toISOString())")

    const done = read('apps/web/src/app/api/leads/[leadId]/done/route.ts')
    expect(done).toContain('requireTenant()')
    expect(done.indexOf('requireTenant()')).toBeLessThan(done.indexOf('createAdminClient()'))
    // looked up and written by id AND tenant, both times
    expect(done.match(/\.eq\('id', leadId\)\s*\n\s*\.eq\('tenant_id', auth\.tenantId\)/g)).toHaveLength(2)
    expect(done).toContain('LEAD_ID.test(leadId)')
    // no customer details in logs
    for (const source of [seen, done]) expect(source).not.toMatch(/console\.\w+\([^)]*(customer|email|phone)/i)
  })

  it('lead ids are plain ids', () => {
    expect(LEAD_ID.test('lead_3f9a2c1b')).toBe(true)
    for (const bad of ['', 'a b', "x'; --", '../x', 'a'.repeat(81)]) expect(LEAD_ID.test(bad), bad).toBe(false)
  })

  it('migration 39 adds the two columns, additive and re-runnable, with no new write policy', () => {
    const sql = read('supabase/migrations/00000000000039_unfinished_requests_seen.sql')
    expect(sql).toMatch(/ALTER TABLE request_leads ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;/)
    expect(sql).toMatch(/ALTER TABLE request_leads ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;/)
    expect(sql).not.toMatch(/CREATE POLICY|NOT NULL|DROP COLUMN/)
    expect(existsSync(join(ROOT, 'scripts/deploy-migration-39.sh'))).toBe(true)
  })

  it('wording', () => {
    const U = QUOTE_TURN_COPY.unfinished
    expect(U.banner(2)).toBe("new people started a request but didn't finish. A quick call often wins the job.")
    expect(U.banner(1)).toBe("new person started a request but didn't finish. A quick call often wins the job.")
    expect(U.bannerButton).toBe('See who')
    expect(U.newTag).toBe('New')
    expect(U.done).toBe('Done')
    expect(U.doneNote).toBe("Marked as done. They won't show here again.")
    expect(U.saveFailed).toBe('Could not save that. Please try again.')
    expect(read('apps/web/src/app/(dashboard)/app/page.tsx')).not.toContain('in the last 7 days')
  })
})

// ---------------------------------------------------------------------------
describe('latest activity', () => {
  const since = new Date(now.getTime() - 30 * DAY)
  const quote = (id: string, name: string, extra: Partial<HomeQuoteRow> = {}): HomeQuoteRow => ({
    id,
    customer_name: name,
    status: 'sent',
    created_at: ago(40),
    sent_at: null,
    accepted_at: null,
    pricing_json: { total: 100 },
    ...extra,
  })

  it('reads each event from a timestamp the quote already carries, newest first', () => {
    const events = buildHomeActivity(
      [
        quote('q1', 'Sarah Okafor', { status: 'accepted', created_at: ago(5), approved_at: ago(4), viewed_at: ago(3), accepted_at: ago(2) }),
        quote('q2', 'Dev Patel', { status: 'declined', created_at: ago(6), approved_at: ago(5, 12), declined_at: ago(1) }),
      ],
      [{ quote_id: 'q1', created_at: ago(2, 12), customer_name: 'Sarah Okafor' }],
      since,
      20
    )
    expect(events.map((e) => `${e.kind} ${e.quoteId}`)).toEqual([
      'declined q2',
      'accepted q1',
      'question q1',
      'opened q1',
      'approved q1',
      'request q1',
      'approved q2',
      'request q2',
    ])
    expect(events[0]).toEqual({ kind: 'declined', quoteId: 'q2', customerName: 'Dev Patel', at: ago(1) })
  })

  it(`keeps the newest ${HOME_ACTIVITY_LIMIT}`, () => {
    const rows = Array.from({ length: 10 }, (_, i) => quote(`q${i}`, `Person ${i}`, { created_at: ago(i + 1) }))
    const events = buildHomeActivity(rows, [], since)
    expect(events).toHaveLength(HOME_ACTIVITY_LIMIT)
    expect(events.map((e) => e.quoteId)).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5'])
  })

  it('leaves out setup tests, on quotes and on questions', () => {
    const events = buildHomeActivity(
      [quote('test', 'Owner Test', { is_test: true, created_at: ago(1), viewed_at: ago(1) }), quote('real', 'Sarah Okafor', { created_at: ago(2) })],
      [
        { quote_id: 'test', created_at: ago(0, 1), customer_name: 'Owner Test', is_test: true },
        { quote_id: 'real', created_at: ago(0, 2), customer_name: 'Sarah Okafor', is_test: false },
      ],
      since
    )
    expect(events.map((e) => `${e.kind} ${e.quoteId}`)).toEqual(['question real', 'request real'])
  })

  it('a quote the business made in its own app is not "a request", but its other events show', () => {
    const events = buildHomeActivity([quote('app', 'Sarah Okafor', { source_type: 'app', created_at: ago(3), viewed_at: ago(2) })], [], since)
    expect(events.map((e) => e.kind)).toEqual(['opened'])
  })

  it('accepted and declined show only while the quote is in that state', () => {
    // a date left on a quote that is no longer accepted or declined
    const events = buildHomeActivity(
      [quote('q1', 'Sarah Okafor', { status: 'sent', accepted_at: ago(2), declined_at: ago(1) }), quote('q2', 'Dev Patel', { status: 'paid', accepted_at: ago(3) })],
      [],
      since
    )
    expect(events.map((e) => `${e.kind} ${e.quoteId}`)).toEqual(['accepted q2'])
  })

  it('nothing older than the window, nothing without a date or an id', () => {
    const events = buildHomeActivity(
      [
        quote('old', 'Sarah Okafor', { created_at: ago(45), viewed_at: ago(31) }),
        quote('edge', 'Dev Patel', { created_at: ago(40), viewed_at: ago(29) }),
        { ...quote('', 'No Id', { created_at: ago(1) }), id: undefined },
        quote('bad', 'Bad Date', { created_at: 'not a date' }),
      ],
      [],
      since
    )
    expect(events.map((e) => `${e.kind} ${e.quoteId}`)).toEqual(['opened edge'])
    expect(buildHomeActivity(null, null, since)).toEqual([])
  })

  it('wording: who did what, with no "his" or "her"', () => {
    expect(quoteActivityLine('request', 'Sarah Okafor')).toBe('Sarah sent a request')
    expect(quoteActivityLine('approved', 'Sarah Okafor')).toBe("You approved Sarah's quote")
    expect(quoteActivityLine('opened', 'Sarah Okafor')).toBe('Sarah opened the quote')
    expect(quoteActivityLine('question', 'Sarah Okafor')).toBe('Sarah asked a question')
    expect(quoteActivityLine('accepted', 'Sarah Okafor')).toBe('Sarah accepted the quote')
    expect(quoteActivityLine('declined', 'Sarah Okafor')).toBe('Sarah declined the quote')
    for (const kind of ['request', 'approved', 'opened', 'question', 'accepted', 'declined'] as const) {
      expect(quoteActivityLine(kind, 'Sarah Okafor')).not.toMatch(/\b(his|her|him|she|he)\b/i)
    }
    // no name
    expect(quoteActivityLine('opened', '')).toBe('A customer opened the quote')
    expect(quoteActivityLine('approved', null)).toBe('You approved a quote')
  })

  it('time: by the clock, then the date', () => {
    const o = { now, locale: 'en-GB', timeZone: 'UTC' }
    expect(agoWords(new Date(now.getTime() - 20_000).toISOString(), o)).toBe('just now')
    expect(agoWords(new Date(now.getTime() - 60_000).toISOString(), o)).toBe('1 minute ago')
    expect(agoWords(new Date(now.getTime() - 5 * 60_000).toISOString(), o)).toBe('5 minutes ago')
    expect(agoWords(ago(0, 1), o)).toBe('1 hour ago')
    expect(agoWords(ago(0, 2), o)).toBe('2 hours ago')
    expect(agoWords(ago(0, 23), o)).toBe('23 hours ago')
    expect(agoWords(ago(1), o)).toBe('yesterday')
    expect(agoWords(ago(3), o)).toBe('3 days ago')
    expect(agoWords(ago(6, 23), o)).toBe('6 days ago')
    expect(agoWords(ago(7), o)).toBe('on 6 Nov')
    // a clock a little ahead, or no date
    expect(agoWords(new Date(now.getTime() + 60_000).toISOString(), o)).toBe('just now')
    expect(agoWords(null, o)).toBeNull()
    expect(agoWords('nonsense', o)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('the last 30 days against the 30 before', () => {
  const since = new Date(now.getTime() - 30 * DAY)
  const before = new Date(now.getTime() - 60 * DAY)
  const row = (extra: Partial<HomeQuoteRow>): HomeQuoteRow => ({ status: 'sent', created_at: ago(90), sent_at: null, accepted_at: null, pricing_json: { total: 0 }, ...extra })
  const rows: HomeQuoteRow[] = [
    // this period: 3 requests, 2 sent, 1 accepted worth 900
    row({ created_at: ago(2), sent_at: ago(2) }),
    row({ created_at: ago(5), sent_at: ago(4), accepted_at: ago(3), status: 'accepted', pricing_json: { total: 900 } }),
    row({ created_at: ago(9), status: 'pending_review' }),
    // the period before: 1 request, 1 sent, 2 accepted worth 2,100
    row({ created_at: ago(40), sent_at: ago(39), accepted_at: ago(35), status: 'accepted', pricing_json: { total: 1500 } }),
    row({ created_at: ago(70), sent_at: ago(65), accepted_at: ago(45), status: 'paid', pricing_json: { total: 600 } }),
    // a setup test never counts, in either period
    row({ created_at: ago(1), sent_at: ago(1), accepted_at: ago(1), status: 'accepted', pricing_json: { total: 5000 }, is_test: true }),
    row({ created_at: ago(50), sent_at: ago(50), is_test: true }),
  ]

  it('each period counts only what happened inside it', () => {
    expect(homeNumbers(rows, since)).toEqual({ requests: 3, sent: 2, accepted: 1, valueAccepted: 900 })
    expect(homeNumbers(rows, before, since)).toEqual({ requests: 1, sent: 1, accepted: 2, valueAccepted: 2100 })
    // the boundary belongs to the newer period only
    const onTheLine = [row({ created_at: since.toISOString() })]
    expect(homeNumbers(onTheLine, since).requests).toBe(1)
    expect(homeNumbers(onTheLine, before, since).requests).toBe(0)
  })

  it('up, down and same', () => {
    const changes = compareHomeNumbers(homeNumbers(rows, since), homeNumbers(rows, before, since))!
    expect(changes).toEqual({
      requests: { direction: 'up', by: 2 },
      sent: { direction: 'up', by: 1 },
      accepted: { direction: 'down', by: 1 },
      valueAccepted: { direction: 'down', by: 1200 },
    })
    expect(changeWords(changes.requests)).toBe('up 2')
    expect(changeWords(changes.accepted)).toBe('down 1')
    expect(changeWords(changes.valueAccepted, (n) => `$${n.toLocaleString('en-US')}`)).toBe('down $1,200')
    expect(changeWords(numberChange(4, 4))).toBe('same')
    expect(numberChange(0, 3)).toEqual({ direction: 'down', by: 3 })
  })

  it('money is compared the way it is shown, in whole units', () => {
    const a = { requests: 1, sent: 1, accepted: 1, valueAccepted: 900.4 }
    const b = { requests: 1, sent: 1, accepted: 1, valueAccepted: 899.6 }
    expect(compareHomeNumbers(a, b)!.valueAccepted).toEqual({ direction: 'same', by: 0 })
  })

  it('nothing in either period: no comparison at all (a new business sees no row of "same")', () => {
    const none = { requests: 0, sent: 0, accepted: 0, valueAccepted: 0 }
    expect(compareHomeNumbers(none, none)).toBeNull()
    // something in just one of them is a comparison
    expect(compareHomeNumbers(none, { ...none, requests: 2 })!.requests).toEqual({ direction: 'down', by: 2 })
    expect(compareHomeNumbers({ ...none, requests: 1 }, none)!.sent).toEqual({ direction: 'same', by: 0 })
  })

  it('wording', () => {
    const N = QUOTE_TURN_COPY.home.numbers
    expect(N.title(30)).toBe('Last 30 days')
    expect(N.note(30)).toBe('Compared with the 30 days before.')
    expect([N.requests, N.sent, N.accepted, N.valueAccepted]).toEqual(['Requests', 'Estimates sent', 'Accepted', 'Value accepted'])
  })
})

// ---------------------------------------------------------------------------
describe('Home', () => {
  const home = read('apps/web/src/app/(dashboard)/app/page.tsx')

  it('order: waiting, unfinished, checklist, where quotes stand, activity, quote link, numbers', () => {
    const order = ['<WaitingForYou', 'data-testid="unfinished-count"', 'data-testid="setup-checklist"', '<QuoteStand', '<LatestActivity', '<HomeQuoteLink', 'data-testid="home-numbers"'].map((s) =>
      home.indexOf(s)
    )
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('a new business sees a friendly line, not zeros and an empty box', () => {
    const S = QUOTE_TURN_COPY.home.stand
    const A = QUOTE_TURN_COPY.home.activity
    expect(S.empty).toBe('No quotes yet. When a customer sends a request, you will see here whose turn it is.')
    expect(A.empty).toBe('Nothing has happened yet. New requests, opens and answers will show here.')
    expect(A.quiet).toBe('Nothing in the last 30 days.')
    const stand = read('apps/web/src/components/home/QuoteStand.tsx')
    expect(stand).toMatch(/hasQuotes \? \([\s\S]*\) : \([\s\S]*\{S\.empty\}/)
    const activity = read('apps/web/src/components/home/LatestActivity.tsx')
    expect(activity).toContain('{hasQuotes ? A.quiet : A.empty}')
    // "has quotes" is asked of the database, not guessed from the last 30 days
    expect(home).toMatch(/const hasQuotes = \(anyQuoteResult\.count \?\? 0\) > 0/)
  })

  it('where your quotes stand uses the T-158 groups and names, and each count opens its tab', () => {
    const stand = read('apps/web/src/components/home/QuoteStand.tsx')
    expect(QUOTE_TURN_COPY.home.stand.title).toBe('Where your quotes stand')
    expect(QUOTE_TURN_COPY.home.stand.acceptedNote).toBe('in the last 30 days')
    for (const label of ['T.needs_you', 'T.waiting', 'T.accepted']) expect(stand).toContain(label)
    expect(stand).toContain('href={`/app/quotes?tab=${tile.key}`}')
    expect(home).toContain('QUOTE_GROUP_STATUSES.waiting')
    // the quotes page opens the tab named in the address
    expect(read('apps/web/src/app/(dashboard)/app/quotes/page.tsx')).toContain("searchParams.get('tab')")
  })

  it('test quotes stay out of every new count, and every query is for the signed-in tenant', () => {
    // the two new counts and the existing lists
    expect(home.match(/\.eq\('is_test', false\)/g)?.length).toBeGreaterThanOrEqual(4)
    const queries = home.match(/\.from\('(quotes|quote_feedback|services|tenants)'\)[\s\S]*?(?=\n\s*supabase\b|\n\s*\]\)|\n\s*checkPlanLimit)/g) ?? []
    expect(queries.length).toBeGreaterThanOrEqual(7)
    for (const q of queries) expect(q, q.slice(0, 80)).toMatch(/\.eq\('(tenant_id|id)', profile\.tenant_id\)/)
    expect(home).toMatch(/unfinishedFilter\([\s\S]{0,160}profile\.tenant_id/)
  })

  it('a fixed number of queries: nothing is fetched per quote', () => {
    expect(home.match(/await /g)?.length).toBeLessThanOrEqual(8)
    expect(home).not.toMatch(/\.map\(async|for \(const [^)]*\) \{[\s\S]{0,200}await supabase/)
  })

  it('your quote link: Copy, Open and the way to the Quote link page', () => {
    const Q = QUOTE_TURN_COPY.home.quoteLink
    expect([Q.title, Q.copy, Q.copied, Q.open, Q.more]).toEqual(['Your quote link', 'Copy', 'Copied', 'Open', 'QR code and website form'])
    const block = read('apps/web/src/components/home/HomeQuoteLink.tsx')
    expect(block).toContain('href="/app/quote-link"')
    expect(block).toContain('useCopy()')
  })
})

// ---------------------------------------------------------------------------
describe('the menu, in sections', () => {
  const layout = read('apps/web/src/app/(dashboard)/layout.tsx')
  const section = (key: string) => {
    const start = layout.indexOf(`key: '${key}',\n    label:`)
    const end = layout.indexOf('\n  },', start)
    return [...layout.slice(start, end).matchAll(/\{ key: '([^']+)', href: '([^']+)', label: M\.(\w+)/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`)
  }

  it('Work, Set up, Account', () => {
    expect(section('work')).toEqual(['home /app home', 'quotes /app/quotes quotes', 'unfinished /app/quotes?filter=unfinished unfinished', 'analytics /app/analytics analytics'])
    expect(section('set-up')).toEqual(['services /app/services services', 'quote-link /app/quote-link quoteLink', 'whatsapp /app/whatsapp whatsapp'])
    expect(section('account')).toEqual(['settings /app/settings settings'])
    const M = QUOTE_TURN_COPY.menu
    expect(M.sections).toEqual({ work: 'Work', setUp: 'Set up', account: 'Account' })
    expect([M.home, M.quotes, M.unfinished, M.analytics, M.services, M.quoteLink, M.whatsapp, M.settings]).toEqual([
      'Home',
      'Quotes',
      'Unfinished requests',
      'Analytics',
      'Services',
      'Quote link',
      'WhatsApp',
      'Settings',
    ])
  })

  it('no SMS item; the page still exists', () => {
    expect(layout).not.toMatch(/href: '\/app\/sms'|label: M\.sms/)
    expect(existsSync(join(WEB, 'src/app/(dashboard)/app/sms/page.tsx'))).toBe(true)
  })

  it('the same sections are the phone menu, and the badge shows only new unfinished requests', () => {
    // one panel, used for the desktop sidebar and the slide-in phone menu
    expect(layout.match(/<NavWithFilter /g)).toHaveLength(1)
    expect(layout).toContain("fetch('/api/leads/new-count')")
    expect(layout).toContain("badge={item.key === 'unfinished' ? badge : 0}")
    expect(layout).toContain('UNFINISHED_CHANGED_EVENT')
  })

  it('"Services" and "Quote link" replace "Prices" and "Share" as page names', async () => {
    expect(read('apps/web/src/app/(dashboard)/app/services/page.tsx')).toContain('title="Services"')
    expect(read('apps/web/src/components/share/SharePageClient.tsx')).toContain(
      '<PageHeader title="Quote link" description="Give customers this link, or put the form on your website." />'
    )
    const config = (await import(join(WEB, 'next.config.js'))).default as { redirects: () => Promise<Array<{ source: string; destination: string }>> }
    const redirects = Object.fromEntries((await config.redirects()).map((r) => [r.source, r.destination]))
    expect(redirects['/app/prices']).toBe('/app/services')
    expect(redirects['/app/share']).toBe('/app/quote-link')
    expect(redirects['/app/widget']).toBe('/app/quote-link')
    for (const gone of ['prices', 'share', 'widget']) expect(existsSync(join(WEB, 'src/app/(dashboard)/app', gone, 'page.tsx')), gone).toBe(false)
    // nothing in the app still links to the old addresses
    for (const path of [
      'apps/web/src/app/(dashboard)/layout.tsx',
      'apps/web/src/app/(dashboard)/app/quotes/page.tsx',
      'apps/web/src/app/(dashboard)/app/analytics/page.tsx',
      'apps/web/src/components/onboarding/TestQuoteStep.tsx',
      'apps/web/src/components/onboarding/OnboardingFlow.tsx',
      'apps/web/src/lib/setup-checklist.ts',
    ]) {
      expect(read(path), path).not.toMatch(/['"`]\/app\/(prices|share|widget)['"`?]/)
    }
  })

  it('the checklist keeps its words and points at the renamed pages', () => {
    const steps = buildChecklist({ hasService: false, pricesCheckedAt: null, quoteLinkCopiedAt: null, quoteLinkFirstVisitAt: null, hasRealRequest: false }).steps
    expect(steps.map((s) => `${s.label} -> ${s.href}`)).toEqual([
      'Add a service -> /app/services',
      'Check your prices -> /app/services',
      'Share your quote link -> /app/quote-link',
      'First real request received -> /app/quotes',
    ])
  })
})

// ---------------------------------------------------------------------------
describe('sign-in line and settings wording', () => {
  it('the auth pages show the home page headline', () => {
    const auth = read('apps/web/src/app/(auth)/layout.tsx')
    expect(auth).toContain('{HERO.headline}')
    expect(auth).not.toContain('AI-powered estimates for your business')
    expect(HERO.headline).toBe('Instant quotes on your website, in your prices.')
  })

  it('"Notification Email (Override)" is "Send notifications to"', () => {
    const settings = read('apps/web/src/components/settings/NotificationsSettings.tsx')
    expect(settings).toContain('Send notifications to')
    expect(settings).not.toContain('Notification Email (Override)')
  })
})
