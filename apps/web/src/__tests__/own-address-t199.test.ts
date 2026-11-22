/**
 * T-199: a business's own address (yourname.<our domain>).
 *   - the name's rules and the reserved names (one list with the quote link);
 *   - only with Pro features; one choice; unique across the address and the
 *     quote-link name;
 *   - the forward when Pro features end and the return on moving up;
 *   - the admin's change and the 90-day hold;
 *   - what a subdomain serves, and the caller's address passed on by the Worker;
 *   - the links a business is shown.
 * The database's own rules (migration 49) are read here as text and were run
 * against a local database; the route logic runs on an in-memory one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADDRESS_COPY,
  ADDRESS_HOLD_DAYS,
  ADDRESS_PROXY_HEADERS,
  RESERVED_NAMES,
  RESERVED_NAMES_T199,
  addressFromHost,
  addressHostFrom,
  addressProblem,
  addressProxyCaller,
  addressRoute,
  addressUrl,
  businessAccess,
  businessLinks,
  cleanAddress,
  onSameAddress,
  suggestedAddress,
} from '@qolumns/shared'
import { memoryDb, type MemRow } from '../../../../packages/shared/src/testing/memory-db'
import { addressViewOf, adminChangeAddress, checkAddress, chooseAddress, lookupAddress, ownAddressHost } from '@/lib/own-address'
import { RESERVED_SLUGS, slugProblem } from '@/lib/tenant-slug'
import { getClientIp } from '@/lib/rate-limit'
import { RATE_LIMITS } from '@/lib/rate-limit-config'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/00000000000049_own_address.sql')
const HOST = 'qolumns.com'
const APP = 'https://qolumns.com'
const PRO = { plan_id: 'plan_us_pro', status: 'active' }
const STARTER = { plan_id: 'plan_us_starter', status: 'active' }

type Admin = Parameters<typeof chooseAddress>[0]

/** The database's `own_address_taken`, as migration 49 writes it (the SQL itself was run against a local database) */
function taken(args: MemRow, tables: Record<string, MemRow[]>): boolean {
  const name = args.candidate as string
  const mine = args.for_tenant as string
  const now = new Date().toISOString()
  return (
    (tables.reserved_slugs ?? []).some((r) => r.slug === name) ||
    (tables.tenants ?? []).some((t) => t.id !== mine && (t.own_address === name || t.slug === name)) ||
    (tables.tenant_slug_history ?? []).some((h) => h.old_slug === name && h.tenant_id !== mine) ||
    (tables.own_address_changes ?? []).some((c) => c.old_address === name && typeof c.held_until === 'string' && c.held_until > now && c.tenant_id !== mine)
  )
}

function world(over: { megan?: MemRow; meganPlan?: MemRow | null; used?: number } = {}) {
  const tables: Record<string, MemRow[]> = {
    tenants: [
      { id: 'tnt_megan', region: 'US', slug: 'megan-grant-painting', own_address: null, own_address_chosen_at: null, own_address_later_at: null, ...over.megan },
      { id: 'tnt_dana', region: 'US', slug: 'whitfield-roofing', own_address: 'whitfield', own_address_chosen_at: '2026-11-01T00:00:00Z', own_address_later_at: null },
    ],
    subscriptions: [
      ...(over.meganPlan === undefined ? [{ tenant_id: 'tnt_megan', ...PRO }] : over.meganPlan ? [{ tenant_id: 'tnt_megan', ...over.meganPlan }] : []),
      { tenant_id: 'tnt_dana', ...PRO },
    ],
    usage_counters: over.used === undefined ? [] : [{ id: 'u1', tenant_id: 'tnt_megan', period_yyyymm: '202611', estimates_created: over.used }],
    tenant_slug_history: [{ old_slug: 'reyes-plumbing-old', tenant_id: 'tnt_dana' }],
    reserved_slugs: RESERVED_NAMES.map((slug) => ({ slug })),
    own_address_changes: [],
  }
  const db = memoryDb(tables, { keys: { subscriptions: 'tenant_id', tenant_slug_history: 'old_slug', reserved_slugs: 'slug' }, unique: { tenants: [['own_address']] }, functions: { own_address_taken: taken } })
  return { db, admin: db as unknown as Admin, tables, megan: () => tables.tenants![0]! }
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_OWN_ADDRESS_HOST = HOST
  process.env.NEXT_PUBLIC_APP_URL = APP
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_OWN_ADDRESS_HOST
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.ADDRESS_PROXY_KEY
})

