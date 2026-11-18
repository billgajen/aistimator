/**
 * T-183: quote wording and the business's name.
 *
 *   - headings, labels and buttons are sentence case in every email the web
 *     app sends, on the PDF and on the quote page
 *   - a logo never stands in for the business's name: with a logo the name is
 *     beside it, with none the name is alone (quote page, PDF)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PRODUCT_NAME, findConfidenceLanguage, CUSTOMER_BANNED_WORDS, repairCustomerWording, type QuoteContent, type QuotePricing, type TenantBranding, type TenantTemplate } from '@qolumns/shared'
import {
  generateRevisedQuoteEmailHtml,
  generateFeedbackNotificationEmailHtml,
  generateLimitReachedEmailHtml,
  generateLeadHeldEmailHtml,
  generateQuoteAcceptedEmailHtml,
  generateQuoteDeclinedEmailHtml,
  generateQuoteReminderEmailHtml,
  generateWhatsAppRenewalEmailHtml,
} from '@/lib/email-templates'
import { generateCustomerEmailHtml } from '@/lib/postmark'
import { requestUpdatedEmail } from '@/lib/request-updated-email'
import { generateQuotePdfHtml } from '@/lib/pdf-template'

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

/**
 * Headings, labels and buttons are sentence case: one capital at the start.
 * A short piece of text with a capital on a later word is Title Case, unless
 * that word is a name we passed in or the product's own.
 */
function titleCased(html: string, names: string[]): string[] {
  const allowed = new Set([...names.flatMap((n) => n.split(/\s+/)), PRODUCT_NAME, 'WhatsApp', 'ID', 'I'])
  const found: string[] = []
  for (const match of html.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1]!.replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim()
    const words = text.split(' ')
    if (!text || words.length < 2 || words.length > 5 || /[.,:!?·]/.test(text)) continue
    if (words.slice(1).some((word) => /^[A-Z][a-z]+$/.test(word) && !allowed.has(word))) found.push(text)
  }
  return found
}

// everything passed in below that is a name or a value, not the template's own words
const NAMES = ['Megan Grant', 'Business A', 'Service A', '1 Main Street', '12 January 2027', '15 November 2026', 'Tomorrow morning']
const common = { customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A' }

const pricing: QuotePricing = { currency: 'USD', subtotal: 300, taxAmount: 0, total: 300, breakdown: [{ label: 'Walls', amount: 300 }] }
const branding = { logoAssetId: null, primaryColor: '#205E56', footerNotes: null } as TenantBranding
const template: TenantTemplate = { showLineItems: true, includeAssumptions: true, includeExclusions: true, validityDays: 30 }
const pdf = (logoUrl?: string) =>
  generateQuotePdfHtml({
    quoteId: 'q_test',
    businessName: 'Business A',
    ...(logoUrl && { logoUrl }),
    branding,
    template,
    customer: { name: 'Megan Grant', email: 'megan@example.test' },
    pricing,
    content: { scopeSummary: 'Paint one room.', assumptions: ['The room is empty.'], exclusions: ['Ceilings.'] } as QuoteContent,
    createdAt: '2026-11-15T10:00:00Z',
    validUntil: '2027-01-12T10:00:00Z',
    locale: 'en-GB',
  })

describe('T-183: sentence case in every email the web app sends, and on the PDF', () => {
  const emails: Record<string, string> = {
    approved: generateCustomerEmailHtml({ ...common, quoteViewUrl: 'u', total: '$300.00', validUntil: '12 January 2027' }),
    revised: generateRevisedQuoteEmailHtml({ ...common, quoteViewUrl: 'u', total: '$300.00' }),
    reminder: generateQuoteReminderEmailHtml({ ...common, totalFormatted: '$300.00', quoteViewUrl: 'u' }),
    feedback: generateFeedbackNotificationEmailHtml({ ...common, feedbackType: 'approval_request', feedbackText: 'Please check.', dashboardUrl: 'u' }),
    limitMonthly: generateLimitReachedEmailHtml({ businessName: 'Business A', used: 50, limit: 50, billingUrl: 'u' }),
    limitFree: generateLimitReachedEmailHtml({ businessName: 'Business A', used: 10, limit: 10, billingUrl: 'u', per: 'total' }),
    held: generateLeadHeldEmailHtml({ ...common, used: 10, limit: 10, billingUrl: 'u', quoteUrl: 'q', per: 'total' }),
    accepted: generateQuoteAcceptedEmailHtml({ ...common, totalFormatted: '$300.00', dashboardUrl: 'u', nextStep: { timing: 'Tomorrow morning', address: '1 Main Street', phone: '555 0100' } }),
    declined: generateQuoteDeclinedEmailHtml({ ...common, reason: 'Too far away.', dashboardUrl: 'u' }),
    whatsapp: generateWhatsAppRenewalEmailHtml({ businessName: 'Business A', displayPhoneNumber: '+1 555 0100', daysLeft: 5, expiresOn: '12 January 2027', whatsappUrl: 'u' } as Parameters<typeof generateWhatsAppRenewalEmailHtml>[0]),
    requestUpdated: requestUpdatedEmail({ customerName: 'Megan Grant', mainServiceName: 'Service A', changedServiceName: 'Service B', change: 'added', pricing, locale: 'en-US', awaitingApproval: true, dashboardUrl: 'u', approveUrl: 'a' }).html,
  }

  it.each(Object.keys(emails))('%s has no Title Case heading, label or button', (name) => {
    expect(titleCased(emails[name]!, [...NAMES, 'Service B'])).toEqual([])
  })

  it('the named headings and buttons read as sentences', () => {
    expect(emails.approved).toContain('Quoted total')
    expect(emails.approved).toContain('View full quote')
    expect(emails.revised).toContain('View updated quote')
    expect(emails.accepted).toContain('View in dashboard')
    expect(emails.reminder).toContain('View your quote')
  })

  it('the PDF: "Scope of work", "Pricing breakdown", "Prepared for", "Quote reference"', () => {
    const out = pdf()
    for (const heading of ['Scope of work', 'Pricing breakdown', 'Prepared for', 'Quote reference']) expect(out).toContain(heading)
    expect(titleCased(out, NAMES)).toEqual([])
  })

  it('the quote page and its error screen have no Title Case text', () => {
    for (const file of ['app/q/[quoteId]/page.tsx', 'app/q/[quoteId]/error.tsx']) {
      const source = read(file)
      // text on a line of its own, or between tags: two capitalised words in a row
      const found = [...source.matchAll(/^\s*([A-Z][a-z]+(?: (?:of|your|the|to|and|a|in|for|&amp;|is|on|this|by|with))* [A-Z][a-z]+(?: [A-Za-z]+)*)\s*$/gm)].map((m) => m[1])
      expect(found, file).toEqual([])
    }
  })

  it('the design system says so', () => {
    expect(readFileSync(join(__dirname, '../../../../Docs/design/system.md'), 'utf8')).toMatch(/Sentence case/)
  })
})

describe('T-183: the business name is shown with the logo, never replaced by it', () => {
  it('PDF with a logo: the logo, and the name beside it', () => {
    const out = pdf('https://files.example.test/logo.png')
    const identity = out.slice(out.indexOf('data-role="business-identity"'), out.indexOf('</table>', out.indexOf('data-role="business-identity"')))
    expect(identity).toContain('<img src="https://files.example.test/logo.png" alt=""')
    expect(identity).toContain('data-role="business-name"')
    expect(identity).toContain('>Business A</h1>')
    // the name is said once in the header, as text
    expect(out.match(/data-role="business-name"/g)).toHaveLength(1)
  })

  it('PDF with no logo: the name alone, as before', () => {
    const out = pdf()
    expect(out).not.toContain('data-role="business-identity"')
    expect(out).not.toMatch(/<img/)
    expect(out).toContain('>Business A</h1>')
  })

  it('the quote page: the name is always there; the logo is beside it when there is one', () => {
    const page = read('app/q/[quoteId]/page.tsx')
    const identity = page.slice(page.indexOf('data-testid="business-identity"'), page.indexOf('{business.tagline &&'))
    expect(identity).toContain('{business.logoUrl && (')
    expect(identity).toContain('data-testid="business-logo"')
    // the name is not inside the logo's condition, and not its "else"
    expect(identity).toMatch(/\)\}\s*<h1[^>]*data-testid="business-name"[^>]*>\s*\{business\.name\}/)
    expect(identity).not.toContain(') : (')
    // the picture carries no words of its own: the name beside it is the text
    expect(identity).toContain('alt=""')
  })
})

