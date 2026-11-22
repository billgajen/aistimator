/**
 * T-197: the Help button, problem and estimate reports, feature requests and
 * the support inbox. The rules are pure (packages/shared); the inbox's own
 * actions are run here against a database held in memory and a mailer that
 * only records.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  AI_TASKS,
  ESTIMATE_CHOICES,
  FEATURE_MATCH_MAX,
  SUPPORT_COPY,
  SUPPORT_DAILY_LIMIT,
  SUPPORT_EMAIL,
  TICKET_SAFETY_LINE,
  browserName,
  buildMatchPrompt,
  buildSortPrompt,
  buildTitlePrompt,
  byPriority,
  byVotes,
  checkEstimateInput,
  checkFeatureText,
  checkProblemInput,
  cleanSupportContext,
  estimateDigest,
  featureShippedEmail,
  fixedRecipients,
  formatFixTicket,
  helpLink,
  opsAlertEmail,
  parseHelpParam,
  parseMatchAnswer,
  parseSortAnswer,
  parseTitleAnswer,
  quoteIdOfPath,
  resolveModelRoute,
  scrubCustomerDetails,
  setupHintFor,
  shippedRecipients,
  supportContextLines,
  supportDailyEmail,
  supportFixedEmail,
  supportReplyEmail,
  ticketWithBusinesses,
  titleFromWords,
  underDailyLimit,
  type SortInput,
  type SupportEmail,
} from '@qolumns/shared'
import { memoryDb, type MemRow } from '../../../../packages/shared/src/testing/memory-db'
import { planOf, sentToday, serviceTemplateOf } from '@/lib/support'
import { attachedReports, listFeatures, listProblems, markFixed, markShipped, mergeFeature, mergeProblem, newSupportCount, replyToReport, splitFeature, unmergeProblem, type SupportMailer } from '@/lib/support-admin'
import { gatherContext, lastShownError } from '@/lib/help-context'
import { listPacks } from '@/lib/vertical-packs'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/00000000000047_support.sql')

/** A customer whose details must never reach the AI or a log */
const CUSTOMER = { name: 'Megan Grant', email: 'megan.grant@example.test', phone: '+1 (314) 555-0142', address: '12 Alder Close, Ballwin' }

afterEach(() => vi.restoreAllMocks())

