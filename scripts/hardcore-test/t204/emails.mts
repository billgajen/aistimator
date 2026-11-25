// T-204, Part C: emails (items 11 to 15). Local stack only; no model is asked, and no email leaves
// this machine: the standard servers have no email service set, so the routes save what they would
// send from, and each email is then built here, by the same functions the routes call, from the rows
// they wrote.
//
//   A  the business's answer to a customer's question (item 13): the route keeps it on the amendment
//      only when the quote is sent and a question is pending, cleans it, and marks the question
//      answered; a plain save, and an answer to nothing, record nothing
//   B  the emails built from those rows: the answer above the price, the status beside the price
//      (item 12), one page at one width (item 11), the question email's subject and message (item 14)
//   C  a revision after a second question: the updated-quote email carries the answer
//   D  in a browser: the editor's "Your answer to <first name>" box, and Save & Send
//   E  the logo's picture is served, and the old one still is (item 15)
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t204.mts emails
import type { Harness, Row } from '../t201/harness.mts'
import { generateCustomerEmailHtml } from '../../../apps/web/src/lib/postmark'
import { customerQuestionEmailWords, generateFeedbackNotificationEmailHtml, generateRevisedQuoteEmailHtml } from '../../../apps/web/src/lib/email-templates'
import { ANSWER_CHANGE_FIELD, ANSWER_TO_CUSTOMER_MAX } from '../../../packages/shared/src/customer-email'
import { EMAIL_WIDTH } from '../../../packages/shared/src/email-shell'
import { PRODUCT_LOGO_EMAIL } from '../../../packages/shared/src/product-logo'

type Change = { field?: string; path?: string; before?: unknown; after?: unknown; type?: string }
type Detail = { quote: { version: number; status: string; pricing_json: { total: number; breakdown: unknown[] }; content_json: Row }; feedback: Array<{ id: string; status: string; feedback_text: string | null }> }

const QUESTION = 'Do you scrape off the <old> paint first?\nAnd is the primer included?'
const ANSWER_TYPED = '  Yes, we scrape and sand first.\r\n\r\n\r\n\r\nPrimer is <b>included</b> & costs nothing extra.  '
const ANSWER_KEPT = 'Yes, we scrape and sand first.\n\nPrimer is <b>included</b> & costs nothing extra.'

