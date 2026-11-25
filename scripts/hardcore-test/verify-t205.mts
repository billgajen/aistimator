// T-205 check, against the real servers (local stack). No model is asked (the worker runs with its
// AI stand-in), no email is sent, and nothing here touches production.
//
// What it proves
//   Item 2  the support page: open to anyone, says how to get help, links to Help, the Privacy
//           Policy, the Terms and account deletion; the site's footer links to it
//   Item 3  the business's answer to a customer's question on the customer's own quote page: above
//           the price, with the question it answers; none before an answer is sent, none on a quote
//           nobody asked about, none while the price is withheld; printed as text, never as markup
//
// Not here: the app's version, its Account row and the iPad layout (unit tests; the iPad screens
// were looked at in a simulator, see the CHANGELOG), and the store pictures (files, committed as
// they are).
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t205.mts
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off. The harness is T-201's.
import { h, finish, type Row } from './t201/harness.mts'
import { DATA_DELETION_PATH, PRODUCT_NAME, SUPPORT_EMAIL, SUPPORT_PATH } from '../../packages/shared/src/brand'
import { answerHeading } from '../../packages/shared/src/customer-email'

const { app, http, check, section, expectOk } = h
const QUESTION = 'Does the price include the trim on the back of the house?'
const ANSWER = 'Yes, front and back.\nWe paint <all> of the trim & the sills.'
type View = { status: string; version: number; pricing: { total: number }; businessAnswer?: { answer: string; question: string } }

// ---------------------------------------------------------------------------
section('1. The support page (item 2)')
const page = await fetch(`${app}${SUPPORT_PATH}`, { redirect: 'manual' })
// React writes an empty comment between a typed word and a value beside it: read the page without them
const html = (await page.text()).replace(/<!-- -->/g, '')
check('qolumns.com/support opens for anyone, signed out', page.status === 200 && html.includes('>Support</h1>'), page.status)
check('it says how to write to us', html.includes(`mailto:${SUPPORT_EMAIL}`) && html.includes(SUPPORT_EMAIL))
const helpLink = /<a[^>]*data-testid="support-help-link"[^>]*>/.exec(html)?.[0] ?? ''
check('it names the Help panel’s assistant and links to the dashboard’s Help', html.includes(`Ask ${PRODUCT_NAME}`) && helpLink.includes('href="/app"'), { helpLink })
check('it links to the Privacy Policy, the Terms and "Delete your account"', html.includes('href="/privacy"') && html.includes('href="/terms"') && html.includes(`href="${DATA_DELETION_PATH}"`) && html.includes('Delete your account'))
for (const path of ['/privacy', '/terms', DATA_DELETION_PATH]) {
  const linked = await fetch(`${app}${path}`, { redirect: 'manual' })
  check(`${path} opens`, linked.status === 200, linked.status)
}
const home = (await (await fetch(`${app}/`)).text()).replace(/<!-- -->/g, '')
check('the site’s footer links to it', new RegExp(`<a[^>]*href="${SUPPORT_PATH}"[^>]*>Support</a>`).test(home))
check('…from the support page’s own footer too', new RegExp(`<a[^>]*href="${SUPPORT_PATH}"[^>]*>Support</a>`).test(html))

