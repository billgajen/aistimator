/**
 * T-156: approve a quote from the review email in one tap, without logging
 * in. The token's lifecycle, every page outcome, and the approval through the
 * shared approveQuote (one customer email, a second press refused, a link
 * that only ever reaches its own quote).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

const sent: Array<{ to: string; subject: string }> = []
vi.mock('@/lib/postmark', () => ({
  isPostmarkConfigured: () => true,
  generateCustomerEmailHtml: () => '<p>quote</p>',
  sendEmail: async (m: { to: string; subject: string }) => {
    sent.push({ to: m.to, subject: m.subject })
    return { success: true }
  },
}))

import {
  generateApprovalToken,
  hashApprovalToken,
  isApprovalTokenShape,
  approvalLinkExpiry,
  approvalLinkUrl,
  approvalLinkState,
  approvalPageOutcome,
  approvalErrorOutcome,
  approvalOutcomeCopy,
  reviewEmailSubject,
  reviewHoldLine,
  findConfidenceLanguage,
  APPROVAL_LINK_TTL_HOURS,
  APPROVAL_LINK_MAX_ATTEMPTS,
  type ApprovalOutcome,
} from '@qolumns/shared'
import { approveByLink, loadApprovalLink, approvalPhotoKey, approvalPhotoUrl, APPROVAL_MAX_PHOTOS } from '@/lib/approval-link'
import { getScopeWindows } from '@/lib/rate-limit'

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the service-role client: enough of the query
// builder for the link and approveQuote (select/update/insert, eq/is, single)
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>
class FakeDb {
  tables: Record<string, Row[]> = { quote_approval_tokens: [], quotes: [], assets: [], quote_validation_logs: [] }
  writes: Array<{ table: string; values: Row }> = []
  from(table: string) {
    return new FakeQuery(this, table)
  }
}
class FakeQuery {
  private op: 'select' | 'update' = 'select'
  private values: Row = {}
  private returning = false
  private filters: Array<(r: Row) => boolean> = []
  constructor(private db: FakeDb, private table: string) {}
  select() {
    if (this.op === 'update') this.returning = true
    return this
  }
  update(values: Row) {
    this.op = 'update'
    this.values = values
    return this
  }
  insert(values: Row) {
    this.db.tables[this.table]!.push({ ...values })
    this.db.writes.push({ table: this.table, values })
    return Promise.resolve({ error: null })
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val)
    return this
  }
  is(col: string, val: null) {
    this.filters.push((r) => (r[col] ?? null) === val)
    return this
  }
  // T-183: the approval detail also reads the request's photos and the newest quote check
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val)
    return this
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]))
    return this
  }
  order() {
    return this
  }
  limit() {
    return this
  }
  private rows() {
    return this.db.tables[this.table]!.filter((r) => this.filters.every((f) => f(r)))
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null })
  }
  single() {
    const row = this.rows()[0]
    return Promise.resolve({ data: row ?? null, error: row ? null : { code: 'PGRST116', message: 'none' } })
  }
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    if (this.op === 'update') {
      const hit = this.rows()
      for (const r of hit) Object.assign(r, this.values)
      if (hit.length) this.db.writes.push({ table: this.table, values: this.values })
      return Promise.resolve(resolve({ data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }))
    }
    return Promise.resolve(resolve({ data: this.rows(), error: null }))
  }
}

const HOUR = 3600 * 1000
const NOW = new Date('2026-11-10T12:00:00Z')

function quoteRow(over: Row = {}): Row {
  return {
    id: 'qte_a',
    tenant_id: 'tnt_a',
    status: 'pending_review',
    version: 1,
    approved_at: null,
    quote_token_hash: 'a'.repeat(64),
    pricing_json: { total: 1400, currency: 'USD', breakdown: [] },
    content_json: { scopeSummary: 'Replace the two torsion springs and balance the door.' },
    customer_json: { name: 'Jordan M.', email: 'jordan@example.com' },
    pricing_trace_json: {},
    tenants: { id: 'tnt_a', name: 'Acme Doors', region: 'US', branding_json: null },
    services: { id: 'svc_a', name: 'Spring Replacement', description: null, scope_includes: [], scope_excludes: [], default_assumptions: [], work_steps: [], service_pricing_rules: [] },
    ...over,
  }
}

async function withLink(db: FakeDb, over: Row = {}, quote: Row = {}) {
  const { token, hash } = await generateApprovalToken()
  const q = quoteRow(quote)
  if (!db.tables.quotes!.some((r) => r.id === q.id)) db.tables.quotes!.push(q)
  db.tables.quote_approval_tokens!.push({
    id: `lnk_${db.tables.quote_approval_tokens!.length}`,
    quote_id: q.id,
    tenant_id: q.tenant_id,
    token_hash: hash,
    expires_at: approvalLinkExpiry(new Date(NOW.getTime() - HOUR)).toISOString(),
    used_at: null,
    invalidated_at: null,
    attempts: 0,
    ...over,
  })
  return token
}

const admin = (db: FakeDb) => db as never

beforeEach(() => {
  sent.length = 0
})

describe('T-156: the token', () => {
  it('is 256 random bits, URL-safe, and only its sha256 is ever stored', async () => {
    const a = await generateApprovalToken()
    const b = await generateApprovalToken()
    expect(a.token).not.toBe(b.token)
    expect(isApprovalTokenShape(a.token)).toBe(true)
    expect(a.hash).toBe(createHash('sha256').update(a.token).digest('hex'))
    expect(await hashApprovalToken(a.token)).toBe(a.hash)
    expect(a.hash).not.toContain(a.token)
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32)
  })

  it('rejects anything not shaped like one before touching the database', () => {
    for (const bad of ['', 'abc', 'x'.repeat(44), `${'a'.repeat(42)}=`, '../../etc/passwd']) expect(isApprovalTokenShape(bad)).toBe(false)
  })

  it('expires 72 hours after it is issued; the link goes to /approve/{token}', () => {
    expect(APPROVAL_LINK_TTL_HOURS).toBe(72)
    expect(approvalLinkExpiry(NOW).getTime() - NOW.getTime()).toBe(72 * HOUR)
    expect(approvalLinkUrl('https://app.example.com/', 'tok')).toBe('https://app.example.com/approve/tok')
  })

  it('state: valid, then used / replaced / expired / too many', () => {
    const base = { expires_at: new Date(NOW.getTime() + HOUR).toISOString(), used_at: null, invalidated_at: null, attempts: 0 }
    expect(approvalLinkState(base, NOW)).toBe('valid')
    expect(approvalLinkState({ ...base, used_at: NOW.toISOString() }, NOW)).toBe('used')
    expect(approvalLinkState({ ...base, invalidated_at: NOW.toISOString() }, NOW)).toBe('replaced')
    expect(approvalLinkState({ ...base, expires_at: NOW.toISOString() }, NOW)).toBe('expired')
    expect(approvalLinkState({ ...base, attempts: APPROVAL_LINK_MAX_ATTEMPTS }, NOW)).toBe('too_many')
  })
})

describe('T-156: what the page says', () => {
  const link = { expires_at: new Date(NOW.getTime() + HOUR).toISOString(), used_at: null, invalidated_at: null, attempts: 0 }
  const quote = { status: 'pending_review', approved_at: null, pricing_json: { total: 1400 }, content_json: {} }

  it('each outcome, the quote’s own state first', () => {
    expect(approvalPageOutcome(link, quote, NOW)).toBe('ready')
    expect(approvalPageOutcome(null, quote, NOW)).toBe('not_found')
    expect(approvalPageOutcome(link, { ...quote, status: 'sent', approved_at: NOW.toISOString() }, NOW)).toBe('already_approved')
    expect(approvalPageOutcome({ ...link, invalidated_at: NOW.toISOString() }, { ...quote, status: 'accepted', approved_at: NOW.toISOString() }, NOW)).toBe('already_approved')
    expect(approvalPageOutcome(link, { ...quote, status: 'declined' }, NOW)).toBe('not_awaiting')
    expect(approvalPageOutcome(link, { ...quote, status: 'expired' }, NOW)).toBe('not_awaiting')
    expect(approvalPageOutcome({ ...link, used_at: NOW.toISOString() }, quote, NOW)).toBe('already_approved')
    expect(approvalPageOutcome({ ...link, expires_at: NOW.toISOString() }, quote, NOW)).toBe('link_expired')
    expect(approvalPageOutcome({ ...link, invalidated_at: NOW.toISOString() }, quote, NOW)).toBe('link_expired')
    expect(approvalPageOutcome({ ...link, attempts: 10 }, quote, NOW)).toBe('too_many')
    expect(approvalPageOutcome(link, { ...quote, content_json: { limitHold: true } }, NOW)).toBe('not_priced')
    expect(approvalPageOutcome(link, { ...quote, pricing_json: { total: 0 } }, NOW)).toBe('not_priced')
  })

  it('the shared approval function’s refusals map to the same messages', () => {
    expect(approvalErrorOutcome('ALREADY_SENT')).toBe('already_approved')
    expect(approvalErrorOutcome('WORDING_NEEDS_EDIT')).toBe('wording_needs_edit')
    expect(approvalErrorOutcome('NOT_PRICED')).toBe('not_priced')
    expect(approvalErrorOutcome('INVALID_STATUS', { approved_at: null })).toBe('not_awaiting')
    expect(approvalErrorOutcome('INVALID_STATUS', { approved_at: NOW.toISOString() })).toBe('already_approved')
  })

  it('every message is plain words, with no customer-banned language', () => {
    const all: ApprovalOutcome[] = ['ready', 'approved', 'already_approved', 'link_expired', 'not_awaiting', 'wording_needs_edit', 'not_priced', 'too_many', 'not_found']
    for (const o of all) {
      const c = approvalOutcomeCopy(o, { customerName: 'Jordan M.' })
      expect(c.title.length).toBeGreaterThan(0)
      expect(findConfidenceLanguage(`${c.title} ${c.body}`)).toEqual([])
    }
    expect(approvalOutcomeCopy('approved', { customerName: 'Jordan M.' }).body).toMatch(/Jordan M\. has been told/)
    expect(approvalOutcomeCopy('approved', { emailed: false }).body).toMatch(/No email went out/)
    expect(approvalOutcomeCopy('wording_needs_edit').body).toMatch(/Edit the wording in your dashboard/)
  })
})

describe('T-156: the review email’s words', () => {
  it('subject: customer, service and price; test requests are marked', () => {
    expect(reviewEmailSubject({ customerName: 'Jordan M.', serviceName: 'Spring Replacement', price: '$1,400.00' })).toBe('Review and approve: Jordan M. - Spring Replacement - $1,400.00')
    expect(reviewEmailSubject({ customerName: 'You', serviceName: 'Spring Replacement', price: '$375.00', isTest: true })).toMatch(/^\[Test\] Review and approve/)
  })

  it('says whether the customer can already see it', () => {
    expect(reviewHoldLine('shown')).toMatch(/can already see this estimate/)
    expect(reviewHoldLine('held')).toMatch(/hasn’t seen a price yet/)
    expect(reviewHoldLine('check')).toMatch(/Held for a check/)
    expect(reviewHoldLine(null)).toMatch(/hasn’t seen a price yet/)
  })
})

describe('T-156: opening the link changes nothing', () => {
  it('the page’s read never writes, and shows only the quote’s summary', async () => {
    const db = new FakeDb()
    const token = await withLink(db)
    const loaded = await loadApprovalLink(admin(db), token, NOW)
    expect(loaded.outcome).toBe('ready')
    expect(db.writes).toEqual([])
    // T-183: a link that can approve also carries the detail the price is judged by, and the photos
    expect(loaded.summary).toEqual({
      quoteId: 'qte_a',
      businessName: 'Acme Doors',
      customerName: 'Jordan M.',
      serviceName: 'Spring Replacement',
      price: '$1,400.00',
      scopeSummary: 'Replace the two torsion springs and balance the door.',
      detail: expect.objectContaining({ warnings: [], combined: false, photoCount: 0 }),
      photos: [],
    })
    expect(JSON.stringify(loaded.summary)).not.toContain('jordan@example.com')
  })

  it('a measured range shows as the range; money follows the region', async () => {
    const db = new FakeDb()
    const token = await withLink(db, {}, {
      pricing_json: { total: 1400, currency: 'GBP', estimate: { rangeLow: 1250, rangeHigh: 1550 } },
      tenants: { id: 'tnt_a', name: 'Acme', region: 'GB', branding_json: null },
    })
    expect((await loadApprovalLink(admin(db), token, NOW)).summary?.price).toBe('£1,250.00 – £1,550.00')
  })

  it('the page’s copy needs no JavaScript to read and offers the dashboard in every state', () => {
    const card = readFileSync(join(__dirname, '..', 'app', 'approve', '[token]', 'ApproveCard.tsx'), 'utf8')
    expect(card).toContain('Open in dashboard to edit')
    expect(card).toMatch(/method: 'POST'/)
    const page = readFileSync(join(__dirname, '..', 'app', 'approve', '[token]', 'page.tsx'), 'utf8')
    expect(page).not.toMatch(/approveByLink|approveQuote/) // the GET page can't approve
  })
})

describe('T-156: pressing Approve & send', () => {
  it('approves once through the shared function; the customer is emailed exactly once', async () => {
    const db = new FakeDb()
    const token = await withLink(db)
    const first = await approveByLink(admin(db), token, NOW)
    expect(first).toMatchObject({ outcome: 'approved', emailed: true })
    const q = db.tables.quotes![0]!
    expect(q).toMatchObject({ status: 'sent', approved_via: 'email_link', approved_by: null, previous_token_hash: 'a'.repeat(64) })
    expect(q.approved_at).toBeTruthy()
    expect(db.tables.quote_approval_tokens![0]!.used_at).toBe(NOW.toISOString())
    expect(sent).toEqual([{ to: 'jordan@example.com', subject: 'Your quote from Acme Doors' }])

    // a second press: refused, nothing sent again
    const second = await approveByLink(admin(db), token, NOW)
    expect(second.outcome).toBe('already_approved')
    expect(sent).toHaveLength(1)
  })

  it('two presses at once still send once (the status guard)', async () => {
    const db = new FakeDb()
    const token = await withLink(db)
    const results = await Promise.all([approveByLink(admin(db), token, NOW), approveByLink(admin(db), token, NOW)])
    expect(results.map((r) => r.outcome).sort()).toEqual(['already_approved', 'approved'])
    expect(sent).toHaveLength(1)
  })

  it.each([
    ['an expired link', { expires_at: new Date(NOW.getTime() - 1).toISOString() }, {}, 'link_expired'],
    ['a replaced or changed link', { invalidated_at: NOW.toISOString(), invalidated_reason: 'quote_changed' }, {}, 'link_expired'],
    ['a link already used', { used_at: NOW.toISOString() }, {}, 'already_approved'],
    ['a quote approved elsewhere', {}, { status: 'sent', approved_at: NOW.toISOString() }, 'already_approved'],
    ['a declined quote', {}, { status: 'declined' }, 'not_awaiting'],
    ['a quote held at the plan limit', {}, { pricing_json: { total: 0 }, content_json: { limitHold: true } }, 'not_priced'],
    ['too many presses', { attempts: APPROVAL_LINK_MAX_ATTEMPTS }, {}, 'too_many'],
  ])('%s: the right message, and nothing changes', async (_name, link, quote, outcome) => {
    const db = new FakeDb()
    const token = await withLink(db, link, quote)
    const before = JSON.stringify(db.tables.quotes)
    const r = await approveByLink(admin(db), token, NOW)
    expect(r.outcome).toBe(outcome)
    expect(JSON.stringify(db.tables.quotes)).toBe(before)
    expect(sent).toEqual([])
  })

  it('wording that needs an edit: the message, nothing sent, the quote still waits', async () => {
    const db = new FakeDb()
    const token = await withLink(db, {}, { content_json: { scopeSummary: 'An exact replacement of your door.' } })
    const r = await approveByLink(admin(db), token, NOW)
    expect(r.outcome).toBe('wording_needs_edit')
    expect(db.tables.quotes![0]!.status).toBe('pending_review')
    expect(db.tables.quote_approval_tokens![0]!.used_at).toBeNull()
    expect(sent).toEqual([])
  })

  it('an unknown or malformed token finds nothing', async () => {
    const db = new FakeDb()
    await withLink(db)
    expect((await approveByLink(admin(db), 'x'.repeat(43), NOW)).outcome).toBe('not_found')
    expect((await approveByLink(admin(db), 'nope', NOW)).outcome).toBe('not_found')
    expect(db.tables.quotes![0]!.status).toBe('pending_review')
  })
})

describe('T-156: a link reaches its own quote and tenant, nothing else', () => {
  it('a token for quote A never reads or approves quote B, even in the same business', async () => {
    const db = new FakeDb()
    db.tables.quotes!.push(quoteRow({ id: 'qte_b', customer_json: { name: 'Other Person', email: 'other@example.com' } }))
    const tokenA = await withLink(db)
    const loaded = await loadApprovalLink(admin(db), tokenA, NOW)
    expect(loaded.summary?.quoteId).toBe('qte_a')
    await approveByLink(admin(db), tokenA, NOW)
    expect(db.tables.quotes!.find((q) => q.id === 'qte_b')!.status).toBe('pending_review')
    expect(sent.map((s) => s.to)).toEqual(['jordan@example.com'])
  })

  it('a link row whose tenant doesn’t own the quote finds nothing', async () => {
    const db = new FakeDb()
    const token = await withLink(db, { tenant_id: 'tnt_other' })
    expect((await loadApprovalLink(admin(db), token, NOW)).outcome).toBe('not_found')
    expect((await approveByLink(admin(db), token, NOW)).outcome).toBe('not_found')
    expect(db.tables.quotes![0]!.status).toBe('pending_review')
  })

  it('the endpoint takes no quote or tenant id from the request', () => {
    const route = readFileSync(join(__dirname, '..', 'app', 'api', 'public', 'approval', '[token]', 'route.ts'), 'utf8')
    expect(route).not.toMatch(/request\.json\(\)|searchParams|params\.(quoteId|tenantId)|tenantId/)
    expect(route).toMatch(/const token = params\.token/)
    const lib = readFileSync(join(__dirname, '..', 'lib', 'approval-link.ts'), 'utf8')
    expect(lib).toMatch(/quoteId: link\.quote_id,\s+tenantId: link\.tenant_id/)
  })
})

describe('T-156: rate limits and logs', () => {
  it('a per-IP and per-link limit on the endpoint', () => {
    expect(getScopeWindows('approval_link')[0]).toMatchObject({ perIp: 10, perKey: 5 })
    const route = readFileSync(join(__dirname, '..', 'app', 'api', 'public', 'approval', '[token]', 'route.ts'), 'utf8')
    expect(route).toMatch(/checkPublicRateLimit\('approval_link', \{ ip: getClientIp\(request\), tenantKey: keyPart \}\)/)
  })

  it('logs carry the quote id only, never customer details or the token', () => {
    const lib = readFileSync(join(__dirname, '..', 'lib', 'approval-link.ts'), 'utf8')
    for (const line of lib.split('\n').filter((l) => /console\.(log|warn|error)/.test(l))) {
      expect(line).not.toMatch(/customer|summary|Name|\.email\b|\$\{token|\$\{hash/)
    }
  })

  it('the dashboard and the app record how they approved', () => {
    const route = readFileSync(join(__dirname, '..', 'app', 'api', 'quotes', '[quoteId]', 'approve', 'route.ts'), 'utf8')
    expect(route).toMatch(/via: bearerToken\(request\.headers\.get\('authorization'\)\) \? 'app' : 'dashboard'/)
  })
})

describe('T-156: the approval page is public', () => {
  it('the login guard matches whole path segments: /app is protected, /approve is not', async () => {
    const { underRoute } = await import('@/middleware')
    expect(underRoute('/app', '/app')).toBe(true)
    expect(underRoute('/app/quotes/qte_1', '/app')).toBe(true)
    expect(underRoute('/approve/abc', '/app')).toBe(false)
    expect(underRoute('/apple', '/app')).toBe(false)
    expect(underRoute('/setup', '/setup')).toBe(true)
    expect(underRoute('/setup-guide', '/setup')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T-183: the approval page shows what the price is judged by
// ---------------------------------------------------------------------------

const JUDGED = {
  pricing_json: {
    total: 462,
    subtotal: 420,
    taxAmount: 42,
    taxLabel: 'Sales tax',
    currency: 'USD',
    breakdown: [
      { label: 'Walls  $2 x 90(sq ft)', amount: 180, source: 'photos' },
      { label: 'Doors  $40 x 3(doors)', amount: 140, source: 'answer' },
    ],
    sections: [
      { serviceId: 'svc_b', serviceName: 'Service B', addedBy: 'customer', addedAt: '2026-01-01T00:00:00.000Z', subtotal: 100, breakdown: [{ label: 'Visit', amount: 100, source: 'fixed' }] },
    ],
  },
  content_json: { scopeSummary: 'Paint the walls.', alsoAsked: [{ id: 'a1', words: 'the other thing', serviceId: 'svc_b', serviceName: 'Service B', state: 'offered' }] },
  request: { asset_ids: ['ast_1', 'ast_doc', 'ast_2', 'ast_other'], source_json: { type: 'widget', serviceSuggestion: { serviceId: 'svc_c', serviceName: 'Service C', reason: '' } } },
}

function withPhotos(db: FakeDb) {
  db.tables.assets!.push(
    { id: 'ast_1', tenant_id: 'tnt_a', type: 'image', r2_key: 'tnt_a/one.jpg' },
    { id: 'ast_2', tenant_id: 'tnt_a', type: 'image', r2_key: 'tnt_a/two.jpg' },
    { id: 'ast_doc', tenant_id: 'tnt_a', type: 'document', r2_key: 'tnt_a/plan.pdf' },
    // an id on the request that belongs to another business is never shown
    { id: 'ast_other', tenant_id: 'tnt_b', type: 'image', r2_key: 'tnt_b/theirs.jpg' }
  )
  db.tables.quote_validation_logs!.push({
    quote_id: 'qte_a',
    tenant_id: 'tnt_a',
    outcome: 'passed_with_issues',
    'input_snapshot->>serviceConfigVersion': 'v2',
    issues: [{ check: 'addon', description: 'an extra was added that the customer did not ask for' }],
  })
}

describe('T-183: the approval page shows what the price is judged by', () => {
  it('a link that can approve carries the warnings, every line with its source, the parts and the total', async () => {
    const db = new FakeDb()
    withPhotos(db)
    const token = await withLink(db, {}, JUDGED)
    const { summary, outcome } = await loadApprovalLink(admin(db), token, NOW)
    expect(outcome).toBe('ready')
    expect(db.writes).toEqual([])
    const detail = summary!.detail!
    expect(detail.warnings.map((w) => w.title)).toEqual(['Check the service', 'Customer also asked for', 'Worth checking'])
    expect(detail.parts.map((p) => [p.serviceName, p.subtotal])).toEqual([
      ['Spring Replacement', '$320.00'],
      ['Service B', '$100.00'],
    ])
    expect(detail.parts[0]!.lines.map((l) => [l.amount, l.source])).toEqual([
      ['$180.00', 'Measured from photos'],
      ['$140.00', "The customer's answer"],
    ])
    expect(detail.totals).toEqual({ subtotal: '$420.00', tax: { label: 'Sales tax', amount: '$42.00' }, total: '$462.00' })
  })

  it('the photos are the request’s own images of the link’s own business, in the customer’s order, behind the link', async () => {
    const db = new FakeDb()
    withPhotos(db)
    const token = await withLink(db, {}, JUDGED)
    const { summary } = await loadApprovalLink(admin(db), token, NOW)
    expect(summary!.photos).toEqual([
      { id: 'ast_1', url: approvalPhotoUrl(token, 'ast_1'), smallUrl: `${approvalPhotoUrl(token, 'ast_1')}?size=small` },
      { id: 'ast_2', url: approvalPhotoUrl(token, 'ast_2'), smallUrl: `${approvalPhotoUrl(token, 'ast_2')}?size=small` },
    ])
    expect(summary!.detail!.photosLine).toBe('2 photos from the customer')
    // a path on our own site: never a storage key or address
    expect(JSON.stringify(summary)).not.toMatch(/one\.jpg|r2_key|https?:/)
    expect(APPROVAL_MAX_PHOTOS).toBeGreaterThanOrEqual(10)
  })

  it('a used, replaced or expired link shows the summary only: no detail, no photos', async () => {
    for (const over of [{ used_at: NOW.toISOString() }, { invalidated_at: NOW.toISOString() }, { expires_at: new Date(NOW.getTime() - HOUR).toISOString() }]) {
      const db = new FakeDb()
      withPhotos(db)
      const token = await withLink(db, over, JUDGED)
      const { summary, outcome } = await loadApprovalLink(admin(db), token, NOW)
      expect(outcome).not.toBe('ready')
      expect(summary!.detail).toBeUndefined()
      expect(summary!.photos).toBeUndefined()
    }
  })

  it('a photo is served only to a link that can still approve, and only a photo of its own quote and business', async () => {
    const db = new FakeDb()
    withPhotos(db)
    const token = await withLink(db, {}, JUDGED)
    expect(await approvalPhotoKey(admin(db), token, 'ast_1', NOW)).toBe('tnt_a/one.jpg')
    // a document, another business's image, an id not on the request, a made-up link
    expect(await approvalPhotoKey(admin(db), token, 'ast_doc', NOW)).toBeNull()
    expect(await approvalPhotoKey(admin(db), token, 'ast_other', NOW)).toBeNull()
    db.tables.assets!.push({ id: 'ast_elsewhere', tenant_id: 'tnt_a', type: 'image', r2_key: 'tnt_a/elsewhere.jpg' })
    expect(await approvalPhotoKey(admin(db), token, 'ast_elsewhere', NOW)).toBeNull()
    expect(await approvalPhotoKey(admin(db), 'x'.repeat(43), 'ast_1', NOW)).toBeNull()
    expect(await approvalPhotoKey(admin(db), 'not-a-token', 'ast_1', NOW)).toBeNull()
    // opening a photo is not a press
    expect(db.writes).toEqual([])
    expect(db.tables.quote_approval_tokens![0]!.attempts).toBe(0)
  })

  it('once the link is used, replaced, expired or pressed too often, its photos stop', async () => {
    for (const over of [{ used_at: NOW.toISOString() }, { invalidated_at: NOW.toISOString() }, { expires_at: new Date(NOW.getTime() - HOUR).toISOString() }, { attempts: APPROVAL_LINK_MAX_ATTEMPTS }]) {
      const db = new FakeDb()
      withPhotos(db)
      const token = await withLink(db, over, JUDGED)
      expect(await approvalPhotoKey(admin(db), token, 'ast_1', NOW)).toBeNull()
    }
  })

  it('the photo route: the link is the key, every refusal is one 404, it redirects to a short-lived address and is rate limited', () => {
    const route = readFileSync(join(__dirname, '../app/api/public/approval/[token]/photos/[assetId]/route.ts'), 'utf8')
    expect(route).toContain("checkPublicRateLimit('approval_photo'")
    expect(route).toContain('approvalPhotoKey(createAdminClient(), token, assetId)')
    expect(route).toContain('if (!originalKey) return notFound()')
    // the link's state is read fresh on every call: a used link's photos stop at once (verify-t183 found a kept read)
    expect(route).toContain("import { unstable_noStore as noStore } from 'next/cache'")
    expect(route.indexOf('  noStore()\n')).toBeGreaterThan(-1)
    expect(route.indexOf('  noStore()\n')).toBeLessThan(route.indexOf('checkPublicRateLimit('))
    expect(route).toContain('generateDownloadUrl(key, DASHBOARD_PHOTO_URL_SECONDS)')
    expect(route).toContain("photoSizeOf(new URL(request.url).searchParams.get('size'))")
    expect(route).not.toMatch(/console\.(log|error)\([^)]*(token|signedUrl|originalKey)/)
    expect(getScopeWindows('approval_photo')[0]).toMatchObject({ perIp: 120, perKey: 120 })
  })

  it('the card reads in order: warnings, lines, total, photos, then one Approve & send, and the dashboard link stays', () => {
    const card = readFileSync(join(__dirname, '../app/approve/[token]/ApproveCard.tsx'), 'utf8')
    const detail = card.slice(card.indexOf('function Detail('), card.indexOf('function Photos('))
    const inDetail = ['data-testid="approve-warning"', 'data-testid="approve-line"', 'data-testid="approve-source"', 'data-testid="approve-part-subtotal"', 'data-testid="approve-total"'].map((m) => detail.indexOf(m))
    expect(inDetail.every((i) => i > -1)).toBe(true)
    expect(inDetail).toEqual([...inDetail].sort((a, b) => a - b))
    const page = card.slice(card.indexOf('export function ApproveCard('))
    const order = ['<Detail detail={summary.detail} />', '<Photos photos={summary.photos}', 'data-testid="approve-button"', 'data-testid="approve-dashboard"'].map((m) => page.indexOf(m))
    expect(order.every((i) => i > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(page.match(/data-testid="approve-button"/g)).toHaveLength(1)
    expect(page).toContain('Open in dashboard to edit')
    // small copies in the list, the full photo on a tap
    expect(card).toContain('src={photo.smallUrl}')
    expect(card).toContain('href={photo.url}')
  })
})