export async function run(h: Harness): Promise<void> {
  const { check, section, http, app } = h
  const biz = await h.business('mail')
  const serviceId = await h.paintService(biz)
  const tenantKey = await h.siteKey(biz)
  // "show, then confirm": the customer sees the estimate while it waits for the business (T-147's default, set here so the check does not lean on it)
  await h.patch('services', `id=eq.${serviceId}`, { auto_send: false, hold_until_approved: false })
  const priced = (row: Row) => ((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && ['pending_review', 'sent', 'viewed'].includes(String(row.status))
  const quoteRow = async (id: string) => (await h.rows('quotes', `id=eq.${id}&select=*`))[0] ?? {}
  const detail = async (id: string) => h.expectOk('quote detail', await http('GET', `${app}/api/quotes/${id}`, { headers: biz.cookie })) as Detail
  const questions = (id: string) => h.rows('quote_feedback', `quote_id=eq.${id}&select=id,status,feedback_text,feedback_type&order=created_at.asc`)
  const amendments = (id: string) => h.rows('quote_amendments', `quote_id=eq.${id}&select=version,source,changes_json&order=version.asc`)
  const answersIn = (rows: Row[]) => rows.flatMap((row) => ((row.changes_json as Change[] | null) ?? []).filter((c) => c.field === ANSWER_CHANGE_FIELD))
  const ask = (q: { id: string; token: string }, text: string) =>
    http('POST', `${app}/api/public/quotes/${q.id}/feedback`, { body: { token: q.token, feedbackType: 'feedback', feedbackText: text } })
  /** Save the quote as the editor does: what is stored, sent back unchanged, with or without an answer */
  const save = async (id: string, extra: Record<string, unknown>) => {
    const now = await detail(id)
    return http('PATCH', `${app}/api/quotes/${id}`, {
      headers: biz.cookie,
      body: { version: now.quote.version, pricing_json: now.quote.pricing_json, content_json: now.quote.content_json, ...extra },
    })
  }

  // -------------------------------------------------------------------------
  section('Emails A. The business’s answer to a customer’s question is kept only when it is sent (item 13)')
  const first = await h.submit(tenantKey, serviceId, 'Derek Shaw')
  const shown = await h.waitForQuote(first.id, priced)
  check('(a request is priced and shown to the customer as an estimate, waiting for approval)', shown.status === 'pending_review' && shown.review_hold === 'shown' && Boolean(first.token), { status: shown.status, hold: shown.review_hold })

  const asked = await ask(first, QUESTION)
  const pending = await questions(first.id)
  check('the customer asks a question from the estimate page: it is saved, waiting', asked.ok && pending.length === 1 && pending[0]!.status === 'pending' && pending[0]!.feedback_text === QUESTION, [asked.status, asked.json, pending])
  const questionId = String(pending[0]?.id)

  const plain = await save(first.id, { sendToCustomer: false, answerToCustomer: 'An answer typed before a plain save' })
  check('a plain Save with an answer typed: saved, but the answer is neither kept nor sent', plain.ok && answersIn(await amendments(first.id)).length === 0, [plain.status, plain.json])
  check('…and the question is still waiting', (await questions(first.id))[0]?.status === 'pending')

  const sent = await save(first.id, { sendToCustomer: true, answerToCustomer: ANSWER_TYPED })
  const afterSend = await quoteRow(first.id)
  check('Save & Send with an answer: the quote is sent, and that is the business’s approval', sent.ok && afterSend.status === 'sent' && Boolean(afterSend.approved_at), [sent.status, sent.json, afterSend.status])
  const kept = answersIn(await amendments(first.id))
  check('the answer is kept once, on that save’s record, against the question it answers', kept.length === 1 && kept[0]!.path === questionId && kept[0]!.before === QUESTION && kept[0]!.type === 'added', kept)
  check('…cleaned (trimmed, blank lines closed up) and still plain text: nothing is escaped until it is put in an email', kept[0]?.after === ANSWER_KEPT, kept[0]?.after)
  check('…and the question is marked answered', (await questions(first.id)).every((q) => q.status === 'resolved'), await questions(first.id))
  check('no new column was needed: the amendment row is the only place it lives', !('answer_text' in ((await questions(first.id))[0] ?? {})))

  const nothingPending = await save(first.id, { sendToCustomer: true, answerToCustomer: 'An answer when nobody asked' })
  check('an answer sent when no question is waiting is not kept (and so never emailed)', nothingPending.ok && answersIn(await amendments(first.id)).length === 1, [nothingPending.status, answersIn(await amendments(first.id)).length])

  const long = await h.submit(tenantKey, serviceId, 'Petra Nolan')
  await h.waitForQuote(long.id, priced)
  await ask(long, 'How long will it take?')
  const longSave = await save(long.id, { sendToCustomer: true, answerToCustomer: 'x'.repeat(ANSWER_TO_CUSTOMER_MAX + 800) })
  const longKept = String(answersIn(await amendments(long.id))[0]?.after ?? '')
  check(`a very long answer is cut at ${ANSWER_TO_CUSTOMER_MAX} characters`, longSave.ok && longKept.length === ANSWER_TO_CUSTOMER_MAX && longKept.endsWith('…'), longKept.length)

  const rival = await h.business('mailrival')
  const byRival = await http('PATCH', `${app}/api/quotes/${first.id}`, { headers: rival.cookie, body: { version: 99, pricing_json: { breakdown: [] }, content_json: {}, sendToCustomer: true, answerToCustomer: 'Not theirs to answer' } })
  check('another business cannot answer it (the quote is not found for them)', byRival.status === 404 && answersIn(await amendments(first.id)).length === 1, byRival.status)

  // -------------------------------------------------------------------------
  section('Emails B. The emails, built from what the routes saved (items 11, 12, 14)')
  const business = (await h.rows('tenants', `id=eq.${biz.tenantId}&select=name`))[0]?.name as string
  const answer = { text: String(kept[0]?.after ?? ''), question: String(kept[0]?.before ?? '') }
  // "Harlow mail ab12’s answer", or "…s’ answer" when the made-up name happens to end in an s
  const owners = /s$/i.test(business) ? `${business}’` : `${business}’s`
  const quoteEmail = generateCustomerEmailHtml({ customerName: 'Derek Shaw', businessName: business, serviceName: 'Exterior wall painting', quoteViewUrl: `${app}/q/${first.id}?token=t`, total: '$867.00', state: 'confirmed', answer })
  const at = (html: string, mark: string) => html.indexOf(mark)
  check('the customer’s email shows the answer above the price, under "<Business>’s answer to your question"', quoteEmail.includes(`${owners} answer to your question`) && at(quoteEmail, 'data-role="business-answer"') > 0 && at(quoteEmail, 'data-role="business-answer"') < at(quoteEmail, 'data-role="price-panel"'))
  check('…with the customer’s own question quoted back', quoteEmail.includes('You asked: “Do you scrape off the &lt;old&gt; paint first? And is the primer included?”'))
  check('…and what the business typed is text, not markup', quoteEmail.includes('Primer is &lt;b&gt;included&lt;/b&gt; &amp; costs nothing extra.') && !quoteEmail.includes('<b>included</b>'))
  check('the status stands beside the price: "Reviewed and confirmed by <business>"', quoteEmail.includes('data-state="confirmed"') && quoteEmail.includes(`Reviewed and confirmed by ${business}`) && at(quoteEmail, 'data-role="price"') < at(quoteEmail, 'data-role="quote-status"') && at(quoteEmail, 'data-role="quote-status"') < at(quoteEmail, 'View full quote'))

  const words = customerQuestionEmailWords({ customerName: 'Derek Shaw', feedbackType: 'feedback' })
  const questionEmail = generateFeedbackNotificationEmailHtml({ businessName: business, customerName: 'Derek Shaw', serviceName: 'Exterior wall painting', feedbackType: 'feedback', feedbackText: QUESTION, dashboardUrl: `${app}/app/quotes/${first.id}` })
  check('the business’s email about the question: "Derek asked a question about their quote"', words.subject === 'Derek asked a question about their quote' && questionEmail.includes('Derek asked a question about their quote'), words.subject)
  check('…with the question itself in it, as text', questionEmail.includes('Do you scrape off the &lt;old&gt; paint first?\nAnd is the primer included?') && !questionEmail.includes('<old>'))
  check('…and a test request’s is marked "[Test]"', customerQuestionEmailWords({ customerName: 'Derek Shaw', feedbackType: 'feedback', isTest: true }).subject.startsWith('[Test] '))

  const card = (html: string) => /<table role="presentation" data-role="email-card"[^>]*>/.exec(html)?.[0] ?? ''
  const short = generateRevisedQuoteEmailHtml({ customerName: 'Derek Shaw', businessName: business, serviceName: 'Exterior wall painting', quoteViewUrl: `${app}/q/${first.id}?token=t`, total: '$9.00' })
  check(`both emails to the customer, and the one to the business, have one card ${EMAIL_WIDTH} px wide whatever is in it`, [quoteEmail, short, questionEmail].every((html) => card(html).includes(`width="${EMAIL_WIDTH}"`) && card(html).includes(`width: 100%; max-width: ${EMAIL_WIDTH}px;`)) && card(quoteEmail) === card(short), [card(quoteEmail), card(short)])
  check('each says it is a light page and carries the phone’s padding rule', [quoteEmail, short, questionEmail].every((html) => html.includes('<meta name="color-scheme" content="light only">') && html.includes('.email-card { padding:')))
  check('the business’s email starts with the logo on its light panel; the customer’s carries none of ours', questionEmail.includes('qolumns-wordmark-email-panel.png') && !quoteEmail.includes('data-role="product-logo"'))

  // -------------------------------------------------------------------------
  section('Emails C. A second question, answered with a revised quote (item 13)')
  const again = await ask(first, 'Can you start on a Monday?')
  check('the customer asks again on the sent quote', again.ok && (await quoteRow(first.id)).status === 'feedback_received', [again.status, (await quoteRow(first.id)).status])
  const revised = await save(first.id, { sendToCustomer: true, answerToCustomer: 'Yes, any Monday in March.' })
  const answers = answersIn(await amendments(first.id))
  check('Save & Send with an answer: the quote is now "revised", and the answer is kept with that save', revised.ok && (await quoteRow(first.id)).status === 'revised' && answers.length === 2 && answers[1]!.after === 'Yes, any Monday in March.' && answers[1]!.before === 'Can you start on a Monday?', [revised.status, answers])
  check('…both questions are answered, and the customer can ask another', (await questions(first.id)).every((q) => q.status === 'resolved'))
  const updated = generateRevisedQuoteEmailHtml({ customerName: 'Derek Shaw', businessName: business, serviceName: 'Exterior wall painting', quoteViewUrl: `${app}/q/${first.id}?token=t`, total: '$867.00', answer: { text: String(answers[1]?.after), question: String(answers[1]?.before) } })
  check('the updated-quote email carries it above the "Updated total", which reads as reviewed and confirmed', at(updated, 'Yes, any Monday in March.') > 0 && at(updated, 'data-role="business-answer"') < at(updated, 'Updated total') && updated.includes('data-state="confirmed"'))
  check('…and with no answer typed the email has no answer block at all', !short.includes('data-role="business-answer"') && !short.includes('answer to your question'))

  // -------------------------------------------------------------------------
  section('Emails D. In a browser: "Your answer to <first name>" in the editor (item 13)')
  const boxed = await h.submit(tenantKey, serviceId, 'Marta Lind')
  await h.waitForQuote(boxed.id, priced)
  const plainQuote = await h.submit(tenantKey, serviceId, 'Noor Hale')
  await h.waitForQuote(plainQuote.id, priced)
  await ask(boxed, 'Is the trim included?')
  const { browserDeps } = await import('../browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    const origin = new URL(app).origin
    await ctx.addCookies(
      biz.cookie.Cookie.split('; ').map((pair: string) => {
        const eq = pair.indexOf('=')
        return { name: pair.slice(0, eq), value: pair.slice(eq + 1), url: origin }
      })
    )
    const p = await ctx.newPage()
    const openEditor = async (id: string) => {
      await p.goto(`${app}/app/quotes/${id}`, { waitUntil: 'networkidle' })
      await p.getByRole('button', { name: 'Edit', exact: true }).first().click({ timeout: 30_000 })
      // the editor has the button twice (its top bar and its bottom bar): the top one is used throughout
      await p.getByRole('button', { name: 'Save & Send', exact: true }).first().waitFor({ timeout: 30_000 })
    }

    await openEditor(plainQuote.id)
    check('a quote with no question waiting: the editor shows no answer box', (await p.locator('[data-testid=answer-to-customer]').count()) === 0)

    await openEditor(boxed.id)
    const box = p.locator('[data-testid=answer-to-customer]')
    await box.waitFor({ timeout: 30_000 })
    const boxText = await box.innerText()
    check('a quote with a question waiting: the editor shows the question and "Your answer to Marta (optional)"', boxText.includes('Is the trim included?') && boxText.includes('Your answer to Marta (optional)'), boxText.slice(0, 300))
    check('…and says when it is sent', boxText.includes('Save & Send') && boxText.includes('above the price'))
    await box.locator('textarea').fill('Yes, the trim is in the price.')
    const [saved] = await Promise.all([
      p.waitForResponse((r) => r.url().endsWith(`/api/quotes/${boxed.id}`) && r.request().method() === 'PATCH', { timeout: 60_000 }),
      p.getByRole('button', { name: 'Save & Send', exact: true }).first().click(),
    ])
    const body = JSON.parse(saved.request().postData() ?? '{}') as { answerToCustomer?: string; sendToCustomer?: boolean }
    check('Save & Send posts the answer with the quote', saved.ok() && body.sendToCustomer === true && body.answerToCustomer === 'Yes, the trim is in the price.', [saved.status(), body.answerToCustomer])
    let typed: Change | undefined
    for (let i = 0; i < 20 && !typed; i++) {
      typed = answersIn(await amendments(boxed.id))[0]
      if (!typed) await new Promise((r) => setTimeout(r, 500))
    }
    check('…the answer is kept with the save, and the question is marked answered', typed?.after === 'Yes, the trim is in the price.' && typed?.before === 'Is the trim included?' && (await questions(boxed.id)).every((q) => q.status === 'resolved'), [typed, await questions(boxed.id)])
    await p.close()
    await ctx.close()
  } finally {
    await browser.close()
  }

  // -------------------------------------------------------------------------
  section('Emails E. The logo’s picture (item 15)')
  const panel = await fetch(`${app}${PRODUCT_LOGO_EMAIL.path}`)
  const bytes = Buffer.from(await panel.arrayBuffer())
  check('the web app serves the wordmark on its light panel, three pixels for each one shown', panel.ok && (panel.headers.get('content-type') ?? '').includes('image/png') && bytes.readUInt32BE(16) === PRODUCT_LOGO_EMAIL.width * 3 && bytes.readUInt32BE(20) === PRODUCT_LOGO_EMAIL.height * 3, [panel.status, panel.headers.get('content-type')])
  const old = await fetch(`${app}/brand/qolumns-wordmark-email.png`)
  check('the earlier picture is still served: emails already sent point at it', old.ok && (old.headers.get('content-type') ?? '').includes('image/png'), old.status)
}
