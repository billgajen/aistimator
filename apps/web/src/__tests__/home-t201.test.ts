/**
 * T-201, Home (items 13 and 35):
 *   13. switching every service off does not send Home back to setup; Home says so in a notice
 *   35. Home's "Accepted" count and the panel's Accepted step count the same thing, under the same word
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { QUOTE_TURN_COPY, WON_COPY, monthStart, wonSummary, type WonRow } from '@qolumns/shared'
import { homeNumbers, type HomeQuoteRow } from '@/lib/home-numbers'
import { SERVICES_OFF_NOTICE, buildChecklist, serviceState } from '@/lib/setup-checklist'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

describe('T-201 item 13: every service switched off is not "no services"', () => {
  it('a business with services, all off: setup is over, and the notice shows', () => {
    expect(serviceState([{ active: false }, { active: false }])).toEqual({ any: true, allOff: true })
  })

  it('one service on: no notice', () => {
    expect(serviceState([{ active: false }, { active: true }])).toEqual({ any: true, allOff: false })
  })

  it('no service at all: setup is not over, and there is nothing to call "off"', () => {
    expect(serviceState([])).toEqual({ any: false, allOff: false })
    expect(serviceState(null)).toEqual({ any: false, allOff: false })
  })

  it('the notice is the owner’s sentence, with the way to Services', () => {
    expect(SERVICES_OFF_NOTICE.text).toBe('All your services are off, so customers can’t get an estimate.')
    expect(SERVICES_OFF_NOTICE.link).toBe('Go to Services')
  })

  it('Home reads every service (on or off), goes to setup only when there is none, and links the notice to Services', () => {
    const page = read('apps/web/src/app/(dashboard)/app/page.tsx')
    // the read no longer asks for active services only
    expect(page).toContain("supabase.from('services').select('id, active').eq('tenant_id', profile.tenant_id)")
    expect(page).not.toMatch(/from\('services'\)\.select\('id'\)[^\n]*\.eq\('active', true\)/)
    expect(page).toContain('const hasService = services.any')
    const redirectAt = page.indexOf("redirect('/app/onboarding')")
    expect(page.slice(redirectAt - 80, redirectAt)).toContain('!hasService && !tenantRow?.onboarding_skipped_at')
    const notice = page.slice(page.indexOf('data-testid="services-off-notice"'))
    expect(page).toContain('{services.allOff && (')
    expect(notice.slice(0, 600)).toContain('href="/app/services"')
  })

  it('"Add a service" stays ticked for a business whose services are all off', () => {
    const state = serviceState([{ active: false }])
    const list = buildChecklist({ hasService: state.any, pricesCheckedAt: null, quoteLinkCopiedAt: null, quoteLinkFirstVisitAt: null, hasRealRequest: false })
    expect(list.steps.find((s) => s.id === 'service')?.completed).toBe(true)
  })
})

describe('T-201 item 35: "Accepted" on Home and in the panel are one number', () => {
  const NOW = new Date('2026-11-21T15:00:00Z')
  const NY = 'America/New_York'
  const row = (over: Partial<WonRow> & { total?: number }): WonRow => ({
    status: 'sent',
    created_at: '2026-11-10T12:00:00Z',
    sent_at: null,
    viewed_at: null,
    accepted_at: null,
    pricing_json: { total: over.total ?? 1000 },
    is_test: false,
    source: null,
    ...over,
  })
  const accepted = (over: Partial<WonRow> & { total?: number }) =>
    row({ status: 'accepted', sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z', accepted_at: '2026-11-12T09:00:00Z', ...over })

  const rows: WonRow[] = [
    accepted({ source: { type: 'widget' } }),
    accepted({ source: 'whatsapp' }),
    row({ sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z' }),
    // made on site, accepted this month
    accepted({ source: { type: 'app' } }),
    // accepted last month, a setup test, and a declined one: in neither count
    accepted({ created_at: '2026-10-05T12:00:00Z', sent_at: '2026-10-05T12:00:00Z', viewed_at: '2026-10-06T12:00:00Z', accepted_at: '2026-10-07T12:00:00Z' }),
    accepted({ is_test: true }),
    row({ status: 'declined', sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z' }),
  ]
  /** The same rows as Home reads them */
  const homeRows = rows.map((q, i) => ({ id: `q${i}`, approved_at: null, declined_at: null, customer_name: null, ...q, source_type: typeof q.source === 'string' ? q.source : ((q.source as { type?: string } | null)?.type ?? null) })) as unknown as HomeQuoteRow[]

  const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 4, fromCustomers: 3 } })
  const step = summary?.customer?.steps?.find((s) => s.key === 'accepted')

  it('the panel’s Accepted step counts every accepted estimate this month: customer requests and on-site', () => {
    expect(step?.count).toBe(3)
    // the headline is still customer requests alone, with the on-site line beside it: 2 + 1 = 3
    expect(summary?.customer?.jobs).toBe(2)
    expect(summary?.onSite?.jobs).toBe(1)
  })

  it('it is the number Home’s "Accepted" count shows for the same rows', () => {
    expect(homeNumbers(homeRows, monthStart(NOW, NY)).accepted).toBe(step?.count)
  })

  it('with on-site estimates in it, the step says so in place of a share of "opened"', () => {
    expect(step?.share).toBeNull()
    expect(step?.note).toBe('includes 1 made on site')
  })

  it('with none, the share of opened is said as before, and there is no note', () => {
    const only = wonSummary(rows.filter((q) => (q.source as { type?: string } | null)?.type !== 'app'), { now: NOW, timeZone: NY, everAccepted: { any: 3, fromCustomers: 3 } })
    const last = only?.customer?.steps?.find((s) => s.key === 'accepted')
    // four were opened this month (two accepted, one waiting, one declined later): 2 of 4
    expect(last).toMatchObject({ count: 2, share: '50%' })
    expect(last?.note).toBeUndefined()
  })

  it('an on-site estimate accepted in a month with no customer step still shows the steps, with the same count', () => {
    const quiet = wonSummary([accepted({ source: 'app' })], { now: NOW, timeZone: NY, everAccepted: { any: 2, fromCustomers: 1 } })
    expect(quiet?.customer?.steps?.map((s) => `${s.key}:${s.count}`)).toEqual(['requests:0', 'sent:0', 'opened:0', 'accepted:1'])
  })

  it('both are labelled with the same word, and Home’s says "this month"', () => {
    expect(WON_COPY.steps.accepted).toBe(QUOTE_TURN_COPY.tabs.accepted)
    expect(WON_COPY.steps.accepted).toBe('Accepted')
    expect(QUOTE_TURN_COPY.home.stand.acceptedNote).toBe('this month')
  })

  it('the panel draws the note under the step', () => {
    const panel = read('apps/web/src/components/home/WonPanel.tsx')
    expect(panel).toContain('data-testid="won-step-note"')
    expect(panel).toContain('{step.note && (')
  })
})
