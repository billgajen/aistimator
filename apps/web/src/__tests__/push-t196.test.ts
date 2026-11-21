/**
 * T-196: the phone's notifications. The rule is one shared function used by
 * the web app and the worker; it is tested here against a store and a push
 * service held in memory.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BUSINESS_REQUEST_SOURCES,
  DEFAULT_PUSH_PREFS,
  EXPO_PUSH_BASE_URL,
  PUSH_ANDROID_CHANNEL,
  PUSH_EVENTS,
  deadFromReceipts,
  devicesFor,
  isExpoPushToken,
  isPushPlatform,
  pushBody,
  pushEventKey,
  pushMessages,
  quoteIdFromPushData,
  readTickets,
  sendBusinessPush,
  shouldNotify,
  type ExpoTicket,
  type PushDevice,
  type PushPrefs,
  type PushQuoteFacts,
  type PushStore,
} from '@qolumns/shared'
import { prefColumns, prefsOfRow } from '@/lib/push'

const token = (n: number) => `ExponentPushToken[device${n}]`
const device = (n: number, prefs: Partial<PushPrefs> = {}, lastTicketId: string | null = null): PushDevice => ({
  token: token(n),
  platform: 'ios',
  prefs: { ...DEFAULT_PUSH_PREFS, ...prefs },
  lastTicketId,
})

const FACTS: PushQuoteFacts = {
  quoteId: 'qte_t196',
  tenantId: 'tnt_t196',
  customerName: 'Megan Grant',
  serviceName: 'Fence installation',
  total: 4190,
  currency: 'USD',
  locale: 'en-US',
  isTest: false,
  isDemo: false,
  requestSource: { type: 'widget' },
}
/** What the customer typed and where they live: none of it may reach a notification */
const PRIVATE = { message: 'Can you come before 8am? The gate code is 4417.', address: '12 Alder Close', phone: '+1 555 0142', email: 'megan.grant@example.test' }

interface World {
  facts: PushQuoteFacts | null
  devices: PushDevice[]
  claimed: Set<string>
  removed: string[]
  tickets: Array<{ token: string; ticketId: string }>
  posts: Array<{ url: string; headers: Record<string, string>; body: unknown }>
  logs: string[]
  /** What the push service answers to a send, per token; default "ok" */
  answer: (to: string) => ExpoTicket
  receipts: Record<string, ExpoTicket>
  down?: boolean
}

function world(over: Partial<World> = {}): World {
  return { facts: FACTS, devices: [device(1)], claimed: new Set(), removed: [], tickets: [], posts: [], logs: [], answer: (to) => ({ status: 'ok', id: `ticket-${to}` }), receipts: {}, ...over }
}

function sender(w: World, accessToken?: string) {
  const store: PushStore = {
    quote: async () => w.facts,
    devices: async () => w.devices.filter((d) => !w.removed.includes(d.token)),
    claim: async (_tenant, quoteId, key) => {
      const id = `${quoteId}/${key}`
      if (w.claimed.has(id)) return false
      w.claimed.add(id)
      return true
    },
    removeTokens: async (tokens) => {
      w.removed.push(...tokens)
    },
    saveTickets: async (tickets) => {
      w.tickets.push(...tickets)
    },
  }
  return {
    store,
    accessToken,
    log: (line: string) => w.logs.push(line),
    fetch: async (url: string, init: { headers: Record<string, string>; body: string }) => {
      if (w.down) throw new TypeError('fetch failed')
      const body = JSON.parse(init.body) as unknown
      w.posts.push({ url, headers: init.headers, body })
      const data = url.endsWith('/getReceipts') ? w.receipts : (body as Array<{ to: string }>).map((m) => w.answer(m.to))
      return { ok: true, status: 200, json: async () => ({ data }) }
    },
  }
}
const sends = (w: World) => w.posts.filter((p) => p.url.endsWith('/send')).flatMap((p) => p.body as Array<{ to: string; body: string; data: unknown }>)

