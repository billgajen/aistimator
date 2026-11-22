/**
 * T-198: "Report a problem with this estimate" in the app: the dashboard's
 * choices, note and "should have been" figure, through the dashboard's own
 * route, and the same one line once a quote has been reported.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESTIMATE_CHOICES, SUPPORT_COPY } from '@qolumns/shared'
import { REPORT_CHOICES, reportBody, reportProblem, reportedLine, toggleChoice, type EstimateReportItem } from '../lib/estimate-report'
import { TONE_STYLE } from '../lib/status'
import { createApi } from '../lib/api'

const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8')
const report = (id: string, status: EstimateReportItem['status'], createdAt: string): EstimateReportItem => ({ id, status, statusLabel: SUPPORT_COPY.status[status], createdAt })

describe('the form', () => {
  it('offers the dashboard’s seven choices, in its order and its words', () => {
    expect(REPORT_CHOICES.map((c) => c.value)).toEqual([...ESTIMATE_CHOICES])
    expect(REPORT_CHOICES.map((c) => c.label)).toEqual(['Price too high', 'Price too low', 'Wrong measurement or reading', 'Missed something the customer asked for', 'Included something it shouldn’t', 'Wording', 'Something else'])
  })

  it('needs one choice, and words for "Something else"', () => {
    expect(reportProblem([], '')).toBe(SUPPORT_COPY.estimate.chooseOne)
    expect(reportProblem(['other'], '  ')).toBe(SUPPORT_COPY.estimate.moreNeeded)
    expect(reportProblem(['other'], 'The wording is odd')).toBeNull()
    expect(reportProblem(['too_high'], '')).toBeNull()
    expect(toggleChoice(['too_high'], 'wording')).toEqual(['too_high', 'wording'])
    expect(toggleChoice(['too_high', 'wording'], 'too_high')).toEqual(['wording'])
    expect(toggleChoice(['too_high'], 'not-a-choice')).toEqual(['too_high'])
  })

  it('sends what the dashboard sends: the choices, the note and the "should have been" figure', () => {
    expect(reportBody('qte_1', ['too_high', 'wrong_reading'], '  Two rooms, not twenty.  ', '$1,250.50')).toEqual({ kind: 'estimate', quoteId: 'qte_1', choices: ['too_high', 'wrong_reading'], body: 'Two rooms, not twenty.', expectedTotal: 1250.5 })
    expect(reportBody('qte_1', ['wording'], '', '').expectedTotal).toBeNull()
  })

  it('goes through the dashboard’s own route, signed in as the business', async () => {
    const calls: Array<{ url: string; method: string; body: unknown; auth: string | null }> = []
    const api = createApi({
      baseUrl: 'https://app.example.test',
      getAccessToken: async () => 'aaa.bbb.ccc',
      fetch: (async (url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get('Authorization') })
        return new Response(JSON.stringify(url.includes('?quoteId=') ? { reports: [report('r1', 'new', '2026-11-21T10:00:00Z')] } : { message: SUPPORT_COPY.problem.thanks }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }) as unknown as NonNullable<Parameters<typeof createApi>[0]['fetch']>,
    })
    const sent = await api.reportEstimate(reportBody('qte_1', ['too_low'], 'Missed the ceiling', '900'))
    expect(sent.message).toBe(SUPPORT_COPY.problem.thanks)
    const listed = await api.estimateReports('qte_1')
    expect(listed.reports).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: 'https://app.example.test/api/support/reports', method: 'POST', body: { kind: 'estimate', quoteId: 'qte_1', choices: ['too_low'], body: 'Missed the ceiling', expectedTotal: 900 } })
    expect(calls[1]).toMatchObject({ url: 'https://app.example.test/api/support?quoteId=qte_1', method: 'GET' })
    for (const call of calls) expect(call.auth).toBe('Bearer aaa.bbb.ccc')
  })
})

describe('once reported', () => {
  it('one line, however many times: the latest report’s date and status', () => {
    expect(reportedLine([], 'en-US')).toBeNull()
    expect(reportedLine(null)).toBeNull()
    const once = reportedLine([report('r1', 'new', '2026-11-21T10:00:00Z')], 'en-US')!
    expect(once).toMatchObject({ text: 'Reported on Nov 21', status: 'Sent', tone: TONE_STYLE.waiting })
    // newest first, as the route answers
    const twice = reportedLine([report('r2', 'fixed', '2026-11-21T10:00:00Z'), report('r1', 'new', '2026-11-18T10:00:00Z')], 'en-US')!
    expect(twice).toMatchObject({ text: 'Reported 2 times, latest Nov 21', status: 'Fixed', tone: TONE_STYLE.good })
    expect(reportedLine([report('r3', 'not_a_fault', '2026-11-21T10:00:00Z')], 'en-GB')).toMatchObject({ text: 'Reported on 21 Nov', tone: TONE_STYLE.closed })
  })
})

describe('on the quote screen', () => {
  it('sits on every priced quote, as a card of its own, and is read on its own', () => {
    const screen = read('app/quote/[id].tsx')
    expect(screen).toContain('{!pricing ? <EstimateReport quoteId={quote.id} currency={currency} /> : null}')
    const component = read('src/components/EstimateReport.tsx')
    expect(component).toContain('api.estimateReports(quoteId)')
    expect(component).toContain('api.reportEstimate(reportBody(quoteId, chosen, more, expected))')
    // a list that cannot be read changes nothing on the screen
    expect(component).toMatch(/catch \{\s*\/\/ the quote reads the same without it/)
    // every word a business reads is the shared one
    expect(component).toContain('title={C.link}')
    expect(component).toContain('{C.investigate}')
    expect(component).toContain('help={C.expectedHint}')
  })

  it('the figure is sent to be recorded; nothing else in the app reads it', () => {
    for (const file of ['app/quote/[id].tsx', 'src/lib/price.ts', 'src/lib/outbox.ts']) expect(read(file), file).not.toMatch(/expectedTotal|expected_total/)
  })
})
