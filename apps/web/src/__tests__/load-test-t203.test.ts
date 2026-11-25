/**
 * T-203: the load test's own rules (scripts/load-test/lib.mts): it never runs
 * against production, no business is sent more than 15 requests, the mix of
 * requests, and the report's sums. The run itself needs the servers and is
 * not a unit test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PER_BUSINESS_CAP, PRODUCTION_SUPABASE_REF, productionRefusal, namesProduction, parseArgs, kindCounts, planRun, percentile, spread,
  outcomeOf, summarise, reportText, type RequestResult,
} from '../../../../scripts/load-test/lib.mjs'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const LOCAL_DB = 'http://127.0.0.1:54321'

describe('T-203 load test: it refuses production', () => {
  it('the local stack may be used', () => {
    expect(productionRefusal('http://localhost:3000', LOCAL_DB)).toBeNull()
    expect(productionRefusal('http://127.0.0.1:3000', 'http://localhost:54321')).toBeNull()
  })

  it('the product’s own address and everything under it is refused', () => {
    for (const url of ['https://qolumns.com', 'https://www.qolumns.com', 'https://QOLUMNS.com/', 'http://app.qolumns.com:443', 'https://quotes.some-business.qolumns.com/quote/x']) {
      expect(productionRefusal(url, 'https://staging-ref.supabase.co'), url).toMatch(/production/)
    }
  })

  it('the web project’s addresses at the host are refused: the main one and each deploy’s own', () => {
    for (const url of ['https://estimator-web-phi.vercel.app', 'https://estimator-8gu7codfb-someone.vercel.app', 'https://estimator-web-git-main-someone.vercel.app']) {
      expect(productionRefusal(url, 'https://staging-ref.supabase.co'), url).toMatch(/production/)
    }
  })

  it('production’s database is refused wherever it is named', () => {
    expect(productionRefusal('https://staging.example.org', `https://${PRODUCTION_SUPABASE_REF}.supabase.co`)).toMatch(/production/)
    expect(productionRefusal('https://staging.example.org', `https://${PRODUCTION_SUPABASE_REF.toUpperCase()}.supabase.co`)).toMatch(/production/)
    expect(productionRefusal(`https://staging.example.org/?db=${PRODUCTION_SUPABASE_REF}`, 'https://staging-ref.supabase.co')).toMatch(/production/)
    // the same ref is what the app's builds carry
    expect(read('apps/mobile/eas.json')).toContain(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`)
  })

  it('a lookalike of the product’s address is not production, and another environment may be used', () => {
    expect(productionRefusal('https://staging.example.org', 'https://staging-ref.supabase.co')).toBeNull()
    expect(productionRefusal('https://notqolumns.com', 'https://staging-ref.supabase.co')).toBeNull()
  })

  it('this machine’s database is never paired with an app on the internet, nor the other way round', () => {
    expect(productionRefusal('https://staging.example.org', LOCAL_DB)).toMatch(/not the same environment/)
    expect(productionRefusal('http://localhost:3000', 'https://staging-ref.supabase.co')).toMatch(/not the same environment/)
  })

  it('an address that is not a web address is refused', () => {
    expect(productionRefusal('qolumns', LOCAL_DB)).toMatch(/not a web address/)
    expect(productionRefusal('file:///tmp/x', LOCAL_DB)).toMatch(/not a web address/)
    expect(productionRefusal('http://localhost:3000', 'nowhere')).toMatch(/not a web address/)
  })

  it('a page built for production’s database is recognised', () => {
    expect(namesProduction(`const url="https://${PRODUCTION_SUPABASE_REF}.supabase.co"`)).toBe(true)
    expect(namesProduction('const url="http://127.0.0.1:54321"')).toBe(false)
  })

  it('the script has no way round the refusal, and refuses before it creates anything', () => {
    const script = read('scripts/load-test/run.mts')
    expect(script).not.toMatch(/--force|--allow|--yes|--production|ALLOW_PROD/i)
    expect(read('scripts/load-test/lib.mts')).not.toMatch(/--force|--allow|ALLOW_PROD/i)
    const refused = script.indexOf('const refusal = productionRefusal(')
    const probed = script.indexOf('await targetNamesProduction()')
    const firstWrite = script.indexOf('makeSupabase(cfg)')
    expect(refused).toBeGreaterThan(-1)
    expect(probed).toBeGreaterThan(refused)
    expect(firstWrite).toBeGreaterThan(probed)
    // its test data never carries the assistant's name
    expect(script.toLowerCase()).not.toContain('clau' + 'de')
  })
})

describe('T-203 load test: arguments', () => {
  it('the address must be given; 25 requests unless told otherwise', () => {
    expect(parseArgs([])).toEqual({ error: expect.stringContaining('--url') })
    expect(parseArgs(['--url', 'http://localhost:3000/'])).toEqual({ url: 'http://localhost:3000', n: 25, keep: false })
    expect(parseArgs(['--url', 'http://localhost:3000', '--n', '250', '--keep'])).toEqual({ url: 'http://localhost:3000', n: 250, keep: true })
  })

  it('a bad count or an unknown argument stops the run', () => {
    for (const n of ['0', '-3', '2.5', 'many', '1001']) expect(parseArgs(['--url', 'http://localhost:3000', '--n', n]), n).toHaveProperty('error')
    expect(parseArgs(['--url', 'http://localhost:3000', '--force'])).toHaveProperty('error')
  })
})

describe('T-203 load test: how the requests are spread', () => {
  it('no business gets more than 15, the counts differ by one at most, and every request is placed once', () => {
    for (const n of [1, 2, 3, 4, 5, 14, 15, 16, 25, 30, 31, 100, 249, 250, 251, 1000]) {
      const plan = planRun(n)
      expect(plan.businesses, `n=${n}`).toBe(Math.ceil(n / PER_BUSINESS_CAP))
      expect(plan.requests.map((r) => r.index)).toEqual([...Array(n).keys()])
      const load = new Array<number>(plan.businesses).fill(0)
      for (const r of plan.requests) load[r.business]! += 1
      expect(Math.max(...load), `n=${n}`).toBeLessThanOrEqual(PER_BUSINESS_CAP)
      expect(Math.max(...load) - Math.min(...load), `n=${n}`).toBeLessThanOrEqual(1)
    }
  })

  it('25 requests: two businesses, 13 and 12; 250: seventeen businesses', () => {
    const plan = planRun(25)
    expect(plan.businesses).toBe(2)
    expect([0, 1].map((b) => plan.requests.filter((r) => r.business === b).length).sort()).toEqual([12, 13])
    expect(planRun(250).businesses).toBe(17)
  })

  it('about half text only, about half with photos, a few of them photo-measured', () => {
    expect(kindCounts(25)).toEqual({ text: 13, photos: 9, measured: 3 })
    expect(kindCounts(250)).toEqual({ text: 125, photos: 100, measured: 25 })
    expect(kindCounts(1)).toEqual({ text: 1, photos: 0, measured: 0 })
    expect(kindCounts(2)).toEqual({ text: 1, photos: 1, measured: 0 })
    for (const n of [4, 5, 10, 25, 99, 250]) {
      const c = kindCounts(n)
      expect(c.text + c.photos + c.measured).toBe(n)
      expect(c.measured, `n=${n}`).toBeGreaterThanOrEqual(1)
      expect(c.photos, `n=${n}`).toBeGreaterThanOrEqual(0)
      const plan = planRun(n)
      for (const kind of ['text', 'photos', 'measured'] as const) expect(plan.requests.filter((r) => r.kind === kind).length, `${kind} n=${n}`).toBe(c[kind])
    }
  })

  it('each business gets some of every kind when there is enough to go round, and the kinds are not bunched', () => {
    const plan = planRun(25)
    for (const b of [0, 1]) {
      const kinds = plan.requests.filter((r) => r.business === b).map((r) => r.kind)
      expect(kinds.filter((k) => k === 'text').length, `business ${b}`).toBeGreaterThanOrEqual(5)
      expect(kinds.filter((k) => k === 'photos').length, `business ${b}`).toBeGreaterThanOrEqual(3)
      expect(kinds.filter((k) => k === 'measured').length, `business ${b}`).toBeGreaterThanOrEqual(1)
    }
    // not "all the text first": both halves of the run hold photo requests
    const first = plan.requests.slice(0, 12).filter((r) => r.kind !== 'text').length
    const second = plan.requests.slice(12).filter((r) => r.kind !== 'text').length
    expect(first).toBeGreaterThanOrEqual(4)
    expect(second).toBeGreaterThanOrEqual(4)
  })
})

describe('T-203 load test: the report', () => {
  it('percentiles are nearest-rank', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([7], 95)).toBe(7)
    expect(percentile([4, 1, 3, 2], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(hundred, 95)).toBe(95)
    expect(percentile(hundred, 100)).toBe(100)
    expect(percentile(hundred, 0)).toBe(1)
    expect(percentile(Array.from({ length: 25 }, (_, i) => (i + 1) * 10), 95)).toBe(240)
    expect(spread([30, 10, 20])).toEqual({ count: 3, median: 20, p95: 30, slowest: 30 })
    expect(spread([])).toEqual({ count: 0, median: null, p95: null, slowest: null })
  })

  it('a status carries a price only with a total; queued and generating are still waiting', () => {
    for (const status of ['sent', 'viewed', 'accepted', 'pending_review', 'awaiting_clarification']) expect(outcomeOf(status, 120.5), status).toBe('priced')
    expect(outcomeOf('sent', null)).toBe('failed')
    expect(outcomeOf('failed', 120.5)).toBe('failed')
    expect(outcomeOf('queued', null)).toBe('waiting')
    expect(outcomeOf('generating', null)).toBe('waiting')
    expect(outcomeOf(null, null)).toBe('not_sent')
  })

  const result = (over: Partial<RequestResult>): RequestResult => ({
    index: 0, kind: 'text', business: 0, quoteId: 'qte_x', httpStatus: 200, postMs: 300, status: 'sent', total: 100, sendToDoneMs: 10_000,
    totalMs: 8_000, queueWaitMs: 500, busyRetries: 0, overflowCalls: 0, busyRequeues: 0, aiCalls: 3, aiCostUsd: 0.01, unpricedModels: [], byTask: { wording: 3 },
    ...over,
  })

  it('sums what was priced, what failed, what waited and what was never taken in', () => {
    const report = summarise([
      result({ index: 0, sendToDoneMs: 10_000 }),
      result({ index: 1, kind: 'photos', sendToDoneMs: 30_000, busyRetries: 2, aiCostUsd: 0.02, byTask: { wording: 3, extraction_pass: 1 } }),
      result({ index: 2, kind: 'measured', status: 'awaiting_clarification', sendToDoneMs: 90_000, overflowCalls: 1, busyRequeues: 1, queueWaitMs: 61_000, unpricedModels: ['some-model'] }),
      result({ index: 3, status: 'failed', total: null, sendToDoneMs: 200_000, busyRetries: 3, aiCostUsd: 0 }),
      result({ index: 4, status: 'generating', total: null, sendToDoneMs: null, totalMs: null, queueWaitMs: null, aiCostUsd: 0, aiCalls: 0, byTask: {} }),
      result({ index: 5, quoteId: null, httpStatus: 429, refusedCode: 'RATE_LIMITED', status: null, total: null, sendToDoneMs: null, totalMs: null, queueWaitMs: null, aiCostUsd: 0, aiCalls: 0, byTask: {} }),
    ])
    expect(report).toMatchObject({ sent: 6, accepted: 5, priced: 3, failed: 1, waitingAtCap: 1, notSent: 1, refusals: { RATE_LIMITED: 1 } })
    expect(report.statuses).toEqual({ sent: 2, awaiting_clarification: 1, failed: 1, generating: 1 })
    // the failed request's time is not in "send to priced"
    expect(report.sendToPricedMs).toEqual({ count: 3, median: 30_000, p95: 90_000, slowest: 90_000 })
    expect(report.queueWaitMs).toMatchObject({ count: 4, slowest: 61_000 })
    expect(report.busyRetries).toEqual({ total: 5, quotes: 2 })
    expect(report.overflowCalls).toEqual({ total: 1, quotes: 1 })
    expect(report.busyRequeues).toEqual({ total: 1, quotes: 1 })
    expect(report.aiCostUsd).toEqual({ total: 0.04, perPricedQuote: 0.013333 })
    expect(report.unpricedModels).toEqual(['some-model'])
    expect(report.byKind.photos).toMatchObject({ sent: 1, priced: 1, aiCallsByTask: { wording: 3, extraction_pass: 1 } })
    expect(report.byKind.text).toMatchObject({ sent: 4, priced: 1, failed: 1, waiting: 1, notSent: 1 })
  })

  it('the printed report says every figure asked for, and says so when there was no queue', () => {
    const report = summarise([result({ queueWaitMs: null }), result({ index: 1, kind: 'photos', queueWaitMs: null })])
    const text = reportText(report, { target: 'http://localhost:3000', businesses: 1, pricedDirectly: true, capMinutes: 20 })
    for (const label of ['Priced:', 'Failed:', 'Still waiting:', 'Send to priced:', 'Queue wait:', 'Busy retries:', 'Overflow calls:', 'Put back as busy:', 'AI cost:', 'By kind:', 'text only', 'with photos']) expect(text, label).toContain(label)
    expect(text).toContain('2 of 2')
    expect(text).toContain('median 10.0 s, 95th 10.0 s, slowest 10.0 s')
    expect(text).toContain('priced each request directly, with no queue')
    expect(text).toContain('$0.0200 in all, $0.0100 a priced quote')
    const queued = reportText(summarise([result({})]), { target: 'x', businesses: 1, pricedDirectly: false, capMinutes: 20 })
    expect(queued).toContain('Queue wait:        median 0.5 s')
  })

  it('the results folder is kept out of the repository and out of deploys', () => {
    expect(read('.gitignore')).toContain('scripts/load-test/results/')
    expect(read('.vercelignore')).toContain('scripts/load-test/results/')
  })
})