describe('T-196: three notifications, and what each says', () => {
  it('the three sentences', () => {
    expect(PUSH_EVENTS).toEqual(['new_request', 'accepted', 'question'])
    expect(pushBody('new_request', FACTS)).toBe('New request from Megan Grant: Fence installation')
    expect(pushBody('accepted', FACTS)).toBe('Megan Grant accepted your estimate: $4,190.00')
    expect(pushBody('question', FACTS)).toBe('Megan Grant asked a question about their estimate')
  })

  it('the total is in the business\'s currency; no name is "A customer"; no total is no total', () => {
    expect(pushBody('accepted', { ...FACTS, currency: 'GBP', locale: 'en-GB' })).toBe('Megan Grant accepted your estimate: £4,190.00')
    expect(pushBody('new_request', { ...FACTS, customerName: '  ', serviceName: null })).toBe('New request from A customer: a service')
    expect(pushBody('accepted', { ...FACTS, total: 0 })).toBe('Megan Grant accepted your estimate')
    // a name is one line, and not endless
    expect(pushBody('question', { ...FACTS, customerName: `Dana\nWhitfield ${'x'.repeat(200)}` }).length).toBeLessThan(110)
  })

  it('a notification carries the quote\'s id and the event, and nothing about the customer', () => {
    const [message] = pushMessages('question', { ...FACTS, ...PRIVATE } as PushQuoteFacts, [device(1)])
    expect(message).toEqual({
      to: token(1),
      body: 'Megan Grant asked a question about their estimate',
      data: { quoteId: 'qte_t196', event: 'question' },
      sound: 'default',
      channelId: PUSH_ANDROID_CHANNEL.id,
      priority: 'high',
    })
    const sent = JSON.stringify(pushMessages('accepted', { ...FACTS, ...PRIVATE } as PushQuoteFacts, [device(1)]))
    for (const secret of Object.values(PRIVATE)) expect(sent).not.toContain(secret)
    expect(sent).not.toMatch(/@|\+1 555|Alder/)
  })

  it('tapping one opens that quote: the id is read back from its data, and nothing else is trusted', () => {
    expect(quoteIdFromPushData({ quoteId: 'qte_t196', event: 'accepted' })).toBe('qte_t196')
    expect(quoteIdFromPushData({ quoteId: '../login' })).toBeNull()
    expect(quoteIdFromPushData({})).toBeNull()
    expect(quoteIdFromPushData('qte_t196')).toBeNull()
    expect(quoteIdFromPushData(null)).toBeNull()
  })
})

describe('T-196: who is notified', () => {
  it('a request the business made itself never notifies; a customer accepting or asking about it does', () => {
    for (const type of BUSINESS_REQUEST_SOURCES) {
      expect(shouldNotify('new_request', { requestSource: { type } })).toBe(false)
      expect(shouldNotify('accepted', { requestSource: { type } })).toBe(true)
      expect(shouldNotify('question', { requestSource: { type } })).toBe(true)
    }
    for (const type of ['widget', 'whatsapp', 'link', undefined]) expect(shouldNotify('new_request', { requestSource: type ? { type } : null })).toBe(true)
  })

  it('a setup test and the public demo notify no one', () => {
    for (const event of PUSH_EVENTS) {
      expect(shouldNotify(event, { isTest: true })).toBe(false)
      expect(shouldNotify(event, { isDemo: true })).toBe(false)
    }
  })

  it('each of the three switches turns off its own notification and no other', () => {
    const devices = [device(1), device(2, { newRequest: false }), device(3, { accepted: false }), device(4, { question: false })]
    expect(devicesFor('new_request', devices).map((d) => d.token)).toEqual([token(1), token(3), token(4)])
    expect(devicesFor('accepted', devices).map((d) => d.token)).toEqual([token(1), token(2), token(4)])
    expect(devicesFor('question', devices).map((d) => d.token)).toEqual([token(1), token(2), token(3)])
  })

  it('all three are on until the user turns one off; the table\'s columns and the switches agree', () => {
    expect(DEFAULT_PUSH_PREFS).toEqual({ newRequest: true, accepted: true, question: true })
    expect(prefsOfRow({})).toEqual(DEFAULT_PUSH_PREFS)
    expect(prefsOfRow({ notify_new_request: false, notify_accepted: true, notify_question: null })).toEqual({ newRequest: false, accepted: true, question: true })
    expect(prefColumns({ question: false })).toEqual({ notify_question: false })
    expect(prefColumns({ newRequest: true, accepted: false, question: true })).toEqual({ notify_new_request: true, notify_accepted: false, notify_question: true })
    expect(prefColumns({ nonsense: true } as never)).toEqual({})
  })

  it('one phone is told once, and a row that is not a push token is never sent to', () => {
    expect(devicesFor('accepted', [device(1), device(1), { ...device(2), token: 'https://example.test/hook' }]).map((d) => d.token)).toEqual([token(1)])
    expect(isExpoPushToken('ExponentPushToken[abc-DEF_123]')).toBe(true)
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true)
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false)
    expect(isExpoPushToken('abc')).toBe(false)
    expect(isExpoPushToken(`ExponentPushToken[${'a'.repeat(300)}]`)).toBe(false)
    expect(isPushPlatform('ios')).toBe(true)
    expect(isPushPlatform('android')).toBe(true)
    expect(isPushPlatform('web')).toBe(false)
  })
})

