/**
 * T-199: the Worker that serves businesses' own addresses (src/addresses.ts,
 * whose rules are src/address-handler.ts).
 * The rules run here with a stand-in for the main site: what is served, what
 * is forwarded, what never crosses, and that nothing is served without the key.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADDRESS_PROXY_HEADERS } from '@qolumns/shared'
import { LOOKUP_SECONDS, handleAddress, type AddressDeps, type AddressEnv } from '../address-handler'

const ENV: AddressEnv = { MAIN_ORIGIN: 'https://qolumns.com', ADDRESS_HOST: 'qolumns.com', ADDRESS_PROXY_KEY: 'the-key' }

interface Call {
  url: string
  init?: RequestInit
}

/** The main site: knows two addresses, and answers pages with a cookie it must never get through */
function mainSite(over: { lookupStatus?: number; pageStatus?: number; location?: string; fail?: boolean } = {}) {
  const calls: Call[] = []
  const known: Record<string, { slug: string; serve: boolean }> = {
    megan: { slug: 'megan-grant-painting', serve: true },
    dana: { slug: 'whitfield-roofing', serve: false },
  }
  const fetch: AddressDeps['fetch'] = async (url, init) => {
    calls.push({ url, init })
    if (over.fail) throw new Error('network')
    const lookup = /\/api\/public\/address\/([^/?]+)$/.exec(url)
    if (lookup) {
      if (over.lookupStatus) return new Response('{}', { status: over.lookupStatus })
      const found = known[decodeURIComponent(lookup[1]!)]
      return found ? Response.json(found) : Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    }
    const headers = new Headers({ 'content-type': 'text/html', 'set-cookie': 'sb-session=secret; Path=/' })
    if (over.location) headers.set('location', over.location)
    return new Response(over.location ? null : `<html>page ${new URL(url).pathname}</html>`, { status: over.pageStatus ?? (over.location ? 307 : 200), headers })
  }
  return { calls, deps: { fetch } as AddressDeps, pages: () => calls.filter((c) => !c.url.includes('/api/public/address/')) }
}

const ask = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(url, { ...init, headers: { host: new URL(url).host, 'cf-connecting-ip': '203.0.113.7', ...init.headers } })

describe('T-199: an address shows the business’s quote page', () => {
  it('the address itself is the quote page, fetched from the main site and answered here: not a redirect', async () => {
    const site = mainSite()
    const response = await handleAddress(ask('https://megan.qolumns.com/'), ENV, site.deps)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('page /quote/megan-grant-painting')
    expect(site.pages().map((c) => c.url)).toEqual(['https://qolumns.com/quote/megan-grant-painting'])
    expect(response.headers.get('location')).toBeNull()
  })

  it('the query goes with it (the owner’s test link)', async () => {
    const site = mainSite()
    await handleAddress(ask('https://megan.qolumns.com/?test=abc'), ENV, site.deps)
    expect(site.pages()[0]!.url).toBe('https://qolumns.com/quote/megan-grant-painting?test=abc')
  })

  it('everything under the quote page works there: the estimate, what the pages load, the public API', async () => {
    for (const path of ['/q/qte_1?token=t', '/_next/static/chunks/app.js', '/api/public/widget/config?tenantKey=k', '/room-model/m1', '/favicon.ico']) {
      const site = mainSite()
      const response = await handleAddress(ask(`https://megan.qolumns.com${path}`), ENV, site.deps)
      expect(response.status, path).toBe(200)
      expect(site.pages()[0]!.url, path).toBe(`https://qolumns.com${path}`)
    }
  })

  it('a customer’s request is passed on with its method and body', async () => {
    const site = mainSite()
    await handleAddress(ask('https://megan.qolumns.com/api/public/quotes', { method: 'POST', body: JSON.stringify({ serviceId: 's1' }), headers: { 'content-type': 'application/json' } }), ENV, site.deps)
    const sent = site.pages()[0]!
    expect(sent.url).toBe('https://qolumns.com/api/public/quotes')
    expect(sent.init?.method).toBe('POST')
    expect(sent.init?.body).toBeTruthy()
  })

  it('a redirect of the main site’s to a served page stays on the address', async () => {
    const site = mainSite({ location: 'https://qolumns.com/q/qte_9?token=abc' })
    const response = await handleAddress(ask('https://megan.qolumns.com/q/qte_old'), ENV, site.deps)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://megan.qolumns.com/q/qte_9?token=abc')
    const away = mainSite({ location: '/login?next=%2Fapp' })
    const out = await handleAddress(ask('https://megan.qolumns.com/q/qte_old'), ENV, away.deps)
    expect(out.headers.get('location')).toBe('https://qolumns.com/login?next=%2Fapp')
  })
})