// ---------------------------------------------------------------------------
section('2. The business’s answer on the customer’s quote page (item 3)')
const biz = await h.business('answer')
const serviceId = await h.paintService(biz)
const tenantKey = await h.siteKey(biz)
// "show, then confirm": the customer sees the estimate while it waits for the business
await h.patch('services', `id=eq.${serviceId}`, { auto_send: false, hold_until_approved: false })
const priced = (row: Row) => ((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && ['pending_review', 'sent', 'viewed'].includes(String(row.status))
const view = async (q: { id: string; token: string }) => expectOk('customer view', await http('GET', `${app}/api/public/quotes/${q.id}?token=${q.token}`)) as View
const detail = async (id: string) => expectOk('quote detail', await http('GET', `${app}/api/quotes/${id}`, { headers: biz.cookie })) as { quote: { version: number; pricing_json: unknown; content_json: unknown } }
const save = async (id: string, extra: Record<string, unknown>) => {
  const now = await detail(id)
  return http('PATCH', `${app}/api/quotes/${id}`, { headers: biz.cookie, body: { version: now.quote.version, pricing_json: now.quote.pricing_json, content_json: now.quote.content_json, ...extra } })
}

const first = await h.submit(tenantKey, serviceId, 'Dana Whitlock')
await h.waitForQuote(first.id, priced)
check('an estimate nobody has asked about carries no answer', (await view(first)).businessAnswer === undefined)
const asked = await http('POST', `${app}/api/public/quotes/${first.id}/feedback`, { body: { token: first.token, feedbackType: 'feedback', feedbackText: QUESTION } })
check('the customer asks a question', asked.ok, [asked.status, asked.json])
check('a question alone shows no answer', (await view(first)).businessAnswer === undefined)
const plain = await save(first.id, { sendToCustomer: false, answerToCustomer: 'Typed, then saved without sending' })
check('an answer typed with a plain save is not shown (it was not sent)', plain.ok && (await view(first)).businessAnswer === undefined, [plain.status])
const sent = await save(first.id, { sendToCustomer: true, answerToCustomer: ANSWER })
const after = await view(first)
check('sent with the quote, the answer is on the customer’s page data with the question it answers', sent.ok && after.businessAnswer?.answer === ANSWER && after.businessAnswer?.question === QUESTION, [sent.status, after.businessAnswer])
const poll = expectOk('poll', await http('GET', `${app}/api/public/quotes/${first.id}?token=${first.token}&poll=1`)) as View
check('a background status check does not look it up', poll.businessAnswer === undefined)

// a later revision with no answer keeps the last answer; a new answer replaces it
const again = await http('POST', `${app}/api/public/quotes/${first.id}/feedback`, { body: { token: first.token, feedbackType: 'feedback', feedbackText: 'And can you start in March?' } })
const silent = await save(first.id, { sendToCustomer: true })
check('a later revision sent without an answer leaves the earlier answer in place', again.ok && silent.ok && (await view(first)).businessAnswer?.answer === ANSWER, [again.status, silent.status])
const third = await http('POST', `${app}/api/public/quotes/${first.id}/feedback`, { body: { token: first.token, feedbackType: 'feedback', feedbackText: 'Which week in March?' } })
const newer = await save(first.id, { sendToCustomer: true, answerToCustomer: 'The second week.' })
const latest = await view(first)
check('a newer answer replaces it, with its own question', third.ok && newer.ok && latest.businessAnswer?.answer === 'The second week.' && latest.businessAnswer?.question === 'Which week in March?', latest.businessAnswer)

// never while the price is withheld
const held = await h.submit(tenantKey, serviceId, 'Evan Marlow')
const heldRow = await h.waitForQuote(held.id, priced)
expectOk('an answer on an older revision', await h.patch('quotes', `id=eq.${first.id}`, { status: 'pending_review', review_hold: 'held' }))
check('a quote put back on hold shows no answer (nothing of a held quote is shown)', (await view(first)).businessAnswer === undefined)
expectOk('back to revised', await h.patch('quotes', `id=eq.${first.id}`, { status: 'revised', review_hold: null }))
check('(the second estimate has no answer of its own)', heldRow.status === 'pending_review' && (await view(held)).businessAnswer === undefined)
// another business's token reads nothing of it
const stranger = await http('GET', `${app}/api/public/quotes/${first.id}?token=${held.token}`)
check('another quote’s link does not open this one', stranger.status === 401 || stranger.status === 403 || stranger.status === 404, stranger.status)

// ---------------------------------------------------------------------------
section('3. In a browser: the answer above the price')
const { browserDeps } = await import('./browser.mjs')
const browser = await browserDeps().chromium.launch()
try {
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1100 } })
    const p = await ctx.newPage()
    await p.goto(`${app}/q/${first.id}?token=${first.token}`, { waitUntil: 'networkidle' })
    const box = p.locator('[data-testid=business-answer]')
    await box.waitFor({ timeout: 30_000 })
    const text = await box.innerText()
    check(`${width}: it is headed "${answerHeading(biz.name)}" and quotes the customer’s question`, text.toUpperCase().includes(answerHeading(biz.name).toUpperCase()) && text.includes('You asked: “Which week in March?”'), text)
    check(`${width}: the answer is there`, (await p.locator('[data-testid=business-answer-text]').innerText()).trim() === 'The second week.')
    const answerBox = await box.boundingBox()
    const priceBox = await p.locator('.figure.text-5xl').first().boundingBox()
    check(`${width}: it sits above the price`, !!answerBox && !!priceBox && answerBox.y + answerBox.height <= priceBox.y, { answer: answerBox, price: priceBox })
    check(`${width}: nothing scrolls sideways`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await ctx.close()
  }
  // an answer with angle brackets and an ampersand is printed as the business typed it
  expectOk('the first answer again', await h.patch('quote_amendments', `quote_id=eq.${first.id}&version=eq.${latest.version}`, { changes_json: [{ field: 'answer_to_customer', path: 'q', before: QUESTION, after: ANSWER, type: 'added' }] }))
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  const p = await ctx.newPage()
  await p.goto(`${app}/q/${first.id}?token=${first.token}`, { waitUntil: 'networkidle' })
  await p.locator('[data-testid=business-answer-text]').waitFor({ timeout: 30_000 })
  check('typed characters are shown as typed, on two lines, and make no markup', (await p.locator('[data-testid=business-answer-text]').innerText()) === ANSWER && (await p.locator('[data-testid=business-answer] all').count()) === 0)
  // a quote with no answer has no such box
  await p.goto(`${app}/q/${held.id}?token=${held.token}`, { waitUntil: 'networkidle' })
  await p.locator('body').waitFor()
  await p.waitForTimeout(1500)
  check('an estimate with no answer has no such box', (await p.locator('[data-testid=business-answer]').count()) === 0)
  await ctx.close()
} finally {
  await browser.close()
}
process.exit(finish())
