/**
 * T-190: the owner's logo everywhere (the website's wordmark, the favicon set, the social image, the logo at the
 * top of every email to the business) and one text box on a question card.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_DOMAIN,
  PRODUCT_LOGO_EMAIL,
  PRODUCT_NAME,
  failedRequestEmail,
  noteToSend,
  productLogoRow,
  productLogoUrl,
  questionChoices,
  questionTextBox,
  type CombinedPricing,
} from '@qolumns/shared'
import { WORDMARK_FILL, WORDMARK_PATHS, WORDMARK_VIEWBOX, wordmarkWidth } from '@/components/brand/Wordmark'
import {
  generateFeedbackNotificationEmailHtml,
  generateLeadHeldEmailHtml,
  generateLimitReachedEmailHtml,
  generateQuoteAcceptedEmailHtml,
  generateQuoteDeclinedEmailHtml,
  generateQuoteReminderEmailHtml,
  generateRevisedQuoteEmailHtml,
  generateWhatsAppRenewalEmailHtml,
} from '@/lib/email-templates'
import { alreadyRegisteredEmail, confirmEmail, resetPasswordEmail } from '@/lib/auth-emails'
import { freeQuotesLeftEmail, paymentFailedEmail } from '@/lib/billing-emails'
import { generateCustomerEmailHtml } from '@/lib/postmark'
import { requestUpdatedEmail } from '@/lib/request-updated-email'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = join(ROOT, 'apps', 'web')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** width and height from a PNG's header */
function pngSize(path: string): { width: number; height: number; colourType: number } {
  const b = readFileSync(path)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25]! }
}
const svgPaths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map((m) => ({ d: m[1], fill: m[2] }))

describe('T-190: the wordmark is the owner’s drawing', () => {
  for (const [file, tone] of [
    ['brand/qolumns-wordmark.svg', 'dark'],
    ['brand/qolumns-wordmark-white.svg', 'light'],
  ] as const) {
    it(`draws the paths and fill of ${file}, and the site serves the same file`, () => {
      const svg = read(file)
      expect(svg).toContain(`viewBox="${WORDMARK_VIEWBOX}"`)
      const paths = svgPaths(svg)
      expect(paths.map((p) => p.d)).toEqual([...WORDMARK_PATHS])
      expect(new Set(paths.map((p) => p.fill))).toEqual(new Set([WORDMARK_FILL[tone]]))
      expect(read(`apps/web/public/${file}`)).toBe(svg)
    })
  }

  it('has a fixed width and height (no shift) and is read as the product name', () => {
    const code = read('apps/web/src/components/brand/Wordmark.tsx')
    expect(code).toContain('width={wordmarkWidth(height)}')
    expect(code).toContain('height={height}')
    expect(code).toContain('role="img"')
    expect(code).toContain('aria-label={PRODUCT_NAME}')
    expect(code).toContain('<title>{PRODUCT_NAME}</title>')
    expect(wordmarkWidth(28)).toBe(104)
  })

  it('the nav, the phone menu, the footer, the sign-in pages and the dashboard draw it; none types the name as a wordmark', () => {
    for (const f of ['components/marketing/SiteNav.tsx', 'components/marketing/MobileMenu.tsx', 'components/marketing/SiteFooter.tsx', 'app/(auth)/layout.tsx', 'app/(dashboard)/layout.tsx']) {
      const code = read(`apps/web/src/${f}`)
      expect(code, f).toMatch(/<Wordmark height=\{\d+\}/)
      expect(code, f).not.toMatch(/font-extrabold[^"]*">\{PRODUCT_NAME\}/)
    }
  })

  it('the design page shows it on paper and the white one on juniper', () => {
    const code = read('apps/web/src/components/design/DesignPreview.tsx')
    expect(code).toContain('<Wordmark height={72} className')
    expect(code).toContain('tone="light"')
  })
})

describe('T-190: favicon, Apple touch icon and social image', () => {
  const app = (f: string) => join(WEB, 'src', 'app', f)

  it('the icons come from the letter file at their sizes, with no transparency', () => {
    expect(pngSize(app('icon.png'))).toMatchObject({ width: 512, height: 512, colourType: 2 })
    expect(pngSize(app('apple-icon.png'))).toMatchObject({ width: 180, height: 180, colourType: 2 })
    const ico = readFileSync(app('favicon.ico'))
    expect(ico.readUInt16LE(2)).toBe(1) // an icon file
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2) // more than one size
  })

  it('the Open Graph and Twitter images are 1200 × 630, named for screen readers', () => {
    for (const f of ['opengraph-image', 'twitter-image']) {
      expect(pngSize(app(`${f}.png`))).toMatchObject({ width: 1200, height: 630 })
      expect(readFileSync(app(`${f}.alt.txt`), 'utf8').trim()).toBe(PRODUCT_NAME)
    }
    expect(existsSync(app('opengraph-image.tsx'))).toBe(false)
  })

  it('the owner’s .ai files are not shipped', () => {
    expect(existsSync(join(WEB, 'public', 'brand'))).toBe(true)
    for (const f of ['qolumns-letter.ai', 'qolumns-square.ai', 'qolumns-wordmark.ai', 'qolumns-wordmark-white.ai']) {
      expect(existsSync(join(WEB, 'public', 'brand', f)), f).toBe(false)
    }
  })
})