describe('T-196: sending', () => {
  it('a new request reaches every phone of the business whose switch is on', async () => {
    const w = world({ devices: [device(1), device(2), device(3, { newRequest: false })] })
    const result = await sendBusinessPush(sender(w), 'new_request', 'qte_t196')
    expect(result).toEqual({ sent: 2, failed: 0, removed: 0 })
    expect(sends(w).map((m) => m.to)).toEqual([token(1), token(2)])
    expect(sends(w)[0]?.body).toBe('New request from Megan Grant: Fence installation')
    expect(w.posts[0]?.url).toBe(`${EXPO_PUSH_BASE_URL}/send`)
    // the ticket ids are kept, to ask later whether each phone is still there
    expect(w.tickets.map((t) => t.token)).toEqual([token(1), token(2)])
  })

  it('one notification per event: a repriced or re-sent request sends nothing more', async () => {
    const w = world()
    expect((await sendBusinessPush(sender(w), 'new_request', 'qte_t196')).sent).toBe(1)
    const again = await sendBusinessPush(sender(w), 'new_request', 'qte_t196')
    expect(again).toMatchObject({ sent: 0, skipped: 'already_sent' })
    expect(sends(w)).toHaveLength(1)
    // the acceptance of the same quote is another event
    expect((await sendBusinessPush(sender(w), 'accepted', 'qte_t196')).sent).toBe(1)
    expect((await sendBusinessPush(sender(w), 'accepted', 'qte_t196')).skipped).toBe('already_sent')
  })

  it('each question is its own event; the same question twice is one', async () => {
    const w = world()
    expect(pushEventKey('question', 'fb_1')).toBe('question:fb_1')
    expect(pushEventKey('new_request', 'anything')).toBe('new_request')
    expect((await sendBusinessPush(sender(w), 'question', 'qte_t196', 'fb_1')).sent).toBe(1)
    expect((await sendBusinessPush(sender(w), 'question', 'qte_t196', 'fb_2')).sent).toBe(1)
    expect((await sendBusinessPush(sender(w), 'question', 'qte_t196', 'fb_1')).skipped).toBe('already_sent')
    expect(sends(w)).toHaveLength(2)
  })

  it('a request the business made, a setup test and a demo send nothing and claim nothing', async () => {
    for (const facts of [{ ...FACTS, requestSource: { type: 'app' } }, { ...FACTS, isTest: true }, { ...FACTS, isDemo: true }]) {
      const w = world({ facts })
      expect(await sendBusinessPush(sender(w), 'new_request', 'qte_t196')).toMatchObject({ sent: 0, skipped: 'not_notified' })
      expect(w.posts).toHaveLength(0)
      expect(w.claimed.size).toBe(0)
    }
  })

  it('a business with no phone registered sends nothing and claims nothing', async () => {
    const w = world({ devices: [] })
    expect(await sendBusinessPush(sender(w), 'accepted', 'qte_t196')).toMatchObject({ sent: 0, skipped: 'no_devices' })
    const off = world({ devices: [device(1, { accepted: false })] })
    expect(await sendBusinessPush(sender(off), 'accepted', 'qte_t196')).toMatchObject({ sent: 0, skipped: 'no_devices' })
    expect(w.claimed.size + off.claimed.size).toBe(0)
  })

  it('a token the push service says is dead is removed, and the others are still told', async () => {
    const w = world({
      devices: [device(1), device(2), device(3)],
      answer: (to) => (to === token(2) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : to === token(3) ? { status: 'error', details: { error: 'MessageRateExceeded' } } : { status: 'ok', id: 't1' }),
    })
    const result = await sendBusinessPush(sender(w), 'accepted', 'qte_t196')
    expect(result).toEqual({ sent: 1, failed: 1, removed: 1 })
    // only the dead one goes: a phone that was merely busy keeps its token
    expect(w.removed).toEqual([token(2)])
  })

  it('a phone whose last notification came back "gone" is removed before the next one is sent', async () => {
    const w = world({
      devices: [device(1, {}, 'ticket-old-1'), device(2, {}, 'ticket-old-2'), device(3)],
      receipts: { 'ticket-old-1': { status: 'error', details: { error: 'DeviceNotRegistered' } }, 'ticket-old-2': { status: 'ok' } },
    })
    const result = await sendBusinessPush(sender(w), 'new_request', 'qte_t196')
    expect(w.posts[0]?.url).toBe(`${EXPO_PUSH_BASE_URL}/getReceipts`)
    expect(w.posts[0]?.body).toEqual({ ids: ['ticket-old-1', 'ticket-old-2'] })
    expect(w.removed).toEqual([token(1)])
    expect(sends(w).map((m) => m.to)).toEqual([token(2), token(3)])
    expect(result).toEqual({ sent: 2, failed: 0, removed: 1 })
  })

  it('the readers of the push service\'s answers', () => {
    const messages = [{ to: token(1) }, { to: token(2) }, { to: token(3) }, { to: token(4) }]
    expect(readTickets(messages, [{ status: 'ok', id: 'a' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'InvalidCredentials' } }])).toEqual({
      dead: [token(2)],
      accepted: [{ token: token(1), ticketId: 'a' }],
      // an error that is not "gone", and an answer that never came
      failed: 2,
    })
    expect(readTickets(messages, null)).toEqual({ dead: [], accepted: [], failed: 4 })
    expect(deadFromReceipts([device(1, {}, 'x'), device(2, {}, 'y'), device(3)], { x: { status: 'error', details: { error: 'DeviceNotRegistered' } }, y: { status: 'error', details: { error: 'MessageTooBig' } } })).toEqual([token(1)])
    expect(deadFromReceipts([device(1, {}, 'x')], null)).toEqual([])
  })

  it('a push service that is down never throws: the quote and the email go on', async () => {
    const w = world({ down: true })
    const result = await sendBusinessPush(sender(w), 'accepted', 'qte_t196')
    expect(result).toEqual({ sent: 0, failed: 1, removed: 0 })
    // and a store that throws
    const broken = sender(world())
    broken.store.quote = async () => {
      throw new Error('database is away')
    }
    await expect(sendBusinessPush(broken, 'accepted', 'qte_t196')).resolves.toMatchObject({ sent: 0, skipped: 'error' })
    expect(await sendBusinessPush(sender(world({ facts: null })), 'accepted', 'qte_missing')).toMatchObject({ skipped: 'no_quote' })
  })

  it('what is logged names the quote and counts, never a customer or a token', async () => {
    const w = world({ facts: { ...FACTS, ...PRIVATE } as PushQuoteFacts, down: true })
    await sendBusinessPush(sender(w), 'accepted', 'qte_t196')
    const ok = world({ facts: { ...FACTS, ...PRIVATE } as PushQuoteFacts })
    await sendBusinessPush(sender(ok), 'accepted', 'qte_t196')
    const logged = [...w.logs, ...ok.logs].join('\n')
    expect(logged).toContain('qte_t196')
    expect(logged).toContain('sent 1, failed 0, removed 0')
    for (const secret of [...Object.values(PRIVATE), 'Megan', 'Grant', 'ExponentPushToken']) expect(logged).not.toContain(secret)
  })

  it('the access token is sent only when there is one', async () => {
    const w = world()
    await sendBusinessPush(sender(w, 'expo-access-token-name-only'), 'accepted', 'qte_t196')
    expect(w.posts[0]?.headers.Authorization).toBe('Bearer expo-access-token-name-only')
    const none = world()
    await sendBusinessPush(sender(none), 'accepted', 'qte_t196')
    expect(none.posts[0]?.headers.Authorization).toBeUndefined()
  })

  it('more than a hundred phones go in batches of a hundred', async () => {
    const w = world({ devices: Array.from({ length: 230 }, (_, i) => device(i)) })
    expect((await sendBusinessPush(sender(w), 'accepted', 'qte_t196')).sent).toBe(230)
    expect(w.posts.map((p) => (p.body as unknown[]).length)).toEqual([100, 100, 30])
  })
})