// ---------------------------------------------------------------------------
describe('migration 47: who can read and write what', () => {
  const TABLES = ['support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes']
  const policies = [...MIGRATION.matchAll(/CREATE POLICY "[^"]+" ON (\w+)\s+FOR (\w+) TO (\w+)/g)].map((m) => ({ table: m[1]!, command: m[2]!, role: m[3]! }))

  it('turns row-level rules on for every table, and closes every table to a signed-out caller', () => {
    for (const table of TABLES) {
      expect(MIGRATION).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
      expect(MIGRATION).toMatch(new RegExp(`REVOKE ALL ON ${table} FROM anon`))
    }
  })

  it('gives the owner’s side no policy at all: only the service role reads the sorting, the ticket and the note', () => {
    expect(policies.filter((p) => p.table === 'support_report_internal')).toEqual([])
    expect(MIGRATION).toContain('REVOKE ALL ON support_report_internal FROM anon, authenticated')
    expect(MIGRATION).not.toMatch(/GRANT [A-Z, ]+ ON support_report_internal/)
  })

  it('lets a business read and add its own reports and thread, and change or delete nothing', () => {
    expect(policies.filter((p) => p.table === 'support_reports').map((p) => p.command).sort()).toEqual(['INSERT', 'SELECT'])
    expect(policies.filter((p) => p.table === 'support_messages').map((p) => p.command).sort()).toEqual(['INSERT', 'SELECT'])
    expect(MIGRATION).toContain('GRANT SELECT, INSERT ON support_reports TO authenticated')
    expect(MIGRATION).toContain('GRANT SELECT, INSERT ON support_messages TO authenticated')
    expect(MIGRATION).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*ON (support_|feature_)/)
  })

  it('lets a business only read its own votes and the requests it voted for', () => {
    expect(policies.filter((p) => p.table.startsWith('feature_')).map((p) => `${p.table}:${p.command}`).sort()).toEqual(['feature_requests:SELECT', 'feature_votes:SELECT'])
    expect(MIGRATION).toContain('GRANT SELECT ON feature_requests TO authenticated')
    expect(MIGRATION).toContain('GRANT SELECT ON feature_votes TO authenticated')
  })

  it('ties every policy to the signed-in user’s own business, and no policy is for anyone signed out', () => {
    const blocks = MIGRATION.split('CREATE POLICY').slice(1)
    expect(blocks.length).toBe(6)
    for (const block of blocks) expect(block.split(';')[0]).toContain('SELECT tenant_id FROM user_profiles WHERE id = auth.uid()')
    expect(policies.every((p) => p.role === 'authenticated')).toBe(true)
  })

  it('a new report is the sender’s own, starts as new, carries nothing of ours, and can name only its own estimate and upload', () => {
    const insert = MIGRATION.split('"Businesses can add own support reports"')[2]!.split(';')[0]!
    for (const rule of ['user_id = auth.uid()', "status = 'new'", 'setup_hint IS NULL', 'reply_unread = FALSE', 'q.tenant_id = support_reports.tenant_id', 'a.tenant_id = support_reports.tenant_id']) expect(insert).toContain(rule)
  })

  it('a business writes only its own side of a thread, on its own report', () => {
    const insert = MIGRATION.split('"Businesses can add own support messages"')[2]!.split(';')[0]!
    for (const rule of ["author = 'business'", 'user_id = auth.uid()', 'r.tenant_id = support_messages.tenant_id']) expect(insert).toContain(rule)
  })

  it('one vote per business per request is the table’s own rule', () => {
    expect(MIGRATION).toMatch(/UNIQUE \(request_id, tenant_id\)/)
  })

  it('a closed account’s reports, threads and votes are deleted with the rest of its data', () => {
    for (const table of ['support_reports', 'support_messages', 'feature_votes']) {
      const body = MIGRATION.split(`CREATE TABLE IF NOT EXISTS ${table} (`)[1]!.split(');')[0]!
      expect(body).toContain('tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE')
    }
    expect(MIGRATION).toContain('report_id UUID PRIMARY KEY REFERENCES support_reports(id) ON DELETE CASCADE')
  })

  it('adds only: nothing is dropped except its own policies and triggers, and no existing table is altered', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/)
    const altered = [...MIGRATION.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1])
    expect(altered.every((table) => TABLES.includes(table!))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('the routes: every one is the signed-in business’s own, or the platform admin’s', () => {
  const routesUnder = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((name) => {
      const path = `${dir}/${name}`
      return statSync(join(ROOT, path)).isDirectory() ? routesUnder(path) : name === 'route.ts' ? [path] : []
    })

  it('a business route starts by finding the signed-in user’s business, and reads with that business’s id', () => {
    const routes = routesUnder('apps/web/src/app/api/support')
    // T-198 added the assistant's two routes (ask, and the rating of one answer)
    expect(routes.length).toBe(8)
    for (const route of routes) {
      const source = read(route)
      const handlers = source.split(/export async function (?:GET|POST)/).slice(1)
      expect(handlers.length).toBeGreaterThan(0)
      for (const handler of handlers) {
        const first = handler.split('\n').slice(1, 3).join('\n')
        expect(first, route).toMatch(/const auth = await (requireTenant|currentTenant)\(\)\s*\n\s*if \(!auth\.ok\) return auth\.response/)
      }
      expect(source, route).toContain('auth.tenantId')
      // the business in a request's body or address is never used
      expect(source, route).not.toMatch(/body\??\.tenant|searchParams\.get\('tenant/)
    }
  })

  it('an inbox route refuses anyone who is not the platform admin before it does anything', () => {
    const routes = routesUnder('apps/web/src/app/api/admin/support')
    // T-198 added one question's route
    expect(routes.length).toBe(4)
    for (const route of routes) {
      const source = read(route)
      for (const handler of source.split(/export async function (?:GET|POST)/).slice(1)) {
        const first = handler.split('\n').slice(1, 3).join('\n')
        expect(first, route).toMatch(/verifyAdmin\(\)/)
        expect(handler.indexOf('verifyAdmin()'), route).toBeLessThan(handler.indexOf('createAdminClient()'))
      }
    }
  })

  it('no business route imports the inbox’s own code', () => {
    for (const route of routesUnder('apps/web/src/app/api/support')) expect(read(route)).not.toContain('support-admin')
  })

  it('the Help panel is part of the dashboard only: the mobile app is not changed', () => {
    expect(read('apps/web/src/app/(dashboard)/layout.tsx')).toContain('<HelpPanel')
    const mobile = readdirSync(join(ROOT, 'apps/mobile/src/lib')).join(' ')
    expect(mobile).not.toMatch(/support|help/i)
  })
})

// ---------------------------------------------------------------------------
describe('what a business sends', () => {
  it('a problem report needs words', () => {
    expect(checkProblemInput({ body: '   ' })).toMatchObject({ ok: false, message: SUPPORT_COPY.problem.required })
    expect(checkProblemInput({ body: ' The page is blank. ' })).toMatchObject({ ok: true, value: { body: 'The page is blank.', screenshotAssetId: null } })
  })

  it('keeps only what we attach, each a short plain value: a page is a path of ours, never a whole address', () => {
    const context = cleanSupportContext({
      page: '/app/quotes/qte_1?token=secret#x',
      quoteId: 'qte_1',
      browser: 'Chrome 141 on macOS',
      screen: '1440 × 900',
      lastError: 'x'.repeat(900),
      tenantId: 'tnt_other',
      cookies: 'a=b',
    })
    expect(context).toEqual({ page: '/app/quotes/qte_1', quoteId: 'qte_1', browser: 'Chrome 141 on macOS', screen: '1440 × 900', lastError: 'x'.repeat(300) })
    expect(cleanSupportContext({ page: 'https://evil.test/app', screen: 'big', quoteId: 'a b' })).toEqual({})
    expect(cleanSupportContext(null)).toEqual({})
  })

  it('finds the quote a dashboard page is about', () => {
    expect(quoteIdOfPath('/app/quotes/qte_9/trace')).toBe('qte_9')
    expect(quoteIdOfPath('/app/quotes/qte_9')).toBe('qte_9')
    expect(quoteIdOfPath('/app/quotes')).toBeNull()
    expect(quoteIdOfPath('/app/settings')).toBeNull()
  })

  it('the "We’ll include" list says the page, the quote, the plan, the browser, the screen and the last error, and leaves out what is not there', () => {
    const context = gatherContext({ pathname: '/app/quotes/qte_9', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', width: 1440, height: 900, plan: 'Pro', lastError: 'Could not send' })
    expect(supportContextLines(context).map((l) => l.label)).toEqual(['The page you were on', 'The quote', 'Your plan', 'Your browser', 'Screen size', 'The last error shown'])
    expect(context).toMatchObject({ quoteId: 'qte_9', browser: 'Chrome 141 on macOS', screen: '1440 × 900' })
    expect(supportContextLines(gatherContext({ pathname: '/app', userAgent: '', width: 390, height: 844 })).map((l) => l.label)).toEqual(['The page you were on', 'Your browser', 'Screen size'])
  })

  it('names a browser shortly', () => {
    expect(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari 18 on iOS')
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge 141 on Windows')
    expect(browserName(null)).toBe('Unknown browser')
  })

  it('the last error shown is one on the page, not one inside the Help panel', () => {
    const el = (text: string, inPanel: boolean) => ({ textContent: text, closest: () => (inPanel ? {} : null) })
    const doc = (els: unknown[]) => ({ querySelectorAll: () => els }) as unknown as Document
    expect(lastShownError(doc([el('  Could not send this quote again ', false), el('Tell us what went wrong.', true)]))).toBe('Could not send this quote again')
    expect(lastShownError(doc([el('Tell us what went wrong.', true)]))).toBeUndefined()
  })

  it('an estimate report needs a choice, words for "Something else", and a figure that is a number', () => {
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: [] })).toMatchObject({ ok: false, message: SUPPORT_COPY.estimate.chooseOne })
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: ['made_up'] })).toMatchObject({ ok: false })
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: ['other'] })).toMatchObject({ ok: false, message: SUPPORT_COPY.estimate.moreNeeded })
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: ['too_high'], expectedTotal: 'lots' })).toMatchObject({ ok: false, code: 'INVALID_TOTAL' })
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: ['too_high'], expectedTotal: -1 })).toMatchObject({ ok: false })
    expect(checkEstimateInput({ choices: ['too_high'] })).toMatchObject({ ok: false, code: 'MISSING_QUOTE' })
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: ['wording', 'too_high', 'too_high'], body: ' odd ', expectedTotal: '1,250.5' })).toEqual({ ok: true, value: { quoteId: 'qte_1', choices: ['too_high', 'wording'], body: 'odd', expectedTotal: 1250.5 } })
    expect(checkEstimateInput({ quoteId: 'qte_1', choices: ['too_low'], expectedTotal: '' })).toMatchObject({ ok: true, value: { expectedTotal: null } })
  })

  it('offers the seven choices of the ticket, in its order', () => {
    expect(ESTIMATE_CHOICES.map((c) => SUPPORT_COPY.choices[c])).toEqual(['Price too high', 'Price too low', 'Wrong measurement or reading', 'Missed something the customer asked for', 'Included something it shouldn’t', 'Wording', 'Something else'])
  })

  it('a feature request needs words; its first title is those words, cut at a word', () => {
    expect(checkFeatureText('  ')).toMatchObject({ ok: false, message: SUPPORT_COPY.feature.required })
    expect(titleFromWords('Export quotes')).toBe('Export quotes')
    const long = titleFromWords('I would really like a way to export every single one of my quotes into a spreadsheet each month')
    expect(long.length).toBeLessThanOrEqual(81)
    expect(long.endsWith('…')).toBe(true)
    expect(long).not.toMatch(/ …$/)
  })

  it('says what the ticket says, promises no time, and gives the support address from its one constant', () => {
    expect(SUPPORT_COPY.problem.thanks).toBe('Thanks, we’ve got it. You’ll see our reply here and by email.')
    expect(SUPPORT_COPY.problem.thanks).not.toMatch(/hour|day|minute|soon|within/i)
    expect(SUPPORT_COPY.emailLine).toBe(`Or email ${SUPPORT_EMAIL}`)
    expect(SUPPORT_COPY.estimate.investigate).toBe('We’ll look at this estimate, its photos and how it was priced to investigate.')
    expect(SUPPORT_COPY.feature.similar).toBe('Others have asked for something similar. Is one of these what you mean?')
    expect([SUPPORT_COPY.feature.yes, SUPPORT_COPY.feature.no, SUPPORT_COPY.feature.already]).toEqual(['Yes, add my vote', 'No, mine is different', 'You’ve already asked for this.'])
    expect(Object.values(SUPPORT_COPY.featureStatus)).toEqual(['Under review', 'Planned', 'Shipped', 'Not planned'])
    expect(Object.values(SUPPORT_COPY.ownerStatus)).toEqual(['New', 'Looking into it', 'Fixed', 'Answered', 'Not a fault'])
    expect(Object.values(SUPPORT_COPY.cause)).toEqual(['Your price setup', 'The AI’s reading of the photos or words', 'A fault in Qolumns', 'Can’t tell'])
    expect(SUPPORT_COPY.setupHint('Rooms', '$375.00 per room')).toBe('This may be down to your prices: Rooms is set to $375.00 per room. Check it in Services.')
  })
})

