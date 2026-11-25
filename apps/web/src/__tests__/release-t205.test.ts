/**
 * T-205: the support page (the App Store's support address) and the business's answer to a
 * customer's question on the customer's own quote page.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANSWER_CHANGE_FIELD, ANSWER_TO_CUSTOMER_MAX, DATA_DELETION_PATH, SUPPORT_PATH, answerHeading, answerToCustomerOf, businessAnswerHtml } from '@qolumns/shared'
import { FOOTER, SUPPORT_PAGE } from '@/lib/marketing/site-copy'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('T-205 item 2: the support page', () => {
  const page = read('apps/web/src/app/support/page.tsx')

  it('one address, shared by the site, the app and the store listing', () => {
    expect(SUPPORT_PATH).toBe('/support')
    expect(SUPPORT_PAGE).toEqual({ href: '/support', label: 'Support' })
  })

  it('says how to get help: the email address, and "Ask Qolumns" in the dashboard’s Help', () => {
    expect(page).toContain('href={`mailto:${SUPPORT_EMAIL}`}')
    expect(page).toContain('&quot;Ask {PRODUCT_NAME}&quot;')
    expect(page).toContain('<Link href="/app" className={LINK} data-testid="support-help-link">')
  })

  it('links to the Privacy Policy, the Terms and "Delete your account"', () => {
    expect(page).toContain('<Link href="/privacy" className={LINK}>')
    expect(page).toContain('<Link href="/terms" className={LINK}>')
    expect(page).toContain('<Link href={DATA_DELETION_PATH} className={LINK}>')
    expect(page).toContain('Delete your account')
    expect(DATA_DELETION_PATH).toBe('/data-deletion')
  })

  it('is a plain page in the site’s own frame, with its own title', () => {
    expect(page).toContain('<SiteNav />')
    expect(page).toContain('<SiteFooter />')
    expect(page).toContain('title: `Support — ${PRODUCT_NAME}`')
    // the product is named from the one constant, never typed
    expect(code('apps/web/src/app/support/page.tsx')).not.toMatch(/Qolumns/)
  })

  it('is open to anyone: no sign-in stands in front of it', () => {
    expect(read('apps/web/src/middleware.ts')).not.toContain("'/support'")
  })

  it('the footer links to it, beside "Contact us"', () => {
    const footer = read('apps/web/src/components/marketing/SiteFooter.tsx')
    expect(footer).toContain('<li><Link href={SUPPORT_PAGE.href} className={FOOT_LINK}>{SUPPORT_PAGE.label}</Link></li>')
    expect(footer.indexOf('SUPPORT_PAGE.href')).toBeLessThan(footer.indexOf('{L.contact}'))
    expect(FOOTER.columns.company).toBe('Company')
  })
})

describe('T-205 item 3: the business’s answer on the customer’s quote page', () => {
  const change = (after: unknown, before: unknown = 'Does it include the trim?') => ({ field: ANSWER_CHANGE_FIELD, path: 'fb_1', before, after, type: 'added' })

  it('is read back from the changes of the revision it was sent with', () => {
    expect(answerToCustomerOf([{ field: 'pricing', path: 'total', before: 1, after: 2, type: 'modified' }, change('Yes, front and back.')])).toEqual({ answer: 'Yes, front and back.', question: 'Does it include the trim?' })
  })

  it('nothing when the revision carried no answer, an empty one, or is not a list', () => {
    expect(answerToCustomerOf([{ field: 'pricing', path: 'total', before: 1, after: 2 }])).toBeNull()
    expect(answerToCustomerOf([change('   ')])).toBeNull()
    expect(answerToCustomerOf([change(42)])).toBeNull()
    expect(answerToCustomerOf(null)).toBeNull()
    expect(answerToCustomerOf({ field: ANSWER_CHANGE_FIELD })).toBeNull()
    expect(answerToCustomerOf([null, 'x'])).toBeNull()
  })

  it('it is cleaned again on the way out, the question is put on one line and shortened', () => {
    const long = answerToCustomerOf([change('a'.repeat(ANSWER_TO_CUSTOMER_MAX + 500), `Line one\n\nline two ${'q'.repeat(400)}`)])!
    expect(long.answer.length).toBe(ANSWER_TO_CUSTOMER_MAX)
    expect(long.question.startsWith('Line one line two ')).toBe(true)
    expect(long.question.length).toBe(240)
    expect(answerToCustomerOf([change('Yes.', null)])).toEqual({ answer: 'Yes.', question: '' })
  })

  it('the heading is the email’s: "<Business>’s answer to your question"', () => {
    expect(answerHeading('Northgate Heating & Air')).toBe('Northgate Heating & Air’s answer to your question')
    expect(answerHeading('Harlow Brothers')).toBe('Harlow Brothers’ answer to your question')
    expect(businessAnswerHtml({ businessName: 'Northgate Heating & Air', answer: 'Yes.' })).toContain('Northgate Heating &amp; Air’s answer to your question')
  })

  it('the route sends the newest answer, only on a revised quote the customer can see a price for, and not on a status check', () => {
    const route = code('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')
    expect(route).toContain('if (!isProvisional && !isStatusPoll && (quote.version ?? 1) > 1) {')
    expect(route).toContain(".from('quote_amendments')")
    expect(route).toContain(".eq('tenant_id', quote.tenant_id)")
    expect(route).toContain(".order('created_at', { ascending: false })")
    expect(route).toContain('...(businessAnswer && { businessAnswer }),')
  })

  it('the page prints it above the price, as text', () => {
    const page = code('apps/web/src/app/q/[quoteId]/page.tsx')
    const box = page.indexOf('data-testid="business-answer"')
    expect(box).toBeGreaterThan(0)
    expect(box).toBeLessThan(page.indexOf("{isReviewedQuote ? 'Your quote' : 'Your estimate'}"))
    expect(page).toContain('{answerHeading(business.name)}')
    expect(page).toContain('{quote.businessAnswer.answer}')
    // never as markup
    expect(page.slice(box, box + 1200)).not.toContain('dangerouslySetInnerHTML')
  })
})
