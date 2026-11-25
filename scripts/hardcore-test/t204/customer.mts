// T-204, the "customer" section of verify-t204: what a customer meets (items 6, 9, 10 and 28).
// Local stack only; no model is asked and no email is sent. Parts run in a browser (the form
// really being sent back to its ZIP field; the estimate page's header and its PDF button).
//
// What it proves
//   Item 6
//   A. the server still refuses a ZIP the business does not cover, before anything is saved
//   B. in a browser: the form comes straight back to the ZIP field with the reason under it and the
//      cursor in it; nothing typed is lost; "Start Over" is never offered; with the ZIP corrected
//      the same answers are sent
//   Items 9 and 10
//   C. an estimate a service sent by itself: "Estimate prepared for", and a PDF is offered although
//      the business never made one
//   D. held for the business: no PDF link, and the PDF's own address refuses; an estimate shown
//      before approval has none either, even when a PDF is stored on the quote
//   E. once approved: "Quote prepared for", the PDF is offered; asking for it makes it (or says in
//      one plain line that it could not be made: the PDF service is outside this machine)
//   F. an edit saved in the dashboard clears the PDF that was made before it
//   Item 28
//   G. a page waiting for a price is checking by itself (the schedule itself, 16 minutes with a
//      fake clock, is a unit test: apps/web/src/__tests__/customer-t204.test.ts)
//
// Item 8 (the plain clarifying question) is the worker's and is held by its unit tests: at this
// level no model writes a question.
import type { Harness, Row } from '../t201/harness.mts'
import { outsideAreaLine } from '../../../packages/shared/src/service-area'
import { preparedForLine } from '../../../packages/shared/src/quote-turn'
import { PDF_FAILED_LINE } from '../../../apps/web/src/lib/customer-pdf'

type Biz = Awaited<ReturnType<Harness['business']>>
interface View {
  status: string
  actions: { pdfUrl?: string }
  review: { state: string; confirmationPending?: boolean }
  pricing: { total: number }
}

