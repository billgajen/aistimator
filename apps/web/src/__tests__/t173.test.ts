/**
 * T-173: bot and spam protection, and the closed database rules.
 *
 * The limiter's own logic is in rate-limit.test.ts and the human check's in
 * turnstile.test.ts. This file covers what is new around them: where each
 * door is guarded, the account flow, the account emails, the upload address,
 * and what migration 43 removes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PRODUCT_NAME } from '@qolumns/shared'
import { RATE_LIMITS } from '@/lib/rate-limit-config'
import { AUTH_LINK_MINUTES, alreadyRegisteredEmail, confirmEmail, resetPasswordEmail } from '@/lib/auth-emails'
import { PASSWORD_MAX_LENGTH, confirmPageUrl, passwordProblem, siteOrigin, validEmail } from '@/lib/auth-flow'
import { HUMAN_CHECK_FAILED_MESSAGE, verifyTurnstileToken } from '@/lib/turnstile'
import { OWNER_ROLE, PLATFORM_ADMIN_ROLE } from '@/lib/roles'
import { noticeFor } from '@/components/auth/auth-form'
import { HERO, NOTICES, PAGE_META } from '@/lib/marketing/home-copy'
import { marketingExample } from '@/lib/marketing/examples'
import { recordedClaims } from '@/lib/marketing/ai-claims'

const ROOT = join(__dirname, '..', '..', '..', '..')
const code = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const route = (path: string) => code(`apps/web/src/app/api/${path}/route.ts`)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('T-173: every open door has its guard, before anything is read or written', () => {
  const before = (source: string, first: string, later: string) => {
    const a = source.indexOf(first)
    const b = source.indexOf(later)
    expect(a, first).toBeGreaterThan(-1)
    expect(b, later).toBeGreaterThan(-1)
    expect(a, `${first} before ${later}`).toBeLessThan(b)
  }

  it('request submission: honeypot, then the limit, then the human check, then the database', () => {
    const src = route('public/quotes')
    before(src, 'Honeypot tripped', "checkPublicRateLimit('quotes'")
    before(src, "checkPublicRateLimit('quotes'", 'verifyTurnstileToken(body.turnstileToken')
    before(src, 'verifyTurnstileToken(body.turnstileToken', 'createAdminClient()')
    // the demo's own daily cap and per-address limit still run for the example business
    expect(code('apps/web/src/lib/quote-intake.ts') + src).toMatch(/demo-guard|checkDemoLimits|demoLimit/)
  })

  it('the four quote actions: by address first, then by quote and business once the link is checked', () => {
    for (const action of ['accept', 'decline', 'feedback', 'clarify']) {
      const src = route(`public/quotes/[quoteId]/${action}`)
      before(src, 'limitQuoteAction(request)', 'request.json()')
      before(src, 'limitQuoteAction(request)', 'createAdminClient()')
      before(src, 'token_expires_at && new Date(quote.token_expires_at) < new Date()', 'limitQuoteAndBusinessActions(quoteId')
      // and before the action itself is carried out
      const write = action === 'feedback' ? ".from('quote_feedback')" : action === 'clarify' ? "status: 'queued'" : '.update({'
      before(src, 'limitQuoteAndBusinessActions(quoteId', write)
    }
    const lib = code('apps/web/src/lib/quote-action-limit.ts')
    // the quote's own allowance is not counted for someone who only knows its id
    expect(lib).toContain("checkRateLimit('quote_actions', { ip: getClientIp(request) })")
    expect(lib).toContain("checkRateLimit('quote_actions', { key: quoteId })")
    expect(lib).toContain("checkRateLimit('quote_actions_business', { key: tenantId })")
  })

  it('uploads, the form’s settings and its view counter', () => {
    before(route('public/uploads/init'), "checkPublicRateLimit('uploads'", 'createAdminClient()')
    before(route('public/widget/config'), "checkPublicRateLimit('widget_config'", 'createAdminClient()')
    before(route('public/widget/analytics'), "checkPublicRateLimit('widget_analytics'", 'createAdminClient()')
  })

  it('sign-up: honeypot, limit by address and email, human check, then the account', () => {
    const src = route('auth/signup')
    before(src, 'Honeypot tripped', "checkRateLimit('signup', { ip, key: emailKey(email) })")
    before(src, "checkRateLimit('signup'", 'verifyTurnstileToken(')
    before(src, 'verifyTurnstileToken(', 'startSignup(')
  })

  it('log-in and password reset: the limit comes before the password or the email', () => {
    before(route('auth/login'), "checkRateLimit('login', { ip: getClientIp(request), key: emailKey(email) })", 'signInWithPassword')
    before(route('auth/forgot-password'), "checkRateLimit('password_reset', { ip: getClientIp(request), key: emailKey(email) })", 'startPasswordReset(')
    before(route('auth/reset-password'), "checkRateLimit('password_reset'", 'updateUser(')
    // setting a password needs the session the link gives
    before(route('auth/reset-password'), 'auth.getUser()', 'updateUser(')
  })

  it('the browser no longer calls Supabase’s sign-up, log-in or reset directly', () => {
    for (const page of ['login', 'signup', 'forgot-password', 'reset-password']) {
      const src = code(`apps/web/src/app/(auth)/${page}/page.tsx`)
      expect(src, page).not.toMatch(/supabase\.auth\.|createClient/)
      expect(src, page).toContain("postAuth('/api/auth/")
    }
    expect(code('apps/web/src/app/(auth)/signup/page.tsx')).toContain('useTurnstile(TURNSTILE_SITE_KEY)')
  })

  it('every limit the ticket names is in the one config file, and nothing else sets a limit', () => {
    for (const scope of ['quotes', 'uploads', 'quote_actions', 'signup', 'login', 'password_reset'] as const) expect(RATE_LIMITS[scope].length).toBeGreaterThan(0)
    const lib = code('apps/web/src/lib/rate-limit.ts')
    expect(lib).not.toMatch(/process\.env\.RATE_LIMIT|envInt\(/)
    expect(code('apps/web/.env.example')).not.toMatch(/RATE_LIMIT_QUOTES_IP/)
  })
})

describe('T-173: a blocked customer keeps their answers', () => {
  const widget = code('apps/web/src/components/embed/EstimateWidget.tsx')

  it('the form offers "Try again", which sends the same request, when it was held back and not refused', () => {
    expect(widget).toContain("setCanResend(response.status === 429 || response.status >= 500 || data.error?.code === 'VERIFICATION_FAILED')")
    expect(widget).toContain('onResend={canResend ? handleSubmit : undefined}')
    expect(widget).toContain('Your answers are still here. Nothing you typed has been lost.')
    // "Start Over" is shown only when there is nothing to send again
    expect(widget).toMatch(/\{onResend \? \([\s\S]*?Try again[\s\S]*?\) : \([\s\S]*?Start Over/)
  })

  it('no message tells a person to refresh the page', () => {
    expect(HUMAN_CHECK_FAILED_MESSAGE).not.toMatch(/refresh|reload/i)
    for (const path of ['public/quotes', 'public/leads', 'auth/signup']) expect(route(path)).not.toMatch(/refresh the page/i)
  })
})

describe('T-173: the human check', () => {
  it('says once, clearly, when it is switched off', async () => {
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fresh = await import('@/lib/turnstile')
    expect((await fresh.verifyTurnstileToken(undefined, '1.2.3.4')).ok).toBe(true)
    expect((await fresh.verifyTurnstileToken(undefined, '1.2.3.4')).ok).toBe(true)
    const lines = warn.mock.calls.flat().filter((l) => String(l).includes('PROTECTION OFF'))
    expect(lines).toHaveLength(1)
    expect(String(lines[0])).toContain('TURNSTILE_SECRET_KEY')
  })

  it('is on only with both keys: the secret alone would refuse every request, because no browser could make a token', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { isTurnstileEnabled } = await import('@/lib/turnstile')
    expect(isTurnstileEnabled()).toBe(false)
    expect((await verifyTurnstileToken(undefined, '1.2.3.4')).ok).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site')
    expect(isTurnstileEnabled()).toBe(true)
    // T-178: with the check on, a request with no token still goes ahead (and the log says so)
    expect(await verifyTurnstileToken(undefined, '1.2.3.4')).toEqual({ ok: true, unchecked: 'no-token' })
  })

  it('checks the token with Cloudflare, and only a test outside production can point it elsewhere', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site')
    vi.stubEnv('TURNSTILE_VERIFY_URL', 'http://127.0.0.1:1/siteverify')
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NODE_ENV', 'production')
    await verifyTurnstileToken('tok', '1.2.3.4')
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    vi.stubEnv('NODE_ENV', 'test')
    await verifyTurnstileToken('tok', '1.2.3.4')
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe('http://127.0.0.1:1/siteverify')
  })

  it('Postmark’s address can likewise only be replaced outside production', () => {
    const src = code('apps/web/src/lib/postmark.ts')
    expect(src).toContain("if (override && process.env.NODE_ENV !== 'production')")
    expect(src).toContain('await fetch(postmarkUrl(), {')
  })
})

describe('T-173: the account emails', () => {
  const confirmUrl = 'https://example.test/auth/confirm?type=signup&token_hash=abc'

  it('confirm your email: the product’s name, the business, one button, plain words', () => {
    const mail = confirmEmail({ businessName: 'Grant & Daughters <Painting>', confirmUrl })
    expect(mail.subject).toBe(`Confirm your email for ${PRODUCT_NAME}`)
    expect(mail.htmlBody).toContain('Grant &amp; Daughters &lt;Painting&gt;')
    expect(mail.htmlBody).not.toContain('<Painting>')
    expect(mail.htmlBody.match(/<a /g)).toHaveLength(1)
    expect(mail.htmlBody).toContain('Confirm my email')
    expect(mail.textBody).toContain(confirmUrl)
    expect(mail.textBody).toContain('If you did not sign up, ignore this email')
    expect(AUTH_LINK_MINUTES).toBe(60)
    expect(mail.textBody).toContain('The link works once, for one hour.')
  })

  it('reset your password, and "you already have an account"', () => {
    const reset = resetPasswordEmail({ resetUrl: 'https://example.test/auth/confirm?type=recovery&token_hash=abc' })
    expect(reset.subject).toBe(`Reset your ${PRODUCT_NAME} password`)
    expect(reset.textBody).toContain('Your password stays the same.')
    const exists = alreadyRegisteredEmail({ loginUrl: 'https://example.test/login', forgotUrl: 'https://example.test/forgot-password' })
    expect(exists.subject).toBe(`You already have a ${PRODUCT_NAME} account`)
    expect(exists.textBody).toContain('https://example.test/login')
    expect(exists.textBody).toContain('https://example.test/forgot-password')
  })

  it('none uses the words of Supabase’s own emails, an exclamation mark or a typed product name', () => {
    const all = [confirmEmail({ businessName: 'Acme', confirmUrl }), resetPasswordEmail({ resetUrl: confirmUrl }), alreadyRegisteredEmail({ loginUrl: confirmUrl, forgotUrl: confirmUrl })]
    for (const mail of all) {
      expect(mail.htmlBody + mail.textBody + mail.subject).not.toMatch(/supabase|magic link|follow this link/i)
      expect(mail.textBody + mail.subject).not.toContain('!')
      expect(mail.textBody).toContain(PRODUCT_NAME)
    }
    expect(code('apps/web/src/lib/auth-emails.ts')).not.toMatch(/Qolumns/)
  })
})

describe('T-173: the account flow’s own rules', () => {
  it('an email address and a password are checked before anything is asked of Supabase', () => {
    expect(validEmail('megan@example.test')).toBe(true)
    for (const bad of ['', 'megan', 'megan@', '@example.test', 'megan @example.test', 42, null, `${'a'.repeat(250)}@example.test`]) expect(validEmail(bad), String(bad)).toBe(false)
    expect(passwordProblem('1234567')).toMatch(/at least 8/)
    expect(passwordProblem('12345678')).toBeNull()
    expect(passwordProblem('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toMatch(/at most 72/)
    expect(passwordProblem(undefined)).toMatch(/at least 8/)
  })

  it('in production a link is built from the configured address, never from the request’s own', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test/')
    expect(siteOrigin(new Request('https://evil.example/api/auth/signup'))).toBe('https://example.test')
    vi.stubEnv('NODE_ENV', 'development')
    expect(siteOrigin(new Request('http://localhost:3000/api/auth/signup'))).toBe('http://localhost:3000')
    expect(confirmPageUrl('https://example.test', 'recovery', 'a/b=c')).toBe('https://example.test/auth/confirm?type=recovery&token_hash=a%2Fb%3Dc')
  })

  it('the link is used by a button press, and where it sends the person is fixed', () => {
    const src = route('auth/confirm')
    expect(src).toContain('export async function POST')
    expect(src).not.toContain('export async function GET')
    expect(src).not.toMatch(/get\('next'\)|searchParams/)
    const page = code('apps/web/src/app/(auth)/auth/confirm/page.tsx')
    expect(page).toContain('<form method="POST" action="/api/auth/confirm">')
    expect(page).not.toMatch(/verifyOtp|createClient/)
  })

  it('sign-up and reset tell a caller nothing about whether an address has an account', () => {
    const flow = code('apps/web/src/lib/auth-flow.ts')
    expect(flow).toContain("if (error.code === 'email_exists') {")
    expect(flow).toContain("if (error.code === 'user_not_found') return { ok: true }")
    // a link is logged only on a laptop without Postmark, never in production
    expect(flow).toMatch(/if \(process\.env\.NODE_ENV === 'production'\) \{[\s\S]*?return \{ ok: false, reason: 'email-not-sent' \}[\s\S]*?Local use only, open:/)
  })

  it('the short notes a page shows are plain', () => {
    expect(noticeFor('link-expired')).toBe('That link has expired or was already used.')
    expect(noticeFor('made-up')).toBeNull()
    expect(noticeFor(null)).toBeNull()
  })
})

describe('T-173: uploads', () => {
  it('a public upload address is good for exactly the declared size and type', () => {
    const r2 = code('apps/web/src/lib/r2.ts')
    expect(r2).toContain('ContentLength: exactSizeBytes,')
    expect(r2).toContain("signableHeaders: new Set(['content-type', 'content-length']),")
    const init = route('public/uploads/init')
    expect(init).toContain('generateUploadUrl(r2Key, file.contentType, 3600, file.sizeBytes)')
    expect(init).toContain('!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0')
    // the limits themselves are unchanged
    expect(init).toContain('const MAX_IMAGE_SIZE = 10 * 1024 * 1024')
    expect(init).toContain('const MAX_DOC_SIZE = 25 * 1024 * 1024')
    expect(init).toContain('const MAX_FILES_PER_REQUEST = 10')
  })
})

describe('T-173: migration 43 and the roles', () => {
  const sql = code('supabase/migrations/00000000000043_close_open_database_rules.sql')

  it('removes every open rule', () => {
    for (const [policy, table] of [
      ['Public can view quotes by token', 'quotes'],
      ['Public can lookup tenant by key', 'tenant_sites'],
      ['Public can view active services', 'services'],
      ['Public can view widget configs', 'widget_configs'],
      ['Public can insert feedback', 'quote_feedback'],
      ['Public can insert assets', 'assets'],
      ['Public can insert quote requests', 'quote_requests'],
      ['Public can insert quote_requests', 'quote_requests'],
      ['Public can insert analytics', 'widget_analytics'],
      ['Users can update own subscription', 'subscriptions'],
    ]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${policy}" ON ${table};`)
    }
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;')
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;')
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
  })

  it('locks a profile’s business and role, and gives new accounts "owner"', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON user_profiles')
    expect(sql).toMatch(/NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id\s+OR NEW\.role IS DISTINCT FROM OLD\.role/)
    expect(sql).toContain("ALTER TABLE user_profiles ALTER COLUMN role SET DEFAULT 'owner';")
    expect(sql).toContain("CHECK (role IN ('owner', 'admin'))")
    // the sign-up trigger gives 'owner'; nothing in the migration gives 'admin'
    expect(sql).not.toMatch(/VALUES \([\s\S]{0,80}'admin'/)
    // a second run must not demote a platform admin granted since
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_role_check'\) THEN\s+UPDATE user_profiles SET role = 'owner'/)
  })

  it('the code names the two roles once, and no route hands out the platform role', () => {
    expect(OWNER_ROLE).toBe('owner')
    expect(PLATFORM_ADMIN_ROLE).toBe('admin')
    expect(code('apps/web/src/lib/admin.ts')).toContain('profile.role !== PLATFORM_ADMIN_ROLE')
    expect(code('apps/web/src/middleware.ts')).toContain('profile.role !== PLATFORM_ADMIN_ROLE')
    expect(route('auth/setup-tenant')).toContain('role: OWNER_ROLE,')
    expect(route('auth/setup-tenant')).not.toContain("'admin'")
  })

  it('the subscription row is written by the server', () => {
    // T-180: Checkout no longer writes the row at all (Stripe's customer is tied to the business by
    // the session's own reference). The one writer is the sync, called with the service-role client
    // by the webhook and by the return from Checkout.
    const checkout = route('billing/checkout')
    expect(checkout).not.toMatch(/\.from\('subscriptions'\)[\s\S]{0,80}\.(update|upsert|insert)\(/)
    expect(code('apps/web/src/lib/billing-sync.ts')).toMatch(/admin\.from\('subscriptions'\)\.upsert\(/)
    expect(route('webhooks/stripe')).toMatch(/const admin = createAdminClient\(\)/)
    expect(route('billing/confirm')).toMatch(/syncSubscriptionFromStripe\(createAdminClient\(\), stripe, subscriptionId/)
  })

  it('the deploy scripts exist and hold no address or key', () => {
    for (const file of ['scripts/deploy-migration-43.sh', 'scripts/set-platform-admin.sh']) {
      expect(existsSync(join(ROOT, file)), file).toBe(true)
      expect(code(file), file).not.toMatch(/@gmail|sbp_[a-z0-9]{10}|eyJ[A-Za-z0-9]{20}/)
    }
    expect(code('scripts/set-platform-admin.sh')).toContain('security find-generic-password')
  })
})

describe('T-173: the home page', () => {
  it('the headline, in the owner’s words, everywhere it appears', () => {
    expect(HERO.headline).toBe('Instant quotes for your customers, in your prices.')
    expect(PAGE_META.title).toBe(`Instant quotes for your customers, in your prices — ${PRODUCT_NAME}`)
    expect(code('apps/web/src/app/layout.tsx')).toContain("description: 'Instant quotes for your customers, in your prices.',")
    for (const file of ['apps/web/src/lib/marketing/home-copy.ts', 'apps/web/src/app/layout.tsx']) expect(code(file)).not.toContain('on your website, in your prices')
  })

  it('the first example says what the product does with a message, and nothing more', () => {
    const words = NOTICES.examples[0]
    const painting = marketingExample('painting')
    // the message holds the size and the painting template's own phrase for its extra
    expect(words.message).toContain('three bedrooms')
    expect(words.message).toContain(painting.extra!.phrase)
    // each sentence names the capability it rests on
    const claims = recordedClaims()
    expect(claims.get(words.text)).toEqual(['service-match', 'words-against-answers', 'extras-from-description'])
    expect(claims.get(words.understood.service.text)).toEqual(['service-match'])
    expect(claims.get(words.understood.size.text)).toEqual(['words-against-answers'])
    expect(claims.get(words.understood.extra.text)).toEqual(['extras-from-description'])
    // it does not say the product works the service or the size out from the message
    expect(JSON.stringify(words)).not.toMatch(/works? out|picks the service|measur|identif/i)
    expect(words.understood.size.text).toContain('it asks')
  })

  it('the inventory has the new row and records the live check', () => {
    const doc = code('Docs/design/ai-capabilities.md')
    expect(doc).toContain('| `words-against-answers` |')
    expect(doc).toMatch(/`service-match`[^\n]*Seen working live on the local stack, 2026-11-17/)
    expect(doc).toContain('The product does not work the service or the size out from a\nmessage alone')
  })
})