describe('T-199: the name', () => {
  it('3 to 30 characters: lowercase letters, numbers and single hyphens, not at either end', () => {
    for (const ok of ['bluum', 'abc', 'a1b', 'megan-grant-painting', '24-7-doors', 'a'.repeat(30)]) expect(addressProblem(ok), ok).toBeNull()
    expect(addressProblem('ab')).toBe('too_short')
    expect(addressProblem('a'.repeat(31))).toBe('too_long')
    for (const bad of ['-bluum', 'bluum-', 'blu--um', 'Bluum', 'blu um', 'blu_um', 'blu.um', 'blüm', 'bluum/', '']) expect(addressProblem(bad), bad).not.toBeNull()
    // the database holds the same shape
    expect(MIGRATION).toContain("own_address ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(own_address) BETWEEN 3 AND 30")
  })

  it('what is typed is tidied: capitals, spaces, and the domain itself', () => {
    expect(cleanAddress('  Bluum ', HOST)).toBe('bluum')
    expect(cleanAddress('bluum.qolumns.com', HOST)).toBe('bluum')
    expect(cleanAddress('https://Bluum.Qolumns.com', HOST)).toBe('bluum')
    expect(suggestedAddress('megan-grant-painting')).toBe('megan-grant-painting')
    expect(suggestedAddress('a'.repeat(40)).length).toBe(30)
  })

  it('reserved names: every one the owner listed, and every subdomain in DNS, for addresses and for new quote-link names alike', () => {
    const listed = ['www', 'app', 'api', 'admin', 'mail', 'email', 'help', 'support', 'status', 'docs', 'blog', 'cdn', 'assets', 'static', 'm', 'dev', 'staging', 'test', 'quote', 'q']
    const inDns = ['www', 'pm-bounces']
    for (const name of [...listed, ...inDns]) {
      expect(addressProblem(name), name).toBe('reserved')
      expect(slugProblem(name), name).toBe('reserved')
    }
    // one list, not two
    expect(RESERVED_SLUGS).toBe(RESERVED_NAMES)
    expect([...RESERVED_NAMES].sort()).toEqual(RESERVED_NAMES)
    // migration 49 adds exactly the new names to the database's copy
    const block = /RESERVED_SLUGS:BEGIN[\s\S]*?\n([\s\S]*?)--\s*RESERVED_SLUGS:END/.exec(MIGRATION)![1]!
    expect([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual([...RESERVED_NAMES_T199].sort())
    for (const name of RESERVED_NAMES_T199) expect(RESERVED_NAMES).toContain(name)
    // nobody is renamed: the migration only adds rows to the reserved list
    expect(MIGRATION).not.toMatch(/UPDATE tenants|DELETE FROM/i)
  })
})

describe('T-199: choosing', () => {
  it('the live check says free, taken, or can’t be used, with the whole address', async () => {
    const { admin } = world()
    expect(await checkAddress(admin, 'Megan', 'tnt_megan', HOST)).toEqual({ name: 'megan', hostname: 'megan.qolumns.com', state: 'free', message: 'megan.qolumns.com is free' })
    expect((await checkAddress(admin, 'whitfield', 'tnt_megan', HOST)).message).toBe('whitfield.qolumns.com is taken')
    expect((await checkAddress(admin, 'admin', 'tnt_megan', HOST)).message).toBe("admin.qolumns.com can't be used")
    expect((await checkAddress(admin, 'no', 'tnt_megan', HOST)).state).toBe('invalid')
  })

  it('unique across both fields: not another business’s address, quote-link name or former quote-link name; its own quote-link name is fine', async () => {
    const { admin } = world()
    for (const name of ['whitfield', 'whitfield-roofing', 'reyes-plumbing-old']) expect((await checkAddress(admin, name, 'tnt_megan', HOST)).state, name).toBe('taken')
    expect((await checkAddress(admin, 'megan-grant-painting', 'tnt_megan', HOST)).state).toBe('free')
    // the database says the same, in one function, and a trigger holds it against two requests at once
    expect(MIGRATION).toMatch(/FUNCTION public\.own_address_taken[\s\S]*reserved_slugs[\s\S]*own_address = candidate AND id IS DISTINCT FROM for_tenant[\s\S]*slug = candidate AND id IS DISTINCT FROM for_tenant[\s\S]*tenant_slug_history[\s\S]*own_address_held/)
    expect(MIGRATION).toMatch(/pg_advisory_xact_lock/)
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_own_address')
  })

  it('a check that cannot be made never says "free"', async () => {
    const tables = { tenants: [], reserved_slugs: [] }
    const broken = memoryDb(tables) as unknown as Admin // no stand-in for the function: the call fails
    expect((await checkAddress(broken, 'megan', 'tnt_megan', HOST)).state).toBe('taken')
  })

  it('only with Pro features: Pro, Business and the free start can; Starter, no plan and a cancelled plan cannot', async () => {
    for (const plan of [PRO, { plan_id: 'plan_us_business', status: 'active' }]) {
      const w = world({ meganPlan: plan })
      expect(await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'megan')).toEqual({ ok: true, address: 'megan' })
    }
    const freeStart = world({ meganPlan: null, used: 3 })
    expect((await chooseAddress(freeStart.admin, 'tnt_megan', 'user_1', 'megan')).ok).toBe(true)

    for (const [name, w] of [
      ['Starter', world({ meganPlan: STARTER })],
      ['free quotes used up', world({ meganPlan: null, used: 10 })],
      ['cancelled', world({ meganPlan: { plan_id: 'plan_us_pro', status: 'canceled' } })],
    ] as const) {
      const result = await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'megan')
      expect(result, name).toMatchObject({ ok: false, status: 403, code: 'PLAN_REQUIRED' })
      expect(w.megan().own_address, name).toBeNull()
    }
  })

  it('one choice: once chosen it is fixed, and the choice is logged', async () => {
    const w = world()
    expect((await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'megan')).ok).toBe(true)
    expect(w.megan()).toMatchObject({ own_address: 'megan' })
    expect(typeof w.megan().own_address_chosen_at).toBe('string')
    expect(w.tables.own_address_changes).toMatchObject([{ tenant_id: 'tnt_megan', old_address: null, new_address: 'megan', changed_from: 'business', changed_by: 'user_1' }])
    const again = await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'megan-grant')
    expect(again).toMatchObject({ ok: false, status: 409, code: 'ALREADY_CHOSEN', message: ADDRESS_COPY.alreadyChosen })
    expect(w.megan().own_address).toBe('megan')
    // the write itself only lands on a business with no address (two choices at once: one wins)
    expect(read('apps/web/src/lib/own-address.ts')).toMatch(/\.eq\('id', tenantId\)\s*\.is\('own_address', null\)/)
  })

  it('a taken, reserved or badly formed name is refused and nothing is saved', async () => {
    const w = world()
    expect(await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'whitfield')).toMatchObject({ ok: false, status: 409, code: 'ADDRESS_TAKEN' })
    expect(await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'support')).toMatchObject({ ok: false, status: 400, code: 'INVALID_ADDRESS' })
    expect(await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'x')).toMatchObject({ ok: false, status: 400 })
    expect(w.megan().own_address).toBeNull()
    expect(w.tables.own_address_changes).toEqual([])
  })

  it('it is its own field: choosing it does not touch the quote-link name or use up its one change', async () => {
    const w = world({ megan: { slug_changed_at: null } })
    await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'megan')
    expect(w.megan()).toMatchObject({ slug: 'megan-grant-painting', slug_changed_at: null })
    expect(w.db.log.filter((e) => e.table === 'tenant_slug_history')).toEqual([])
  })

  it('nothing is offered until the feature is switched on (the Worker serves)', async () => {
    delete process.env.NEXT_PUBLIC_OWN_ADDRESS_HOST
    expect(ownAddressHost()).toBeNull()
    const w = world()
    expect(await chooseAddress(w.admin, 'tnt_megan', 'user_1', 'megan')).toMatchObject({ ok: false, status: 409, code: 'NOT_AVAILABLE' })
    expect(await lookupAddress(w.admin, 'whitfield')).not.toBeNull() // the lookup itself is the route's to switch off
    expect(read('apps/web/src/app/api/public/address/[name]/route.ts')).toContain('ownAddressHost() ? await lookupAddress(')
    // every call looks the business up afresh (a route that never touches the request has its reads reused:
    // an address whose plan had ended kept answering "serve" until this line was there)
    const lookupRoute = read('apps/web/src/app/api/public/address/[name]/route.ts')
    expect(lookupRoute.indexOf('requestHeaders()')).toBeGreaterThan(0)
    expect(lookupRoute.indexOf('requestHeaders()')).toBeLessThan(lookupRoute.indexOf('await lookupAddress('))
    expect(addressHostFrom('')).toBeNull()
    expect(addressHostFrom('qolumns.com')).toBe('qolumns.com')
    expect(addressHostFrom('localhost:8799')).toBe('localhost:8799')
  })

  it('a new quote-link name may not equal an existing address (route, clean-link offers and database)', () => {
    const route = read('apps/web/src/app/api/tenant/slug/route.ts')
    expect(route).toContain(".eq('own_address', slug).neq('id', tenantId)")
    expect(route).toContain("from('own_address_changes')")
    expect(read('apps/web/src/lib/clean-slug-server.ts')).toContain(".in('own_address', list).neq('id', tenantId)")
    expect(MIGRATION).toMatch(/FUNCTION public\.tenant_slug_taken[\s\S]*own_address = candidate AND id IS DISTINCT FROM for_tenant[\s\S]*own_address_held/)
    expect(MIGRATION).toMatch(/That quote link name is another business''s address/)
  })

  it('the live check is rate limited per business, and the database refuses a business that writes the field itself', () => {
    expect(RATE_LIMITS.address_check.length).toBeGreaterThan(0)
    const route = read('apps/web/src/app/api/tenant/address/route.ts')
    expect(route).toContain("checkRateLimit('address_check', { key: auth.tenantId })")
    expect(MIGRATION).toMatch(/auth\.jwt\(\) ->> 'role', 'service_role'\) <> 'service_role'[\s\S]*NEW\.own_address IS DISTINCT FROM OLD\.own_address/)
    expect(MIGRATION).toContain('ALTER TABLE own_address_changes ENABLE ROW LEVEL SECURITY')
    expect(MIGRATION).toContain('REVOKE ALL ON own_address_changes FROM anon, authenticated')
    expect(MIGRATION).not.toMatch(/CREATE POLICY/)
  })

  it('every address route works only for the signed-in business, and the admin route only for an admin', () => {
    const route = read('apps/web/src/app/api/tenant/address/route.ts')
    expect(route.match(/await requireTenant\(\)/g)).toHaveLength(3)
    expect(route).not.toMatch(/body\.tenantId|searchParams\.get\('tenant/)
    const admin = read('apps/web/src/app/api/admin/tenants/[tenantId]/address/route.ts')
    expect(admin.indexOf('await verifyAdmin()')).toBeGreaterThan(0)
    expect(admin.indexOf('await verifyAdmin()')).toBeLessThan(admin.indexOf('adminChangeAddress('))
    expect(admin).toContain("action: 'change_address'")
  })
})

