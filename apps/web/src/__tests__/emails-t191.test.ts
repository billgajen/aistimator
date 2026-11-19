/**
 * T-191: every email in the design system's colours and type; a customer's email in the business's own colour.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMAIL_COLOR, EMAIL_FONT, EMAIL_FONT_FILES, brandColourForEmail, contrastRatio, emailHeadStyle, textColourOnCardForEmail } from '@qolumns/shared'
import { generateCustomerEmailHtml } from '@/lib/postmark'
import { generateQuoteAcceptedEmailHtml, generateQuoteReminderEmailHtml } from '@/lib/email-templates'
import { confirmEmail } from '@/lib/auth-emails'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const EMAIL_FILES = [
  'apps/worker/src/email/templates.ts',
  'apps/web/src/lib/email-templates.ts',
  'apps/web/src/lib/postmark.ts',
  'apps/web/src/lib/auth-emails.ts',
  'apps/web/src/lib/billing-emails.ts',
  'apps/web/src/lib/request-updated-email.ts',
  'apps/web/src/lib/sections-email.ts',
  'packages/shared/src/failed-request.ts',
  'packages/shared/src/ops-alerts.ts',
  'packages/shared/src/product-logo.ts',
]
const TOKEN_NAMES: Record<keyof typeof EMAIL_COLOR, string | null> = {
  paper: 'background', card: null, surface: 'surface', mist: 'mist', mint: 'mint', ink: 'ink', textSecondary: 'text-secondary', muted: 'text-muted',
  border: 'border', borderStrong: 'border-strong', juniper: 'primary', success: 'secondary', successLight: 'secondary-light', warning: 'tertiary',
  warningLine: 'tertiary-line', danger: 'danger', dangerLight: 'danger-light', dangerLine: 'danger-line',
}

describe('T-191: the email colours are the design system’s', () => {
  const css = read('apps/web/src/app/globals.css')
  for (const [key, token] of Object.entries(TOKEN_NAMES)) {
    if (!token) continue
    it(`${key} is --color-${token}`, () => {
      const m = new RegExp(`--color-${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)
      expect(m?.[1]?.toUpperCase()).toBe(EMAIL_COLOR[key as keyof typeof EMAIL_COLOR].toUpperCase())
    })
  }

  it('every colour written in an email file is one of them; the old blue and greys are gone', () => {
    const allowed = new Set(Object.values(EMAIL_COLOR).map((c) => c.toLowerCase()))
    for (const f of EMAIL_FILES) {
      const found = [...read(f).matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => `#${m[1]!.toLowerCase()}`)
      expect(found.filter((c) => !allowed.has(c)), f).toEqual([])
    }
  })

  it('every email page has our type in its head and its body', () => {
    for (const f of EMAIL_FILES.filter((f) => read(f).includes('<body'))) {
      const code = read(f)
      expect(code.match(/<\/head>/g)?.length, f).toBe(code.match(/\$\{emailHeadStyle\(\)\}\n<\/head>/g)?.length)
      expect(code, f).not.toContain("font-family: -apple-system")
      expect(code, f).not.toContain('font-family:-apple-system')
    }
  })

  it('the faces are served from our own domain, and the files are there', () => {
    const head = emailHeadStyle()
    for (const f of EMAIL_FONT_FILES) {
      expect(head).toContain(`https://qolumns.com/brand/fonts/${f.file}`)
      expect(existsSync(join(ROOT, 'apps/web/public/brand/fonts', f.file)), f.file).toBe(true)
    }
    expect(head).not.toMatch(/googleapis|gstatic/)
    expect(EMAIL_FONT.body.startsWith("'Instrument Sans'")).toBe(true)
  })
})

describe('T-191: whose colour', () => {
  const customer = (primaryColor?: string) => generateCustomerEmailHtml({ customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A', quoteViewUrl: 'https://x.test/q', total: '£100.00', primaryColor })

  it('a customer’s email is in the business’s own colour', () => {
    const html = customer('#8B1E3F')
    expect(html).toContain('background-color: #8B1E3F; color: #ffffff;')
  })

  it('a light business colour never becomes text on white, and its button text reads on it', () => {
    const html = customer('#FFC53D')
    expect(html).toContain(`background-color: #FFC53D; color: ${EMAIL_COLOR.ink};`)
    expect(html).not.toMatch(/[^-]color: #FFC53D/)
    expect(textColourOnCardForEmail('#FFC53D')).toBe(EMAIL_COLOR.ink)
    expect(contrastRatio(textColourOnCardForEmail('#205E56'), '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  it('no colour set: juniper, as on the quote page (never the old blue)', () => {
    expect(brandColourForEmail(undefined)).toBe(EMAIL_COLOR.juniper)
    expect(brandColourForEmail('blue')).toBe(EMAIL_COLOR.juniper)
    expect(customer()).toContain(`background-color: ${EMAIL_COLOR.juniper}`)
    expect(generateQuoteReminderEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '£1', quoteViewUrl: 'https://x.test/q', primaryColor: '#8B1E3F' })).toContain('#8B1E3F')
  })

  it('an email to the business is ours: juniper, whatever the business’s colour', () => {
    const html = generateQuoteAcceptedEmailHtml({ businessName: 'Business A', customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '£1', dashboardUrl: 'https://x.test/app', primaryColor: '#8B1E3F' })
    expect(html).not.toContain('#8B1E3F')
    expect(html).toContain(`background-color: ${EMAIL_COLOR.juniper}`)
    expect(confirmEmail({ businessName: 'Business A', confirmUrl: 'https://x.test/c' }).htmlBody).toContain(EMAIL_COLOR.paper)
  })
})
