// T-201, the quote link and estimates (items 11, 15 to 20, 27, 28), against the real servers.
//
// What it proves:
//   11  the business opening its own quote link (from the dashboard, or signed in) does not tick "Share
//       your quote link"; a customer's visit does
//   15  the Quote link page has no "Preview on a demo page"; the developer page itself still opens
//   17  an estimate sent automatically promises no review; one shown before approval does
//   18  "Hold until I approve": no price, no low or high figure, no note with a figure and no PDF, in the
//       public quote API's answer, until the business approves. The same while a detail is being confirmed.
//   19  "Try again" on a request that could not be priced prices it again and the plan's count does not move
//   20  what the pricing trace shows as "What Qolumns understood" is made of lines, from the stored record
//   27  the business's terms are in the customer's answer when filled in, and gone when emptied
//   28  (the "PDF only" tags are unit tests: the Settings pages are drawn in the browser)
//
// No browser, no model, no email.
import { customerEstimateNote } from '../../../packages/shared/src/quote-turn'
import { understoodTrace } from '../../../apps/web/src/lib/trace-understood'
import type { Harness, Row } from './harness.mts'

type View = {
  status: string
  pricing: { total: number; breakdown: unknown[]; notes?: string[] }
  breakdown: unknown[]
  provisional?: { rangeLow: number; rangeHigh: number }
  estimateRange?: { low: number; high: number }
  review: { state: string; confirmationPending?: boolean }
  notes: { scopeSummary?: string; assumptions?: string[]; exclusions?: string[]; notes?: string }
  actions: { pdfUrl?: string }
  acceptQuoteEnabled?: boolean
  terms?: string
}

const TOTAL = 867 // 40 sq ft at 18, and 20 ft at 7.35
const LOW = 811.11
const HIGH = 933.33
const TERMS = 'Payment is due on completion.\nA 20% deposit books the job.'

