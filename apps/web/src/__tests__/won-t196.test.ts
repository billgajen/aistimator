/**
 * T-196: "Won through Qolumns" (the split by who made the request, the month
 * in the business's time zone, setup tests left out, nothing before the first
 * accepted estimate) and the ticket's small fixes that are plain functions.
 */
import { describe, it, expect } from 'vitest'
import { BUSINESS_REQUEST_SOURCES, PRODUCT_NAME, WON_COPY, fieldExample, getRegion, isTimeZone, monthStart, shareMoved, wonLines, wonSummary, type WonRow } from '@qolumns/shared'
import { cardServiceLine, TEMPLATE_CARDS } from '@/lib/marketing/who-its-for'
import { widgetConfigRow } from '@/lib/service-rows'
import { getPack } from '@/lib/vertical-packs'
import { businessTimeZone, customerMadeFilter } from '@/lib/won'

const NOW = new Date('2026-11-21T15:00:00Z')
const NY = 'America/New_York'
const EVER = { any: 5, fromCustomers: 3 }

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
const accepted = (over: Partial<WonRow> & { total?: number }) => row({ status: 'accepted', sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z', accepted_at: '2026-11-12T09:00:00Z', ...over })

describe('T-196: the month, in the business\'s time zone', () => {
  it('starts at the business\'s midnight, not UTC\'s', () => {
    // 1 November 2026, 00:00 in New York is 04:00 UTC (summer time ended that morning at 2am, so midnight is still EDT)
    expect(monthStart(NOW, NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(monthStart(NOW, 'Europe/London').toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(monthStart(NOW, 'Asia/Kolkata').toISOString()).toBe('2026-10-31T18:30:00.000Z')
    // December in New York is winter time: five hours behind
    expect(monthStart(new Date('2026-12-15T12:00:00Z'), NY).toISOString()).toBe('2026-12-01T05:00:00.000Z')
  })

  it('the month before, and across a year\'s end', () => {
    expect(monthStart(NOW, NY, 1).toISOString()).toBe('2026-10-01T04:00:00.000Z')
    expect(monthStart(new Date('2027-01-10T12:00:00Z'), 'Europe/London', 1).toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('late on the last evening of a month is still that month for the business', () => {
    // 30 November, 23:30 in New York is already 1 December in UTC
    const lateNovember = new Date('2026-12-01T04:30:00Z')
    expect(monthStart(lateNovember, NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(monthStart(lateNovember, 'UTC').toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('an estimate accepted at 00:30 UTC on the 1st belongs to the month before for a New York business', () => {
    const rows = [accepted({ accepted_at: '2026-11-01T00:30:00Z', total: 700 }), accepted({ accepted_at: '2026-11-01T04:30:00Z', total: 300 })]
    const inNewYork = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: EVER })
    expect(inNewYork?.customer).toMatchObject({ value: 300, jobs: 1, lastMonth: { value: 700, jobs: 1 } })
    const inLondon = wonSummary(rows, { now: NOW, timeZone: 'Europe/London', everAccepted: EVER })
    expect(inLondon?.customer).toMatchObject({ value: 1000, jobs: 2, lastMonth: null })
  })

  it('a name that is not a time zone is refused, and the region\'s zone is used until the business has its own', () => {
    expect(isTimeZone('Europe/London')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(null)).toBe(false)
    expect(businessTimeZone({ time_zone: 'America/Chicago', region: 'US' })).toBe('America/Chicago')
    expect(businessTimeZone({ time_zone: null, region: 'US' })).toBe(getRegion('US').timeZone)
    expect(businessTimeZone({ time_zone: 'nonsense', region: 'GB' })).toBe('Europe/London')
    // an unknown zone never throws
    expect(monthStart(NOW, 'nonsense').toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('T-196: the split by who made the request', () => {
  const rows: WonRow[] = [
    // seven customer requests this month: five sent, four opened, two accepted
    accepted({ total: 5000, source: { type: 'widget' } }),
    accepted({ total: 7400, source: 'whatsapp' }),
    row({ sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z' }),
    row({ sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z' }),
    row({ sent_at: '2026-11-10T12:05:00Z' }),
    row({ status: 'pending_review' }),
    row({ status: 'failed' }),
    // two the business made on site, both accepted
    accepted({ total: 1200, source: { type: 'app' } }),
    accepted({ total: 2000, source: 'app' }),
    // last month
    accepted({ created_at: '2026-10-05T12:00:00Z', sent_at: '2026-10-05T12:00:00Z', viewed_at: '2026-10-06T12:00:00Z', accepted_at: '2026-10-07T12:00:00Z', total: 9800 }),
  ]
  const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: EVER })

  it('the headline counts customer requests only; on-site estimates are never added in', () => {
    expect(summary?.title).toBe(`Won through ${PRODUCT_NAME}`)
    expect(summary?.customer).toMatchObject({ value: 12400, jobs: 2 })
    expect(summary?.onSite).toMatchObject({ value: 3200, jobs: 2 })
    const lines = wonLines(summary!, 'USD', 'en-US')
    expect(lines.headline).toBe('Won this month: $12,400 from 2 jobs')
    expect(lines.onSite).toBe('Plus $3,200 from 2 estimates you made on site.')
    expect(lines.lastMonth).toBe('Last month: $9,800 from 1 job')
  })

  it('four steps with the share that moved on; on-site estimates are in none of the first three', () => {
    // T-201: Accepted counts every accepted estimate this month (2 customers + 2 on site), the number
    // Home's "Accepted" count shows; with on-site estimates in it, it says so in place of a share
    expect(summary?.customer?.steps).toEqual([
      { key: 'requests', label: 'Requests', count: 7, share: null },
      { key: 'sent', label: 'Estimates sent', count: 5, share: '71%' },
      { key: 'opened', label: 'Opened', count: 4, share: '80%' },
      { key: 'accepted', label: 'Accepted', count: 4, share: null, note: 'includes 2 made on site' },
    ])
  })

  it('the rule for "the business made it" is the shared one', () => {
    for (const type of BUSINESS_REQUEST_SOURCES) {
      const made = wonSummary([accepted({ source: { type }, total: 10 })], { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 0 } })
      expect(made?.customer).toBeNull()
      expect(made?.onSite).toMatchObject({ jobs: 1 })
    }
    expect(customerMadeFilter()).toBe(`source_json->>type.is.null,source_json->>type.not.in.(${BUSINESS_REQUEST_SOURCES.join(',')})`)
  })

  it('a step with no date of its own was still passed when a later one happened', () => {
    // accepted without ever recording an open (accepted from the link's first screen), and one opened before it was marked sent
    const rows = [accepted({ viewed_at: null, total: 300 }), row({ sent_at: null, viewed_at: '2026-11-11T09:00:00Z' })]
    const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 1 } })
    expect(summary?.customer?.steps?.map((s) => `${s.key}:${s.count}`)).toEqual(['requests:2', 'sent:2', 'opened:2', 'accepted:1'])
    // a date of its own in another month is respected: sent last month, accepted this month
    const older = [accepted({ created_at: '2026-10-28T12:00:00Z', sent_at: '2026-10-28T12:10:00Z', viewed_at: '2026-10-29T12:00:00Z', accepted_at: '2026-11-03T12:00:00Z' })]
    expect(wonSummary(older, { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 1 } })?.customer?.steps?.map((s) => `${s.key}:${s.count}:${s.share}`)).toEqual([
      'requests:0:null',
      'sent:0:null',
      'opened:0:null',
      'accepted:1:null',
    ])
  })

  it('a share is said only when it can be: nothing to divide, or more arrived than left, says nothing', () => {
    expect(shareMoved(7, 5)).toBe('71%')
    expect(shareMoved(4, 4)).toBe('100%')
    expect(shareMoved(0, 0)).toBeNull()
    expect(shareMoved(2, 3)).toBeNull()
  })

  it('money in the business\'s currency', () => {
    expect(wonLines(summary!, 'GBP', 'en-GB').headline).toBe('Won this month: £12,400 from 2 jobs')
  })
})

describe('T-196: when the panel shows', () => {
  it('not before the first accepted estimate, whatever else there is', () => {
    const busy = [row({ sent_at: '2026-11-10T12:05:00Z', viewed_at: '2026-11-11T09:00:00Z' }), row({})]
    expect(wonSummary(busy, { now: NOW, timeZone: NY, everAccepted: { any: 0, fromCustomers: 0 } })).toBeNull()
    expect(wonSummary([], { now: NOW, timeZone: NY, everAccepted: { any: 0, fromCustomers: 0 } })).toBeNull()
    expect(wonSummary(null, { now: NOW, timeZone: NY, everAccepted: { any: 0, fromCustomers: 0 } })).toBeNull()
  })

  it('setup tests never count: not in the value, not in the steps', () => {
    const rows = [accepted({ total: 900 }), accepted({ total: 5000, is_test: true }), row({ is_test: true }), accepted({ total: 400, source: 'app', is_test: true })]
    const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 1 } })
    expect(summary?.customer).toMatchObject({ value: 900, jobs: 1 })
    expect(summary?.customer?.steps?.[0]).toMatchObject({ key: 'requests', count: 1 })
    expect(summary?.onSite).toBeNull()
  })

  it('an estimate that was accepted and is no longer (declined later) is not won', () => {
    const summary = wonSummary([accepted({ status: 'declined' }), accepted({ status: 'paid', total: 250 })], { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 1 } })
    expect(summary?.customer).toMatchObject({ value: 250, jobs: 1 })
  })

  it('a business that only quotes on site gets its own title and one line, without "Plus"', () => {
    const rows = [accepted({ total: 1200, source: 'app' }), accepted({ total: 2000, source: 'app' }), accepted({ total: 600, source: 'app', accepted_at: '2026-10-20T12:00:00Z' })]
    const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 3, fromCustomers: 0 } })
    expect(summary?.title).toBe('Quoted on site this month')
    expect(summary?.customer).toBeNull()
    const lines = wonLines(summary!, 'USD', 'en-US')
    expect(lines.headline).toBeNull()
    expect(lines.onSite).toBe('$3,200 from 2 estimates you made on site.')
    expect(lines.lastMonth).toBe('Last month: $600 from 1 estimate')
  })

  it('that business with nothing accepted this month sees no panel: no empty panel, no zeros', () => {
    const rows = [accepted({ total: 600, source: 'app', accepted_at: '2026-10-20T12:00:00Z' })]
    expect(wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 0 } })).toBeNull()
  })

  it('its first customer request this month brings the customer part in', () => {
    const rows = [accepted({ total: 1200, source: 'app' }), row({})]
    const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 0 } })
    expect(summary?.title).toBe(WON_COPY.title)
    expect(summary?.customer).toMatchObject({ jobs: 0 })
    expect(wonLines(summary!, 'USD', 'en-US').headline).toBe('No jobs won yet this month')
    expect(wonLines(summary!, 'USD', 'en-US').onSite).toBe('Plus $1,200 from 1 estimate you made on site.')
  })

  it('a quiet month after a won one: the headline says so, and no row of zeros', () => {
    const rows = [accepted({ created_at: '2026-10-05T12:00:00Z', sent_at: '2026-10-05T12:00:00Z', viewed_at: '2026-10-06T12:00:00Z', accepted_at: '2026-10-07T12:00:00Z', total: 9800 })]
    const summary = wonSummary(rows, { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 1 } })
    expect(summary?.customer).toMatchObject({ jobs: 0, steps: null, lastMonth: { value: 9800, jobs: 1 } })
    expect(wonLines(summary!, 'USD', 'en-US')).toMatchObject({ headline: 'No jobs won yet this month', lastMonth: 'Last month: $9,800 from 1 job', onSite: null })
  })

  it('one job is "1 job"', () => {
    const summary = wonSummary([accepted({ total: 480 })], { now: NOW, timeZone: NY, everAccepted: { any: 1, fromCustomers: 1 } })
    expect(wonLines(summary!, 'USD', 'en-US').headline).toBe('Won this month: $480 from 1 job')
  })
})