/**
 * Found by running the regression set against a BUILT web app for the first
 * time: the production build turned the banned-word pattern's `\\b` into a
 * backspace character, so the guard found nothing in any built web app and
 * the approval-time wording repair (T-148) did nothing there. The development
 * server and these unit tests never showed it. The pattern now has no escape
 * in it; `verify-t156` proves the built app refuses a banned word, and the
 * checks' runner reads every build for a pattern changed this way.
 */
describe('T-183: the customer-language guard cannot be changed by a build', () => {
  it('a banned word standing on its own is found, wherever it sits', () => {
    for (const text of ['An exact replacement of your door.', 'Exact price.', 'This price is firm', 'It is guaranteed.', '(preliminary)', 'A "firm" figure', 'No guarantee']) {
      expect(findConfidenceLanguage(text), text).toHaveLength(1)
    }
    expect(findConfidenceLanguage('It is an exact fit.')[0]).toContain('"exact" in: ')
  })

  it('a longer word that contains one is another word', () => {
    for (const text of ['We will measure exactly on the day.', 'An inexact figure', 'Firmly fixed brackets', 'Guarantees are separate', 'exact_match', 'Replace the door.']) {
      expect(findConfidenceLanguage(text), text).toEqual([])
    }
  })

  it('every banned word is covered', () => {
    for (const word of CUSTOMER_BANNED_WORDS) expect(findConfidenceLanguage(`The price is ${word}.`), word).toHaveLength(1)
  })

  it('the pattern is written with no backslash at all', () => {
    const source = readFileSync(join(__dirname, '../../../../packages/shared/src/customer-language.ts'), 'utf8')
    const line = source.split('\n').find((l) => l.startsWith('const WORD_RE = '))!
    expect(line).toBeTruthy()
    expect(line).not.toContain('\\')
    expect(line).not.toContain('`')
    expect(source.split('\n').find((l) => l.startsWith('const WORD_CHAR = '))).not.toContain('\\')
  })

  it('wording that only deleting could fix is still refused at approval (the case the built app let through)', async () => {
    const result = await repairCustomerWording({ scopeSummary: 'An exact replacement of your door.' }, { path: 'approval', businessPhrases: [] })
    expect(result.unresolved).toHaveLength(1)
  })

  it('the checks read every built web app for a pattern changed by the build', () => {
    const runner = readFileSync(join(__dirname, '../../../../scripts/checks/run.mjs'), 'utf8')
    expect(runner).toContain('function builtPatternCheck(')
    expect(runner).toContain("if (!patterns.ok) throw new Error('the built web app holds a pattern the build changed")
  })
})
