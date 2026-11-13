/**
 * T-159: emails show a sender name.
 *
 * To a customer the From name is "<business name> via <PRODUCT_NAME>"; to the
 * business it is PRODUCT_NAME. One builder (packages/shared/src/email-from.ts)
 * makes the header for the web app and the worker, and a business name can
 * never change the address or add a header.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMAIL_BUSINESS_NAME_MAX,
  PRODUCT_NAME,
  cleanSenderName,
  emailFromAddress,
  emailFromHeader,
  emailSenderName,
} from '@estimator/shared'
import { sendEmail } from '@/lib/postmark'

const ADDRESS = 'quotes@mail.example.com'
const customer = (businessName: string | null | undefined) => emailFromHeader({ kind: 'customer', businessName }, ADDRESS)
/** Every header must end with exactly the configured address and hold one address only */
const endsWithTheAddress = (header: string) =>
  header.endsWith(` <${ADDRESS}>`) && (header.match(/</g) ?? []).length === 1 && (header.match(/>/g) ?? []).length === 1 && !/[\r\n]/.test(header)
/** The display name, read back the way a mail parser reads a quoted string */
const displayName = (header: string) => {
  const quoted = /^"((?:[^"\\]|\\.)*)" </.exec(header)?.[1]
  return quoted === undefined ? null : quoted.replace(/\\(.)/g, '$1')
}

