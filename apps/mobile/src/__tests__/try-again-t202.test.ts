/**
 * T-202, item 1: "Try again" in the phone app, on a request that could not be priced.
 *
 * The same button, words and server action as the dashboard's quote page (T-201 item 19). No phone runs
 * here: these test the pure rules, the request the app sends, and read the screen's source.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUSINESS_RETRY_LIMIT, QUOTE_TURN_COPY, RETRY_COPY, tryAgainView, type AppQuoteView } from '@qolumns/shared'
import { ApiError, createApi } from '../lib/api'
import { PLAIN } from '../lib/errors'
import { mainAction } from '../lib/price'
import { TRY_AGAIN_BUTTON, TRY_AGAIN_STARTED, TRY_AGAIN_USED, tryAgainError, tryAgainState } from '../lib/try-again'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')
const screen = read('app/quote/[id].tsx')

const view = (over: Partial<AppQuoteView> = {}): AppQuoteView => ({
  id: 'qte_1',
  status: 'failed',
  businessName: 'Harlow Painting',
  serviceName: 'Exterior wall painting',
  customerName: 'Jordan Reyes',
  createdAt: '2026-11-24T09:00:00Z',
  pricing: { total: 0, currency: 'USD' },
  takeoff: [],
  questions: [],
  ...over,
})

describe('T-202: when the app offers "Try again"', () => {
  it('a request that could not be priced, with a try left: the button', () => {
    expect(tryAgainState(view({ tryAgain: { left: 5 } }))).toBe('offer')
    expect(tryAgainState(view({ tryAgain: { left: 1 } }))).toBe('offer')
  })

  it('every try used: no button, the sentence instead', () => {
    expect(tryAgainState(view({ tryAgain: { left: 0 } }))).toBe('used')
  })

  it('only a failed request: not one being priced, sent, or saved at the plan limit', () => {
    for (const status of ['queued', 'generating', 'pending_review', 'sent', 'accepted', 'awaiting_clarification'] as const) {
      expect(tryAgainState(view({ status, tryAgain: { left: 5 } }))).toBeNull()
    }
  })

  it('a server from before T-202 says nothing about tries: the screen is as it was', () => {
    expect(tryAgainState(view())).toBeNull()
  })

  it('the server works the tries out with the dashboard’s rule (five a request)', () => {
    expect(BUSINESS_RETRY_LIMIT).toBe(5)
    expect(tryAgainView({ status: 'failed', content_json: {} })).toEqual({ left: 5 })
    expect(tryAgainView({ status: 'failed', content_json: { businessRetries: 2 } })).toEqual({ left: 3 })
    expect(tryAgainView({ status: 'failed', content_json: { businessRetries: 5 } })).toEqual({ left: 0 })
    expect(tryAgainView({ status: 'failed', content_json: { businessRetries: 9 } })).toEqual({ left: 0 })
    expect(tryAgainView({ status: 'failed', content_json: null })).toEqual({ left: 5 })
    expect(tryAgainView({ status: 'sent', content_json: { businessRetries: 1 } })).toBeUndefined()
  })

  it('reaching the customer stays the story’s main action: "Try again" is added, nothing is taken away', () => {
    expect(mainAction(view({ tryAgain: { left: 5 } }))).toBe('contact')
    expect(mainAction(view({ tryAgain: { left: 0 } }))).toBe('contact')
  })
})

describe('T-202: the words are the dashboard’s', () => {
  it('the button, "starting", "started" and the limit sentence are the shared ones', () => {
    expect(TRY_AGAIN_BUTTON).toEqual({ title: QUOTE_TURN_COPY.pageButtons.tryAgain, busy: QUOTE_TURN_COPY.pageButtons.tryingAgain })
    expect(TRY_AGAIN_BUTTON.title).toBe('Try again')
    expect(TRY_AGAIN_STARTED).toBe(RETRY_COPY.started)
    expect(TRY_AGAIN_USED).toBe(RETRY_COPY.limit)
    expect(TRY_AGAIN_USED).toContain('tried 5 times')
  })

  it('a refusal is said in the server’s sentence: the limit, a paused account', () => {
    expect(tryAgainError(new ApiError(429, 'RETRY_LIMIT', RETRY_COPY.limit))).toBe(RETRY_COPY.limit)
    expect(tryAgainError(new ApiError(403, 'ACCOUNT_PAUSED', RETRY_COPY.paused))).toBe(RETRY_COPY.paused)
  })

  it('anything else is "Could not start pricing. Try again."; no signal is the app’s own line', () => {
    expect(tryAgainError(new ApiError(502, 'QUEUE_FAILED', RETRY_COPY.notStarted))).toBe(RETRY_COPY.notStarted)
    expect(tryAgainError(new ApiError(500, 'HTTP_ERROR', 'Request failed (500)'))).toBe(RETRY_COPY.notStarted)
    expect(tryAgainError(new TypeError('undefined is not a function'))).toBe(RETRY_COPY.notStarted)
    expect(tryAgainError(new ApiError(0, 'NETWORK', 'No signal'))).toBe(PLAIN.offline)
  })

  it('none of the sentences points at buying anything (the app may not)', () => {
    for (const text of Object.values(RETRY_COPY)) expect(text).not.toMatch(/\b(upgrade|pick a plan|choose a plan|subscribe|billing|checkout|buy)\b/i)
  })
})

describe('T-202: the request the app sends', () => {
  it('is the dashboard’s route, signed with the app’s own sign-in, with nothing in its body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const api = createApi({
      baseUrl: 'https://app.test',
      getAccessToken: async () => 'jwt',
      fetch: async (url, init) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ queued: true, retried: true }), { status: 200 })
      },
    })
    expect(await api.tryAgain('qte_1')).toEqual({ queued: true, retried: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://app.test/api/quotes/qte_1/process')
    expect(calls[0]!.init!.method).toBe('POST')
    expect(calls[0]!.init!.body).toBeUndefined()
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
  })

  it('the sixth try comes back as the limit, with the server’s sentence', async () => {
    const api = createApi({
      baseUrl: 'https://app.test',
      getAccessToken: async () => 'jwt',
      fetch: async () => new Response(JSON.stringify({ error: { code: 'RETRY_LIMIT', message: RETRY_COPY.limit } }), { status: 429 }),
    })
    const error = await api.tryAgain('qte_1').catch((e: unknown) => e as ApiError)
    expect(error).toMatchObject({ status: 429, code: 'RETRY_LIMIT', message: RETRY_COPY.limit })
    expect(tryAgainError(error)).toBe(RETRY_COPY.limit)
  })
})

describe('T-202: the quote screen (one code path for both phones)', () => {
  it('shows the button in the bottom bar only while a try is left', () => {
    expect(screen).toMatch(/tryState === 'offer' \? \(\s*(\/\/[^\n]*\n\s*)*<BottomBar>\s*<Button title=\{TRY_AGAIN_BUTTON\.title\}/)
    expect(screen).toContain('const tryState = tryAgainState(quote)')
  })

  it('says the limit sentence once the tries are used, and "Pricing started" while it is priced again', () => {
    expect(screen).toContain("{tryState === 'used' ? <Muted>{TRY_AGAIN_USED}</Muted> : null}")
    expect(screen).toContain('{triedAgain ? <Muted>{TRY_AGAIN_STARTED}</Muted> : null}')
  })

  it('calls the app’s tryAgain and then follows the quote; a refusal is said with tryAgainError', () => {
    const body = screen.slice(screen.indexOf('const tryAgain = async () =>'), screen.indexOf('const saveInvoice'))
    expect(body).toContain('await api.tryAgain(quote.id)')
    expect(body).toContain('await load()')
    expect(body).toContain('setError(tryAgainError(e))')
    // the limit is said once, by the quote read again, not twice
    expect(body).toContain("toApiError(e).code !== 'RETRY_LIMIT'")
  })

  it('has no branch by phone: Android and iPhone run the same lines', () => {
    const body = screen.slice(screen.indexOf('const tryAgain = async () =>'), screen.indexOf('const saveInvoice'))
    expect(body).not.toContain('Platform.OS')
    expect(read('src/lib/try-again.ts')).not.toContain('Platform')
  })

  it('its hooks come before the screen’s early return (a hook after it breaks the screen)', () => {
    const early = screen.indexOf('if (!quote) {')
    expect(screen.indexOf('const [triedAgain, setTriedAgain] = useState(false)')).toBeGreaterThan(0)
    expect(screen.indexOf('const [triedAgain, setTriedAgain] = useState(false)')).toBeLessThan(early)
    expect(screen.indexOf('setTriedAgain(false)')).toBeLessThan(early)
  })

  it('how to reach the customer is still on the screen', () => {
    expect(screen).toMatch(/mailto:|tel:/)
  })
})
