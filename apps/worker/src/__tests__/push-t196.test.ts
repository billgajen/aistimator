/**
 * T-196: the worker tells the business's phones about a customer's new
 * request, through the shared rule (packages/shared/src/push.ts) over the
 * worker's own database client. The rule itself is tested in the web app's
 * push-t196 test; this holds the worker's store and its hooks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXPO_PUSH_BASE_URL } from '@qolumns/shared'
import { notifyPhones } from '../push'

interface Tables {
  quote: Record<string, unknown> | null
  devices: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  deleted: string[]
  updated: Array<{ token: string; values: Record<string, unknown> }>
}

/** Just enough of the database client for the push store */
function database(tables: Tables) {
  return {
    from(table: string) {
      if (table === 'quotes') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tables.quote }) }) }) }
      }
      if (table === 'push_events') {
        return {
          insert: async (row: Record<string, unknown>) => {
            const taken = tables.events.some((e) => e.quote_id === row.quote_id && e.event_key === row.event_key)
            if (taken) return { error: { code: '23505' } }
            tables.events.push(row)
            return { error: null }
          },
        }
      }
      return {
        select: () => ({ eq: () => ({ limit: async () => ({ data: tables.devices.filter((d) => !tables.deleted.includes(d.token as string)) }) }) }),
        delete: () => ({
          in: async (_column: string, tokens: string[]) => {
            tables.deleted.push(...tokens)
            return { error: null }
          },
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async (_column: string, token: string) => {
            tables.updated.push({ token, values })
            return { error: null }
          },
        }),
      }
    },
  } as never
}

const quote = (over: Record<string, unknown> = {}) => ({
  id: 'qte_t196',
  tenant_id: 'tnt_t196',
  customer_json: { name: 'Jordan Reyes', email: 'jordan.reyes@example.test', phone: '+1 555 0177' },
  pricing_json: { total: 380, currency: 'USD' },
  is_test: false,
  is_demo: false,
  tenant: { region: 'US', currency: 'USD', is_demo: false },
  service: { name: 'Pressure washing' },
  request: { source_json: { type: 'widget' } },
  ...over,
})
const phone = (n: number, over: Record<string, unknown> = {}) => ({ token: `ExponentPushToken[w${n}]`, platform: 'ios', notify_new_request: true, notify_accepted: true, notify_question: true, last_ticket_id: null, ...over })
const tables = (over: Partial<Tables> = {}): Tables => ({ quote: quote(), devices: [phone(1)], events: [], deleted: [], updated: [], ...over })

function pushService(answer: (to: string) => unknown = () => ({ status: 'ok', id: 'ticket-1' })) {
  const posts: Array<{ url: string; body: unknown }> = []
  const doFetch = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as unknown
    posts.push({ url, body })
    return { ok: true, status: 200, json: async () => ({ data: Array.isArray(body) ? body.map((m: { to: string }) => answer(m.to)) : {} }) }
  }) as unknown as typeof fetch
  return { posts, doFetch }
}

afterEach(() => vi.restoreAllMocks())