describe('T-199: what an address never does', () => {
  it('sign-in, dashboard and admin routes are refused on a subdomain: a redirect to the main address, nothing fetched', async () => {
    for (const path of ['/app', '/app/quotes/qte_1', '/admin', '/admin/tenants', '/login', '/signup', '/auth/callback?code=1', '/api/tenant', '/api/admin/tenants', '/api/app/bootstrap', '/api/billing/portal', '/pricing', '/quote/whitfield-roofing']) {
      const site = mainSite()
      const response = await handleAddress(ask(`https://megan.qolumns.com${path}`), ENV, site.deps)
      expect(response.status, path).toBe(302)
      expect(response.headers.get('location'), path).toBe(`https://qolumns.com${path}`)
      expect(site.calls, path).toEqual([]) // not even the lookup
    }
  })

  it('no cookie crosses in either direction, and nothing that says who the caller is, except their address with the key', async () => {
    const site = mainSite()
    const response = await handleAddress(ask('https://megan.qolumns.com/', { headers: { cookie: 'sb-session=mine', authorization: 'Bearer token', 'x-forwarded-for': '10.0.0.1', [ADDRESS_PROXY_HEADERS.ip]: '10.9.9.9', [ADDRESS_PROXY_HEADERS.key]: 'guess' } }), ENV, site.deps)
    expect(response.headers.get('set-cookie')).toBeNull()
    const sent = new Headers(site.pages()[0]!.init?.headers)
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('authorization')).toBeNull()
    expect(sent.get('x-forwarded-for')).toBeNull()
    expect(sent.get('host')).toBeNull()
    // the caller cannot name their own address or key: the Worker writes both
    expect(sent.get(ADDRESS_PROXY_HEADERS.ip)).toBe('203.0.113.7')
    expect(sent.get(ADDRESS_PROXY_HEADERS.key)).toBe('the-key')
  })

  it('it only ever fetches the main site', async () => {
    for (const url of ['https://megan.qolumns.com/q/x', 'https://megan.qolumns.com//evil.example/q/', 'https://megan.qolumns.com/q/..%2F..%2Fapp']) {
      const site = mainSite()
      await handleAddress(ask(url), ENV, site.deps)
      for (const call of site.calls) expect(call.url.startsWith('https://qolumns.com/'), call.url).toBe(true)
    }
  })
})