export async function run(h: Harness): Promise<void> {
  const { app, http, expectOk, check, section, rows, patch } = h
  const { browserDeps } = await import('../browser.mjs')
  const { chromium } = browserDeps()

  const view = async (q: { id: string; token: string }) => expectOk('view', await http('GET', `${app}/api/public/quotes/${q.id}?token=${q.token}&poll=1`)) as View
  const quoteRow = async (id: string) => (await rows('quotes', `id=eq.${id}&select=*`))[0] ?? {}
  const setMode = (serviceId: string, mode: 'show' | 'hold' | 'auto') => patch('services', `id=eq.${serviceId}`, { auto_send: mode === 'auto', hold_until_approved: mode === 'hold' })
  const priced = (row: Row) => ((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && ['pending_review', 'sent', 'viewed'].includes(String(row.status))
  const pdfAddress = (q: { id: string; token: string }) => `${app}/api/public/quotes/${q.id}/pdf?token=${q.token}`
  const slugOf = async (b: Biz) => String((await rows('tenants', `id=eq.${b.tenantId}&select=slug`))[0]?.slug)

  // ---------------------------------------------------------------------------
  section('Customer A. A ZIP the business does not cover is still refused by the server (item 6)')
  const area = await h.business('area')
  const areaService = await h.paintService(area)
  const areaKey = await h.siteKey(area)
  expectOk('service area', await http('PUT', `${app}/api/tenant`, { headers: area.cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'postcode_allowlist', serviceAreaValues: ['630'] } }))
  const requestBody = (zip: string) => ({
    tenantKey: areaKey,
    serviceId: areaService,
    customer: { name: 'Orla Finch', email: 'orla.finch@example.com', phone: '(555) 204-3434' },
    job: { postcodeOrZip: zip, answers: [{ fieldId: '_project_description', value: 'Paint the outside walls and the trim' }, { fieldId: 'wall_area', value: 40 }, { fieldId: 'trim_length', value: 20 }] },
    source: { type: 'widget' },
  })
  const refused = await http('POST', `${app}/api/public/quotes`, { body: requestBody('90210') })
  check('a ZIP outside the list: 400 OUTSIDE_SERVICE_AREA, as before', refused.status === 400 && refused.json?.error?.code === 'OUTSIDE_SERVICE_AREA', [refused.status, refused.json?.error])
  check('…and nothing was saved for it', (await rows('quotes', `tenant_id=eq.${area.tenantId}&select=id`)).length === 0)

  // ---------------------------------------------------------------------------
  section('Customer B. In a browser: back to the ZIP field, everything else kept (item 6)')
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
    const form = await ctx.newPage()
    await form.goto(`${app}/quote/${await slugOf(area)}`, { waitUntil: 'networkidle' })
    await form.getByLabel('Your name').waitFor({ timeout: 60_000 })
    await form.getByLabel('Your name').fill('Orla Finch')
    await form.getByLabel('Email').fill('orla.finch@example.com')
    await form.getByLabel('Phone').fill('(555) 204-3434')
    await form.getByRole('button', { name: 'Continue' }).click()
    const numbers = form.locator('[data-testid=request-form] input[type=number]')
    await numbers.first().waitFor({ timeout: 30_000 })
    await numbers.nth(0).fill('40')
    await numbers.nth(1).fill('20')
    const sendButton = form.getByRole('button', { name: 'Get my estimate' })
    for (let step = 0; step < 4 && (await sendButton.count()) === 0; step++) {
      await form.getByRole('button', { name: 'Continue' }).click({ timeout: 30_000 })
      await form.waitForTimeout(600)
    }
    const zip = form.locator('#job-postcode')
    const description = form.locator('#job-description')
    await zip.fill('90210')
    await description.fill('Paint the outside walls and the trim')

    const [firstTry] = await Promise.all([
      form.waitForResponse((r) => r.url().endsWith('/api/public/quotes') && r.request().method() === 'POST', { timeout: 60_000 }),
      sendButton.click(),
    ])
    check('the form sent the request and the server refused it for the area', firstTry.status() === 400, firstTry.status())
    const reason = form.locator('[data-testid=outside-area]')
    await reason.waitFor({ timeout: 30_000 }).catch(() => undefined)
    const said = (await reason.count()) ? await reason.innerText() : ''
    check('the customer is back on the last step, with the reason under the ZIP field', said === outsideAreaLine({ businessName: area.name, postalCodeLabel: 'ZIP code', postcode: '90210' }), said)
    check('…the cursor is in the ZIP field, ready to correct it', (await form.evaluate(() => document.activeElement?.id)) === 'job-postcode', await form.evaluate(() => document.activeElement?.id))
    check('…what they wrote about the job is still there', (await description.inputValue()) === 'Paint the outside walls and the trim', await description.inputValue())
    const screen = await form.locator('[data-testid=request-form]').innerText()
    check('…and nothing on the screen says to start over', !/start (over|again)/i.test(screen) && !/Something went wrong/i.test(screen), screen.slice(0, 300))

    await zip.fill('63021')
    await form.waitForTimeout(300)
    check('typing in the field takes the message away', (await reason.count()) === 0)
    const [secondTry] = await Promise.all([
      form.waitForRequest((r) => r.url().endsWith('/api/public/quotes') && r.method() === 'POST', { timeout: 60_000 }),
      sendButton.click(),
    ])
    const sent = JSON.parse(secondTry.postData() ?? '{}') as { customer?: { name?: string; email?: string }; job?: { postcodeOrZip?: string; answers?: Array<{ fieldId: string; value: unknown }> } }
    const answer = (fieldId: string) => sent.job?.answers?.find((a) => a.fieldId === fieldId)?.value
    check(
      'with the ZIP corrected, the same answers go again: the name, the email, both figures and the description',
      sent.customer?.name === 'Orla Finch' && sent.customer?.email === 'orla.finch@example.com' && sent.job?.postcodeOrZip === '63021' && Number(answer('wall_area')) === 40 && Number(answer('trim_length')) === 20 && answer('_project_description') === 'Paint the outside walls and the trim',
      sent
    )
    let saved: Row[] = []
    for (let i = 0; i < 30 && saved.length === 0; i++) {
      saved = await rows('quotes', `tenant_id=eq.${area.tenantId}&select=id,status`)
      if (saved.length === 0) await form.waitForTimeout(1000)
    }
    check('…and this time the request is saved: one quote, for the one customer', saved.length === 1, saved)
    await ctx.close()

    // -------------------------------------------------------------------------
    section('Customer C. An estimate a service sent by itself: an estimate, with a PDF to download (items 9 and 10)')
    const docs = await h.business('docs')
    const docsService = await h.paintService(docs)
    const docsKey = await h.siteKey(docs)
    expectOk('auto mode', await setMode(docsService, 'auto'))
    const auto = await h.submit(docsKey, docsService, 'Nia Okoro')
    const autoRow = await h.waitForQuote(auto.id, priced)
    const autoView = await view(auto)
    check('sent automatically, never reviewed, and the business made no PDF', autoRow.status === 'sent' && autoView.review.state === 'estimate' && !autoRow.pdf_asset_id, { status: autoRow.status, review: autoView.review, pdf: autoRow.pdf_asset_id })
    check('…the customer’s answer still offers the PDF: it no longer depends on the business having made one', autoView.actions.pdfUrl === pdfAddress(auto), autoView.actions.pdfUrl)

    const pages = await browser.newContext({ viewport: { width: 1100, height: 1000 } })
    const autoPage = await pages.newPage()
    await autoPage.goto(`${app}/q/${auto.id}?token=${auto.token}`, { waitUntil: 'networkidle' })
    await autoPage.locator('[data-testid=prepared-for]').first().waitFor({ timeout: 60_000 })
    check('its page says "Estimate prepared for" the customer (nobody has approved it)', (await autoPage.locator('[data-testid=prepared-for]').first().innerText()) === preparedForLine(false, 'Nia Okoro'), await autoPage.locator('[data-testid=prepared-for]').first().innerText())
    const autoButton = autoPage.locator('[data-testid=download-pdf]')
    check('…and has the "Download PDF" button, 44 px tall or more', (await autoButton.count()) === 1 && (await autoButton.innerText()).trim() === 'Download PDF' && ((await autoButton.boundingBox())?.height ?? 0) >= 44, [await autoButton.count(), await autoButton.boundingBox().catch(() => null)])
    await autoPage.close()

    // -------------------------------------------------------------------------
    section('Customer D. While the business has not approved: no PDF anywhere (item 10, T-201 item 18)')
    expectOk('hold mode', await setMode(docsService, 'hold'))
    const held = await h.submit(docsKey, docsService, 'Tomas Reyes')
    const heldRow = await h.waitForQuote(held.id, priced)
    const heldView = await view(held)
    check('held until approved: the answer has no PDF link', heldRow.status === 'pending_review' && heldRow.review_hold === 'held' && heldView.actions.pdfUrl === undefined, { status: heldRow.status, hold: heldRow.review_hold, pdf: heldView.actions.pdfUrl })
    const heldPdf = await http('GET', `${pdfAddress(held)}&format=json`)
    check('…and the PDF’s own address refuses, and makes nothing', heldPdf.status === 404 && heldPdf.json?.error?.code === 'PDF_NOT_FOUND' && !(await quoteRow(held.id)).pdf_asset_id, [heldPdf.status, heldPdf.json?.error?.code])
    const heldPage = await pages.newPage()
    await heldPage.goto(`${app}/q/${held.id}?token=${held.token}`, { waitUntil: 'networkidle' })
    await heldPage.locator('[data-testid=prepared-for]').first().waitFor({ timeout: 60_000 })
    check('its page is still an estimate, with no "Download PDF"', (await heldPage.locator('[data-testid=prepared-for]').first().innerText()) === preparedForLine(false, 'Tomas Reyes') && (await heldPage.locator('[data-testid=download-pdf]').count()) === 0)
    await heldPage.close()

    expectOk('show mode', await setMode(docsService, 'show'))
    const shown = await h.submit(docsKey, docsService, 'Dev Raman')
    const shownRow = await h.waitForQuote(shown.id, priced)
    // a PDF stored on the quote, as if one had been made before the quote went back for review
    const stored = await h.sb.insert('assets', { tenant_id: docs.tenantId, type: 'document', file_name: 'estimate.pdf', content_type: 'application/pdf', size_bytes: 10, r2_key: `local/t204-${h.shortId()}.pdf` })
    expectOk('a stored PDF', await patch('quotes', `id=eq.${shown.id}`, { pdf_asset_id: stored.id }))
    const shownView = await view(shown)
    check('shown before approval, with a PDF stored on it: the customer sees the price but is offered no PDF', shownRow.review_hold === 'shown' && shownView.review.confirmationPending === true && shownView.pricing.total > 0 && shownView.actions.pdfUrl === undefined, { hold: shownRow.review_hold, pdf: shownView.actions.pdfUrl })
    const shownPdf = await http('GET', `${pdfAddress(shown)}&format=json`)
    check('…and the address refuses that stored PDF too, until the business approves', shownPdf.status === 404 && shownPdf.json?.error?.code === 'PDF_NOT_FOUND', [shownPdf.status, shownPdf.json?.error?.code])

    // -------------------------------------------------------------------------
    section('Customer E. Once the business approves: a quote, and its PDF (items 9 and 10)')
    expectOk('approve', await http('POST', `${app}/api/quotes/${held.id}/approve`, { headers: docs.cookie }))
    const approvedView = await view(held)
    check('approved: the answer says "quote" and offers the PDF', approvedView.review.state === 'quote' && approvedView.actions.pdfUrl === pdfAddress(held), { review: approvedView.review, pdf: approvedView.actions.pdfUrl })
    const approvedPage = await pages.newPage()
    await approvedPage.goto(`${app}/q/${held.id}?token=${held.token}`, { waitUntil: 'networkidle' })
    await approvedPage.locator('[data-testid=download-pdf]').waitFor({ timeout: 60_000 }).catch(() => undefined)
    check('its page now says "Quote prepared for" the customer', (await approvedPage.locator('[data-testid=prepared-for]').first().innerText()) === preparedForLine(true, 'Tomas Reyes'), await approvedPage.locator('[data-testid=prepared-for]').first().innerText())
    check('…with "Download PDF", which is a link to the page’s own address', (await approvedPage.locator('[data-testid=download-pdf]').getAttribute('href')) === `/api/public/quotes/${held.id}/pdf?token=${held.token}`, await approvedPage.locator('[data-testid=download-pdf]').getAttribute('href').catch(() => null))
    await approvedPage.close()

    // The PDF itself is made by a service outside this machine, and the check servers hold no key for
    // it. So this accepts exactly two answers, and says which it got:
    //   made      200, a download address and the file's name, and the PDF recorded on the quote
    //   not made  503 with the one plain line (PDF_FAILED_LINE), and nothing recorded on the quote
    // Anything else fails: above all a refusal for the rule (404 PDF_NOT_FOUND) on an approved quote.
    const made = await http('GET', `${pdfAddress(held)}&format=json`, { timeoutMs: 90_000 })
    const madeRow = await quoteRow(held.id)
    check('asking for the PDF of an approved quote is not refused for the rule, although it was refused a moment ago while held', made.json?.error?.code !== 'PDF_NOT_FOUND' && madeRow.status !== 'pending_review', [made.status, made.json?.error?.code, madeRow.status])
    const madeOk = made.status === 200 && /^https?:\/\//.test(String(made.json?.downloadUrl)) && made.json?.fileName === `Quote-${held.id}.pdf` && Boolean(madeRow.pdf_asset_id)
    const madePlain = made.status === 503 && made.json?.error?.message === PDF_FAILED_LINE && !madeRow.pdf_asset_id
    check(
      `it is made and recorded on the quote (200), or the customer is told in one plain line that it could not be made (503); here: ${madeOk ? 'made' : madePlain ? 'not made, the plain line' : 'neither'}`,
      madeOk || madePlain,
      [made.status, made.json]
    )
    if (madeOk) {
      const again = await http('GET', `${pdfAddress(held)}&format=json`, { timeoutMs: 90_000 })
      check('…and asking again hands over the same PDF: nothing new is made', again.status === 200 && (await quoteRow(held.id)).pdf_asset_id === madeRow.pdf_asset_id, [again.status, (await quoteRow(held.id)).pdf_asset_id, madeRow.pdf_asset_id])
    }
    const wrongToken = await http('GET', `${app}/api/public/quotes/${held.id}/pdf?token=not-the-token&format=json`)
    check('the address needs the quote’s own link: a made-up token gets nothing', wrongToken.status === 404 && wrongToken.json?.error?.code === 'QUOTE_NOT_FOUND', [wrongToken.status, wrongToken.json?.error?.code])

    // -------------------------------------------------------------------------
    section('Customer F. An edit saved in the dashboard clears the PDF made before it (item 10)')
    const before = await quoteRow(auto.id)
    expectOk('a PDF from before the edit', await patch('quotes', `id=eq.${auto.id}`, { pdf_asset_id: stored.id }))
    const edit = await http('PATCH', `${app}/api/quotes/${auto.id}`, { headers: docs.cookie, body: { version: before.version, pricing_json: before.pricing_json, content_json: before.content_json } })
    const after = await quoteRow(auto.id)
    check('saving an edit leaves the quote with no PDF, so the next download is made from what was saved', edit.ok && after.pdf_asset_id === null && Number(after.version) === Number(before.version) + 1, [edit.status, edit.json?.error, after.pdf_asset_id, after.version])
    check('…and the customer is still offered one', (await view(auto)).actions.pdfUrl === pdfAddress(auto))

    // -------------------------------------------------------------------------
    section('Customer G. A page waiting for its price checks by itself (item 28)')
    const waiting = await h.submit(docsKey, docsService, 'Ines Waller')
    await h.waitForQuote(waiting.id, priced)
    expectOk('back to being priced', await patch('quotes', `id=eq.${waiting.id}`, { status: 'generating' }))
    const waitingPage = await pages.newPage()
    await waitingPage.goto(`${app}/q/${waiting.id}?token=${waiting.token}`, { waitUntil: 'domcontentloaded' })
    await waitingPage.locator('[data-testid=preparing]').waitFor({ timeout: 60_000 }).catch(() => undefined)
    const polled = await waitingPage.waitForRequest((r) => r.url().includes(`/api/public/quotes/${waiting.id}`) && r.url().includes('poll=1'), { timeout: 15_000 }).then(() => true, () => false)
    check('"Preparing your estimate" asks for the quote again within a few seconds, without counting as a view', polled && (await waitingPage.locator('[data-testid=preparing]').count()) === 1)
    check('…and the header there is still "Estimate prepared for"', (await waitingPage.locator('[data-testid=prepared-for]').first().innerText()) === preparedForLine(false, 'Ines Waller'))
    // the price arrives: the page moves on by itself, at the schedule's next check
    expectOk('priced', await patch('quotes', `id=eq.${waiting.id}`, { status: 'pending_review' }))
    const movedOn = await waitingPage.locator('[data-testid=preparing]').waitFor({ state: 'detached', timeout: 20_000 }).then(() => true, () => false)
    check('once it is priced, the page shows the estimate without a reload', movedOn)
    await pages.close()
  } finally {
    await browser.close()
  }
}