describe('T-196: the worker and the phones', () => {
  it('a customer\'s new request is sent to the business\'s phones, without the customer\'s details', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const t = tables({ devices: [phone(1), phone(2, { notify_new_request: false })] })
    const service = pushService()
    const result = await notifyPhones(database(t), { ENVIRONMENT: 'production' }, 'new_request', 'qte_t196', service.doFetch)
    expect(result).toEqual({ sent: 1, failed: 0, removed: 0 })
    expect(service.posts).toHaveLength(1)
    expect(service.posts[0]?.url).toBe(`${EXPO_PUSH_BASE_URL}/send`)
    expect(service.posts[0]?.body).toEqual([
      { to: 'ExponentPushToken[w1]', body: 'New request from Jordan Reyes: Pressure washing', data: { quoteId: 'qte_t196', event: 'new_request' }, sound: 'default', channelId: 'quotes', priority: 'high' },
    ])
    const sent = JSON.stringify(service.posts)
    expect(sent).not.toContain('example.test')
    expect(sent).not.toContain('555')
    // the event is recorded, and the ticket kept for the next time
    expect(t.events).toEqual([{ tenant_id: 'tnt_t196', quote_id: 'qte_t196', event_key: 'new_request' }])
    expect(t.updated).toEqual([{ token: 'ExponentPushToken[w1]', values: { last_ticket_id: 'ticket-1' } }])
  })

  it('the same request priced again notifies no one', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const t = tables()
    const service = pushService()
    await notifyPhones(database(t), {}, 'new_request', 'qte_t196', service.doFetch)
    const again = await notifyPhones(database(t), {}, 'new_request', 'qte_t196', service.doFetch)
    expect(again).toMatchObject({ sent: 0, skipped: 'already_sent' })
    expect(service.posts).toHaveLength(1)
  })

  it('a quote the business made in its own app, a setup test and the demo notify no one', async () => {
    for (const row of [quote({ request: [{ source_json: { type: 'app' } }] }), quote({ is_test: true }), quote({ tenant: { region: 'US', is_demo: true } })]) {
      const t = tables({ quote: row })
      const service = pushService()
      expect(await notifyPhones(database(t), {}, 'new_request', 'qte_t196', service.doFetch)).toMatchObject({ sent: 0, skipped: 'not_notified' })
      expect(service.posts).toHaveLength(0)
      expect(t.events).toHaveLength(0)
    }
  })

  it('a token the push service says is dead is deleted', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const t = tables({ devices: [phone(1), phone(2)] })
    const service = pushService((to) => (to.includes('w2') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'ticket-1' }))
    expect(await notifyPhones(database(t), {}, 'new_request', 'qte_t196', service.doFetch)).toEqual({ sent: 1, failed: 0, removed: 1 })
    expect(t.deleted).toEqual(['ExponentPushToken[w2]'])
  })

  it('a push service that cannot be reached, or a database that throws, never stops the quote', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const down = (async () => {
      throw new TypeError('fetch failed: token=secret-value')
    }) as unknown as typeof fetch
    await expect(notifyPhones(database(tables()), {}, 'new_request', 'qte_t196', down)).resolves.toEqual({ sent: 0, failed: 1, removed: 0 })
    const broken = { from: () => { throw new Error('database is away') } } as never
    await expect(notifyPhones(broken, {}, 'new_request', 'qte_t196', down)).resolves.toMatchObject({ skipped: 'error' })
    // the error's name only, and never a name or a token
    const logged = quiet.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('qte_t196')
    for (const secret of ['secret-value', 'Jordan', 'ExponentPushToken']) expect(logged).not.toContain(secret)
  })

  it('a stand-in for the push service is used in development only', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const standIn = 'http://127.0.0.1:8792/push'
    const urls: string[] = []
    for (const ENVIRONMENT of ['development', 'staging', 'production', undefined]) {
      const service = pushService()
      await notifyPhones(database(tables()), { ENVIRONMENT, EXPO_PUSH_BASE_URL: standIn }, 'new_request', 'qte_t196', service.doFetch)
      urls.push(service.posts[0]?.url ?? '')
    }
    expect(urls).toEqual([`${standIn}/send`, `${EXPO_PUSH_BASE_URL}/send`, `${EXPO_PUSH_BASE_URL}/send`, `${EXPO_PUSH_BASE_URL}/send`])
  })

  it('the phones are told where the business is emailed: after pricing, and when a request cannot be priced', () => {
    const read = (file: string) => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
    const processor = read('quote-processor.ts')
    const call = processor.indexOf("await notifyPhones(supabase, env, 'new_request', quoteId)")
    expect(call).toBeGreaterThan(processor.indexOf('// 7. Send notification emails'))
    expect(call).toBeLessThan(processor.indexOf('const result = await sendReviewRequestEmail('))
    expect(processor.match(/notifyPhones\(/g)).toHaveLength(1)
    expect(read('failed-quote.ts')).toContain("if (quote) await notifyPhones(supabase, env, 'new_request', quoteId)")
  })
})
