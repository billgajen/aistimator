/**
 * T-174: cleaner quote links, the sample customer's name, and the move to the
 * product's own domain (the names, the redirects, the sender, the settings
 * the deploy script sends).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_DOMAIN, PREVIOUS_DOMAINS, REDIRECT_DOMAINS, SUPPORT_EMAIL, emailFromHeader } from '@qolumns/shared'
import { CLEAN_SLUG_CANDIDATES, cleanSlugCandidates, endsInGeneratedCharacters } from '@/lib/clean-slug'
import { SLUG_MAX_LENGTH, slugProblem } from '@/lib/tenant-slug'
import { appOriginFrom } from '@/lib/tenant-site'
import { quoteLinkUrl } from '@/lib/quote-link-url'
import { embedSnippet } from '@/lib/embed-snippet'
import { marketingExample } from '@/lib/marketing/examples'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
/** Files (tracked or new) that match; git grep exits 1 when there are none */
function filesWith(args: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '-l', '-I', '--untracked', ...args], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort()
  } catch (error) {
    if ((error as { status?: number }).status === 1) return []
    throw error
  }
}

describe('T-174: a link that ends in generated characters', () => {
  it('is one that ends in a dash and four generated characters, and is not the business name itself', () => {
    expect(endsInGeneratedCharacters('alex-hvac-3f9a', 'Alex HVAC')).toBe(true)
    expect(endsInGeneratedCharacters('painting-0b1c', 'Painting')).toBe(true) // a reserved name
    expect(endsInGeneratedCharacters('ab-77e0', 'AB')).toBe(true) // a name too short to stand alone
    expect(endsInGeneratedCharacters('my-business-9d2f', '***')).toBe(true) // a name with no letters
  })

  it('is not a plain name, even one that ends in four such characters', () => {
    expect(endsInGeneratedCharacters('alex-hvac', 'Alex HVAC')).toBe(false)
    expect(endsInGeneratedCharacters('studio-2024', 'Studio 2024')).toBe(false)
    expect(endsInGeneratedCharacters('alex-hvac-austin', 'Alex HVAC')).toBe(false)
    expect(endsInGeneratedCharacters('alex-hvac-3f9', 'Alex HVAC')).toBe(false)
    expect(endsInGeneratedCharacters('alex-hvac-3f9ab', 'Alex HVAC')).toBe(false)
    expect(endsInGeneratedCharacters('alex-hvac-3F9A', 'Alex HVAC')).toBe(false)
  })

  it('the pattern is the one the database generates (migration 32)', () => {
    expect(read('supabase/migrations/00000000000032_quote_link.sql')).toContain("candidate := base || '-' || substr(md5(random()::text), 1, 4);")
  })
})