describe('T-196: a question\'s hint is shown once', () => {
  it('what goes in the box is the question\'s own example, never a copy of the hint', () => {
    expect(fieldExample({ placeholder: 'From 1 to 5.', helpText: 'From 1 to 5.' })).toBeUndefined()
    expect(fieldExample({ placeholder: ' From 1 to 5. ', helpText: 'From 1 to 5.' })).toBeUndefined()
    expect(fieldExample({ placeholder: 'e.g. 3', helpText: 'From 1 to 5.' })).toBe('e.g. 3')
    expect(fieldExample({ helpText: 'From 1 to 5.' })).toBeUndefined()
    expect(fieldExample({ placeholder: '' })).toBeUndefined()
  })

  it('a new service\'s questions are saved with the hint once', () => {
    const saved = widgetConfigRow('tnt_x', 'svc_x', { suggestedFields: [{ fieldId: 'ms_rooms', label: 'How many rooms?', type: 'number', required: true, helpText: 'From 1 to 5.' }] } as never)
    const field = (saved?.config_json.fields ?? [])[0] as { helpText?: string; placeholder?: string }
    expect(field.helpText).toBe('From 1 to 5.')
    expect(field.placeholder).toBeUndefined()
  })
})

describe('T-196: "Who it\'s for" cards', () => {
  it('no service line when the only service has the card\'s name', () => {
    expect(cardServiceLine('Junk removal', ['Junk removal'])).toBeNull()
    expect(cardServiceLine('Junk removal', [' junk Removal '])).toBeNull()
    expect(cardServiceLine('Fence installation', [])).toBeNull()
    // one service under another name is still said
    expect(cardServiceLine('Fence installation', ['Wood fence'])).toBe('Wood fence')
  })

  it('the "·" is tied to the name before it, so it never starts a line', () => {
    const line = cardServiceLine('HVAC', ['AC replacement', 'Furnace replacement', 'Heat pump'])
    expect(line).toBe('AC replacement\u00A0· Furnace replacement\u00A0· Heat pump')
    // every "·" has a non-breaking space before it and an ordinary one after
    expect(line?.match(/·/g)).toHaveLength(2)
    expect(line).not.toMatch(/[^\u00A0]·/)
  })

  it('every card today: a single-service template whose service is its title shows no line', () => {
    for (const card of TEMPLATE_CARDS) {
      const names = (getPack(card.packId)?.services ?? []).map((s) => s.name)
      const line = cardServiceLine(card.label, names)
      if (names.length === 1 && names[0]?.toLowerCase() === card.label.toLowerCase()) expect(line).toBeNull()
      else expect(line).toContain(names[0])
    }
  })
})