// ---------------------------------------------------------------------------
describe('the daily limit', () => {
  it(`allows ${SUPPORT_DAILY_LIMIT} a day and refuses the next`, () => {
    expect(SUPPORT_DAILY_LIMIT).toBe(20)
    expect(underDailyLimit(19)).toBe(true)
    expect(underDailyLimit(20)).toBe(false)
    expect(SUPPORT_COPY.limit).toContain('20 today')
  })

  it('fails open: a count that cannot be read allows the report', async () => {
    expect(underDailyLimit(null)).toBe(true)
    expect(underDailyLimit(undefined)).toBe(true)
    expect(underDailyLimit(Number.NaN)).toBe(true)
    const broken = memoryDb({}, { fail: new Set(['support_reports']) }) as unknown as Parameters<typeof sentToday>[0]
    expect(await sentToday(broken, 'support_reports', 'tnt_a')).toBeNull()
    const throwing = { from: () => { throw new Error('down') } } as unknown as Parameters<typeof sentToday>[0]
    expect(await sentToday(throwing, 'feature_votes', 'tnt_a')).toBeNull()
    expect(underDailyLimit(await sentToday(throwing, 'feature_votes', 'tnt_a'))).toBe(true)
  })

  it('counts only this business’s own, in the last day', async () => {
    const now = new Date('2026-11-21T12:00:00Z')
    const db = memoryDb({
      support_reports: [
        { id: '1', tenant_id: 'tnt_a', created_at: '2026-11-21T09:00:00Z' },
        { id: '2', tenant_id: 'tnt_a', created_at: '2026-11-19T09:00:00Z' },
        { id: '3', tenant_id: 'tnt_b', created_at: '2026-11-21T09:00:00Z' },
      ],
    }) as unknown as Parameters<typeof sentToday>[0]
    expect(await sentToday(db, 'support_reports', 'tnt_a', now)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('nothing about a customer reaches the AI', () => {
  const estimate = estimateDigest({
    quoteId: 'qte_1',
    serviceId: 'svc_1',
    serviceName: 'Room refresh',
    status: 'sent',
    pricing: { total: 7500, currency: 'USD', breakdown: [{ label: 'Rooms painted  $3,750 × 2 rooms', amount: 7500 }], estimate: { grade: 'A' } },
    trace: {
      trace: [
        { type: 'work_step', id: 'rooms', description: 'Rooms painted', calculation: '2 room × 3750/room = 7500', amount: 7500, quantitySource: 'form_field', quantityTrusted: true, signalsUsed: [{ key: 'room_count', value: 2 }, { key: 'notes', value: 'Megan says the gate code is 4417' }, { key: 'has_pets', value: true }] },
      ],
      summary: { minimumApplied: false },
    },
    workSteps: [{ id: 'rooms', name: 'Rooms painted', costType: 'per_unit', defaultCost: 3750, unitLabel: 'room' }],
  })
  const input: SortInput = {
    kind: 'estimate',
    words: `Megan Grant (megan.grant@example.test, +1 (314) 555-0142) at 12 Alder Close, Ballwin says two rooms should be about $750. Megan's quote is far too high.`,
    choices: ['too_high'],
    expectedTotal: 750,
    context: { page: '/app/quotes/qte_1', plan: 'Pro', lastError: 'Could not email megan.grant@example.test' },
    customers: [CUSTOMER],
    estimate,
    open: [{ id: 'r-1', title: 'Send again does nothing', summary: 'The button has no effect.' }],
  }

  it('takes the customer’s name, email, phone and address out of the business’s own words', () => {
    const scrubbed = scrubCustomerDetails(input.words, [CUSTOMER])
    expect(scrubbed).not.toMatch(/megan|grant|example\.test|555|alder|ballwin/i)
    expect(scrubbed).toContain('[customer]')
    expect(scrubbed).toContain('two rooms should be about $750')
    // an email or a phone number goes even when we do not know whose it is
    expect(scrubCustomerDetails('call 07700 900123 or write to someone@else.test')).toBe('call [phone] or write to [email]')
    // a short number is a quantity, not a phone
    expect(scrubCustomerDetails('12 rooms at $3,750')).toBe('12 rooms at $3,750')
  })

  it('the prompt for a report carries ids, numbers, line names and the scrubbed words: no name, email, phone, address or customer text', () => {
    const prompt = buildSortPrompt(input)
    expect(prompt).not.toMatch(/megan|grant|example\.test|555-0142|alder|ballwin|gate code/i)
    for (const part of ['qte_1', 'Rooms painted', '$3,750.00 per room', '$7,500.00', 'should have been: $750.00', 'Price too high', 'room_count=2', 'has_pets=true', '1. Send again does nothing']) expect(prompt).toContain(part)
    expect(prompt).not.toContain('notes=')
  })

  it('the estimate as the AI sees it keeps a step’s numbers and yes/no answers, and drops its text answers', () => {
    expect(estimate.steps[0]!.numbers).toEqual([{ key: 'room_count', value: 2 }, { key: 'has_pets', value: true }])
    expect(JSON.stringify(estimate)).not.toMatch(/gate code|megan/i)
    expect(Object.keys(estimate)).not.toContain('customer')
  })

  it('the match and title prompts scrub the same way', () => {
    const words = 'Megan at megan.grant@example.test wants CSV exports, call 07700 900123'
    expect(buildMatchPrompt(words, [])).not.toMatch(/example\.test|07700/)
    expect(buildTitlePrompt(words)).not.toMatch(/example\.test|07700/)
  })

  it('what the AI answers is scrubbed again before it is stored', () => {
    const result = parseSortAnswer(
      { title: 'Megan Grant quote too high', summary: 'megan.grant@example.test was quoted $7,500.', kind: 'how_to', severity: 'medium', similar: [], likely_cause: 'setup', evidence: 'Rooms painted at $3,750', setup_line: 'rooms', ticket: { title: 't', wrong: 'Megan was overcharged', evidence: 'e', expected: 'x', check: 'c' } },
      input
    )!
    expect(JSON.stringify(result)).not.toMatch(/megan|grant|example\.test/i)
    expect(result.title).toBe('[customer] quote too high')
  })

  it('the worker’s sorter logs ids and an error’s name only', () => {
    const source = read('apps/worker/src/support.ts')
    const logs = [...source.matchAll(/console\.(?:log|error|warn)\(([^\n]+)\)/g)].map((m) => m[1]!)
    expect(logs.length).toBeGreaterThan(3)
    // everything a log line puts in from the running program is an id, a kind, a severity or an error's name
    const put = logs.flatMap((line) => [...line.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]!))
    // T-198: and how many of the assistant's old questions were deleted (a number)
    expect([...new Set(put)].sort()).toEqual(['count ?? 0', 'errorNameOf(error)', 'reportId', 'requestId', "result.success ? 'sent' : 'failed'", 'result.kind', 'result.severity'].sort())
  })
})

// ---------------------------------------------------------------------------
describe('reading the AI’s answer', () => {
  const base: SortInput = { kind: 'problem', words: 'x', choices: [], expectedTotal: null, context: {}, customers: [], estimate: null, open: [{ id: 'r-1', title: 'A', summary: '' }, { id: 'r-2', title: 'B', summary: '' }] }
  const good = { title: 'Send again does nothing', summary: 'The button has no effect.', kind: 'fault', severity: 'high', similar: [{ ref: 2, confidence: 0.91 }, { ref: 9, confidence: 0.99 }, { ref: 1, confidence: 0.2 }, { ref: 2, confidence: 0.7 }], ticket: { title: 'Fix Send again', wrong: 'w', evidence: 'e', expected: 'x', check: 'c' } }

  it('keeps a look-alike only when it is one we offered and it is sure enough; never more than three', () => {
    expect(parseSortAnswer(good, base)!.similar).toEqual([{ id: 'r-2', confidence: 0.91 }])
  })

  it('an answer with no title, or a kind or severity that is not ours, is a failed sort', () => {
    expect(parseSortAnswer({ ...good, title: '' }, base)).toBeNull()
    expect(parseSortAnswer({ ...good, kind: 'urgent' }, base)).toBeNull()
    expect(parseSortAnswer({ ...good, severity: 'critical' }, base)).toBeNull()
    expect(parseSortAnswer('not json', base)).toBeNull()
    expect(parseSortAnswer(null, base)).toBeNull()
  })

  it('gives a likely cause only for an estimate report, and a price line only when it is in the business’s own setup', () => {
    expect(parseSortAnswer({ ...good, likely_cause: 'setup', setup_line: 'rooms' }, base)).toMatchObject({ likelyCause: null, setupLineId: null })
    const digest = estimateDigest({ quoteId: 'q', pricing: { total: 1, currency: 'USD' }, trace: { trace: [{ id: 'rooms', type: 'work_step', description: 'Rooms', calculation: '', amount: 10 }] }, workSteps: [{ id: 'rooms', name: 'Rooms', costType: 'per_unit', defaultCost: 375, unitLabel: 'Room' }, { id: 'unused', name: 'Ceilings', costType: 'fixed', defaultCost: 90 }] })
    const withEstimate = { ...base, kind: 'estimate' as const, estimate: digest }
    expect(parseSortAnswer({ ...good, likely_cause: 'setup', setup_line: '[rooms]' }, withEstimate)).toMatchObject({ likelyCause: 'setup', setupLineId: 'rooms' })
    expect(parseSortAnswer({ ...good, likely_cause: 'setup', setup_line: 'made_up' }, withEstimate)).toMatchObject({ likelyCause: 'setup', setupLineId: null })
    expect(parseSortAnswer({ ...good, likely_cause: 'ai_reading', setup_line: 'rooms' }, withEstimate)).toMatchObject({ likelyCause: 'ai_reading', setupLineId: null })
    expect(parseSortAnswer({ ...good, likely_cause: 'nonsense' }, withEstimate)).toMatchObject({ likelyCause: 'unknown' })

    // the hint's words are the setup's own; a line that was not priced on this estimate gives none
    expect(setupHintFor(digest, 'rooms')).toEqual({ line: 'Rooms', rate: '$375.00 per room', serviceId: null })
    expect(setupHintFor(digest, 'unused')).toBeNull()
    expect(setupHintFor(digest, null)).toBeNull()
    expect(setupHintFor(null, 'rooms')).toBeNull()
  })

  it('the fix ticket is in the house format and the AI supplies only the descriptions', () => {
    const ticket = formatFixTicket({ title: 'Send again does nothing', wrong: 'Pressing Send again has no effect.', evidence: 'Seen on every quote.', expected: 'The estimate is emailed again.', check: 'Press it and see the email.' }, { reportId: 'r-1', businesses: 2, quoteId: 'qte_1', severity: 'high' })
    const lines = ticket.split('\n')
    expect(lines[0]).toBe('T-NNN: Send again does nothing')
    expect(lines[2]).toBe(TICKET_SAFETY_LINE)
    expect(TICKET_SAFETY_LINE).toBe('SAFETY: no WhatsApp messages, no real requests or charges on production, names only for secrets, never "claude" in test data.')
    expect(ticket).toContain('RULES\n- Build only. Do not deploy.\n- Run pnpm check:quick once. Use pnpm check:failed for failures.')
    for (const heading of ['WHAT IS WRONG', 'EVIDENCE', 'WHAT SHOULD HAPPEN INSTEAD', 'HOW TO CHECK IT']) expect(lines).toContain(heading)
    expect(ticket).toContain('Reported by 2 businesses; severity high')
    // merged into later: the count on the ticket follows
    expect(ticketWithBusinesses(ticket, 1)).toContain('- Reported by 1 business; severity high')
    expect(ticketWithBusinesses(ticket, 5)).toContain('- Reported by 5 businesses; severity high')
  })

  it('a feature match is one we offered, sure enough, best first, three at most', () => {
    const known = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, title: id, summary: '' }))
    expect(parseMatchAnswer({ matches: [{ ref: 1, confidence: 0.7 }, { ref: 3, confidence: 0.95 }, { ref: 2, confidence: 0.3 }, { ref: 40, confidence: 1 }, { ref: 4, confidence: 0.8 }, { ref: 5, confidence: 0.75 }] }, known)).toEqual(['c', 'd', 'e'])
    expect(parseMatchAnswer({ matches: 'none' }, known)).toEqual([])
    expect(parseMatchAnswer(null, known)).toEqual([])
    expect(FEATURE_MATCH_MAX).toBe(3)
  })

  it('a title needs to be a title', () => {
    expect(parseTitleAnswer({ title: 'Export quotes to a spreadsheet', summary: 'Download quotes as CSV.' })).toEqual({ title: 'Export quotes to a spreadsheet', summary: 'Download quotes as CSV.' })
    expect(parseTitleAnswer({ title: '', summary: 'x' })).toBeNull()
    expect(parseTitleAnswer([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('the models come from the registry', () => {
  it('has a task for sorting problems and one for matching feature requests, each overridable', () => {
    expect(AI_TASKS).toContain('support_sort')
    expect(AI_TASKS).toContain('feature_match')
    const registry = JSON.parse(read('packages/shared/src/ai-models.json')) as { tasks: Record<string, { model: string }> }
    expect(resolveModelRoute('support_sort').model).toBe(registry.tasks.support_sort!.model)
    expect(resolveModelRoute('feature_match', { AI_MODEL_FEATURE_MATCH: 'anthropic:some-model' })).toEqual({ provider: 'anthropic', model: 'some-model' })
  })

  it('no model name is written in the support code', () => {
    for (const file of ['apps/worker/src/support.ts', 'packages/shared/src/support.ts', 'packages/shared/src/support-sort.ts', 'apps/web/src/lib/support.ts', 'apps/web/src/lib/support-admin.ts']) {
      expect(read(file), file).not.toMatch(/gemini-|claude-|gpt-/i)
    }
  })
})

// ---------------------------------------------------------------------------
describe('the "should have been" figure changes no price', () => {
  it('is read only by the support code: nothing that prices, sends or shows an estimate knows it', () => {
    const allowed = ['support', 'help', 'testing']
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        if (name === 'node_modules' || name === '.next' || name === '__tests__' || name === 'dist') continue
        const path = `${dir}/${name}`
        if (statSync(join(ROOT, path)).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && /expected_total|expectedTotal/.test(read(path)) && !allowed.some((word) => path.toLowerCase().includes(word))) offenders.push(path)
      }
    }
    for (const dir of ['apps/web/src', 'apps/worker/src', 'packages/shared/src']) walk(dir)
    expect(offenders).toEqual([])
  })

  it('the support code writes to no quote, service or price', () => {
    for (const file of ['apps/worker/src/support.ts', 'apps/web/src/lib/support.ts', 'apps/web/src/lib/support-admin.ts', 'apps/web/src/app/api/support/reports/route.ts', 'apps/web/src/app/api/support/features/route.ts']) {
      const source = read(file)
      const writes = [...source.matchAll(/\.from\('(\w+)'\)\s*(?:\n\s*)?\.(insert|update|upsert|delete)\(/g)].map((m) => m[1])
      // T-198: and the Help assistant's own table (old questions are deleted; a conversation is pointed at the report it became)
      for (const table of writes) expect(['support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes', 'help_questions'], `${file} writes ${table}`).toContain(table)
    }
  })
})

// ---------------------------------------------------------------------------
describe('the inbox order', () => {
  it('problems: severity first (an unsorted report just under high), then businesses affected, then the oldest', () => {
    const rows = [
      { id: 'low', severity: 'low' as const, businesses: 9, createdAt: '2026-11-01T00:00:00Z' },
      { id: 'unsorted', severity: null, businesses: 1, createdAt: '2026-11-20T00:00:00Z' },
      { id: 'high-one', severity: 'high' as const, businesses: 1, createdAt: '2026-11-01T00:00:00Z' },
      { id: 'high-three', severity: 'high' as const, businesses: 3, createdAt: '2026-11-20T00:00:00Z' },
      { id: 'medium-new', severity: 'medium' as const, businesses: 2, createdAt: '2026-11-20T00:00:00Z' },
      { id: 'medium-old', severity: 'medium' as const, businesses: 2, createdAt: '2026-11-10T00:00:00Z' },
    ]
    expect([...rows].sort(byPriority).map((r) => r.id)).toEqual(['high-three', 'high-one', 'unsorted', 'medium-old', 'medium-new', 'low'])
  })

  it('feature requests: by votes, then by how many of them pay', () => {
    const rows = [
      { id: 'two-free', votes: 2, paying: 0, createdAt: '2026-11-01T00:00:00Z' },
      { id: 'two-paying', votes: 2, paying: 2, createdAt: '2026-11-01T00:00:00Z' },
      { id: 'five', votes: 5, paying: 0, createdAt: '2026-11-01T00:00:00Z' },
    ]
    expect([...rows].sort(byVotes).map((r) => r.id)).toEqual(['five', 'two-paying', 'two-free'])
  })

  it('a plan is held only while the subscription is live; a free test account does not pay', () => {
    expect(planOf(null)).toEqual({ plan: 'Free', paying: false })
    expect(planOf({ status: 'canceled', plan_id: 'plan_us_pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })).toEqual({ plan: 'Free', paying: false })
    expect(planOf({ status: 'active', plan_id: 'plan_us_pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })).toEqual({ plan: 'Pro', paying: true })
    expect(planOf({ status: 'active', plan_id: 'plan_us_pro' })).toEqual({ plan: 'Pro', paying: false })
  })

  it('a service is matched to its template by name, from the packs’ own data', () => {
    const pack = listPacks()[0]!
    expect(serviceTemplateOf(`  ${pack.services[0]!.name.toUpperCase()} `)).toBe(`${pack.name}: ${pack.services[0]!.name}`)
    expect(serviceTemplateOf('A service nobody templated 9b1')).toBeNull()
    expect(serviceTemplateOf(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('"Fixed" and "Shipped" tell the right businesses, once', () => {
  const sent: Array<{ to: string; subject: string; tag: string; html: string }> = []
  const mailer: SupportMailer = {
    appUrl: 'https://qolumns.test',
    send: async (to: string, email: SupportEmail, tag: string) => {
      sent.push({ to, subject: email.subject, tag, html: email.html })
      return true
    },
  }
  const world = () => {
    sent.length = 0
    const tables: Record<string, MemRow[]> = {
      tenants: [
        { id: 'tnt_a', name: 'Harbour Painting', notification_email: null, is_demo: false },
        { id: 'tnt_b', name: 'Rival Decorating', notification_email: null, is_demo: false },
        { id: 'tnt_c', name: 'Quiet Fencing', notification_email: 'office@quiet.test', is_demo: false },
        { id: 'tnt_d', name: 'Not Involved', notification_email: null, is_demo: false },
      ],
      subscriptions: [{ tenant_id: 'tnt_a', status: 'active', plan_id: 'plan_us_pro', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }],
      user_profiles: [],
      support_reports: [
        { id: 'r-1', tenant_id: 'tnt_a', user_id: 'user-a', kind: 'problem', body: 'Send again does nothing.', status: 'new', created_at: '2026-11-20T10:00:00Z' },
        { id: 'r-2', tenant_id: 'tnt_b', user_id: 'user-b', kind: 'problem', body: 'The button is dead.', status: 'new', created_at: '2026-11-20T11:00:00Z' },
        { id: 'r-3', tenant_id: 'tnt_b', user_id: 'user-b2', kind: 'problem', body: 'Still dead.', status: 'looking', created_at: '2026-11-20T12:00:00Z' },
        { id: 'r-4', tenant_id: 'tnt_c', user_id: null, kind: 'problem', body: 'Cannot resend.', status: 'new', created_at: '2026-11-20T13:00:00Z' },
        { id: 'r-5', tenant_id: 'tnt_d', user_id: 'user-d', kind: 'problem', body: 'Something else entirely.', status: 'new', created_at: '2026-11-20T14:00:00Z' },
      ],
      support_report_internal: [
        { report_id: 'r-1', title: 'Send again does nothing', severity: 'high', sort_state: 'sorted', merged_into: null, similar_json: [] },
        { report_id: 'r-2', title: 'Dead button', severity: 'high', sort_state: 'sorted', merged_into: 'r-1', similar_json: [] },
        { report_id: 'r-3', title: 'Still dead', severity: 'medium', sort_state: 'sorted', merged_into: 'r-1', similar_json: [] },
        { report_id: 'r-4', title: 'Cannot resend', severity: null, sort_state: 'failed', merged_into: 'r-1', similar_json: [] },
        { report_id: 'r-5', title: 'Unrelated', severity: 'low', sort_state: 'sorted', merged_into: null, similar_json: [{ id: 'r-1', confidence: 0.9 }] },
      ],
      support_messages: [],
      feature_requests: [
        { id: 'f-1', title: 'Export quotes to a spreadsheet', summary: 'Download every quote as CSV.', title_source: 'ai', status: 'planned', merged_into: null, reviewed_at: null, created_at: '2026-11-19T00:00:00Z' },
        { id: 'f-2', title: 'CSV download', summary: '', title_source: 'words', status: 'under_review', merged_into: null, reviewed_at: '2026-11-19T00:00:00Z', created_at: '2026-11-20T00:00:00Z' },
      ],
      feature_votes: [
        { id: 'v-1', request_id: 'f-1', tenant_id: 'tnt_a', user_id: 'user-a', body: 'CSV export please', shipped_emailed_at: null, created_at: '2026-11-19T00:00:00Z' },
        { id: 'v-2', request_id: 'f-1', tenant_id: 'tnt_b', user_id: 'user-b', body: 'Download as CSV', shipped_emailed_at: null, created_at: '2026-11-19T01:00:00Z' },
        { id: 'v-3', request_id: 'f-2', tenant_id: 'tnt_b', user_id: 'user-b', body: 'CSV download', shipped_emailed_at: null, created_at: '2026-11-20T00:00:00Z' },
        { id: 'v-4', request_id: 'f-2', tenant_id: 'tnt_c', user_id: null, body: 'A CSV of quotes', shipped_emailed_at: null, created_at: '2026-11-20T01:00:00Z' },
      ],
      quotes: [{ id: 'qte_1', tenant_id: 'tnt_a', pricing_json: { total: 7500 } }],
    }
    const db = memoryDb(tables, {
      keys: { support_report_internal: 'report_id', subscriptions: 'tenant_id' },
      unique: { feature_votes: [['request_id', 'tenant_id']] },
      users: { 'user-a': 'owner@harbour.test', 'user-b': 'owner@rival.test', 'user-b2': 'second@rival.test', 'user-d': 'owner@notinvolved.test' },
    })
    return { tables, db: db as unknown as Parameters<typeof markFixed>[0] }
  }

  it('who is told a problem is fixed: one per business attached, the earliest report standing for it, never one already told', () => {
    const attached = [
      { reportId: 'r-1', tenantId: 'a', createdAt: '2026-11-20T10:00:00Z', fixedEmailedAt: null },
      { reportId: 'r-2', tenantId: 'b', createdAt: '2026-11-20T12:00:00Z', fixedEmailedAt: null },
      { reportId: 'r-3', tenantId: 'b', createdAt: '2026-11-20T11:00:00Z', fixedEmailedAt: null },
      { reportId: 'r-4', tenantId: 'c', createdAt: '2026-11-20T13:00:00Z', fixedEmailedAt: '2026-11-21T00:00:00Z' },
      { reportId: 'r-5', tenantId: 'c', createdAt: '2026-11-20T14:00:00Z', fixedEmailedAt: null },
    ]
    expect(fixedRecipients(attached).map((r) => r.reportId)).toEqual(['r-1', 'r-3'])
  })

  it('"Fixed" sets every attached report to fixed, tells each attached business once, and nobody else', async () => {
    const { tables, db } = world()
    expect((await attachedReports(db, 'r-1')).map((r) => r.reportId).sort()).toEqual(['r-1', 'r-2', 'r-3', 'r-4'])
    const before = JSON.stringify(tables.quotes)
    const result = await markFixed(db, 'r-1', 'Send again works now.', mailer)
    expect(result).toEqual({ ok: true, businesses: 3, emailed: 3 })
    // the user who reported; the business's own address when that user is gone
    expect(sent.map((s) => s.to).sort()).toEqual(['office@quiet.test', 'owner@harbour.test', 'owner@rival.test'])
    expect(sent.every((s) => s.subject === 'The problem you reported is fixed' && s.tag === 'support-fixed' && s.html.includes('Send again works now.'))).toBe(true)
    expect(tables.support_reports!.filter((r) => r.status === 'fixed').map((r) => r.id).sort()).toEqual(['r-1', 'r-2', 'r-3', 'r-4'])
    expect(tables.support_reports!.find((r) => r.id === 'r-5')!.status).toBe('new')
    // each told business also has it in its Help panel, with the dot
    expect(tables.support_messages!.map((m) => m.report_id).sort()).toEqual(['r-1', 'r-2', 'r-4'])
    expect(tables.support_messages!.every((m) => m.author === 'team' && m.body === 'Send again works now.')).toBe(true)
    expect(tables.support_reports!.filter((r) => r.reply_unread).map((r) => r.id).sort()).toEqual(['r-1', 'r-2', 'r-4'])
    expect(JSON.stringify(tables.quotes)).toBe(before)

    // a second "Fixed" tells nobody again
    const again = await markFixed(db, 'r-1', 'Send again works now.', mailer)
    expect(again).toEqual({ ok: true, businesses: 0, emailed: 0 })
    expect(sent.length).toBe(3)
    expect(tables.support_messages!.length).toBe(3)
  })

  it('a business told before is not told again when another joins the problem later', async () => {
    const { tables, db } = world()
    tables.support_report_internal!.find((r) => r.report_id === 'r-4')!.merged_into = null
    expect((await markFixed(db, 'r-1', '', mailer)).businesses).toBe(2)
    await mergeProblem(db, 'r-4', 'r-1')
    const later = await markFixed(db, 'r-1', '', mailer)
    expect(later.businesses).toBe(1)
    expect(sent.map((s) => s.to)).toEqual(['owner@harbour.test', 'owner@rival.test', 'office@quiet.test'])
  })

  it('an email that cannot be sent does not stop the business being told in its Help panel, or being marked as told', async () => {
    const { tables, db } = world()
    const result = await markFixed(db, 'r-1', '', { appUrl: 'https://qolumns.test', send: async () => { throw new Error('postmark down') } })
    expect(result).toEqual({ ok: true, businesses: 3, emailed: 0 })
    expect(tables.support_messages!.length).toBe(3)
    expect((await markFixed(db, 'r-1', '', mailer)).businesses).toBe(0)
  })

  it('a reply goes to the business’s Help panel and by email to the user who reported it', async () => {
    const { tables, db } = world()
    expect(await replyToReport(db, 'r-2', '  We are looking at this now.  ', mailer)).toEqual({ ok: true, emailed: true })
    expect(tables.support_messages).toMatchObject([{ report_id: 'r-2', tenant_id: 'tnt_b', author: 'team', body: 'We are looking at this now.' }])
    expect(tables.support_reports!.find((r) => r.id === 'r-2')!.reply_unread).toBe(true)
    expect(sent).toMatchObject([{ to: 'owner@rival.test', tag: 'support-reply' }])
    expect(sent[0]!.html).toContain('To reply, open it in your dashboard')
    expect(sent[0]!.html).toContain('https://qolumns.test/app?help=report:r-2')
    expect(await replyToReport(db, 'r-2', '   ', mailer)).toEqual({ ok: false, emailed: false })
    expect(await replyToReport(db, 'missing', 'hello', mailer)).toEqual({ ok: false, emailed: false })
  })

  it('who is told a request shipped: one per business that voted, never one already told', () => {
    const votes = [
      { voteId: 'v-1', tenantId: 'a', shippedEmailedAt: null },
      { voteId: 'v-2', tenantId: 'b', shippedEmailedAt: null },
      { voteId: 'v-3', tenantId: 'b', shippedEmailedAt: null },
      { voteId: 'v-4', tenantId: 'c', shippedEmailedAt: '2026-11-21T00:00:00Z' },
    ]
    expect(shippedRecipients(votes).map((v) => v.voteId)).toEqual(['v-1', 'v-2'])
  })

  it('"Shipped" emails every business that voted, counting a request merged into it, each once', async () => {
    const { tables, db } = world()
    // f-2 is merged in: the business already on f-1 keeps one vote there; the other's moves across
    expect(await mergeFeature(db, 'f-2', 'f-1')).toEqual({ ok: true })
    expect(tables.feature_votes!.filter((v) => v.request_id === 'f-1').map((v) => v.tenant_id).sort()).toEqual(['tnt_a', 'tnt_b', 'tnt_c'])
    expect(tables.feature_requests!.find((f) => f.id === 'f-2')!.merged_into).toBe('f-1')

    const result = await markShipped(db, 'f-1', mailer)
    expect(result).toEqual({ ok: true, businesses: 3, emailed: 3 })
    expect(sent.map((s) => s.to).sort()).toEqual(['office@quiet.test', 'owner@harbour.test', 'owner@rival.test'])
    expect(sent.every((s) => s.subject === 'Something you asked for is ready' && s.html.includes('Export quotes to a spreadsheet'))).toBe(true)
    expect(tables.feature_requests!.find((f) => f.id === 'f-1')!.status).toBe('shipped')
    expect(tables.feature_votes!.every((v) => typeof v.shipped_emailed_at === 'string')).toBe(true)

    expect(await markShipped(db, 'f-1', mailer)).toEqual({ ok: true, businesses: 0, emailed: 0 })
    expect(sent.length).toBe(3)
  })

  it('one vote per business per request holds through a merge and a split', async () => {
    const { tables, db } = world()
    await mergeFeature(db, 'f-2', 'f-1')
    const perRequest = new Map<string, string[]>()
    for (const vote of tables.feature_votes!) perRequest.set(vote.request_id as string, [...(perRequest.get(vote.request_id as string) ?? []), vote.tenant_id as string])
    for (const tenants of perRequest.values()) expect(new Set(tenants).size).toBe(tenants.length)
    // the database's rule refuses a second vote outright
    const second = await (db as unknown as ReturnType<typeof memoryDb>).from('feature_votes').insert({ request_id: 'f-1', tenant_id: 'tnt_a', body: 'again' })
    expect(second.error?.code).toBe('23505')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    const split = await splitFeature(db, 'f-1', 'v-4')
    expect(split.ok).toBe(true)
    expect(tables.feature_votes!.find((v) => v.id === 'v-4')!.request_id).toBe(split.newId)
    expect(tables.feature_requests!.find((f) => f.id === split.newId)).toMatchObject({ title: 'A CSV of quotes', title_source: 'words' })
    expect((await splitFeature(db, split.newId!, 'v-4')).ok).toBe(false)
    expect(await mergeFeature(db, 'f-1', 'f-1')).toMatchObject({ ok: false })
  })

  it('the lists: a merged problem counts towards the one it joined; feature requests carry votes and paying businesses; the AI’s look-alike is only a flag', async () => {
    const { db } = world()
    const problems = await listProblems(db)
    expect(problems.map((p) => p.id)).toEqual(['r-1', 'r-5'])
    expect(problems[0]).toMatchObject({ businesses: 3, severity: 'high', business: 'Harbour Painting' })
    expect(problems[1]).toMatchObject({ mergeSuggested: true, businesses: 1 })
    const features = await listFeatures(db)
    expect(features.map((f) => [f.id, f.votes, f.paying])).toEqual([['f-1', 2, 1], ['f-2', 2, 0]])
    expect(features[1]).toMatchObject({ ownWords: true, isNew: false })
    // new items: two problems still "New" that are not merged away (r-1, r-5) and one request not opened yet (f-1)
    expect(await newSupportCount(db)).toBe(3)
  })

  it('a merge is the owner’s act and can be undone; a problem cannot join itself or its own child', async () => {
    const { tables, db } = world()
    expect(await mergeProblem(db, 'r-1', 'r-1')).toMatchObject({ ok: false })
    expect(await mergeProblem(db, 'r-1', 'r-2')).toMatchObject({ ok: false })
    expect(await mergeProblem(db, 'r-5', 'r-2')).toEqual({ ok: true })
    // merged into something merged: it goes where that one went
    expect(tables.support_report_internal!.find((r) => r.report_id === 'r-5')!.merged_into).toBe('r-1')
    expect((await listProblems(db))[0]).toMatchObject({ id: 'r-1', businesses: 4 })
    expect(await unmergeProblem(db, 'r-5')).toBe(true)
    expect((await listProblems(db)).find((p) => p.id === 'r-1')!.businesses).toBe(3)
  })
})

// ---------------------------------------------------------------------------
describe('the emails', () => {
  it('a reply says to reply in the dashboard, and carries the link to the report', () => {
    const email = supportReplyEmail({ businessName: 'Harbour Painting', reply: 'First line.\n\nSecond <b>line</b>.', yourWords: 'Send again does nothing.', link: helpLink('https://qolumns.test/', { kind: 'report', id: 'abc-1' }) })
    expect(email.subject).toBe('A reply from Qolumns about your report')
    expect(email.html).toContain('To reply, open it in your dashboard. Replies to this email are not read.')
    expect(email.html).toContain('href="https://qolumns.test/app?help=report:abc-1"')
    expect(email.html).toContain('Second &lt;b&gt;line&lt;/b&gt;.')
    expect(email.html).toContain('data-role="product-logo"')
  })

  it('the link opens the Help panel on the business’s own item', () => {
    expect(parseHelpParam('report:0b6f1c2e-8a53-4d2a-9d3e-000000000001')).toEqual({ kind: 'report', id: '0b6f1c2e-8a53-4d2a-9d3e-000000000001' })
    expect(parseHelpParam('open')).toEqual({ kind: 'open' })
    expect(parseHelpParam('report:../../etc')).toEqual({ kind: 'open' })
    expect(parseHelpParam(null)).toBeNull()
  })

  it('"fixed" and "shipped" say one thing each', () => {
    expect(supportFixedEmail({ businessName: 'B', message: '', yourWords: 'x', link: 'https://qolumns.test/app' }).html).toContain('It is fixed now')
    const shipped = featureShippedEmail({ businessName: 'B', title: 'Export quotes', summary: 'As CSV.', link: 'https://qolumns.test/app' })
    expect(shipped.html).toContain('Export quotes')
    // never who else asked or how many
    expect(shipped.html).not.toMatch(/\d+ (other )?business|votes?/i)
  })

  it('the daily summary has counts by kind and the top three; with nothing new there is no email', () => {
    expect(supportDailyEmail({ problems: {}, featureRequests: 0, top: [], inboxUrl: 'https://qolumns.test/admin/support' })).toBeNull()
    expect(supportDailyEmail({ problems: { fault: 0 }, featureRequests: 0, top: [], inboxUrl: 'x' })).toBeNull()
    const email = supportDailyEmail({
      problems: { fault: 2, billing: 1, unsorted: 1 },
      featureRequests: 3,
      top: [1, 2, 3, 4].map((n) => ({ title: `Problem ${n}`, severity: 'high' as const, businesses: n })),
      inboxUrl: 'https://qolumns.test/admin/support',
      environment: 'production',
    })!
    expect(email.subject).toBe('Qolumns support: 7 new items')
    for (const part of ['Fault: 2', 'Billing: 1', 'Not sorted yet: 1', 'Feature requests: 3', 'Problem 3 (High; 3 businesses)']) expect(email.text).toContain(part)
    expect(email.text).not.toContain('Problem 4')
    expect(email.html).toContain('href="https://qolumns.test/admin/support"')
  })

  it('a high-severity problem uses the owner’s alert, with its own words and the inbox’s address', () => {
    const email = opsAlertEmail({ kind: 'support_high', details: { Report: 'r-1', Kind: 'fault', Businesses: 2 } }, { appUrl: 'https://qolumns.test', heldBack: 3 })
    expect(email.subject).toBe('Qolumns alert: A business reported a serious problem')
    expect(email.text).toContain('https://qolumns.test/admin/support')
    expect(email.text).toContain('3 more of this kind happened in the last hour and were not emailed.')
    expect(opsAlertEmail({ kind: 'quote_failed', details: {} }, { appUrl: 'https://qolumns.test' }).text).toContain('/admin/quotes')
  })
})
