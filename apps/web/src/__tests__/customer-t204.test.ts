/**
 * T-204, the customer's side (items 6, 9, 10 and 28):
 *
 *    6  a ZIP or postcode the business does not cover: straight back to that field, everything else kept
 *    9  the page's header says "Quote prepared for" once the business has approved it
 *   10  "Download PDF" on the customer's page once the quote is final, made on demand, never while held
 *   28  the quote page and the form keep checking for 16 minutes, less often after the first few
 *
 * (Item 8, the plain clarifying question, is the worker's: apps/worker/src/__tests__/customer-t204.test.ts.)
 * No server is started and no PDF service or storage is called: the route is run with stand-ins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  OUTSIDE_SERVICE_AREA_CODE,
  QUOTE_LINK_STATUSES,
  SLOW_PREPARING_MS,
  WAITING_POLL,
  canDownloadQuotePdf,
  customerCanDownloadPdf,
  nextWaitingPollMs,
  outsideAreaChatLine,
  outsideAreaLine,
  preparedForLine,
  slowPreparingLine,
  startWaitingPoll,
  waitingPollCount,
  type WaitingPollClock,
} from '@qolumns/shared'
import { RATE_LIMITS } from '@/lib/rate-limit-config'
import { PDF_FAILED_LINE, customerPdfPath } from '@/lib/customer-pdf'

const read = (path: string) => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')

// ---------------------------------------------------------------------------
describe('T-204 item 6: a ZIP or postcode the business does not cover', () => {
  it('the line names the business and the place, says what to do, and never says to start again', () => {
    const us = outsideAreaLine({ businessName: 'Harlow Heating', postalCodeLabel: 'ZIP code', postcode: '90210' })
    expect(us).toBe('Harlow Heating doesn’t cover 90210. If the ZIP code isn’t right, change it and send again. Everything else you entered is still here.')
    const gb = outsideAreaLine({ businessName: 'Harlow Heating', postalCodeLabel: 'Postcode', postcode: ' SW1A 1AA ' })
    expect(gb).toBe('Harlow Heating doesn’t cover SW1A 1AA. If the postcode isn’t right, change it and send again. Everything else you entered is still here.')
    for (const line of [us, gb, outsideAreaChatLine({ businessName: 'Harlow Heating', postalCodeLabel: 'ZIP code' })]) expect(line).not.toMatch(/start (over|again)/i)
  })

  it('…and still reads as a sentence when a name, a label or the place is missing', () => {
    expect(outsideAreaLine({})).toBe('This business doesn’t cover that postcode. If the postcode isn’t right, change it and send again. Everything else you entered is still here.')
    expect(outsideAreaChatLine({ businessName: '', postalCodeLabel: 'ZIP code' })).toBe('Sorry, This business doesn’t cover that ZIP code. If it isn’t right, tell me the correct one and I’ll send your request again. Everything else you told me is kept.')
  })

  it('the server’s answer is unchanged, and the form knows it by its code', () => {
    expect(OUTSIDE_SERVICE_AREA_CODE).toBe('OUTSIDE_SERVICE_AREA')
    expect(read('apps/web/src/lib/quote-intake.ts')).toContain("{ error: { code: 'OUTSIDE_SERVICE_AREA', message: 'Location is outside service area' } }")
  })

  it('the form goes back to the last step with the reason, before the error screen is ever reached', () => {
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    const refused = widget.indexOf('if (data.error?.code === OUTSIDE_SERVICE_AREA_CODE) {')
    const errorScreen = widget.indexOf("setStep('error')", refused)
    expect(refused).toBeGreaterThan(0)
    const branch = widget.slice(refused, errorScreen)
    expect(branch).toContain('setPostcodeError(outsideAreaLine(')
    expect(branch).toContain("setStep('job')")
    expect(branch).toContain('return')
    // nothing typed is cleared on the way back: no setter of an answer, a photo or a contact detail
    expect(branch).not.toMatch(/setFieldAnswers|setUploadedFiles|setCustomer(Name|Email|Phone)|setJobDescription|setJobPostcode\(|loadWidgetConfig/)
    // typing in the field takes the message away; sending again clears it first
    expect(widget).toContain('postcodeError={postcodeError}')
    expect(widget).toMatch(/setJobPostcode\(value\)\s*\n\s*setPostcodeError\(null\)/)
    // "Start Over" is still the error screen's last resort, and only there
    expect(widget.match(/Start Over/g)).toHaveLength(1)
    expect(widget.indexOf('Start Over')).toBeGreaterThan(widget.indexOf('function ErrorState('))
  })

  it('the chat form keeps the conversation and asks for the right one', () => {
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toContain('} else if (quoteData.error?.code === OUTSIDE_SERVICE_AREA_CODE) {')
    expect(widget).toContain('text: outsideAreaChatLine(')
  })

  it('the field shows the reason under it, as an alert tied to the field, and takes the focus', () => {
    const step = read('apps/web/src/components/embed/steps/JobDetailsStep.tsx')
    expect(step).toContain('role="alert"')
    expect(step).toContain('data-testid="outside-area"')
    expect(step).toContain("aria-describedby={postcodeError ? 'job-postcode-error' : undefined}")
    expect(step).toContain('postcodeField.current?.focus()')
    // an error edge is the full danger colour, in place of the field's own (design system: never both)
    expect(step).toContain("input.replace('border-field', 'border-danger')")
  })
})

// ---------------------------------------------------------------------------
describe('T-204 item 9: "Quote prepared for" once the business has approved it', () => {
  it('a quote after approval, an estimate before it and on one nobody reviewed', () => {
    expect(preparedForLine(true, 'Dana Pryce')).toBe('Quote prepared for Dana Pryce')
    expect(preparedForLine(false, 'Dana Pryce')).toBe('Estimate prepared for Dana Pryce')
  })

  it('the customer’s page words its header from the same fact as "Your quote" / "Your estimate"', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain("const isReviewedQuote = review?.state === 'quote'")
    expect(page).toContain('reviewed={isReviewedQuote}')
    expect(page).toContain('{preparedForLine(reviewed === true, customerName)}')
    expect(page).not.toContain('Estimate prepared for {customerName}')
    // the two screens with no document yet (being prepared; a detail to confirm) stay an estimate
    expect(page.match(/reviewed=\{/g)).toHaveLength(1)
  })

  it('the sample sheet on the site follows the same rule; the PDF says "Prepared for" and needed no change', () => {
    expect(read('apps/web/src/components/quote/EstimateSheet.tsx')).toContain('{preparedForLine(confirmed === true, data.customerName)}')
    const pdf = read('apps/web/src/lib/pdf-template.ts')
    expect(pdf).toContain('Prepared for')
    expect(pdf).not.toContain('Estimate prepared for')
  })
})

// ---------------------------------------------------------------------------
describe('T-204 item 10: who may download the PDF, and when', () => {
  it('once the quote has gone to the customer as final: the same statuses as the business’s own button', () => {
    for (const status of QUOTE_LINK_STATUSES) expect(customerCanDownloadPdf(status), status).toBe(true)
    for (const status of ['sent', 'viewed', 'feedback_received', 'revised', 'accepted', 'paid', 'expired']) expect(customerCanDownloadPdf(status)).toBe(canDownloadQuotePdf(status))
  })

  it('never while it waits for the business (shown early or not), while a detail is confirmed, or with no document', () => {
    for (const status of ['pending_review', 'awaiting_clarification', 'queued', 'generating', 'failed', 'declined', 'draft', '', null, undefined]) expect(customerCanDownloadPdf(status), String(status)).toBe(false)
  })

  it('the page’s answer offers it when the rule allows and a PDF exists or can be made; never from a stored PDF alone', () => {
    const view = read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    expect(view).toContain('customerCanDownloadPdf(quote.status) && awaitingParts.length === 0 && (quote.pdf_asset_id || quotePdfCanBeMade())')
    expect(view).toContain('if (isProvisional) delete actions.pdfUrl')
    expect(view).not.toContain('if (quote.pdf_asset_id && awaitingParts.length === 0) {')
  })

  it('the button is on the finished document only, asks the page’s own address, and says what happened', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('pdf={actions.pdfUrl && token ? { quoteId, token } : null}')
    expect(page.match(/pdf=\{/g)).toHaveLength(1)
    expect(customerPdfPath('qte_1', 'tok/en+1')).toBe('/api/public/quotes/qte_1/pdf?token=tok%2Fen%2B1')
    const button = read('apps/web/src/components/quote/PdfDownloadButton.tsx')
    expect(button).toContain("'Preparing PDF…' : 'Download PDF'")
    expect(button).toContain('fetch(`${href}&format=json`)')
    expect(button).toContain('min-h-[44px]')
    expect(button).toContain('role="alert"')
    expect(PDF_FAILED_LINE).toBe('The PDF could not be made just now. Please try again in a minute.')
  })

  it('an edit saved in the dashboard clears the PDF made before it, as adding or removing a service already did', () => {
    const edit = read('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    const payload = edit.slice(edit.indexOf('const updatePayload: Record<string, unknown> = {'), edit.indexOf('if (body.business_notes !== undefined)'))
    expect(payload).toContain('pdf_asset_id: null,')
    expect(read('apps/web/src/lib/quote-sections-service.ts').match(/pdf_asset_id: null/g)).toHaveLength(2)
  })

  it('the PDF is made in one place, and recorded only on the version it was made from', () => {
    const maker = read('apps/web/src/lib/quote-pdf.ts')
    expect(maker).toContain('export async function makeQuotePdf(')
    expect(maker).toContain("if (typeof quote.version === 'number') record = record.eq('version', quote.version)")
    expect(read('apps/web/src/app/api/quotes/[quoteId]/pdf/route.ts')).not.toContain('generatePdf(')
    expect(read('apps/web/src/app/api/public/quotes/[quoteId]/pdf/route.ts')).not.toContain('generatePdf(')
  })

  it('the customer’s PDF address reads the quote fresh on every call: a quote approved a moment ago is not still "held"', () => {
    // A built web app reuses a GET route's database read unless told not to (T-183). The first run of
    // verify-t204 met it: 404 for an approved quote, because the read from while it was held was reused.
    const route = read('apps/web/src/app/api/public/quotes/[quoteId]/pdf/route.ts')
    expect(route).toContain("import { unstable_noStore as noStore } from 'next/cache'")
    const handler = route.slice(route.indexOf('export async function GET('))
    expect(handler.indexOf('noStore()')).toBeGreaterThan(0)
    expect(handler.indexOf('noStore()')).toBeLessThan(handler.indexOf('createAdminClient()'))
    expect(handler.indexOf('new URL(request.url)')).toBeLessThan(handler.indexOf('createAdminClient()'))
    expect(route).not.toContain("export const dynamic = 'force-dynamic'")
  })

  it('making one is limited for the quote, and the address for every download', () => {
    expect(RATE_LIMITS.quote_pdf.map((w) => [w.seconds, w.perIp, w.perKey])).toEqual([[60, 10, 3], [3600, 60, 10]])
  })
})

// --- the customer's PDF address, run with stand-ins ---------------------------------------------
const state = vi.hoisted(() => ({
  quote: null as Record<string, unknown> | null,
  asset: null as Record<string, unknown> | null,
  limits: [] as Array<{ scope: string; ids: Record<string, string> }>,
  refuse: null as null | 'ip' | 'key',
  made: null as null | Record<string, unknown>,
  makeCalls: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        single: async () => (table === 'quotes' ? { data: state.quote, error: state.quote ? null : { message: 'none' } } : { data: state.asset, error: null }),
      }
      return builder
    },
  }),
}))
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  generateDownloadUrl: async (key: string, _seconds: number, downloadAs?: string) => `https://files.test/${key}?as=${downloadAs ?? ''}`,
}))
vi.mock('@/lib/rate-limit', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getClientIp: () => '203.0.113.9',
  checkRateLimit: async (scope: string, ids: Record<string, string>) => {
    state.limits.push({ scope, ids })
    const refused = (state.refuse === 'ip' && 'ip' in ids) || (state.refuse === 'key' && 'key' in ids)
    return refused ? { allowed: false, retryAfterSeconds: 40, limitType: 'key' } : { allowed: true, retryAfterSeconds: 0 }
  },
}))
vi.mock('@/lib/quote-pdf', () => ({
  quotePdfFileName: (quoteId: string) => `Quote-${quoteId}.pdf`,
  quotePdfCanBeMade: () => true,
  makeQuotePdf: async () => {
    state.makeCalls += 1
    return state.made
  },
}))

describe('T-204 item 10: the customer’s PDF address', () => {
  const sent = { id: 'qte_1', tenant_id: 'tnt_1', status: 'sent', pricing_json: { total: 480 }, content_json: {}, review_hold: null, token_expires_at: null, pdf_asset_id: null }
  const call = async (query = '?token=abc') => {
    const { GET } = await import('@/app/api/public/quotes/[quoteId]/pdf/route')
    return GET(new Request(`https://app.test/api/public/quotes/qte_1/pdf${query}`), { params: { quoteId: 'qte_1' } })
  }

  beforeEach(() => {
    Object.assign(state, { quote: { ...sent }, asset: null, limits: [], refuse: null, made: { ok: true, pdf: Buffer.from('x'), fileName: 'Quote-qte_1.pdf', assetId: 'ast_new', r2Key: 'tnt_1/pdfs/qte_1-1.pdf' }, makeCalls: 0 })
  })

  it('a final quote with no PDF yet: one is made, and the customer is sent to the file, saved under its name', async () => {
    const response = await call()
    expect(state.makeCalls).toBe(1)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://files.test/tnt_1/pdfs/qte_1-1.pdf?as=Quote-qte_1.pdf')
  })

  it('…or, for the page’s button, told where it is', async () => {
    const response = await call('?token=abc&format=json')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ downloadUrl: 'https://files.test/tnt_1/pdfs/qte_1-1.pdf?as=Quote-qte_1.pdf', fileName: 'Quote-qte_1.pdf' })
  })

  it('a PDF already made for this price is handed over as it is: nothing is made, and making is not counted', async () => {
    state.quote = { ...sent, pdf_asset_id: 'ast_old' }
    state.asset = { r2_key: 'tnt_1/pdfs/qte_1-0.pdf' }
    const response = await call()
    expect(state.makeCalls).toBe(0)
    expect(response.headers.get('location')).toContain('tnt_1/pdfs/qte_1-0.pdf')
    expect(state.limits).toEqual([{ scope: 'quote_pdf', ids: { ip: '203.0.113.9' } }])
  })

  it('held for the business, shown early, or a detail still to confirm: refused, and nothing is made', async () => {
    for (const quote of [
      { ...sent, status: 'pending_review', review_hold: 'held' },
      { ...sent, status: 'pending_review', review_hold: 'shown', pdf_asset_id: 'ast_old' },
      { ...sent, status: 'awaiting_clarification' },
      { ...sent, status: 'generating' },
    ]) {
      state.quote = quote
      const response = await call('?token=abc&format=json')
      expect(response.status, quote.status + String(quote.review_hold)).toBe(404)
      expect((await response.json()).error.code).toBe('PDF_NOT_FOUND')
    }
    expect(state.makeCalls).toBe(0)
  })

  it('no token, or a quote the token does not open: refused before anything is made', async () => {
    expect((await call('')).status).toBe(401)
    state.quote = null
    expect((await call()).status).toBe(404)
    expect(state.makeCalls).toBe(0)
  })

  it('the address is counted first; making is counted for the quote, after the token, and a refusal makes nothing', async () => {
    await call()
    expect(state.limits).toEqual([{ scope: 'quote_pdf', ids: { ip: '203.0.113.9' } }, { scope: 'quote_pdf', ids: { key: 'qte_1' } }])
    state.limits = []
    state.makeCalls = 0
    state.refuse = 'key'
    const refused = await call('?token=abc&format=json')
    expect(refused.status).toBe(429)
    expect(state.makeCalls).toBe(0)
    state.refuse = 'ip'
    state.quote = null
    expect((await call()).status).toBe(429)
  })

  it('when the PDF cannot be made the customer reads one plain line, never the PDF service’s own words', async () => {
    state.made = { ok: false, status: 500, code: 'PDF_GENERATION_FAILED', message: 'DocRaptor API error: 422 - {"errors":"Authentication failed"}' }
    const response = await call('?token=abc&format=json')
    expect(response.status).toBe(503)
    const body = JSON.stringify(await response.json())
    expect(body).toContain(PDF_FAILED_LINE)
    expect(body).not.toMatch(/DocRaptor|Authentication/)
  })
})

// ---------------------------------------------------------------------------
describe('T-204 item 28: the pages keep checking for 16 minutes, less often after the first few', () => {
  it('the schedule: every 3 seconds for 3 minutes, then every 12, ending on the 16th minute', () => {
    expect(WAITING_POLL).toEqual({ quickEveryMs: 3_000, quickForMs: 180_000, slowEveryMs: 12_000, totalMs: 960_000 })
    expect(nextWaitingPollMs(0)).toBe(3_000)
    expect(nextWaitingPollMs(179_999)).toBe(3_000)
    expect(nextWaitingPollMs(180_000)).toBe(12_000)
    expect(nextWaitingPollMs(600_000)).toBe(12_000)
    // the last check lands on the end, not after it
    expect(nextWaitingPollMs(955_000)).toBe(5_000)
    expect(nextWaitingPollMs(960_000)).toBeNull()
    expect(nextWaitingPollMs(2_000_000)).toBeNull()
    expect(nextWaitingPollMs(-5)).toBe(3_000)
  })

  it('it outlasts the longest a put-back request can take (15 minutes, T-203), with fewer checks than 16 minutes at the old pace', () => {
    const consumer = read('apps/worker/src/queue-consumer.ts')
    const busyMinutes = Number(/export const BUSY_MAX_MINUTES = (\d+)/.exec(consumer)?.[1])
    expect(busyMinutes).toBe(15)
    expect(WAITING_POLL.totalMs).toBeGreaterThan(busyMinutes * 60_000)
    // 60 quick checks, then 65 slow ones
    expect(waitingPollCount()).toBe(125)
    expect(waitingPollCount()).toBeLessThan(WAITING_POLL.totalMs / 3_000)
  })

  /** A clock the test moves by hand */
  function fakeClock() {
    let now = 0
    let pending: { run: () => void; at: number } | null = null
    const clock: WaitingPollClock = {
      now: () => now,
      setTimeout: (run, ms) => {
        pending = { run, at: now + ms }
        return pending
      },
      clearTimeout: (timer) => {
        if (pending === timer) pending = null
      },
    }
    /** run timers until none is left or `limit` have fired; each check is given a turn to finish */
    const drain = async (limit = 1_000) => {
      let fired = 0
      while (pending && fired < limit) {
        const next: { run: () => void; at: number } = pending
        pending = null
        now = next.at
        next.run()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        fired += 1
      }
      return fired
    }
    return { clock, drain, time: () => now, waiting: () => pending !== null }
  }

  it('it checks until the answer is in, then stops', async () => {
    const { clock, drain, time } = fakeClock()
    let checks = 0
    let gaveUp = false
    startWaitingPoll(async () => (checks += 1) === 5, () => (gaveUp = true), clock)
    expect(await drain()).toBe(5)
    expect([checks, time(), gaveUp]).toEqual([5, 15_000, false])
  })

  it('with no answer it gives up once, at 16 minutes, having checked 125 times', async () => {
    const { clock, drain, time, waiting } = fakeClock()
    let checks = 0
    let gaveUp = 0
    startWaitingPoll(async () => {
      checks += 1
      return false
    }, () => (gaveUp += 1), clock)
    await drain()
    expect([checks, time(), gaveUp, waiting()]).toEqual([125, 960_000, 1, false])
  })

  it('a check that fails is one missed check, not the end; and leaving the page stops it at once', async () => {
    const { clock, drain, waiting } = fakeClock()
    let checks = 0
    let gaveUp = false
    const stop = startWaitingPoll(async () => {
      checks += 1
      if (checks === 2) throw new Error('offline for a moment')
      return false
    }, () => (gaveUp = true), clock)
    await drain(4)
    expect(checks).toBe(4)
    stop()
    expect(waiting()).toBe(false)
    expect(await drain()).toBe(0)
    expect([checks, gaveUp]).toEqual([4, false])
  })

  it('both pages follow it, and neither keeps a pace of its own', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    for (const [name, source] of [['quote page', page], ['form', widget]] as const) {
      expect(source, name).toContain('startWaitingPoll(')
      expect(source, name).not.toMatch(/maxPolls/)
      expect(source, name).not.toMatch(/\}, [34]000\)/)
    }
    expect(page).toContain('if (!cancelled) setStoppedChecking(true)')
    expect(widget).toContain('if (!cancelled) setTimedOut(true)')
  })

  it('what the customer reads while waiting is as it was: the slow line after a minute, and the email', () => {
    expect(SLOW_PREPARING_MS).toBe(60_000)
    expect(slowPreparingLine(true)).toBe('This is taking longer than usual. We’ll email you as soon as it’s ready.')
    expect(slowPreparingLine(false)).toBe('This is taking longer than usual. Keep this page open, or come back to it: your estimate will appear here.')
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('slowPreparingLine(customer.hasEmail !== false)')
    expect(page).toContain('This usually takes a minute or two — this page updates by itself.')
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toContain('This usually takes a minute or two. Keep this open — or we’ll email you the link when it’s ready.')
    expect(widget).toContain('slowPreparingLine(hasEmail)')
  })
})