describe('T-174: clean links are built from the business’s own stored details', () => {
  const base = { name: 'Alex HVAC', slug: 'alex-hvac-3f9a' }

  it('service area, trade and region, best first', () => {
    const options = cleanSlugCandidates({ ...base, serviceAreaValues: ['AUSTIN', 'TRAVIS COUNTY'], trade: 'water-heater-us', region: 'US' })
    expect(options.slice(0, 3)).toEqual(['alex-hvac-austin', 'alex-hvac-travis-county', 'alex-hvac-water-heater'])
    // a postal code or prefix comes after the trade: a name reads better than a number
    expect(cleanSlugCandidates({ ...base, serviceAreaValues: ['78701'], trade: 'water-heater-us', region: 'US' }).slice(0, 3)).toEqual([
      'alex-hvac-water-heater',
      'alex-hvac-78701',
      'alex-hvac-water-heater-78701',
    ])
    expect(options).toContain('alex-hvac-us')
    expect(options).toContain('alex-hvac-water-heater-austin')
  })

  it('a word the name already says is not added again', () => {
    // the template's id is "hvac-replacement-us": the name already says "hvac", and the region is its own word
    const options = cleanSlugCandidates({ ...base, trade: 'hvac-replacement-us', serviceAreaValues: ['78701'], region: 'US' })
    expect(options.slice(0, 2)).toEqual(['alex-hvac-replacement', 'alex-hvac-78701'])
    expect(options.some((o) => o.includes('hvac-hvac'))).toBe(false)
    expect(cleanSlugCandidates({ name: 'Austin Painting', slug: 'austin-painting-0c4e', trade: 'painting-decorating-us', serviceAreaValues: ['AUSTIN'], region: 'US' })).toEqual([
      'austin-painting-decorating',
      'austin-painting-us',
      'austin-painting-decorating-us',
    ])
  })

  it('a trade the business typed, and the name of its own website', () => {
    const options = cleanSlugCandidates({ ...base, trade: 'other', tradeOther: 'Chimney sweeping and repairs', website: 'https://www.alexheatingaustin.com/contact' })
    expect(options).toContain('alex-hvac-chimney-sweeping')
    expect(options).toContain('alexheatingaustin')
    // a bare word is not a web address
    expect(cleanSlugCandidates({ ...base, website: 'none' })).toEqual([])
  })

  it('no details, no options: the business types its own', () => {
    expect(cleanSlugCandidates(base)).toEqual([])
    expect(cleanSlugCandidates({ ...base, trade: null, tradeOther: null, serviceAreaValues: [], website: null, region: null })).toEqual([])
  })

  it('every option keeps the format and reserved-word rules, and none is the link it has now', () => {
    const long = 'a'.repeat(35)
    const cases = [
      { name: 'Alex HVAC', slug: 'alex-hvac-3f9a', serviceAreaValues: ['AUSTIN'], trade: 'hvac-replacement-us', region: 'US' },
      { name: long, slug: `${long}-0a1b`, serviceAreaValues: ['SAN LUIS OBISPO COUNTY'], trade: 'garage-doors-us', region: 'US' },
      { name: 'Painting', slug: 'painting-0b1c', serviceAreaValues: ['BS9'], trade: 'painting-decorating', region: 'GB' },
      { name: 'AB', slug: 'ab-77e0', serviceAreaValues: ['--', '  '], tradeOther: '!!!', trade: 'other', region: 'US' },
      { name: 'Qolumns', slug: 'qolumns-12ab', website: 'qolumns.com', region: 'US' },
    ]
    for (const details of cases) {
      const options = cleanSlugCandidates(details)
      expect(options.length).toBeLessThanOrEqual(CLEAN_SLUG_CANDIDATES)
      expect(new Set(options).size).toBe(options.length)
      for (const option of options) {
        expect(slugProblem(option), option).toBeNull()
        expect(option.length, option).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
        expect(option).not.toBe(details.slug)
        // nothing generated: no option ends the way the random link does unless a stored detail does
        expect(option.startsWith(details.slug.replace(/-[0-9a-f]{4}$/, '').slice(0, 3)) || option === 'qolumns').toBe(true)
      }
    }
    // the product's own name is never offered, even from a website field
    expect(cleanSlugCandidates(cases[4]!)).not.toContain('qolumns')
  })

  it('the link keeps the name it was made from when the business has since been renamed', () => {
    expect(cleanSlugCandidates({ name: 'Northside Heating', slug: 'alex-hvac-3f9a', serviceAreaValues: ['AUSTIN'] })[0]).toBe('alex-hvac-austin')
  })

  it('no town, trade or region is written into the code', () => {
    const source = read('apps/web/src/lib/clean-slug.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(source).not.toMatch(/austin|texas|london|hvac|plumb|paint|electric/i)
  })
})

describe('T-174: replacing a random link is free, and the server decides', () => {
  const route = read('apps/web/src/app/api/tenant/slug/route.ts')
  const server = read('apps/web/src/lib/clean-slug-server.ts')

  it('free means: generated ending, never changed, and nothing in the history table', () => {
    expect(server).toMatch(/if \(tenant\.slug_changed_at \|\| !endsInGeneratedCharacters\(tenant\.slug, tenant\.name\)\) return false/)
    expect(server).toContain(".from('tenant_slug_history')")
    expect(server).toMatch(/return !error && count === 0/)
  })

  it('the request cannot ask for a free change: only the slug is read from it', () => {
    expect(route).toContain('const body = (await request.json().catch(() => null)) as { slug?: unknown } | null')
    expect(route).not.toMatch(/body\??\.(free|random|clean)/)
  })

  it('a free replacement leaves the one change, writes the old link to history first, and cannot run twice', () => {
    expect(route).toContain(".update(free ? { slug } : { slug, slug_changed_at: new Date().toISOString() })")
    expect(route.indexOf(".from('tenant_slug_history').insert")).toBeLessThan(route.indexOf('.update(free ?'))
    expect(route).toContain(".eq('slug', tenant.slug)")
    expect(route).toContain("return NextResponse.json({ slug, changeable: free, free })")
  })

  it('the same checks run for a free replacement as for a change', () => {
    // format, reserved words and never-reuse are in check(); it is called before any write
    expect(route.indexOf('const result = await check(admin, slug, auth.tenantId, tenant.slug)')).toBeLessThan(route.indexOf(".from('tenant_slug_history').insert"))
    expect(server).toContain("admin.from('reserved_slugs')")
    expect(server).toContain("admin.from('tenant_slug_history').select('old_slug').in('old_slug', list)")
  })

  it('it is offered at the end of setup and on the Quote link page', () => {
    expect(read('apps/web/src/components/onboarding/TestQuoteStep.tsx')).toContain('<CleanLinkOffer')
    expect(read('apps/web/src/components/share/QuoteLinkCard.tsx')).toContain('{random && <CleanLinkOffer')
    // dashboard: the button is the brand colour, never the accent
    const offer = read('apps/web/src/components/share/CleanLinkOffer.tsx')
    expect(offer).toContain('bg-primary')
    expect(offer).not.toMatch(/bg-accent|butter|tape|yellow/)
  })
})

describe('T-174: the sample customer is Megan G.', () => {
  it('on the marketing examples', () => {
    expect(marketingExample('water-heaters').customerName).toBe('Megan G.')
  })
  it('and the old sample name is nowhere in the app or the checks', () => {
    const old = 'Pri' + 'ya'
    // the T-174 check names the old name to prove it is on no page
    expect(filesWith(['-i', old, '--', 'apps', 'packages', 'scripts', 'Docs/design', 'supabase', ':!scripts/hardcore-test/verify-t174.mts'])).toEqual([])
  }, 20_000)
})

describe('T-174: the product’s addresses', () => {
  it('one file names them', () => {
    expect(APP_DOMAIN).toBe('qolumns.com')
    expect([...REDIRECT_DOMAINS]).toEqual(['www.qolumns.com', 'qolums.com', 'www.qolums.com'])
    expect([...PREVIOUS_DOMAINS]).toEqual(['estimator-web-phi.vercel.app'])
    expect(SUPPORT_EMAIL).toBe(`hello@${APP_DOMAIN}`)
  })

  it('the three other names redirect permanently, path kept; the main and the previous address do not', async () => {
    type Redirect = { source: string; destination: string; permanent: boolean; has?: Array<{ type: string; value: string }> }
    const config = (await import(join(ROOT, 'apps/web/next.config.js'))).default as { redirects: () => Promise<Redirect[]> }
    const rules = (await config.redirects()).filter((r) => r.has?.some((h) => h.type === 'host'))
    expect(rules.map((r) => r.has![0]!.value)).toEqual(['www.qolumns.com', 'qolums.com', 'www.qolums.com'])
    for (const rule of rules) {
      expect(rule.source).toBe('/:path*')
      expect(rule.destination).toBe('https://qolumns.com/:path*')
      expect(rule.permanent).toBe(true)
    }
    const hosts = rules.map((r) => r.has![0]!.value)
    expect(hosts).not.toContain(APP_DOMAIN)
    for (const previous of PREVIOUS_DOMAINS) expect(hosts).not.toContain(previous)
  })

  it('no address is typed in the app: links come from the app address setting', () => {
    const typed = filesWith(['-E', 'qolumns\\.com|qolums\\.com|vercel\\.app', '--', 'apps/web/src', 'apps/worker/src', 'apps/mobile/src', 'packages/shared/src', ':!*__tests__*', ':!*.test.ts'])
    expect(typed).toEqual(['packages/shared/src/brand.ts', 'packages/shared/src/domains.json'])
  }, 20_000)

  it('with the setting on the new address, quote links and the embed code carry it whatever host served the page', () => {
    const before = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://qolumns.com'
    try {
      const origin = appOriginFrom('estimator-web-phi.vercel.app')
      expect(origin).toBe('https://qolumns.com')
      expect(quoteLinkUrl(origin, 'alex-hvac-austin')).toBe('https://qolumns.com/quote/alex-hvac-austin')
      expect(embedSnippet({ appOrigin: origin, tenantKey: 'tkey_example', placement: 'inline', experience: 'form' })).toContain('src="https://qolumns.com/widget.js"')
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_APP_URL
      else process.env.NEXT_PUBLIC_APP_URL = before
    }
  })

  it('the embed loader takes its address from its own script tag, so code already on a website keeps its address', () => {
    const loader = read('apps/web/public/widget.js')
    expect(loader).toContain('return new URL(src).origin;')
    expect(loader).not.toMatch(/qolumns\.com|vercel\.app/)
    // why the previous address serves and does not redirect: the iframe loader only trusts its own origin
    expect(read('apps/web/public/iframe-loader.js')).toContain('if (event.origin !== WIDGET_ORIGIN)')
  })
})

describe('T-174: emails from the new address', () => {
  it('the sender name rule (T-159) is as it was; only the address changes', () => {
    expect(emailFromHeader({ kind: 'customer', businessName: 'Kent Painters' }, 'quotes@qolumns.com')).toBe('"Kent Painters via Qolumns" <quotes@qolumns.com>')
    expect(emailFromHeader({ kind: 'business' }, 'quotes@qolumns.com')).toBe('"Qolumns" <quotes@qolumns.com>')
  })

  it('the address is a setting, not code', () => {
    expect(read('apps/web/src/lib/postmark.ts')).toContain('process.env.POSTMARK_FROM_EMAIL')
    expect(read('apps/worker/src/quote-processor.ts')).toContain('env.POSTMARK_FROM_EMAIL')
  })
})

describe('T-174: what the deploy script sends', () => {
  const run = (...steps: string[]) => execFileSync('bash', [join(ROOT, 'scripts/deploy-t174-settings.sh'), '--dry-run', ...steps], { cwd: ROOT, encoding: 'utf8' })

  it('auth: the Site URL is the new address, and both addresses may be redirected to', () => {
    const out = run('auth')
    const sent = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { site_url: string; uri_allow_list: string }
    expect(sent.site_url).toBe('https://qolumns.com')
    expect(sent.uri_allow_list.split(',')).toEqual(['https://qolumns.com/**', 'https://estimator-web-phi.vercel.app/**'])
  })

  it('cors: photo uploads are accepted from the new address and still from the previous one', () => {
    const out = run('cors')
    const sent = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { rules: Array<{ allowed: { origins: string[]; methods: string[] } }> }
    expect(sent.rules).toHaveLength(1)
    expect(sent.rules[0]!.allowed.origins).toEqual(['http://localhost:3000', 'http://localhost:3001', 'https://estimator-web-phi.vercel.app', 'https://qolumns.com'])
    expect(sent.rules[0]!.allowed.methods).toContain('PUT')
  })

  it('the app address and the sender are the new ones, and the sender waits for Postmark', () => {
    const out = run('app-url', 'sender')
    expect(out).toContain('worker secret APP_URL = https://qolumns.com')
    expect(out).toContain('Vercel production NEXT_PUBLIC_APP_URL = https://qolumns.com')
    expect(out).toContain('worker secret POSTMARK_FROM_EMAIL = quotes@qolumns.com')
    expect(read('scripts/deploy-t174-settings.sh')).toContain('POSTMARK_DOMAIN_VERIFIED')
  })
})
