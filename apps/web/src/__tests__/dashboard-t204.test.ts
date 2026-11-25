/**
 * T-204, the dashboard's part (items 17 to 19 and 21 to 25):
 *   17  Home and Quotes update by themselves (a pulse, asked every few seconds)
 *   18  the pricing trace shows the quote as sent, the service's name, and "v1"
 *   19  the Branding preview is the business's own look
 *   21  unfinished requests: one entry per person per service
 *   22  Analytics: a revised quote is one quote, and tests never count
 *   23  a final invoice far from the quote is asked about before it is saved
 *   24  setup takes more than one trade
 *   25  the QR code downloads as SVG too
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  FINAL_INVOICE_ASK,
  PRODUCT_NAME,
  badgeLineFor,
  businessAccess,
  calibrateService,
  editsPerQuote,
  finalInvoiceLooksOff,
  formatMoney,
  noBadgeLine,
  quoteWasAccepted,
  quoteWasOpened,
  quoteWasSent,
  type CalibrationAmendmentInput,
  type CalibrationQuoteInput,
} from '@qolumns/shared'
import { PULSE_INTERVAL_MS, pulseRecentSince, pulseStamp, type PulseParts } from '@/lib/dashboard-pulse'
import { mergeRefreshed, quietRefreshSize } from '@/lib/quote-list-refresh'
import { configVersionLabel, quoteAsSent } from '@/lib/trace-as-sent'
import { NEUTRAL_SAMPLE, brandingSample, previewTotals, ratePercentText, type PreviewServiceRow } from '@/lib/branding-preview'
import { collapseLeads, type LeadRow } from '@/lib/unfinished-leads'
import { analyticsMetrics } from '@/lib/analytics-metrics'
import { MAX_TRADES, OTHER_TRADE, mainTrade, toggleTrade, tradeIds, tradeValue, tradesProblem } from '@/lib/trades'
import { packServices } from '@/lib/onboarding-service'
import { getPack, listPacks } from '@/lib/vertical-packs'
import { qrMatrix, qrToSvg, svgToMatrix } from '@/lib/qr'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

// ---------------------------------------------------------------------------------------------
describe('T-204 item 17: the dashboard’s pulse', () => {
  const parts = (over: Partial<PulseParts> = {}): PulseParts => ({
    newest: [
      { id: 'qte_a', status: 'sent', version: 1 },
      { id: 'qte_b', status: 'pending_review', version: 1 },
    ],
    recent: [{ id: 'qte_a', status: 'sent', sent_at: '2026-11-25T10:00:00.000Z' }],
    unfinished: { listed: 1, fresh: 1, lastActiveAt: '2026-11-25T09:00:00.000Z' },
    questions: 0,
    ...over,
  })
  const stamp = pulseStamp(parts())

  it('the same facts give the same stamp, in any order', () => {
    expect(pulseStamp(parts())).toBe(stamp)
    expect(pulseStamp(parts({ newest: [...parts().newest].reverse() }))).toBe(stamp)
    expect(stamp).toMatch(/^[0-9a-f]{8}$/)
  })

  it('a request arriving, an estimate opened, accepted or declined, an edit and a question each move it', () => {
    const moved = [
      parts({ newest: [...parts().newest, { id: 'qte_c', status: 'queued', version: 1 }] }),
      parts({ newest: [{ id: 'qte_a', status: 'viewed', version: 1 }, parts().newest[1]!] }),
      parts({ recent: [{ id: 'qte_a', status: 'viewed', sent_at: '2026-11-25T10:00:00.000Z', viewed_at: '2026-11-25T10:05:00.000Z' }] }),
      parts({ recent: [{ id: 'qte_old', status: 'accepted', accepted_at: '2026-11-25T10:06:00.000Z' }, ...parts().recent] }),
      parts({ recent: [{ id: 'qte_old', status: 'declined', declined_at: '2026-11-25T10:07:00.000Z' }, ...parts().recent] }),
      parts({ newest: [{ id: 'qte_a', status: 'sent', version: 2 }, parts().newest[1]!] }),
      parts({ questions: 1 }),
      parts({ unfinished: { listed: 2, fresh: 2, lastActiveAt: '2026-11-25T10:08:00.000Z' } }),
      parts({ unfinished: { listed: 1, fresh: 0, lastActiveAt: '2026-11-25T09:00:00.000Z' } }),
    ].map(pulseStamp)
    for (const other of moved) expect(other).not.toBe(stamp)
    expect(new Set(moved).size).toBe(moved.length)
  })

  it('a quote that only drops out of the "lately" window does not move it', () => {
    const two = parts({ recent: [...parts().recent, { id: 'qte_z', status: 'sent', sent_at: '2026-11-24T09:00:00.000Z' }] })
    expect(pulseStamp(two)).toBe(stamp)
  })

  it('the window’s start is steady within the hour', () => {
    expect(pulseRecentSince(new Date('2026-11-25T10:05:00Z'))).toBe(pulseRecentSince(new Date('2026-11-25T10:55:00Z')))
    expect(pulseRecentSince(new Date('2026-11-25T10:05:00Z'))).toBe('2026-11-24T10:00:00.000Z')
  })

  it('it is asked every few seconds, only while the tab is on screen, and tells the page only when the stamp changes', () => {
    expect(PULSE_INTERVAL_MS).toBeGreaterThanOrEqual(3_000)
    expect(PULSE_INTERVAL_MS).toBeLessThanOrEqual(10_000)
    const hook = read('apps/web/src/components/dashboard/LivePulse.tsx')
    expect(hook).toContain("document.addEventListener('visibilitychange', onVisible)")
    // the first answer is only remembered; a later one tells the page when its stamp differs
    expect(hook).toContain('if (last === null ? missedFirst : answer.stamp !== last) window.dispatchEvent(new Event(DASHBOARD_CHANGED_EVENT))')
    // a tab hidden before its first answer reads itself once when it is shown (what it drew may be old)
    expect(hook).toMatch(/if \(document\.visibilityState !== 'visible'\) \{\s+if \(last === null\) missedFirst = true\s+return/)
    // the first ask is at once, not one interval later
    expect(hook).toMatch(/addEventListener\('visibilitychange', onVisible\)[\s\S]{0,160}schedule\(0\)/)
    // a failed ask is quiet and slower, never an error on the page
    expect(hook).toMatch(/catch \{\s+wait = PULSE_RETRY_MS/)
  })

  it('the endpoint is the signed-in business’s own, and answers no quote, name or figure', () => {
    const route = read('apps/web/src/app/api/quotes/pulse/route.ts')
    expect(route).toContain('const auth = await currentTenant()')
    expect(route.match(/\.eq\('tenant_id', tenantId\)/g)?.length).toBe(3)
    expect(route).toContain('unfinishedFilter(supabase.from(\'request_leads\').select(LEAD_ROW_COLUMNS), tenantId)')
    expect(route).not.toMatch(/customer_json|pricing_json|customer_name|customer_email|createAdminClient/)
    expect(route).toContain('const answer: PulseAnswer = { stamp: pulseStamp(parts), newUnfinished: parts.unfinished.fresh }')
  })

  it('the layout runs it once; Home reads itself again; Quotes and the Unfinished list refresh quietly', () => {
    expect(read('apps/web/src/app/(dashboard)/layout.tsx')).toContain('useDashboardPulse(setNewUnfinished)')
    const home = read('apps/web/src/app/(dashboard)/app/page.tsx')
    expect(home).toContain('<RefreshOnChange />')
    expect(read('apps/web/src/components/dashboard/LivePulse.tsx')).toContain('useDashboardChanged(() => router.refresh())')
    const quotes = read('apps/web/src/app/(dashboard)/app/quotes/page.tsx')
    expect(quotes).toContain('useDashboardChanged(refreshQuietly)')
    // quiet: the loading state is never set, and it waits while the page is busy
    const quiet = quotes.slice(quotes.indexOf('const refreshQuietly'), quotes.indexOf('useDashboardChanged(refreshQuietly)'))
    expect(quiet).not.toContain('setLoading(')
    expect(quiet).toContain('if (!ready || tab === null || busyNow.current) return')
    expect(read('apps/web/src/components/quotes/UnfinishedLeads.tsx')).toContain('useDashboardChanged(reloadQuietly)')
  })

  it('a quiet refresh never shrinks the list under the reader', () => {
    expect(quietRefreshSize(0)).toBe(50)
    expect(quietRefreshSize(70)).toBe(70)
    expect(quietRefreshSize(400)).toBe(100)
    const row = (n: number) => ({ quoteId: `q${n}`, createdAt: `2026-11-${String(30 - n).padStart(2, '0')}T00:00:00Z` })
    const shown = [1, 2, 3, 4, 5].map(row)
    // the answer covers the list: it is the list (a quote that left the tab is gone, a new one is first)
    expect(mergeRefreshed(shown, [row(0), row(1), row(3)], true).map((r) => r.quoteId)).toEqual(['q0', 'q1', 'q3'])
    // it covers only the newest part: the older quotes on screen stay below it
    expect(mergeRefreshed(shown, [row(0), row(1), row(2)], false).map((r) => r.quoteId)).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5'])
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 18: the pricing trace shows the quote as sent', () => {
  const first = {
    subtotal: 2150,
    taxLabel: 'Sales tax',
    taxRate: 8.25,
    taxAmount: 177.38,
    total: 2327.38,
    breakdown: [
      { label: 'Water heater  $1,900 × 1 unit', amount: 1900 },
      { label: 'Drain, removal and haul-away', amount: 250 },
    ],
  }
  const edited = {
    ...first,
    subtotal: 2335,
    taxAmount: 192.64,
    total: 2527.64,
    breakdown: [...first.breakdown, { label: 'Expansion tank', amount: 185 }],
  }

  it('a quote never edited: every line as first priced, and the quote’s own total', () => {
    const sent = quoteAsSent(first, null)
    expect(sent.lines.map((l) => l.mark)).toEqual(['first', 'first'])
    expect(sent.edited).toBe(false)
    expect(sent.firstTotal).toBeNull()
    expect(sent.total).toBe(2327.38)
  })

  it('a line added with Edit is on it, marked, and the total is the quote’s, not the first price', () => {
    const sent = quoteAsSent(edited, first)
    expect(sent.lines.map((l) => [l.label, l.amount, l.mark])).toEqual([
      ['Water heater  $1,900 × 1 unit', 1900, 'first'],
      ['Drain, removal and haul-away', 250, 'first'],
      ['Expansion tank', 185, 'added'],
    ])
    expect(sent.total).toBe(2527.64)
    expect(sent.subtotal).toBe(2335)
    expect(sent.taxLabel).toBe('Sales tax')
    expect(sent.edited).toBe(true)
    expect(sent.firstTotal).toBe(2327.38)
  })

  it('a changed line says what it was (its label loses the maths when its amount changes); a removed one is listed', () => {
    const sent = quoteAsSent({ ...first, subtotal: 1700, total: 1840.25, breakdown: [{ label: 'Water heater', amount: 1700 }] }, first)
    expect(sent.lines).toEqual([{ label: 'Water heater', amount: 1700, mark: 'changed', was: 1900 }])
    expect(sent.removed).toEqual([{ label: 'Drain, removal and haul-away', amount: 250 }])
  })

  it('an added service is a section with its own lines; the minimum is a note, not a line', () => {
    const withSection = {
      ...first,
      subtotal: 2400,
      total: 2598,
      breakdown: [...first.breakdown, { label: 'Minimum charge', amount: 0, kind: 'minimum' as const, minimumCharge: 300 }],
      sections: [{ serviceId: 'svc_b', serviceName: 'AC Tune-Up', breakdown: [{ label: 'First system', amount: 129 }, { label: 'Minimum charge', amount: 121, kind: 'minimum', minimumCharge: 250 }], subtotal: 250, addedBy: 'business', addedAt: '2026-11-25T10:00:00Z' }],
    }
    const sent = quoteAsSent(withSection, first)
    expect(sent.lines.map((l) => l.label)).not.toContain('Minimum charge')
    expect(sent.sections).toEqual([{ serviceName: 'AC Tune-Up', addedBy: 'business', added: true, lines: [{ label: 'First system', amount: 129 }], minimumCharge: 250, subtotal: 250 }])
    expect(sent.edited).toBe(true)
  })

  it('the version reads "v1" once, whatever was stored', () => {
    for (const stored of ['v1', '1', 'vv1', 1, ' V1 ']) expect(configVersionLabel(stored)).toBe('v1')
    expect(configVersionLabel(null)).toBeNull()
    expect(configVersionLabel('')).toBeNull()
  })

  it('the page reads the service from beside the quote, asks for the first price, and prints no "Unknown Service" or "vv"', () => {
    const page = read('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/trace/page.tsx')
    expect(page).toContain('setQuote({ ...data.quote, service: data.service ?? null })')
    expect(page).toContain('fetch(`/api/quotes/${quoteId}?trace=1`)')
    expect(page).not.toContain('Unknown Service')
    expect(page).not.toContain('Config v${')
    expect(page).toContain('{version && ` - Config ${version}`}')
    expect(page).toContain('data-testid="trace-sent-total">{formatCurrency(sent.total)}')
    // the engine's own summary is named as the first price once the quote was edited
    expect(page).toContain("{sent.edited ? C.firstTotal : 'Total:'}")
    const route = read('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    expect(route).toContain("...(forTrace && { firstPricing: await firstPricingOf(supabase, auth.tenantId, quoteId) })")
    expect(route).toMatch(/firstPricingOf[\s\S]{0,400}\.eq\('tenant_id', tenantId\)[\s\S]{0,80}\.order\('version', \{ ascending: true \}\)/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 19: the Branding preview is the business’s own look', () => {
  const money = (amount: number) => formatMoney(amount, 'USD')
  const service: PreviewServiceRow = {
    name: 'Water Heater Replacement',
    description: 'Replace a tank water heater like for like.',
    scope_includes: ['New tank', 'Haul-away'],
    scope_excludes: ['Gas line changes'],
    default_assumptions: ['Clear access to the heater'],
    expected_signals: [],
    rules: {
      baseFee: 0,
      workSteps: [
        { id: 'weekend', name: 'Weekend visit', description: '', costType: 'fixed', defaultCost: 60, optional: true, when: { fieldId: 'weekend', operator: 'equals', equals: true } },
        { id: 'haul', name: 'Drain, removal and haul-away', description: '', costType: 'fixed', defaultCost: 250, optional: false },
        { id: 'labour', name: 'Labour', description: '', costType: 'per_hour', defaultCost: 95, optional: false, quantitySource: { type: 'constant', value: 3 } },
        { id: 'pct', name: 'Service charge', description: '', costType: 'percent', defaultCost: 10, optional: false },
      ],
    },
  }

  it('the sample is one of the business’s own services: its name, its scope and its lines at its rates', () => {
    const sample = brandingSample([service], money)
    expect(sample.own).toBe(true)
    expect(sample.serviceName).toBe('Water Heater Replacement')
    expect(sample.scopeSummary).toBe('Replace a tank water heater like for like.')
    expect(sample.exclusions).toEqual(['Gas line changes'])
    // lines that are always charged come first; a percentage is not a line of its own here
    expect(sample.lines).toEqual([
      { label: 'Drain, removal and haul-away', amount: 250 },
      { label: 'Labour  $95.00 × 3 hours', amount: 285 },
      { label: 'Weekend visit', amount: 60 },
    ])
  })

  it('a service with no price is passed over; with none at all the sketch is neutral: no trade, no country', () => {
    const empty: PreviewServiceRow = { name: 'Unpriced', rules: { baseFee: 0, workSteps: [] } }
    expect(brandingSample([empty, service], money).serviceName).toBe('Water Heater Replacement')
    expect(brandingSample([empty], money)).toBe(NEUTRAL_SAMPLE)
    expect(brandingSample([], money)).toBe(NEUTRAL_SAMPLE)
    expect(JSON.stringify(NEUTRAL_SAMPLE)).not.toMatch(/kitchen|VAT|\$|£/i)
  })

  it('the tax is the business’s own name and rate, and there is no tax line when it charges none', () => {
    const sample = brandingSample([service], money)
    expect(previewTotals(sample, { enabled: true, label: 'Sales tax', ratePercent: 8.25 })).toEqual({
      subtotal: 595,
      tax: { label: 'Sales tax', ratePercent: 8.25, amount: 49.09 },
      total: 644.09,
    })
    expect(previewTotals(sample, { enabled: false, label: 'Sales tax', ratePercent: 8.25 })).toEqual({ subtotal: 595, tax: null, total: 595 })
    expect(previewTotals({ ...sample, taxExempt: true }, { enabled: true, label: 'Sales tax', ratePercent: 8.25 }).tax).toBeNull()
    expect(ratePercentText(8.25)).toBe('8.25')
    expect(ratePercentText(20)).toBe('20')
  })

  it('the badge shows only when the business’s estimates carry one: not on the free start, not on Pro', () => {
    const freeStart = businessAccess({ subscription: null, region: 'US', quotesUsed: 2 })
    const pro = businessAccess({ subscription: { plan_id: 'plan_us_pro', status: 'active' }, region: 'US', quotesUsed: 0 })
    const starter = businessAccess({ subscription: { plan_id: 'plan_us_starter', status: 'active' }, region: 'US', quotesUsed: 0 })
    const used = businessAccess({ subscription: null, region: 'US', quotesUsed: 999 })
    expect(freeStart.basis).toBe('free_start')
    expect(badgeLineFor(freeStart)).toBe(`While you have free quotes left, your estimates carry no “Prepared with ${PRODUCT_NAME}” badge. After that, only Pro removes it.`)
    expect(badgeLineFor(pro)).toBe(`Your plan removes the “Prepared with ${PRODUCT_NAME}” badge. Your estimates carry only your brand.`)
    expect(badgeLineFor(starter)).toBe(noBadgeLine())
    expect(badgeLineFor(used)).toBe(noBadgeLine())
  })

  it('the page holds no fixed sample, and the route reads the business’s own rows with the estimate page’s badge rule', () => {
    const page = read('apps/web/src/app/(dashboard)/app/settings/branding/page.tsx')
    expect(page).not.toMatch(/MOCK_QUOTE|Kitchen|John Smith|'VAT'|taxRate: 20|currency: 'USD'/)
    expect(page).toContain('{badgeShown && (')
    expect(page).toContain('{totals.tax && (')
    const route = read('apps/web/src/app/api/tenant/branding/route.ts')
    expect(route).toContain("badgeShown: !canUse(access, 'no_badge')")
    expect(route).toContain('loadAccess(supabase, tenant.id)')
    expect(route).toMatch(/\.from\('services'\)[\s\S]{0,300}\.eq\('tenant_id', tenant\.id\)/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 21: unfinished requests, one entry per person per service', () => {
  const lead = (id: string, over: Partial<LeadRow> = {}): LeadRow => ({
    id,
    service_id: 'svc_a',
    customer_email: 'derek@customer.test',
    customer_phone: null,
    progress: 'contact',
    created_at: '2026-11-25T09:00:00.000Z',
    updated_at: '2026-11-25T09:00:00.000Z',
    seen_at: null,
    ...over,
  })

  it('three tries by the same person for the same service within a day are one entry: the one that got furthest', () => {
    const entries = collapseLeads([
      lead('lead_1'),
      lead('lead_2', { created_at: '2026-11-25T09:10:00.000Z', updated_at: '2026-11-25T09:14:00.000Z', progress: 'photos' }),
      lead('lead_3', { created_at: '2026-11-25T11:00:00.000Z', updated_at: '2026-11-25T11:01:00.000Z', progress: 'questions' }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.lead.id).toBe('lead_2')
    expect(entries[0]!.rows.map((r) => r.id)).toEqual(['lead_1', 'lead_2', 'lead_3'])
    expect(entries[0]!.firstAt).toBe('2026-11-25T09:00:00.000Z')
    expect(entries[0]!.lastActiveAt).toBe('2026-11-25T11:01:00.000Z')
  })

  it('the same phone number counts as the same person, however it was typed; the email’s case does not matter', () => {
    const entries = collapseLeads([
      lead('lead_1', { customer_email: null, customer_phone: '+1 (512) 555-0100' }),
      lead('lead_2', { customer_email: 'megan@customer.test', customer_phone: '15125550100', created_at: '2026-11-25T10:00:00.000Z' }),
      lead('lead_3', { customer_email: 'MEGAN@customer.test', created_at: '2026-11-25T10:30:00.000Z' }),
    ])
    expect(entries).toHaveLength(1)
  })

  it('a try that gives the email of one earlier try and the phone of another joins them into one entry', () => {
    const entries = collapseLeads([
      lead('lead_1', { customer_email: 'megan@customer.test', customer_phone: null }),
      lead('lead_2', { customer_email: null, customer_phone: '512-555-0100', created_at: '2026-11-25T09:30:00.000Z' }),
      lead('lead_3', { customer_email: 'megan@customer.test', customer_phone: '(512) 555-0100', created_at: '2026-11-25T10:00:00.000Z', progress: 'questions' }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.rows.map((r) => r.id)).toEqual(['lead_1', 'lead_2', 'lead_3'])
    expect(entries[0]!.lead.id).toBe('lead_3')
  })

  it('another service, another person, or a try more than a day later is its own entry', () => {
    const entries = collapseLeads([
      lead('lead_1'),
      lead('lead_2', { service_id: 'svc_b' }),
      lead('lead_3', { customer_email: 'megan@customer.test' }),
      lead('lead_4', { created_at: '2026-11-26T09:00:01.000Z' }),
    ])
    expect(entries).toHaveLength(4)
  })

  it('on a tie in how far they got, the latest try is shown; an entry is new while any of its tries is unseen', () => {
    const entries = collapseLeads([
      lead('lead_1', { seen_at: '2026-11-25T09:05:00.000Z' }),
      lead('lead_2', { created_at: '2026-11-25T12:00:00.000Z', updated_at: '2026-11-25T12:00:00.000Z' }),
    ])
    expect(entries[0]!.lead.id).toBe('lead_2')
    expect(entries[0]!.isNew).toBe(true)
    expect(collapseLeads([lead('lead_1', { seen_at: '2026-11-25T09:05:00.000Z' })])[0]!.isNew).toBe(false)
  })

  it('newest activity first', () => {
    const entries = collapseLeads([lead('lead_1'), lead('lead_2', { customer_email: 'megan@customer.test', created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z' })])
    expect(entries.map((e) => e.lead.id)).toEqual(['lead_2', 'lead_1'])
  })

  it('the form takes an open request up again instead of saving a second one, with a fresh token', () => {
    const create = read('apps/web/src/app/api/public/leads/route.ts')
    expect(create).toContain('const open = await openLeadFor(supabase, { tenantId, serviceId: service.id, email: contact.clean.email, phone: contact.clean.phone })')
    expect(create).toMatch(/if \(open\) \{[\s\S]{0,700}lead_token_hash: hashLeadToken\(token\)[\s\S]{0,200}\.eq\('id', open\.id\)\s*\.eq\('tenant_id', tenantId\)/)
    const lookup = read('apps/web/src/lib/request-leads.ts')
    const fn = lookup.slice(lookup.indexOf('export async function openLeadFor'), lookup.indexOf('export async function completeLeads'))
    // the same tenant and service, still open, not marked done by the business, within the day
    for (const filter of [".eq('tenant_id', opts.tenantId)", ".eq('service_id', opts.serviceId)", ".is('completed_at', null)", ".is('handled_at', null)", ".gte('created_at', since)"]) expect(fn).toContain(filter)
  })

  it('a step earlier than the furthest one reached does not replace what was saved there', () => {
    const update = read('apps/web/src/app/api/public/leads/[leadId]/route.ts')
    expect(update).toContain('if (furthest === body!.progress) {')
    expect(update).toContain("const updates: Record<string, unknown> = { progress: furthest }")
  })

  it('"Done" clears every try of that entry, so an earlier one cannot take its place', () => {
    const done = read('apps/web/src/app/api/leads/[leadId]/done/route.ts')
    expect(done).toContain('collapseLeads((listed ?? []) as LeadRow[]).find((e) => e.rows.some((row) => row.id === leadId))')
    expect(done).toContain(".update({ handled_at: now })")
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 22: Analytics counts a revised quote once, and never a test', () => {
  const SVC = 'svc_1'
  const quote = (status: string, over: Partial<CalibrationQuoteInput> = {}): CalibrationQuoteInput => ({ serviceId: SVC, status, total: 500, ...over })

  it('one definition of sent, opened and accepted for every figure', () => {
    for (const status of ['sent', 'viewed', 'feedback_received', 'revised', 'accepted', 'paid', 'declined', 'expired']) expect(quoteWasSent({ status }), status).toBe(true)
    for (const status of ['queued', 'generating', 'pending_review', 'awaiting_clarification', 'failed']) expect(quoteWasSent({ status }), status).toBe(false)
    expect(quoteWasSent({ status: 'pending_review', sent_at: '2026-11-25T10:00:00Z' })).toBe(true)
    expect(quoteWasOpened({ status: 'declined', viewed_at: '2026-11-25T10:00:00Z' })).toBe(true)
    expect(quoteWasAccepted({ status: 'accepted' })).toBe(true)
    // both pages read the rule from the one place
    expect(read('apps/web/src/lib/analytics-metrics.ts')).toContain("from '@qolumns/shared'")
    expect(read('apps/web/src/lib/analytics-metrics.ts')).not.toContain('new Set(')
    expect(read('packages/shared/src/calibration.ts')).toContain("import { isSetupTest, quoteWasAccepted, quoteWasSent } from './quote-outcomes'")
  })

  it('"Quote Outcomes by Service" and the four figures agree on the same quotes', () => {
    const rows = [
      { status: 'revised', is_test: false, sent_at: '2026-11-25T10:00:00Z' },
      { status: 'declined', is_test: false, sent_at: '2026-11-24T10:00:00Z' },
      { status: 'accepted', is_test: false, sent_at: '2026-11-23T10:00:00Z' },
      { status: 'accepted', is_test: true, sent_at: '2026-11-23T10:00:00Z' },
      { status: 'pending_review', is_test: false, sent_at: null },
    ]
    const figures = analyticsMetrics(rows)
    const outcome = calibrateService(SVC, 'AC Tune-Up', rows.map((r) => quote(r.status, { isTest: r.is_test, sentAt: r.sent_at })), [])
    expect(figures.quotesSent).toBe(3)
    expect(outcome.quotesSent).toBe(figures.quotesSent)
    expect(outcome.accepted).toBe(figures.quotesAccepted)
    expect(outcome.accepted).toBe(1)
  })

  it('a quote revised twice is one quote and one change: from before its first edit to after its last', () => {
    const edits: CalibrationAmendmentInput[] = [
      { serviceId: SVC, quoteId: 'qte_megan', beforeTotal: 2327.38, afterTotal: 2400, createdAt: '2026-11-25T10:00:00Z' },
      { serviceId: SVC, quoteId: 'qte_megan', beforeTotal: 2400, afterTotal: 2527.64, createdAt: '2026-11-25T11:00:00Z' },
      { serviceId: SVC, quoteId: 'qte_other', beforeTotal: 1000, afterTotal: 1100, createdAt: '2026-11-25T09:00:00Z' },
      { serviceId: SVC, quoteId: 'qte_test', beforeTotal: 1000, afterTotal: 5000, createdAt: '2026-11-25T09:00:00Z', isTest: true },
    ]
    expect(editsPerQuote(edits).map((e) => [e.quoteId, e.beforeTotal, e.afterTotal])).toEqual([
      ['qte_megan', 2327.38, 2527.64],
      ['qte_other', 1000, 1100],
    ])
    const outcome = calibrateService(SVC, 'Water Heater Replacement', [quote('revised', { sentAt: '2026-11-25T10:00:00Z' })], edits)
    expect(outcome.quotesSent).toBe(1)
    expect(outcome.amendedCount).toBe(2)
  })

  it('the route tells tests apart, and the accuracy figures leave them out too', () => {
    const route = read('apps/web/src/app/api/learning/calibration/route.ts')
    expect(route).toContain(".select('service_id, status, pricing_json, created_at, is_test, sent_at')")
    expect(route).toContain("quotes!quote_id ( service_id, is_test )")
    expect(read('apps/web/src/app/api/analytics/accuracy/route.ts')).toContain(".eq('is_test', false)")
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 23: a final invoice far from the quote is asked about first', () => {
  it('under half or over double the quote is asked about; anything between is not', () => {
    expect(finalInvoiceLooksOff(1163, 2327.38)).toBe(true)
    expect(finalInvoiceLooksOff(1163.69, 2327.38)).toBe(false) // exactly half
    expect(finalInvoiceLooksOff(4654.76, 2327.38)).toBe(false) // exactly double
    expect(finalInvoiceLooksOff(4654.77, 2327.38)).toBe(true)
    expect(finalInvoiceLooksOff(2500, 2327.38)).toBe(false)
    expect(finalInvoiceLooksOff(0, 2327.38)).toBe(true)
  })

  it('with no quoted total there is nothing to compare, so nothing is asked', () => {
    expect(finalInvoiceLooksOff(500, 0)).toBe(false)
    expect(finalInvoiceLooksOff(500, Number.NaN)).toBe(false)
  })

  it('the card asks in those words, saves only on "Yes", and a changed amount is asked about afresh', () => {
    expect(FINAL_INVOICE_ASK).toBe('Is this the full amount you charged for the job?')
    const card = read('apps/web/src/components/analytics/FinalInvoiceCard.tsx')
    expect(card).toContain('if (!confirmed && finalInvoiceLooksOff(parsed, props.quotedTotal)) {')
    expect(card).toContain('onClick={() => save(true)}')
    expect(card).toMatch(/setAmount\(e\.target\.value\)\s+setAsking\(null\)/)
    // the phone app asks the same question before it saves
    expect(read('apps/mobile/app/quote/[id].tsx')).toMatch(/if \(!finalInvoiceLooksOff\(amount, quoted\)\) return void recordInvoice\(amount\)\s+Alert\.alert\(\s+FINAL_INVOICE_ASK/)
  })

  it('a saved final invoice comes back when the quote is read again', () => {
    const route = read('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    for (const column of ['final_invoice_amount', 'final_invoice_recorded_at', 'final_invoice_note']) expect(route).toContain(`${column}: (quote as`)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 24: setup takes more than one trade', () => {
  const isPack = (id: string) => Boolean(getPack(id))
  const [first, second] = listPacks('US').filter((p) => p.region === 'US')

  it('the picked trades are kept in the one column, in order; one trade reads as it always did', () => {
    expect(tradeValue([first!.id, second!.id])).toBe(`${first!.id},${second!.id}`)
    expect(tradeIds(`${first!.id}, ${second!.id},${first!.id}`)).toEqual([first!.id, second!.id])
    expect(tradeIds(first!.id)).toEqual([first!.id])
    expect(tradeValue([first!.id])).toBe(first!.id)
    expect(tradeValue([])).toBeNull()
    expect(tradeIds(null)).toEqual([])
    expect(mainTrade(`${first!.id},${second!.id}`)).toBe(first!.id)
  })

  it('only template packs can be saved; "Something else" stands alone; there is a most', () => {
    expect(tradesProblem([first!.id, second!.id], isPack)).toBeNull()
    expect(tradesProblem([OTHER_TRADE], isPack)).toBeNull()
    expect(tradesProblem([], isPack)).toBeNull()
    expect(tradesProblem([first!.id, 'not-a-pack'], isPack)).toBe('Unknown trade')
    expect(tradesProblem([first!.id, OTHER_TRADE], isPack)).toMatch(/cannot be combined/)
    const many = listPacks('US').slice(0, MAX_TRADES + 1).map((p) => p.id)
    expect(tradesProblem(many, isPack)).toBe(`Pick up to ${MAX_TRADES} trades`)
  })

  it('ticking adds a trade, ticking again removes it, and "Something else" replaces the trades', () => {
    expect(toggleTrade([], 'a')).toEqual(['a'])
    expect(toggleTrade(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleTrade(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleTrade(['a', 'b'], OTHER_TRADE)).toEqual([OTHER_TRADE])
    expect(toggleTrade([OTHER_TRADE], 'a')).toEqual(['a'])
    expect(toggleTrade([OTHER_TRADE], OTHER_TRADE)).toEqual([])
    expect(toggleTrade(['a', 'b', 'c', 'd'].slice(0, MAX_TRADES), 'z')).toHaveLength(MAX_TRADES)
  })

  it('"Here’s what we found" offers each picked trade’s services, under the trade’s name, each once', () => {
    const offered = packServices([first!, second!])
    expect(offered).toHaveLength(new Set([...first!.services, ...second!.services].map((s) => s.name.toLowerCase())).size)
    expect(offered.slice(0, first!.services.length).every((s) => s.trade === first!.name)).toBe(true)
    expect(offered.at(-1)!.trade).toBe(second!.name)
    expect(offered.every((s) => s.selected)).toBe(true)
    // the same pack twice offers nothing twice
    expect(packServices([first!, first!])).toHaveLength(first!.services.length)
  })

  it('the saving route validates every id, and the one reader that wants a single trade takes the first', () => {
    const route = read('apps/web/src/app/api/tenant/route.ts')
    expect(route).toContain('const problem = tradesProblem(picked, (id) => Boolean(getPack(id)))')
    expect(route).toContain('updates.trade = tradeValue(picked)')
    expect(read('apps/web/src/lib/clean-slug-server.ts')).toContain('trade: mainTrade(row.trade),')
    const step = read('apps/web/src/components/onboarding/TradeStep.tsx')
    expect(step).toContain('role="checkbox"')
    expect(step).not.toContain('role="radio"')
  })

  it('no migration: the column is the one it was', () => {
    const migrations = read('supabase/migrations/00000000000033_setup_test_quote.sql')
    expect(migrations).toContain('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trade TEXT;')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 25: the QR code as SVG', () => {
  const link = 'https://qolumns.com/quote/northgate-heating-air'
  const matrix = qrMatrix(link)
  const svg = qrToSvg(matrix)

  it('the vector draws exactly the modules the picture draws', () => {
    expect(svgToMatrix(svg)).toEqual(matrix)
  })

  it('it is a plain SVG: a white ground, the quiet zone, one path, and it scales', () => {
    const modules = matrix.length + 8
    expect(svg).toContain(`viewBox="0 0 ${modules} ${modules}"`)
    expect(svg).toContain(`<rect width="${modules}" height="${modules}" fill="#FFFFFF"/>`)
    expect(svg.match(/<path /g)).toHaveLength(1)
    expect(svg).toContain('fill="#1B2823"')
    expect(svg).not.toMatch(/<script|<image|href=/)
    // nothing is drawn in the quiet zone
    for (const [, x, y] of svg.matchAll(/M(\d+) (\d+)h/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(4)
      expect(Number(y)).toBeGreaterThanOrEqual(4)
    }
  })

  it('"Download SVG" sits beside "Download PNG", and either one ticks the share step', () => {
    const component = read('apps/web/src/components/share/QrCode.tsx')
    expect(component).toContain('Download PNG')
    expect(component).toContain('Download SVG')
    expect(component).toContain("fileName.replace(/\\.png$/i, '') + '.svg'")
    // one place saves a file and reports it, used by both buttons
    expect(component.match(/body: JSON\.stringify\(\{ event: 'qr' \}\)/g)).toHaveLength(1)
    expect(component).toContain('if (blob) save(blob, fileName)')
    expect(component).toContain("save(new Blob([qrToSvg(qrMatrix(value))], { type: 'image/svg+xml' })")
  })
})