export async function run(h: Harness): Promise<void> {
  const biz = await h.business('estimates')
  const key = await h.siteKey(biz)
  const tenant = async () => (await h.rows('tenants', `id=eq.${biz.tenantId}&select=slug,quote_link_first_visit_at,quote_link_copied_at`))[0] ?? {}
  const view = async (q: { id: string; token: string }) => h.expectOk('customer view', await h.http('GET', `${h.app}/api/public/quotes/${q.id}?token=${q.token}&poll=1`)) as View
  const quoteRow = async (id: string) => (await h.rows('quotes', `id=eq.${id}&select=*`))[0] ?? {}
  const setMode = (serviceId: string, mode: 'show' | 'hold' | 'auto') =>
    h.patch('services', `id=eq.${serviceId}`, { auto_send: mode === 'auto', hold_until_approved: mode === 'hold' })
  const priced = (row: Row) => ((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && ['pending_review', 'sent', 'viewed'].includes(String(row.status))

  // -------------------------------------------------------------------------
  h.section('Item 11. Opening your own quote link does not tick "Share your quote link"')
  const slug = String((await tenant()).slug)
  const link = `${h.app}/quote/${slug}`
  h.check('the step starts unticked', !(await tenant()).quote_link_first_visit_at && !(await tenant()).quote_link_copied_at, await tenant())
  const own = await h.http('GET', `${link}?own=1`)
  h.check('opened from the dashboard’s "Open" button (the link with its mark): the page opens, the step stays unticked', own.status === 200 && !(await tenant()).quote_link_first_visit_at, { status: own.status, row: await tenant() })
  const signedIn = await h.http('GET', link, { headers: biz.cookie })
  h.check('opened by the business while signed in: the step stays unticked', signedIn.status === 200 && !(await tenant()).quote_link_first_visit_at, { status: signedIn.status, row: await tenant() })
  const customer = await h.http('GET', link)
  h.check('opened by a customer: the step is ticked', customer.status === 200 && Boolean((await tenant()).quote_link_first_visit_at), { status: customer.status, row: await tenant() })

  // -------------------------------------------------------------------------
  h.section('Items 15 and 16. The Quote link page')
  const sharePage = await h.http('GET', `${h.app}/app/quote-link`, { headers: biz.cookie })
  h.check('the Quote link page opens with its website code card', sharePage.status === 200 && /Add it to your website/.test(sharePage.text), sharePage.status)
  h.check('…with no "Preview on a demo page" and no link to the developer page', !/Preview on a demo page/.test(sharePage.text) && !/href="\/demo\?tenantKey=/.test(sharePage.text))
  h.check('…and no "Pricing Rules" anywhere on it', !/Pricing Rules/.test(sharePage.text))
  const developer = await h.http('GET', `${h.app}/demo?tenantKey=${encodeURIComponent(key)}`)
  h.check('the developer page itself still opens for whoever has its address', developer.status === 200, developer.status)

  // -------------------------------------------------------------------------
  h.section('Item 17. Only an estimate that waits for approval says the business will review it')
  const serviceId = await h.paintService(biz)
  const shown = await h.submit(key, serviceId, 'Dev Raman')
  const shownRow = await h.waitForQuote(shown.id, priced)
  const shownView = await view(shown)
  h.check('"Show the estimate, then I confirm it": the customer sees the price, waiting for the business', shownRow.status === 'pending_review' && shownRow.review_hold === 'shown' && shownView.pricing.total === TOTAL && shownView.review.confirmationPending === true, { status: shownRow.status, hold: shownRow.review_hold, total: shownView.pricing.total, review: shownView.review })
  const noteOf = (v: View) => customerEstimateNote({ reviewed: v.review.state === 'quote', confirmationPending: v.review.confirmationPending === true, businessName: biz.name })
  h.check('…and its page says the business will review and confirm it', noteOf(shownView) === `This is an estimate based on your photos and details. ${biz.name} will review and confirm it.`, noteOf(shownView))

  h.expectOk('auto mode', await setMode(serviceId, 'auto'))
  const auto = await h.submit(key, serviceId, 'Nia Okoro')
  const autoRow = await h.waitForQuote(auto.id, priced)
  const autoView = await view(auto)
  h.check('"Send automatically": the estimate goes straight out, with nothing waiting on the business', autoRow.status === 'sent' && autoView.pricing.total === TOTAL && autoView.review.state === 'estimate' && autoView.review.confirmationPending !== true, { status: autoRow.status, review: autoView.review })
  h.check('…and its page promises no review: an estimate, and that is all', noteOf(autoView) === 'This is an estimate based on your photos and details.' && !/review|confirm/i.test(noteOf(autoView)), noteOf(autoView))

  // -------------------------------------------------------------------------
  h.section('Item 27. The business’s terms are printed for the customer, when filled in')
  h.check('with no terms set, the customer’s answer carries none', autoView.terms === undefined, autoView.terms)
  h.expectOk('save terms', await h.http('PUT', `${h.app}/api/tenant`, { headers: biz.cookie, body: { defaultTermsText: `  ${TERMS}  ` } }))
  const withTerms = await view(auto)
  h.check('once filled in on Settings, an estimate’s answer carries them, word for word', withTerms.terms === TERMS, withTerms.terms)
  h.check('…an estimate shown before approval carries them too', (await view(shown)).terms === TERMS)

  // -------------------------------------------------------------------------
  h.section('Item 18. "Hold until I approve": no price and no low or high figure until the business approves')
  h.expectOk('hold mode', await setMode(serviceId, 'hold'))
  const held = await h.submit(key, serviceId, 'Tomas Reyes')
  const heldRow = await h.waitForQuote(held.id, priced)
  h.check('the request is priced and held for the business', heldRow.status === 'pending_review' && heldRow.review_hold === 'held' && (heldRow.pricing_json as { total: number }).total === TOTAL, { status: heldRow.status, hold: heldRow.review_hold })
  // a quantity that was not certain: the engine's own low and high, and a note and a sentence that name a figure
  const asset = await h.sb.insert('assets', { tenant_id: biz.tenantId, type: 'document', file_name: 'estimate.pdf', content_type: 'application/pdf', size_bytes: 10, r2_key: `local/t201-${h.shortId()}.pdf` })
  h.expectOk('uncertain quantity', await h.patch('quotes', `id=eq.${held.id}`, {
    pricing_json: { ...(heldRow.pricing_json as Row), notes: ['Travel is charged at $57.77'], estimate: { grade: 'B', label: 'Measured', description: 'One quantity was measured from the photos', rangeLow: LOW, rangeHigh: HIGH } },
    content_json: { ...(heldRow.content_json as Row), scopeSummary: `Two coats on the outside walls, about $${TOTAL} in all.`, notes: `We have allowed $${TOTAL} for this.` },
    pdf_asset_id: asset.id,
  }))
  const figures = [String(TOTAL), '811', '933', '57.77']
  const leaks = (v: View) => {
    const text = JSON.stringify(v).split(held.id).join('').split(held.token).join('')
    return figures.filter((figure) => text.includes(figure))
  }
  const heldView = await view(held)
  h.check('the customer’s answer has no price, no lines and no range of any kind', heldView.status === 'pending_review' && heldView.pricing.total === 0 && heldView.pricing.breakdown.length === 0 && heldView.breakdown.length === 0 && heldView.provisional === undefined && heldView.estimateRange === undefined, { total: heldView.pricing.total, provisional: heldView.provisional, estimateRange: heldView.estimateRange })
  h.check('…no note or sentence that names a figure, no PDF link, and no Accept', (heldView.pricing.notes ?? []).length === 0 && heldView.notes.scopeSummary === undefined && heldView.notes.notes === undefined && heldView.actions.pdfUrl === undefined && heldView.acceptQuoteEnabled === false && heldView.review.confirmationPending !== true, { notes: heldView.pricing.notes, wording: heldView.notes, pdf: heldView.actions.pdfUrl })
  h.check('…not one of the quote’s figures is anywhere in the answer', leaks(heldView).length === 0, leaks(heldView))
  h.check('…and no terms: there is no document to print them under yet', heldView.terms === undefined, heldView.terms)
  const heldPdf = await h.http('GET', `${h.app}/api/public/quotes/${held.id}/pdf?token=${held.token}`)
  h.check('the PDF’s own address refuses too (a PDF carries every price)', heldPdf.status === 404 && heldPdf.json?.error?.code === 'PDF_NOT_FOUND', [heldPdf.status, heldPdf.json?.error?.code])

  // the same quote while the customer still has a detail to confirm
  h.expectOk('to confirm a detail', await h.patch('quotes', `id=eq.${held.id}`, { status: 'awaiting_clarification' }))
  const confirming = await view(held)
  h.check('while the customer confirms a detail, a holding service still shows no figure', confirming.status === 'awaiting_clarification' && confirming.provisional === undefined && confirming.pricing.total === 0 && leaks(confirming).length === 0, { provisional: confirming.provisional, leaks: leaks(confirming) })
  h.expectOk('show mode', await setMode(serviceId, 'show'))
  const confirmingShown = await view(held)
  h.check('…where a service that shows its estimates gives the range, as before', confirmingShown.provisional?.rangeLow === LOW && confirmingShown.provisional?.rangeHigh === HIGH && confirmingShown.pricing.total === 0, confirmingShown.provisional)
  h.expectOk('hold mode again', await setMode(serviceId, 'hold'))
  h.expectOk('held again', await h.patch('quotes', `id=eq.${held.id}`, { status: 'pending_review', review_hold: 'held' }))

  h.expectOk('approve', await h.http('POST', `${h.app}/api/quotes/${held.id}/approve`, { headers: biz.cookie }))
  const approved = await view(held)
  h.check('once the business approves, the customer sees the price, as a quote, with the terms under it', approved.pricing.total === TOTAL && approved.review.state === 'quote' && approved.provisional === undefined && approved.terms === TERMS, { total: approved.pricing.total, review: approved.review, terms: approved.terms })
  const approvedPdf = await fetch(`${h.app}/api/public/quotes/${held.id}/pdf?token=${held.token}`, { redirect: 'manual' })
  const approvedPdfCode = approvedPdf.status === 404 ? ((await approvedPdf.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code : null
  h.check('…and the PDF’s address no longer refuses for the price', approvedPdfCode !== 'PDF_NOT_FOUND', [approvedPdf.status, approvedPdfCode])

  h.expectOk('clear terms', await h.http('PUT', `${h.app}/api/tenant`, { headers: biz.cookie, body: { defaultTermsText: '' } }))
  h.check('emptied on Settings, the terms are gone from the customer’s answer', (await view(held)).terms === undefined)

  // -------------------------------------------------------------------------
  h.section('Item 19. "Try again" on a request that could not be priced')
  const used = async () => (await h.rows('usage_counters', `tenant_id=eq.${biz.tenantId}&select=estimates_created`)).reduce((sum, r) => sum + Number(r.estimates_created), 0)
  const usedBefore = await used()
  h.check('three requests have been counted on the plan so far', usedBefore === 3, usedBefore)
  const tryAgain = (id: string, cookie = biz.cookie) => h.http('POST', `${h.app}/api/quotes/${id}/process`, { headers: cookie, timeoutMs: 150_000 })
  const failedAt = new Date().toISOString()
  h.expectOk('mark failed', await h.patch('quotes', `id=eq.${auto.id}`, { status: 'failed', content_json: { error: 'The pricing worker stopped', failedAt, failedNotifiedAt: failedAt }, pricing_json: { ...(autoRow.pricing_json as Row), subtotal: 0, total: 0, breakdown: [] } }))
  const stranger = await h.business('estimates-other')
  const notYours = await tryAgain(auto.id, stranger.cookie)
  h.check('another business cannot try it', notYours.status === 404 && (await quoteRow(auto.id)).status === 'failed', notYours.status)
  const retried = await tryAgain(auto.id)
  h.check('the business presses "Try again": pricing starts', retried.status === 200 && retried.json?.queued === true && retried.json?.retried === true, [retried.status, retried.json])
  const again = await h.waitForQuote(auto.id, priced)
  h.check('…and the request is priced, from the same answers', (again.pricing_json as { total?: number } | null)?.total === TOTAL && ['pending_review', 'sent'].includes(String(again.status)), { status: again.status, total: (again.pricing_json as { total?: number } | null)?.total })
  h.check('…it is not counted a second time: the plan’s count has not moved', (await used()) === usedBefore, { before: usedBefore, after: await used() })
  h.check('…and it is still one quote for one request', (await h.rows('quotes', `quote_request_id=eq.${again.quote_request_id}&select=id`)).length === 1)

  h.expectOk('failed five times over', await h.patch('quotes', `id=eq.${auto.id}`, { status: 'failed', content_json: { error: 'The pricing worker stopped', failedAt, businessRetries: 5 } }))
  const sixth = await tryAgain(auto.id)
  h.check('after five tries it is refused, and nothing is started', sixth.status === 429 && sixth.json?.error?.code === 'RETRY_LIMIT' && (await quoteRow(auto.id)).status === 'failed' && (await used()) === usedBefore, [sixth.status, sixth.json?.error?.code])
  const notFailed = await tryAgain(shown.id)
  h.check('a request that has a price and is not held by the plan is left alone', notFailed.status === 400 && notFailed.json?.error?.code === 'NOT_HELD' && (await quoteRow(shown.id)).status === 'pending_review', [notFailed.status, notFailed.json?.error?.code])

  // -------------------------------------------------------------------------
  h.section('Item 20. The pricing trace: "What Qolumns understood", in lines')
  const detail = h.expectOk('quote detail', await h.http('GET', `${h.app}/api/quotes/${shown.id}`, { headers: biz.cookie })) as { quote: { signals_json?: unknown; service?: { expected_signals?: unknown } | null } }
  const trace = understoodTrace(detail.quote.signals_json, detail.quote.service?.expected_signals)
  const rawKeys = ((detail.quote.signals_json as { signals?: Array<{ key?: string }> } | null)?.signals ?? []).map((s) => String(s.key ?? '')).filter((k) => /[_A-Z]/.test(k))
  h.check('the record the pipeline stored for a real quote reads as lines: a name, a value, where it came from', trace.lines.every((line) => line.name.trim() !== '' && line.value.trim() !== '' && line.from.trim() !== '' && !/[{}[\]]/.test(`${line.name}${line.value}${line.from}`)), trace.lines.slice(0, 3))
  h.check('…and no line is named by a stored key', trace.lines.every((line) => !rawKeys.includes(line.name)), { rawKeys, names: trace.lines.map((l) => l.name) })
  const tracePage = await h.http('GET', `${h.app}/app/quotes/${shown.id}/trace`, { headers: biz.cookie })
  h.check('the trace page opens, and nothing on it is headed "Extracted Signals"', tracePage.status === 200 && !/Extracted Signals/.test(tracePage.text), tracePage.status)
}