describe('the From header', () => {
  it('a plain business name: "<business> via <product>" and the configured address', () => {
    expect(customer('Ridgeway Doors')).toBe(`"Ridgeway Doors via ${PRODUCT_NAME}" <${ADDRESS}>`)
  })

  it('to the business: the product name', () => {
    expect(emailFromHeader({ kind: 'business' }, ADDRESS)).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(emailSenderName({ kind: 'business' })).toBe(PRODUCT_NAME)
  })

  it('a name with quotes is escaped inside the quoted name, not left to close it', () => {
    const header = customer('Sam "The Door" Okafor')
    expect(header).toBe(`"Sam \\"The Door\\" Okafor via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(displayName(header)).toBe(`Sam "The Door" Okafor via ${PRODUCT_NAME}`)
    expect(endsWithTheAddress(header)).toBe(true)
  })

  it('a backslash is escaped too, so it cannot unescape the closing quote', () => {
    const header = customer('Doors\\')
    expect(header).toBe(`"Doors\\\\ via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(displayName(header)).toBe(`Doors\\ via ${PRODUCT_NAME}`)
    // a quote straight after a backslash
    expect(displayName(customer('Doors\\"'))).toBe(`Doors\\" via ${PRODUCT_NAME}`)
  })

  it('a name with commas stays one sender (it is quoted)', () => {
    const header = customer('Okafor, Reyes & Sons, Ltd.')
    expect(header).toBe(`"Okafor, Reyes & Sons, Ltd. via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(endsWithTheAddress(header)).toBe(true)
  })

  it('angle brackets are removed: a name cannot bring its own address', () => {
    const header = customer('Ridgeway Doors <billing@elsewhere.example>')
    expect(header).toBe(`"Ridgeway Doors billing@elsewhere.example via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(endsWithTheAddress(header)).toBe(true)
    expect(endsWithTheAddress(customer('<<>><a@b.example>'))).toBe(true)
    expect(endsWithTheAddress(customer('"> <a@b.example> "'))).toBe(true)
  })

  it('line breaks are removed: a name cannot add a header', () => {
    const header = customer('Ridgeway Doors\r\nBcc: someone@elsewhere.example\nX-Extra: 1')
    expect(header).toBe(`"Ridgeway Doors Bcc: someone@elsewhere.example X-Extra: 1 via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(header).not.toMatch(/[\r\n]/)
    expect(endsWithTheAddress(header)).toBe(true)
    // tabs, other control characters and the Unicode line separators go the same way
    expect(cleanSenderName('Ridge\tway\u0000 Doors Two Three\u0085Four')).toBe('Ridge way Doors Two Three Four')
  })

  it('text-direction overrides are removed', () => {
    expect(cleanSenderName('Ridgeway ‮Doors⁦')).toBe('Ridgeway Doors')
  })

  it('a very long name is cut', () => {
    const long = 'Ridgeway Garage Doors and Openers of Greater Saint Louis County and Surrounding Areas Incorporated'
    const header = customer(long)
    const cut = cleanSenderName(long)
    expect(Array.from(cut).length).toBeLessThanOrEqual(EMAIL_BUSINESS_NAME_MAX)
    expect(long.startsWith(cut)).toBe(true)
    expect(header).toBe(`"${cut} via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(endsWithTheAddress(header)).toBe(true)
    // cut by whole characters: an emoji at the limit is kept or dropped, never halved
    const emoji = `${'a'.repeat(EMAIL_BUSINESS_NAME_MAX - 1)}🚪🚪`
    expect(cleanSenderName(emoji)).toBe(`${'a'.repeat(EMAIL_BUSINESS_NAME_MAX - 1)}🚪`)
  })

  it('an empty name falls back to the product name alone', () => {
    for (const empty of ['', '   ', '\r\n', '<>', null, undefined]) {
      expect(customer(empty), JSON.stringify(empty)).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
    }
  })

  it('keeps accents and other scripts as they are', () => {
    expect(customer('Café Müller Türen')).toBe(`"Café Müller Türen via ${PRODUCT_NAME}" <${ADDRESS}>`)
  })

  it('surrounding and repeated spaces are tidied', () => {
    expect(customer('  Ridgeway    Doors  ')).toBe(`"Ridgeway Doors via ${PRODUCT_NAME}" <${ADDRESS}>`)
  })

  it('the address is the configured one, even if it was configured with a name', () => {
    expect(emailFromAddress(ADDRESS)).toBe(ADDRESS)
    expect(emailFromAddress(`  ${ADDRESS}\n`)).toBe(ADDRESS)
    expect(emailFromAddress(`Some Name <${ADDRESS}>`)).toBe(ADDRESS)
    expect(emailFromHeader({ kind: 'business' }, `"Some Name" <${ADDRESS}>`)).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
  })

  it('whatever the name, the header holds the configured address and nothing else', () => {
    const hostile = [
      'a@b.example',
      '"',
      '\\',
      '\\"',
      '" <x@y.example>',
      'Name\r\nTo: x@y.example',
      'Name <x@y.example>',
      ', other@elsewhere.example',
      '>'.repeat(200),
      '\\'.repeat(200),
      '"'.repeat(200),
    ]
    for (const name of hostile) {
      const header = customer(name)
      expect(endsWithTheAddress(header), JSON.stringify(name)).toBe(true)
      expect(displayName(header), JSON.stringify(name)).not.toBeNull()
    }
  })
})

describe('the web app’s sender', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function fromOf(from: Parameters<typeof sendEmail>[0]['from'], configured = ADDRESS) {
    vi.stubEnv('POSTMARK_API_TOKEN', 'test-token')
    vi.stubEnv('POSTMARK_FROM_EMAIL', configured)
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => new Response(JSON.stringify({ MessageID: 'm' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await sendEmail({ from, to: 'riley.stone@example.com', subject: 'Your quote', htmlBody: '<p>Hello</p>', replyTo: 'office@example.com' })
    expect(result.success).toBe(true)
    return JSON.parse(fetchMock.mock.calls[0]![1].body) as { From: string; To: string; ReplyTo?: string }
  }

  it('sends a customer email as "<business> via <product>" from the configured address, reply-to untouched', async () => {
    const body = await fromOf({ kind: 'customer', businessName: 'Ridgeway Doors' })
    expect(body.From).toBe(`"Ridgeway Doors via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(body.To).toBe('riley.stone@example.com')
    expect(body.ReplyTo).toBe('office@example.com')
  })

  it('sends a business email as the product name', async () => {
    expect((await fromOf({ kind: 'business' })).From).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
  })

  it('a hostile business name reaches the provider as display text only', async () => {
    const body = await fromOf({ kind: 'customer', businessName: 'Ridgeway" <billing@elsewhere.example>\r\nBcc: x@y.example' })
    expect(endsWithTheAddress(body.From)).toBe(true)
    expect(body.To).toBe('riley.stone@example.com')
  })
})

describe('every sender says who the email is for', () => {
  const ROOT = join(__dirname, '..', '..', '..', '..')
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
  /** Each `sendEmail(` call in a file, with the `from:` it passes */
  const kindsIn = (source: string) =>
    source
      .split('await sendEmail(')
      .slice(1)
      .map((call) => /from: \{ kind: '(customer|business)'/.exec(call)?.[1] ?? 'none')
  const callsIn = (source: string) => (source.match(/await sendEmail\(/g) ?? []).length

  // customer = the email goes to the customer; business = it goes to the business
  const expected: Record<string, Array<'customer' | 'business'>> = {
    // web
    'apps/web/src/lib/quote-approval.ts': ['customer'], // "Your quote from …" on approval
    'apps/web/src/app/api/quotes/[quoteId]/route.ts': ['customer', 'customer'], // edit and send: first send, revised
    'apps/web/src/app/api/quotes/[quoteId]/resend/route.ts': ['customer'], // Send again
    'apps/web/src/app/api/cron/lifecycle/route.ts': ['customer'], // reminder
    'apps/web/src/app/api/public/quotes/[quoteId]/accept/route.ts': ['business'], // quote accepted
    'apps/web/src/app/api/public/quotes/[quoteId]/decline/route.ts': ['business'], // quote declined
    'apps/web/src/app/api/public/quotes/[quoteId]/feedback/route.ts': ['business'], // customer question
    'apps/web/src/lib/lead-hold.ts': ['business'], // new lead waiting
    'apps/web/src/lib/plan-limits.ts': ['business'], // plan limit reached
    // worker: customer quote, business "new quote", review request, customer estimate
    'apps/worker/src/email/index.ts': ['customer', 'business', 'business', 'customer'],
  }

  it('each caller passes the right kind', () => {
    for (const [path, kinds] of Object.entries(expected)) {
      const source = read(path)
      expect(callsIn(source), `${path}: number of sendEmail calls`).toBe(kinds.length)
      expect(kindsIn(source), path).toEqual(kinds)
    }
  })

  it('there is no sender outside that list', () => {
    const found = execSync(
      `grep -rlE "await sendEmail\\(" apps/web/src apps/worker/src --include=*.ts --include=*.tsx | grep -v __tests__ | sort`,
      { cwd: ROOT, encoding: 'utf8' }
    ).trim().split('\n')
    expect(found).toEqual(Object.keys(expected).sort())
  })

  it('customer emails take the business name from the tenant record', () => {
    for (const [path, kinds] of Object.entries(expected)) {
      if (!kinds.includes('customer')) continue
      const names = Array.from(read(path).matchAll(/kind: 'customer', businessName: ([^}]+?) \}/g)).map((m) => m[1])
      expect(names.length, path).toBe(kinds.filter((k) => k === 'customer').length)
      // tenant.name (web) or the tenant's name handed to the worker's email functions
      for (const name of names) expect(name, path).toMatch(/^(tenant\??\.name|data\.business\.name|data\.businessName)$/)
    }
    const processor = read('apps/worker/src/quote-processor.ts')
    expect(processor).toMatch(/businessName: tenant\.name/)
    expect(processor).toMatch(/business: \{\s*name: tenant\.name/)
  })

  it('no sender builds a From header by hand, and no product name is hardcoded for it', () => {
    for (const path of ['apps/web/src/lib/postmark.ts', 'apps/worker/src/email/postmark.ts']) {
      const source = read(path)
      expect(source, path).toContain('From: emailFromHeader(message.from, ')
      expect(source, path).not.toMatch(/From: [^e]/)
    }
    const worker = read('apps/worker/src/quote-processor.ts') + read('apps/worker/src/email/index.ts')
    expect(worker).not.toContain('fromName')
  })
})