describe('T-190: the logo at the top of every email to the business', () => {
  it('is the PNG at a fixed address on the main domain, at a third of its pixels, with the name as alt text', () => {
    expect(productLogoUrl()).toBe(`https://${APP_DOMAIN}/brand/qolumns-wordmark-email.png`)
    const file = pngSize(join(WEB, 'public', PRODUCT_LOGO_EMAIL.path))
    expect(file.width).toBe(PRODUCT_LOGO_EMAIL.width * 3)
    expect(Math.abs(file.height / 3 - PRODUCT_LOGO_EMAIL.height)).toBeLessThan(1)
    const row = productLogoRow()
    expect(row).toContain(`width="${PRODUCT_LOGO_EMAIL.width}" height="${PRODUCT_LOGO_EMAIL.height}"`)
    expect(row).toContain(`alt="${PRODUCT_NAME}"`)
    expect(row).toContain('data-role="product-logo"')
    // with pictures blocked the alt text is dark and bold, not a broken box
    expect(row).toMatch(/color: #1B2823; font-size: 22px; font-weight: 800/)
  })

  const pricing = { sections: [], total: 100, currency: 'GBP' } as unknown as CombinedPricing
  const business: Array<[string, string]> = [
    ['feedback', generateFeedbackNotificationEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', feedbackType: 'feedback', dashboardUrl: 'https://x.test/app' })],
    ['limit reached', generateLimitReachedEmailHtml({ businessName: 'Business A', used: 10, limit: 10, billingUrl: 'https://x.test/b' })],
    ['request held', generateLeadHeldEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', used: 10, limit: 10, billingUrl: 'https://x.test/b', quoteUrl: 'https://x.test/q' })],
    ['accepted', generateQuoteAcceptedEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '£100.00', dashboardUrl: 'https://x.test/app' })],
    ['declined', generateQuoteDeclinedEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', dashboardUrl: 'https://x.test/app' })],
    ['WhatsApp renewal', generateWhatsAppRenewalEmailHtml({ businessName: 'Business A', displayPhoneNumber: '+44 7700 900000', daysLeft: 3, expiresOn: '22 November', whatsappUrl: 'https://x.test/w' })],
    ['confirm email', confirmEmail({ businessName: 'Business A', confirmUrl: 'https://x.test/c' }).htmlBody],
    ['reset password', resetPasswordEmail({ resetUrl: 'https://x.test/r' }).htmlBody],
    ['already registered', alreadyRegisteredEmail({ loginUrl: 'https://x.test/l', forgotUrl: 'https://x.test/f' }).htmlBody],
    ['free quotes left', freeQuotesLeftEmail({ businessName: 'Business A', used: 8, limit: 10, billingUrl: 'https://x.test/b' })!.html],
    ['payment failed', paymentFailedEmail({ businessName: 'Business A', billingUrl: 'https://x.test/b' }).html],
    ['failed request', failedRequestEmail({ customerName: 'Megan Grant', serviceName: 'Service A', quoteUrl: 'https://x.test/q' }).html],
  ]
  for (const [name, html] of business) {
    it(`"${name}" starts with the logo, once`, () => {
      expect(html.split(productLogoRow())).toHaveLength(2)
      // above the white card
      expect(html.indexOf(productLogoRow())).toBeLessThan(html.indexOf('#ffffff'))
    })
  }

  it('"request updated" (to the business) has it too', () => {
    const { html } = requestUpdatedEmail({ customerName: 'Megan Grant', mainServiceName: 'Service A', changedServiceName: 'Service B', change: 'added', pricing, locale: 'en-GB', awaitingApproval: false, dashboardUrl: 'https://x.test/app' })
    expect(html.split(productLogoRow())).toHaveLength(2)
  })

  it('emails to a customer carry the business’s brand, not ours', () => {
    const customer = [
      generateRevisedQuoteEmailHtml({ customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A', quoteViewUrl: 'https://x.test/q', total: '£100.00' }),
      generateQuoteReminderEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '£100.00', quoteViewUrl: 'https://x.test/q' }),
      generateCustomerEmailHtml({ customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A', quoteViewUrl: 'https://x.test/q', total: '£100.00' }),
    ]
    for (const html of customer) {
      expect(html).not.toContain('data-role="product-logo"')
      expect(html).not.toContain(productLogoUrl())
    }
  })
})

describe('T-190: a question card has at most one text box', () => {
  const withChoices = questionChoices({ id: 'q1', question: 'How many rooms?', options: ['1', '2', '3'] } as never)
  const none = questionChoices({ id: 'q2', question: 'How long is the fence?' } as never)

  it('choices: the buttons and the note', () => {
    expect(withChoices.choices.length).toBeGreaterThan(0)
    expect(questionTextBox(withChoices.choices, undefined)).toBe('note')
    expect(questionTextBox(withChoices.choices, '2')).toBe('note')
    expect(noteToSend(withChoices.choices, '2', '  the customer said so ')).toBe('the customer said so')
  })

  it('"Other" typed: the answer box is the one box, and no note is sent', () => {
    expect(questionTextBox(withChoices.choices, '')).toBe('answer')
    expect(questionTextBox(withChoices.choices, '4')).toBe('answer')
    expect(noteToSend(withChoices.choices, '4', 'old words')).toBeUndefined()
  })

  it('no choices (older quotes, a quantity with no list): the answer box only', () => {
    expect(none.choices).toHaveLength(0)
    expect(questionTextBox(none.choices, undefined)).toBe('answer')
    expect(noteToSend(none.choices, '12', 'a note')).toBeUndefined()
  })

  it('the dashboard and the app both follow the rule', () => {
    for (const f of ['apps/web/src/components/quotes/BusinessQuestions.tsx', 'apps/mobile/app/quote/[id].tsx']) {
      const code = read(f)
      expect(code, f).toContain("questionTextBox(choices, answer) === 'note'")
      expect(code, f).toContain('noteToSend(questionChoices(q).choices, answers[q.id], notes[q.id])')
    }
  })
})
