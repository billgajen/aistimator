/**
 * T-149: quote link — slug rules, tenant resolution (isolation), share texts,
 * the embed snippet and the QR code round trip.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import jsQR from 'jsqr'
import { slugify, slugProblem, RESERVED_SLUGS, SLUG_MAX_LENGTH } from '@/lib/tenant-slug'
import { resolveQuoteLink, type QuoteLinkStore, type QuoteLinkTenant } from '@/lib/quote-link'
import { quoteLinkUrl } from '@/lib/quote-link-url'
import { buildShareTexts, webPersonMailto } from '@/lib/share-texts'
import { embedSnippet } from '@/lib/embed-snippet'
import { qrMatrix, qrToRgba } from '@/lib/qr'

const ROOT = join(__dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(join(ROOT, 'supabase/migrations/00000000000032_quote_link.sql'), 'utf8')

describe('T-149: slugify (mirrors the SQL slugify_business_name)', () => {
  it.each([
    ['Sunbelt Painting', 'sunbelt-painting'],
    ['Café Déjà-Vu & Sons Ltd.', 'cafe-deja-vu-and-sons-ltd'],
    ['  ŁÓDŹ Straße  ', 'lodz-strasse'],
    ["O'Brien's Plumbing, Inc.", 'o-brien-s-plumbing-inc'],
    ['!!!', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps at 40 characters without a trailing dash', () => {
    const s = slugify('The Very Long Name Of A Painting And Decorating Company Limited')
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(s.endsWith('-')).toBe(false)
  })

  it('the SQL accent map is the same as this one', () => {
    const m = /\n\s*'([^'\n]{20,})',\n\s*'([^'\n]{20,})'\n\s*\)/.exec(MIGRATION)
    expect(m).not.toBeNull()
    const [, from, to] = m!
    expect([...from!].length).toBe([...to!].length)
    for (let i = 0; i < [...from!].length; i++) expect(slugify([...from!][i]!)).toBe([...to!][i])
  })
})

describe('T-149: slug rules', () => {
  it('accepts a normal slug', () => {
    expect(slugProblem('sunbelt-painting')).toBeNull()
    expect(slugProblem('abc')).toBeNull()
  })

  it('rejects bad shapes', () => {
    expect(slugProblem('ab')).toBe('too_short')
    expect(slugProblem('a'.repeat(41))).toBe('too_long')
    expect(slugProblem('-abc')).toBe('invalid_characters')
    expect(slugProblem('abc-')).toBe('invalid_characters')
    expect(slugProblem('ab--c')).toBe('invalid_characters')
    expect(slugProblem('Abc')).toBe('invalid_characters')
    expect(slugProblem('ab c')).toBe('invalid_characters')
  })

  it('blocks reserved words', () => {
    for (const word of ['app', 'api', 'admin', 'quote', 'embed', 'share', 'login']) expect(slugProblem(word)).toBe('reserved')
  })

  it('the reserved list is sorted, unique and identical to the migration', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(RESERVED_SLUGS)
    expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length)
    const block = /RESERVED_SLUGS:BEGIN[\s\S]*?\n([\s\S]*?)--\s*RESERVED_SLUGS:END/.exec(MIGRATION)![1]!
    const inSql = [...block.matchAll(/\('([a-z0-9-]+)'\)/g)].map((x) => x[1])
    expect(inSql).toEqual(RESERVED_SLUGS)
  })

  it('every reserved word passes the format check (so it is caught as reserved, not as malformed)', () => {
    for (const word of RESERVED_SLUGS) expect(slugProblem(word)).toBe('reserved')
  })
})

describe('T-149: resolving /quote/{slug}', () => {
  const tenants: QuoteLinkTenant[] = [
    { id: 'tnt_a', name: 'Alpha Painting', slug: 'alpha-painting', quoteLinkFirstVisitAt: null },
    { id: 'tnt_b', name: 'Bravo Roofing', slug: 'bravo-roofing-new', quoteLinkFirstVisitAt: null },
    { id: 'tnt_c', name: 'Charlie Doors', slug: 'charlie-doors', quoteLinkFirstVisitAt: null },
  ]
  const sites: Record<string, string | null> = { tnt_a: 'tkey_alpha', tnt_b: 'tkey_bravo', tnt_c: null }
  const history: Record<string, string> = { 'bravo-roofing': 'tnt_b' }
  const store = (): QuoteLinkStore => ({
    tenantBySlug: vi.fn(async (slug: string) => tenants.find((t) => t.slug === slug) ?? null),
    tenantIdForOldSlug: vi.fn(async (slug: string) => history[slug] ?? null),
    tenantById: vi.fn(async (id: string) => tenants.find((t) => t.id === id) ?? null),
    activeTenantKey: vi.fn(async (id: string) => sites[id] ?? null),
  })

  it('a slug resolves to its own tenant and that tenant’s own widget key', async () => {
    const s = store()
    const r = await resolveQuoteLink(s, 'alpha-painting')
    expect(r).toEqual({ kind: 'found', tenant: tenants[0], tenantKey: 'tkey_alpha' })
    // the key is looked up by the resolved tenant id, never anything else
    expect(s.activeTenantKey).toHaveBeenCalledTimes(1)
    expect(s.activeTenantKey).toHaveBeenCalledWith('tnt_a')
  })

  it('is case-insensitive and trims', async () => {
    expect((await resolveQuoteLink(store(), '  Alpha-Painting ')).kind).toBe('found')
  })

  it('an old slug redirects to the current one', async () => {
    expect(await resolveQuoteLink(store(), 'bravo-roofing')).toEqual({ kind: 'redirect', slug: 'bravo-roofing-new' })
  })

  it('a tenant with no active site is a 404, not someone else’s widget', async () => {
    expect(await resolveQuoteLink(store(), 'charlie-doors')).toEqual({ kind: 'not_found' })
  })

  it('unknown and malformed slugs are 404; malformed ones make no lookup', async () => {
    expect(await resolveQuoteLink(store(), 'nobody-here')).toEqual({ kind: 'not_found' })
    const s = store()
    expect(await resolveQuoteLink(s, '../etc')).toEqual({ kind: 'not_found' })
    expect(await resolveQuoteLink(s, 'x')).toEqual({ kind: 'not_found' })
    expect(s.tenantBySlug).not.toHaveBeenCalled()
  })

  it('builds the public address', () => {
    expect(quoteLinkUrl('https://example.test/', 'alpha-painting')).toBe('https://example.test/quote/alpha-painting')
  })
})

describe('T-149: "Where to put it" texts', () => {
  const link = 'https://example.test/quote/alpha-painting'

  it('every text carries the link, and the ones that name the business use its name', () => {
    const texts = buildShareTexts({ businessName: 'Alpha Painting', link, region: 'US' })
    expect(texts.map((t) => t.id)).toEqual(['google', 'social_bio', 'email_signature', 'text_reply'])
    for (const t of texts) expect(t.text).toContain(link)
    for (const id of ['google', 'email_signature', 'text_reply']) {
      expect(texts.find((t) => t.id === id)!.text).toContain('Alpha Painting')
    }
  })

  it('says "an estimate" in the US and "a quote" in GB', () => {
    expect(buildShareTexts({ businessName: 'A', link, region: 'US' })[1]!.text).toBe(`Get an estimate online: ${link}`)
    expect(buildShareTexts({ businessName: 'A', link, region: 'GB' })[1]!.text).toBe(`Get a quote online: ${link}`)
  })

  it('the social bio fits an Instagram bio (150 characters) with a long link', () => {
    const long = `https://estimator-web-phi.vercel.app/quote/${'a'.repeat(40)}`
    expect(buildShareTexts({ businessName: 'A', link: long, region: 'US' })[1]!.text.length).toBeLessThanOrEqual(150)
  })

  it('"Send to my web person" is an email draft with the code, the link and the business name', () => {
    const code = embedSnippet({ appOrigin: 'https://example.test', tenantKey: 'tkey_alpha', placement: 'inline', experience: 'form' })
    const href = webPersonMailto({ businessName: 'Alpha Painting', link, embedCode: code, region: 'US' })
    expect(href.startsWith('mailto:?subject=')).toBe(true)
    const body = decodeURIComponent(href.split('&body=')[1]!)
    expect(body).toContain(code)
    expect(body).toContain(link)
    expect(body).toContain('Alpha Painting')
    expect(body).toContain('\r\n')
    expect(decodeURIComponent(href.split('&body=')[0]!.replace('mailto:?subject=', ''))).toBe('Please add our estimate form to the website')
  })
})

describe('T-149: embed snippet', () => {
  it('inline and floating carry the tenant key and the loader', () => {
    const base = { appOrigin: 'https://example.test', tenantKey: 'tkey_alpha' } as const
    const inline = embedSnippet({ ...base, placement: 'inline', experience: 'form' })
    expect(inline).toContain('data-tenant-key="tkey_alpha"')
    expect(inline).toContain('<div id="estimator-widget"></div>')
    const floating = embedSnippet({ ...base, placement: 'floating', experience: 'conversational' })
    expect(floating).toContain('data-mode="floating"')
    expect(floating).toContain('data-display-mode="conversational"')
  })
})

describe('T-149: QR code', () => {
  it.each([
    'https://estimator-web-phi.vercel.app/quote/alpha-painting',
    `https://estimator-web-phi.vercel.app/quote/${'b'.repeat(40)}`,
  ])('decodes back to the link: %s', (link) => {
    const { data, size } = qrToRgba(qrMatrix(link), 4, 4)
    const decoded = jsQR(data, size, size)
    expect(decoded?.data).toBe(link)
  })

  it('has the quiet zone and square shape a scanner expects', () => {
    const matrix = qrMatrix('https://example.test/quote/abc')
    const { size, data } = qrToRgba(matrix, 1, 4)
    expect(size).toBe(matrix.length + 8)
    // top-left pixel is in the quiet zone: light
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255])
  })
})