describe('T-199: forwarding', () => {
  it('a business without Pro features: a 302 to its quote link (never permanent: it serves again on moving up)', async () => {
    const site = mainSite()
    const response = await handleAddress(ask('https://dana.qolumns.com/?utm=1'), ENV, site.deps)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://qolumns.com/quote/whitfield-roofing?utm=1')
    expect(site.pages()).toEqual([])
    const estimate = await handleAddress(ask('https://dana.qolumns.com/q/qte_1?token=t'), ENV, mainSite().deps)
    expect(estimate.headers.get('location')).toBe('https://qolumns.com/q/qte_1?token=t')
  })

  it('nobody’s address: a 302 to the main site', async () => {
    const response = await handleAddress(ask('https://nobody-here.qolumns.com/'), ENV, mainSite().deps)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://qolumns.com')
  })

  it('a deeper name, or a host that is not ours, is not an address: the same path on the main site', async () => {
    for (const host of ['a.b.qolumns.com', 'megan.elsewhere.example']) {
      const site = mainSite()
      const response = await handleAddress(new Request(`https://${host}/pricing`, { headers: { host } }), ENV, site.deps)
      expect(response.status, host).toBe(302)
      expect(response.headers.get('location'), host).toBe('https://qolumns.com/pricing')
      expect(site.calls).toEqual([])
    }
  })

  it('without the key it serves nothing: every address forwards to its quote link, which always works', async () => {
    for (const key of [undefined, '', '  ']) {
      const site = mainSite()
      const response = await handleAddress(ask('https://megan.qolumns.com/'), { ...ENV, ADDRESS_PROXY_KEY: key }, site.deps)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('https://qolumns.com/quote/megan-grant-painting')
      expect(site.pages()).toEqual([])
    }
  })

  it('when the main site cannot be asked, the customer is told to try again: never sent somewhere wrong', async () => {
    for (const site of [mainSite({ lookupStatus: 500 }), mainSite({ fail: true })]) {
      const response = await handleAddress(ask('https://megan.qolumns.com/'), ENV, site.deps)
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('10')
    }
  })
})

describe('T-199: the look-up is kept for a minute', () => {
  it('one question to the main site per address per minute in a data centre', async () => {
    const kept = new Map<string, Response>()
    const cache: AddressDeps['cache'] = { match: async (key) => kept.get(key)?.clone(), put: async (key, response) => void kept.set(key, response) }
    const site = mainSite()
    for (let i = 0; i < 3; i++) await handleAddress(ask('https://megan.qolumns.com/'), ENV, { ...site.deps, cache })
    expect(site.calls.filter((c) => c.url.includes('/api/public/address/'))).toHaveLength(1)
    expect(site.pages()).toHaveLength(3)
    expect([...kept.values()][0]!.headers.get('cache-control')).toBe(`public, max-age=${LOOKUP_SECONDS}`)
    expect(LOOKUP_SECONDS).toBe(60)
  })

  it('"nobody’s address" is kept too; a failed look-up is not', async () => {
    const kept = new Map<string, Response>()
    const cache: AddressDeps['cache'] = { match: async (key) => kept.get(key)?.clone(), put: async (key, response) => void kept.set(key, response) }
    await handleAddress(ask('https://nobody-here.qolumns.com/'), ENV, { ...mainSite().deps, cache })
    expect(kept.size).toBe(1)
    await handleAddress(ask('https://megan.qolumns.com/'), ENV, { ...mainSite({ lookupStatus: 500 }).deps, cache })
    expect(kept.size).toBe(1)
  })
})

describe('T-199: its settings', () => {
  const toml = readFileSync(join(__dirname, '../../wrangler.addresses.toml'), 'utf8')

  it('a Worker of its own on *.qolumns.com/*, with no queue, bucket or database, and no secret in the file', () => {
    expect(toml).toContain('name = "qolumns-addresses"')
    expect(toml).toContain('main = "src/addresses.ts"')
    expect(toml).toContain('routes = [{ pattern = "*.qolumns.com/*", zone_name = "qolumns.com" }]')
    expect(toml).not.toMatch(/r2_buckets|queues|SUPABASE|kv_namespaces/)
    expect(toml).not.toMatch(/^\s*ADDRESS_PROXY_KEY\s*=/m)
    for (const file of ['../addresses.ts', '../address-handler.ts']) {
      expect(readFileSync(join(__dirname, file), 'utf8'), file).not.toMatch(/supabase|createClient|console\.log\(/i)
    }
    // the entry file exports its handler and nothing else: the Workers runtime refuses to start it otherwise
    const entry = readFileSync(join(__dirname, '../addresses.ts'), 'utf8')
    expect(entry.match(/^export /gm)).toEqual(['export '])
    expect(entry).toContain('export default {')
  })
})