describe('T-196: email and push are sent from the same places', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../../..', path), 'utf8')

  it('each place that emails the business about one of the three events also tells its phones', () => {
    const places: Array<[string, string, RegExp]> = [
      ['apps/web/src/app/api/public/quotes/[quoteId]/accept/route.ts', "notifyPhones('accepted', quoteId", /generateQuoteAcceptedEmailHtml\(/],
      ['apps/web/src/app/api/public/quotes/[quoteId]/feedback/route.ts', "notifyPhones('question', quoteId", /generateFeedbackNotificationEmailHtml\(/],
      ['apps/web/src/lib/lead-hold.ts', "notifyPhones('new_request', opts.quoteId", /generateLeadHeldEmailHtml\(/],
      ['apps/web/src/lib/failed-quote.ts', "notifyPhones('new_request', quoteId", /failedRequestEmail\(/],
      ['apps/worker/src/quote-processor.ts', "notifyPhones(supabase, env, 'new_request', quoteId)", /sendReviewRequestEmail\(/],
      ['apps/worker/src/failed-quote.ts', "notifyPhones(supabase, env, 'new_request', quoteId)", /failedRequestEmail\(/],
    ]
    for (const [file, call, email] of places) {
      const source = read(file)
      expect(source, file).toContain(call)
      expect(source, file).toMatch(email)
    }
  })

  it('nothing else notifies: these are the only callers', () => {
    // the request-updated email (a repriced or changed request) and the approval email must not notify
    for (const file of ['apps/web/src/lib/request-updated.ts', 'apps/web/src/lib/quote-approval.ts', 'apps/web/src/app/api/public/quotes/[quoteId]/decline/route.ts']) {
      expect(read(file), file).not.toContain('notifyPhones')
    }
    // a review request ("approval_request") is not the "Ask a question" box
    expect(read('apps/web/src/app/api/public/quotes/[quoteId]/feedback/route.ts')).toMatch(/if \(body\.feedbackType === 'feedback'\) \{\s+await notifyPhones\('question'/)
  })

  it('a stand-in for the push service is honoured only outside production', () => {
    expect(read('apps/web/src/lib/push.ts')).toMatch(/override && process\.env\.NODE_ENV !== 'production' \? override : undefined/)
    expect(read('apps/worker/src/push.ts')).toContain("env.ENVIRONMENT === 'development' ? env.EXPO_PUSH_BASE_URL || undefined : undefined")
  })
})