describe('T-199: the admin’s change and the 90-day hold', () => {
  const NOW = new Date('2026-11-22T12:00:00Z')

  it('only the admin area changes a chosen address; the old name is held for 90 days and the change is logged', async () => {
    const w = world({ megan: { own_address: 'megan' } })
    const result = await adminChangeAddress(w.admin, 'tnt_megan', 'admin_1', 'megan-grant', 'asked by email', NOW)
    expect(result).toMatchObject({ ok: true, address: 'megan-grant', held: { address: 'megan' } })
    expect(w.megan().own_address).toBe('megan-grant')
    const [log] = w.tables.own_address_changes!
    expect(log).toMatchObject({ tenant_id: 'tnt_megan', old_address: 'megan', new_address: 'megan-grant', changed_from: 'admin', changed_by: 'admin_1', note: 'asked by email' })
    expect(ADDRESS_HOLD_DAYS).toBe(90)
    expect(new Date(log!.held_until as string).getTime() - NOW.getTime()).toBe(90 * 86_400_000)
  })

  it('nobody else can take the old name while it is held; the business that had it can; after 90 days it is free', async () => {
    const w = world({ megan: { own_address: 'megan' } })
    await adminChangeAddress(w.admin, 'tnt_megan', 'admin_1', 'megan-grant', '', new Date())
    expect((await checkAddress(w.admin, 'megan', 'tnt_dana', HOST)).state).toBe('taken')
    expect((await checkAddress(w.admin, 'megan', 'tnt_megan', HOST)).state).toBe('free')
    // 91 days on
    w.tables.own_address_changes![0]!.held_until = new Date(Date.now() - 86_400_000).toISOString()
    expect((await checkAddress(w.admin, 'megan', 'tnt_dana', HOST)).state).toBe('free')
  })

  it('the hold is written before the change, so the name is never free even for a moment', () => {
    const lib = read('apps/web/src/lib/own-address.ts')
    const change = lib.slice(lib.indexOf('export async function adminChangeAddress'))
    expect(change.indexOf("from('own_address_changes')")).toBeLessThan(change.indexOf(".update({ own_address: name"))
    expect(change).toContain(".delete().eq('id'") // and taken back if the change itself fails
  })

  it('the admin can remove an address (held the same way), and cannot give a taken or reserved one', async () => {
    const w = world({ megan: { own_address: 'megan' } })
    expect(await adminChangeAddress(w.admin, 'tnt_megan', 'admin_1', 'whitfield', '', NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await adminChangeAddress(w.admin, 'tnt_megan', 'admin_1', 'www', '', NOW)).toMatchObject({ ok: false, status: 400 })
    expect(w.megan().own_address).toBe('megan')
    expect(await adminChangeAddress(w.admin, 'tnt_megan', 'admin_1', null, 'closed', NOW)).toMatchObject({ ok: true, address: null, held: { address: 'megan' } })
    expect(w.megan()).toMatchObject({ own_address: null, own_address_chosen_at: null })
    // the same name again changes nothing and logs nothing
    const before = w.tables.own_address_changes!.length
    expect(await adminChangeAddress(w.admin, 'tnt_megan', 'admin_1', null, '', NOW)).toMatchObject({ ok: true, address: null, held: null })
    expect(w.tables.own_address_changes).toHaveLength(before)
  })
})

describe('T-199: serving, forwarding and coming back', () => {
  it('the Worker is told: serve for a business with Pro features, forward for one without, nothing for nobody’s address', async () => {
    const w = world({ megan: { own_address: 'megan' } })
    expect(await lookupAddress(w.admin, 'megan')).toEqual({ slug: 'megan-grant-painting', serve: true })
    expect(await lookupAddress(w.admin, 'nobody-here')).toBeNull()
    expect(await lookupAddress(w.admin, 'www')).toBeNull()
    expect(await lookupAddress(w.admin, 'megan-grant-painting')).toBeNull() // a quote-link name is not an address
  })

  it('when Pro features end the address forwards and stays the business’s own; on moving up it serves again', async () => {
    const w = world({ megan: { own_address: 'megan' } })
    for (const plan of [STARTER, { plan_id: 'plan_us_pro', status: 'canceled' }]) {
      w.tables.subscriptions!.splice(0, 1, { tenant_id: 'tnt_megan', ...plan })
      expect(await lookupAddress(w.admin, 'megan'), plan.status).toEqual({ slug: 'megan-grant-painting', serve: false })
      expect(w.megan().own_address).toBe('megan')
      // still reserved for it: nobody else can take it
      expect((await checkAddress(w.admin, 'megan', 'tnt_dana', HOST)).state).toBe('taken')
    }
    w.tables.subscriptions!.splice(0, 1, { tenant_id: 'tnt_megan', ...PRO })
    expect(await lookupAddress(w.admin, 'megan')).toEqual({ slug: 'megan-grant-painting', serve: true })
  })

  it('the free start’s address forwards when the free quotes run out', async () => {
    const w = world({ megan: { own_address: 'megan' }, meganPlan: null, used: 4 })
    expect((await lookupAddress(w.admin, 'megan'))?.serve).toBe(true)
    w.tables.usage_counters![0]!.estimates_created = 10
    expect((await lookupAddress(w.admin, 'megan'))?.serve).toBe(false)
  })

  it('a subdomain serves the public quote pages only: sign-in, dashboard and admin routes go to the main address', () => {
    expect(addressRoute('/')).toEqual({ kind: 'quote_page' })
    for (const path of ['/q/qte_123', '/api/public/quotes', '/api/public/widget/config', '/_next/static/chunks/main.js', '/room-model/abc', '/favicon.ico', '/brand/mark.svg']) {
      expect(addressRoute(path), path).toEqual({ kind: 'serve' })
    }
    for (const path of ['/app', '/app/quotes', '/admin', '/admin/tenants', '/login', '/signup', '/auth/callback', '/api/tenant', '/api/admin/tenants', '/api/billing', '/api/app/bootstrap', '/pricing', '/quote/someone-else', '/qr', '/approve/abc', '/q/../app', '/api/public/../admin', '//evil.example/q/']) {
      expect(addressRoute(path), path).toEqual({ kind: 'main' })
    }
  })

  it('which host is an address: one name under ours, never the main host or a deeper name', () => {
    expect(addressFromHost('megan.qolumns.com', HOST)).toBe('megan')
    expect(addressFromHost('Megan.Qolumns.com:443', HOST)).toBe('megan')
    expect(addressFromHost('megan.localhost:8799', 'localhost:8799')).toBe('megan')
    for (const host of ['qolumns.com', 'a.b.qolumns.com', 'megan.qolumns.com.evil.example', 'evilqolumns.com', '', null]) expect(addressFromHost(host, HOST), String(host)).toBeNull()
  })

  it('a customer on an address stays on it when the page moves them on; anywhere else the link is left alone', () => {
    const here = { host: 'megan.qolumns.com', origin: 'https://megan.qolumns.com' }
    expect(onSameAddress('https://qolumns.com/q/qte_1?token=abc', here, APP, HOST)).toBe('https://megan.qolumns.com/q/qte_1?token=abc')
    expect(onSameAddress('/q/qte_1?token=abc', here, APP, HOST)).toBe('/q/qte_1?token=abc')
    expect(onSameAddress('https://qolumns.com/app', here, APP, HOST)).toBe('https://qolumns.com/app')
    expect(onSameAddress('https://elsewhere.example/q/qte_1', here, APP, HOST)).toBe('https://elsewhere.example/q/qte_1')
    const main = { host: 'qolumns.com', origin: APP }
    expect(onSameAddress('https://qolumns.com/q/qte_1', main, APP, HOST)).toBe('https://qolumns.com/q/qte_1')
    expect(onSameAddress('https://qolumns.com/q/qte_1', here, APP, null)).toBe('https://qolumns.com/q/qte_1')
  })

  it('the caller’s own address is believed only with the key both sides hold', () => {
    const headers = (key: string | null, ip: string) => new Headers({ ...(key !== null && { [ADDRESS_PROXY_HEADERS.key]: key }), [ADDRESS_PROXY_HEADERS.ip]: ip, 'x-forwarded-for': '198.51.100.9' })
    expect(addressProxyCaller(headers('right-key', '203.0.113.7'), 'right-key')).toBe('203.0.113.7')
    expect(addressProxyCaller(headers('wrong-key', '203.0.113.7'), 'right-key')).toBeNull()
    expect(addressProxyCaller(headers(null, '203.0.113.7'), 'right-key')).toBeNull()
    expect(addressProxyCaller(headers('', '203.0.113.7'), '')).toBeNull() // no key configured: nobody is believed
    expect(addressProxyCaller(headers('right-key', 'not an address; drop table'), 'right-key')).toBeNull()
    // the limiter counts the customer, not the Worker; without the key it counts what Vercel saw
    process.env.ADDRESS_PROXY_KEY = 'right-key'
    expect(getClientIp({ headers: headers('right-key', '203.0.113.7') })).toBe('203.0.113.7')
    expect(getClientIp({ headers: headers('wrong-key', '203.0.113.7') })).toBe('198.51.100.9')
    delete process.env.ADDRESS_PROXY_KEY
    expect(getClientIp({ headers: headers('right-key', '203.0.113.7') })).toBe('198.51.100.9')
    expect(read('apps/web/src/middleware.ts')).toContain('addressProxyCaller(request.headers, process.env.ADDRESS_PROXY_KEY)')
  })
})

describe('T-199: showing', () => {
  const row = (own_address: string | null, later: string | null = null) => ({ slug: 'megan-grant-painting', own_address, own_address_later_at: later })
  const on = (subscription: MemRow | null, used = 0) => businessAccess({ subscription, region: 'US', quotesUsed: used })

  it('with an address and Pro features: the address is the main link, the quote link "Also works"', () => {
    const links = businessLinks({ appUrl: APP, slug: 'megan-grant-painting', ownAddress: 'megan', canUseAddress: true, host: HOST })
    expect(links).toEqual({ main: 'https://megan.qolumns.com', also: 'https://qolumns.com/quote/megan-grant-painting', quoteLink: 'https://qolumns.com/quote/megan-grant-painting', addressHostname: 'megan.qolumns.com' })
    expect(ADDRESS_COPY.alsoWorks).toBe('Also works')
    expect(addressUrl('megan', 'localhost:8799', 'http://localhost:3000')).toBe('http://megan.localhost:8799')
    const view = addressViewOf(row('megan'), on(PRO), HOST, APP)
    expect(view).toMatchObject({ canChoose: false, planLine: null, tag: null, links: { main: 'https://megan.qolumns.com' } })
  })

  it('the quote link is the main link whenever any of the three is missing, and it always works', () => {
    const quoteLink = 'https://qolumns.com/quote/megan-grant-painting'
    for (const input of [
      { ownAddress: null, canUseAddress: true, host: HOST },
      { ownAddress: 'megan', canUseAddress: false, host: HOST },
      { ownAddress: 'megan', canUseAddress: true, host: null },
    ]) {
      expect(businessLinks({ appUrl: APP, slug: 'megan-grant-painting', ...input })).toEqual({ main: quoteLink, also: null, quoteLink, addressHostname: null })
    }
    // the quote page itself is untouched by this ticket: no plan stands in front of /quote/<name>
    expect(read('apps/web/src/lib/quote-link.ts')).not.toMatch(/own_address|canUse|loadAccess/)
    expect(read('apps/web/src/app/quote/[slug]/page.tsx')).not.toMatch(/own_address|canUse|loadAccess/)
  })

  it('Pro features and no address: the card, pre-filled with the quote-link name; "Later" is remembered', () => {
    const view = addressViewOf(row(null), on(PRO), HOST, APP)
    expect(view).toMatchObject({ live: true, canChoose: true, later: false, suggested: 'megan-grant-painting', planLine: null, tag: null })
    expect(view.links.main).toBe('https://qolumns.com/quote/megan-grant-painting')
    expect(addressViewOf(row(null, '2026-11-22T10:00:00Z'), on(PRO), HOST, APP)).toMatchObject({ canChoose: true, later: true })
    // Home hides it after "Later"; the Quote link page keeps it
    expect(read('apps/web/src/components/home/HomeAddressCard.tsx')).toContain('!view.canChoose || view.later')
    expect(read('apps/web/src/components/share/SharePageClient.tsx')).toContain('address?.canChoose && <OwnAddressCard')
    // and it comes back on Home when a plan that includes it starts
    expect(read('apps/web/src/lib/billing-sync.ts')).toMatch(/gives\(decision\.row[^\n]*&& !gives\(existing\)\) await offerAddressAgain\(/)
  })

  it('the free start: the card, with the tag of the plan that keeps it', () => {
    expect(addressViewOf(row(null), on(null, 2), HOST, APP)).toMatchObject({ canChoose: true, tag: 'Pro', planLine: null })
  })

  it('Starter: the normal link and one quiet line; a business with no plan at all is told nothing', () => {
    const starter = addressViewOf(row(null), on(STARTER), HOST, APP)
    expect(starter).toMatchObject({ canChoose: false, tag: null, planLine: 'Get your own address, like megan-grant-painting.qolumns.com, on Pro.' })
    expect(addressViewOf(row(null), on(null, 10), HOST, APP)).toMatchObject({ canChoose: false, planLine: null })
    // a business that chose one and then moved to Starter keeps it reserved, and is shown its quote link
    expect(addressViewOf(row('megan'), on(STARTER), HOST, APP).links).toMatchObject({ main: 'https://qolumns.com/quote/megan-grant-painting', also: null })
    // the line is the website dashboard's only: nothing of it is in the app
    for (const file of ['apps/mobile/app/(tabs)/account.tsx', 'apps/mobile/app/link.tsx']) expect(read(file), file).not.toMatch(/onPlan|planLine\b.*address|Get your own address/)
  })

  it('the confirm step says it is for good, and the buttons name the address', () => {
    expect(ADDRESS_COPY.cardHeading).toBe('Choose your own address')
    expect(ADDRESS_COPY.confirmText).toBe("This is your address for good. You can't change it yourself later.")
    expect(ADDRESS_COPY.use('bluum.qolumns.com')).toBe('Use bluum.qolumns.com')
    expect(ADDRESS_COPY.back).toBe('Back')
    expect(ADDRESS_COPY.later).toBe('Later')
    const card = read('apps/web/src/components/share/OwnAddressCard.tsx')
    expect(card).toContain('ADDRESS_COPY.confirmText')
    expect(card).toContain('ADDRESS_COPY.use(hostname)')
    expect(card).not.toMatch(/accent/) // nothing in the dashboard is yellow
  })
})
