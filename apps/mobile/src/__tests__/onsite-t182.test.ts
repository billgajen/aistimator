/**
 * T-182: the on-site path and the app's match with the web.
 *
 * The sending queue is tested with a pretend phone: storage, files, the
 * network and the clock are handed in, so "the signal drops" is one line.
 */
import { describe, it, expect } from 'vitest'
import { QUOTE_TURN_COPY, type AppCreateQuoteRequest, type AppQuoteView, type QuoteListItem } from '@qolumns/shared'
import { ApiError } from '../lib/api'
import { chunkedStore, CHUNK_CHARS, type KeyValue } from '../lib/chunked-store'
import { missingSettings } from '../lib/config'
import { createOutbox, draftProgress, OUTBOX_COPY, restoreState, retryDelayMs, type Draft, type DraftRequest, type NewPhoto } from '../lib/outbox'
import { canRecordInvoice, hasPrice, headlinePrice, isPricing, mainAction, minimumNote, priceLines } from '../lib/price'
import { evidenceWords, shareMessage } from '../lib/share'
import { TONE_STYLE, turnOfListItem, turnOfQuote } from '../lib/status'
import { colors } from '../theme'

// ---------------------------------------------------------------------------
// A pretend phone
// ---------------------------------------------------------------------------

const OFFLINE = () => new ApiError(0, 'NETWORK', 'No signal')

function phone(opts: { owner?: string | null } = {}) {
  const world = {
    online: true,
    owner: opts.owner === undefined ? 'user-1' : opts.owner,
    now: 1_000_000,
    saved: null as string | null,
    starts: [] as string[],
    puts: [] as string[],
    removed: [] as string[],
    creates: [] as AppCreateQuoteRequest[],
    links: [] as Array<[string, string]>,
    /** What the next calls do instead of succeeding (one entry per call) */
    startFails: [] as ApiError[],
    putFails: [] as ApiError[],
    createFails: [] as ApiError[],
    createAnswer: { quoteId: 'qte_1', status: 'queued', quoteViewUrl: 'https://app.test/q/qte_1?token=tok' } as { quoteId: string; status: string; quoteViewUrl?: string; alreadyCreated?: boolean },
    ids: 0,
  }
  const outbox = createOutbox({
    api: {
      async startUpload(_key, file) {
        if (!world.online) throw OFFLINE()
        const fail = world.startFails.shift()
        if (fail) throw fail
        world.starts.push(file.fileName)
        return { assetId: `asset-${file.fileName}`, uploadUrl: `https://storage.test/${file.fileName}` }
      },
      async createQuote(body) {
        if (!world.online) throw OFFLINE()
        const fail = world.createFails.shift()
        if (fail) throw fail
        world.creates.push(body)
        return world.createAnswer as never
      },
    },
    tenantKey: async () => {
      if (!world.online) throw OFFLINE()
      return 'tkey'
    },
    store: {
      read: async () => world.saved,
      write: async (json) => {
        world.saved = json
      },
    },
    files: {
      async put(url, _photo, onProgress) {
        if (!world.online) throw OFFLINE()
        const fail = world.putFails.shift()
        if (fail) throw fail
        onProgress(0.5)
        onProgress(1)
        world.puts.push(url)
      },
      async remove(uri) {
        world.removed.push(uri)
      },
    },
    saveQuoteLink: async (quoteId, url) => {
      world.links.push([quoteId, url])
    },
    owner: () => world.owner,
    now: () => world.now,
    newId: () => `id-${++world.ids}`,
  })
  return { world, outbox }
}

const photo = (name: string, angleId: string | null = null): NewPhoto => ({ uri: `file:///docs/${name}`, fileName: name, contentType: 'image/jpeg', sizeBytes: 1000, angleId })
const request: DraftRequest = { serviceId: 'svc_1', customer: { name: 'Megan Grant' }, job: { answers: [] } }

/** Let the queue finish what it can do now */
async function settle(outbox: ReturnType<typeof phone>['outbox']) {
  await outbox.pump()
  await outbox.pump()
}

describe('the sending queue: photos upload in the background', () => {
  it('a photo starts uploading as soon as it is taken, with its progress, while the quote is still being written', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    outbox.addPhoto(draft.id, photo('a.jpg'))
    await settle(outbox)
    const now = outbox.find(draft.id)!
    expect(now.send).toBe('editing')
    expect(now.photos[0]).toMatchObject({ state: 'done', progress: 1, assetId: 'asset-a.jpg' })
    expect(world.puts).toEqual(['https://storage.test/a.jpg'])
    expect(world.creates).toEqual([]) // nothing is sent until "Price this job"
    expect(draftProgress(now)).toMatchObject({ photosDone: 1, photosTotal: 1, fraction: 1, line: 'Photo uploaded' })
  })

  it('the upload is started with the real file size (the signed address takes exactly that)', async () => {
    const { outbox } = phone()
    const sizes: number[] = []
    const draft = outbox.start()!
    const spy = createOutbox({
      api: {
        startUpload: async (_k, file) => {
          sizes.push(file.sizeBytes)
          return { assetId: 'a', uploadUrl: 'u' }
        },
        createQuote: async () => ({ quoteId: 'q', status: 'queued' }),
      },
      tenantKey: async () => 'k',
      store: { read: async () => null, write: async () => undefined },
      files: { put: async () => undefined, remove: async () => undefined },
      saveQuoteLink: async () => undefined,
      owner: () => 'user-1',
      now: () => 1,
      newId: () => 'x',
    })
    const d = spy.start()!
    spy.addPhoto(d.id, { ...photo('big.jpg'), sizeBytes: 734_211 })
    await spy.pump()
    expect(sizes).toEqual([734_211])
    expect(draft.id).toBeTruthy()
  })

  it('one photo per guided angle: taking it again replaces the first and deletes its file', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    outbox.addPhoto(draft.id, photo('plate-1.jpg', 'plate'))
    outbox.addPhoto(draft.id, photo('wide.jpg'))
    outbox.addPhoto(draft.id, photo('plate-2.jpg', 'plate'))
    await settle(outbox)
    expect(outbox.find(draft.id)!.photos.map((p) => p.fileName)).toEqual(['wide.jpg', 'plate-2.jpg'])
    expect(world.removed).toContain('file:///docs/plate-1.jpg')
  })

  it('a file the server will not take is marked, said in words, and never retried', async () => {
    const { world, outbox } = phone()
    world.startFails.push(new ApiError(400, 'VALIDATION_ERROR', 'File too large. Maximum size: 10MB'))
    const draft = outbox.start()!
    outbox.addPhoto(draft.id, photo('huge.jpg'))
    await settle(outbox)
    const now = outbox.find(draft.id)!
    expect(now.photos[0]).toMatchObject({ state: 'refused', error: 'File too large. Maximum size: 10MB' })
    expect(now.problem).toEqual({ kind: 'refused', message: OUTBOX_COPY.photoRefused })
    expect(world.starts).toEqual([])
    // taking it again clears the problem
    outbox.removePhoto(draft.id, now.photos[0]!.id)
    expect(outbox.find(draft.id)!.problem).toBeNull()
  })

  it('a signed address that ran out is asked for again; after three refusals the photo is marked', async () => {
    const { world, outbox } = phone()
    world.putFails.push(new ApiError(403, 'UPLOAD_FAILED', 'expired'))
    const draft = outbox.start()!
    outbox.addPhoto(draft.id, photo('a.jpg'))
    await settle(outbox)
    // refused once, then a new address was asked for and the photo went up
    expect(outbox.find(draft.id)!.photos[0]).toMatchObject({ state: 'done', refusals: 1 })
    expect(world.starts).toEqual(['a.jpg', 'a.jpg'])

    const second = phone()
    second.world.putFails.push(new ApiError(403, 'UPLOAD_FAILED', 'no'), new ApiError(403, 'UPLOAD_FAILED', 'no'), new ApiError(403, 'UPLOAD_FAILED', 'no'))
    const d2 = second.outbox.start()!
    second.outbox.addPhoto(d2.id, photo('b.jpg'))
    for (let i = 0; i < 4; i++) await second.outbox.pump()
    expect(second.outbox.find(d2.id)!.photos[0]).toMatchObject({ state: 'refused' })
  })
})

describe('the sending queue: a lost signal never loses the quote', () => {
  it('"Price this job" with no signal: the quote waits on the phone, then sends by itself when the signal is back', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    outbox.addPhoto(draft.id, photo('a.jpg'))
    await settle(outbox)

    world.online = false
    outbox.addPhoto(draft.id, photo('b.jpg'))
    outbox.queue(draft.id, request, outbox.find(draft.id)!.photos.map((p) => p.id))
    await settle(outbox)

    const now = outbox.find(draft.id)!
    expect(now.send).toBe('queued')
    expect(now.problem).toEqual({ kind: 'offline', message: OUTBOX_COPY.offline })
    expect(now.photos.map((p) => p.state)).toEqual(['done', 'waiting'])
    expect(world.creates).toEqual([])
    expect(outbox.hasWork()).toBe(true)

    // still no signal: it does not hammer, it waits its turn
    world.now += 1000
    await outbox.pump()
    expect(outbox.find(draft.id)!.attempts).toBe(1)

    // the signal is back
    world.online = true
    world.now += 60_000
    await settle(outbox)
    expect(outbox.find(draft.id)).toBeNull()
    expect(world.creates).toHaveLength(1)
    expect(world.creates[0]).toMatchObject({ serviceId: 'svc_1', customer: { name: 'Megan Grant' }, assetIds: ['asset-a.jpg', 'asset-b.jpg'], clientRequestId: draft.id })
    expect(world.links).toEqual([['qte_1', 'https://app.test/q/qte_1?token=tok']])
    expect(outbox.takeSent(draft.id)).toEqual({ draftId: draft.id, quoteId: 'qte_1', held: false })
    expect(outbox.takeSent(draft.id)).toBeNull() // taken once
    // the photos' copies are removed only after the quote exists
    expect(world.removed.sort()).toEqual(['file:///docs/a.jpg', 'file:///docs/b.jpg'])
    expect(outbox.hasWork()).toBe(false)
  })

  it('the answer was lost on the way back: the same id is sent again, so no second quote is made', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    // the server made the quote, but the phone never heard
    world.createFails.push(OFFLINE())
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    expect(outbox.find(draft.id)!.send).toBe('queued')

    world.createAnswer = { quoteId: 'qte_1', status: 'queued', alreadyCreated: true } // answered from the first send: no link
    world.now += 60_000
    await settle(outbox)
    expect(world.creates).toHaveLength(1)
    expect(world.creates[0]!.clientRequestId).toBe(draft.id)
    expect(outbox.takeSent(draft.id)).toMatchObject({ quoteId: 'qte_1' })
    expect(world.links).toEqual([]) // the link is made from the quote's page instead
  })

  it('everything is saved as it happens: the app is closed mid-way and carries on where it was', async () => {
    const first = phone()
    const draft = first.outbox.start()!
    first.outbox.update(draft.id, { serviceId: 'svc_1', serviceName: 'A service', description: 'Back wall', customer: { name: 'Megan Grant', email: '', phone: '' }, answers: { rooms: '3' } })
    first.outbox.addPhoto(draft.id, photo('a.jpg'))
    await settle(first.outbox)
    first.world.online = false
    first.outbox.addPhoto(draft.id, photo('b.jpg'))
    first.outbox.queue(draft.id, request, first.outbox.find(draft.id)!.photos.map((p) => p.id))
    await settle(first.outbox)

    // the app is closed; a new run reads what was saved
    const second = phone()
    second.world.saved = first.world.saved
    await second.outbox.load()
    const restored = second.outbox.find(draft.id)!
    expect(restored).toMatchObject({ send: 'queued', description: 'Back wall', answers: { rooms: '3' }, nextTryAt: 0 })
    expect(restored.photos.map((p) => [p.fileName, p.state, p.assetId])).toEqual([
      ['a.jpg', 'done', 'asset-a.jpg'],
      ['b.jpg', 'waiting', undefined],
    ])
    await settle(second.outbox)
    expect(second.world.starts).toEqual(['b.jpg']) // the photo already up is not sent again
    expect(second.world.creates[0]).toMatchObject({ assetIds: ['asset-a.jpg', 'asset-b.jpg'], clientRequestId: draft.id })
  })

  it('what was saved mid-upload or mid-send is put back to "waiting"; a damaged file is an empty queue, never a crash', () => {
    const saved = JSON.stringify({
      drafts: [{ id: 'd1', owner: 'user-1', send: 'sending', nextTryAt: 999, photos: [{ id: 'p', state: 'uploading', progress: 0.4 }] }],
    })
    const restored = restoreState(saved)
    expect(restored.drafts[0]).toMatchObject({ send: 'queued', nextTryAt: 0 })
    expect(restored.drafts[0]!.photos[0]).toMatchObject({ state: 'waiting', progress: 0 })
    expect(restoreState('{not json')).toEqual({ drafts: [], sent: [] })
    expect(restoreState(null)).toEqual({ drafts: [], sent: [] })
    // a draft with no owner could be sent under the wrong sign-in: it is not carried over
    expect(restoreState(JSON.stringify({ drafts: [{ id: 'old', photos: [] }] })).drafts).toEqual([])
  })

  it('a rate limit is waited out for as long as the server asks, then the quote goes', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    world.createFails.push(new ApiError(429, 'RATE_LIMITED', 'Too many requests', 90))
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    const waiting = outbox.find(draft.id)!
    expect(waiting.problem).toEqual({ kind: 'busy', message: OUTBOX_COPY.busy })
    expect(waiting.nextTryAt).toBe(world.now + 90_000)

    world.now += 89_000
    await settle(outbox)
    expect(world.creates).toEqual([]) // not a second before
    world.now += 2_000
    await settle(outbox)
    expect(world.creates).toHaveLength(1)
  })

  it('"Try now" does not wait; the waits grow from seconds to a minute and no longer', async () => {
    expect([1, 2, 3, 4, 5, 6, 50].map((n) => retryDelayMs(n))).toEqual([3000, 8000, 15000, 30000, 60000, 60000, 60000])
    expect(retryDelayMs(1, 42)).toBe(42_000)

    const { world, outbox } = phone()
    const draft = outbox.start()!
    world.online = false
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    world.online = true
    outbox.retryNow() // no clock moved
    await settle(outbox)
    expect(world.creates).toHaveLength(1)
  })

  it('a request the server refuses comes back to be put right, with the server\'s own words', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    world.createFails.push(new ApiError(400, 'VALIDATION_ERROR', 'Missing critical fields for accurate pricing: Number of rooms'))
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    expect(outbox.find(draft.id)).toMatchObject({ send: 'editing', problem: { kind: 'refused', message: 'Missing critical fields for accurate pricing: Number of rooms' } })
  })

  it('a sign-in that ran out keeps the quote and says to sign in again', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    world.createFails.push(new ApiError(401, 'UNAUTHORIZED', 'Please sign in again'))
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    expect(outbox.find(draft.id)).toMatchObject({ send: 'queued', problem: { kind: 'signin', message: OUTBOX_COPY.signin } })
  })

  it('a request saved at the plan limit is reported as held, not as priced', async () => {
    const { world, outbox } = phone()
    world.createAnswer = { quoteId: 'qte_held', status: 'held', quoteViewUrl: 'https://app.test/q/qte_held?token=t' }
    const draft = outbox.start()!
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    expect(outbox.takeSent(draft.id)).toEqual({ draftId: draft.id, quoteId: 'qte_held', held: true })
  })

  it('a draft belongs to the sign-in that wrote it: another sign-in neither sees nor sends it', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    world.online = false
    outbox.queue(draft.id, request, [])
    await settle(outbox)

    world.owner = 'user-2'
    world.online = true
    world.now += 600_000
    await settle(outbox)
    expect(world.creates).toEqual([])
    expect(outbox.mine()).toEqual([])
    expect(outbox.hasWork()).toBe(false)
    expect(outbox.start()!.id).not.toBe(draft.id)

    world.owner = 'user-1'
    await settle(outbox)
    expect(world.creates).toHaveLength(1)

    world.owner = null
    expect(outbox.start()).toBeNull() // nobody signed in: nothing is started
  })

  it('there is one unfinished quote at a time; it can be taken back to change, or deleted with its photos', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    expect(outbox.start()!.id).toBe(draft.id)
    outbox.addPhoto(draft.id, photo('a.jpg'))
    world.online = false
    outbox.queue(draft.id, request, [])
    await settle(outbox)
    outbox.edit(draft.id)
    expect(outbox.find(draft.id)).toMatchObject({ send: 'editing', problem: null })
    outbox.discard(draft.id)
    expect(outbox.find(draft.id)).toBeNull()
    expect(world.removed).toEqual(['file:///docs/a.jpg'])
    expect(JSON.parse(world.saved!)).toEqual({ drafts: [] })
  })
})

// ---------------------------------------------------------------------------
// Matching the web
// ---------------------------------------------------------------------------

const view = (over: Partial<AppQuoteView> = {}): AppQuoteView => ({
  id: 'qte_1',
  status: 'sent',
  businessName: 'A Business',
  serviceName: 'A service',
  customerName: 'Megan Grant',
  createdAt: '2026-11-18T10:00:00Z',
  pricing: { total: 2880, currency: 'USD', estimate: { grade: 'A', label: 'Confirmed', description: '' } },
  takeoff: [],
  questions: [],
  ...over,
})

describe('the price', () => {
  it('exact total when confirmed; the range while provisional', () => {
    expect(headlinePrice(view())).toBe('$2,880.00')
    expect(
      headlinePrice(view({ status: 'awaiting_clarification', pricing: { total: 300, currency: 'USD', estimate: { grade: 'C', label: 'Concept', description: '', rangeLow: 2300, rangeHigh: 4100 } } }))
    ).toBe('$2,300–$4,100')
  })

  it('no price is never shown as 0.00: while it is worked out, when the request is held, when it could not be priced', () => {
    for (const q of [
      view({ status: 'generating' }),
      view({ status: 'queued', pricing: { total: 0, currency: 'USD' } }),
      view({ status: 'pending_review', held: true, pricing: { total: 0, currency: 'USD' } }),
      view({ status: 'failed', pricing: { total: 0, currency: 'USD' } }),
      view({ status: 'pending_review', pricing: { total: 0, currency: 'USD' } }),
    ]) {
      expect(hasPrice(q)).toBe(false)
      expect(headlinePrice(q)).toBeNull()
    }
    expect(isPricing('queued')).toBe(true)
    expect(isPricing('sent')).toBe(false)
  })

  it('the minimum charge is one note in the web\'s words, never a line (AD-048)', () => {
    expect(minimumNote({ minimumCharge: 120 }, 'USD')).toBe('Minimum charge of $120.00 applied')
    expect(minimumNote(undefined, 'USD')).toBeNull()
    expect(minimumNote(null, 'GBP')).toBeNull()
  })

  it('lines come from the priced lines, each with how it was measured when the takeoff says', () => {
    const q = view({
      lines: [
        { label: 'Walls', amount: 900 },
        { label: 'Ceiling', amount: 300 },
      ],
      takeoff: [{ item: 'Walls', amount: 900, method: 'From your photos' }],
    })
    expect(priceLines(q)).toEqual([
      { label: 'Walls', amount: 900, method: 'From your photos' },
      { label: 'Ceiling', amount: 300 },
    ])
    // an older server sends only the takeoff
    expect(priceLines(view({ takeoff: [{ item: 'Walls', amount: 900, method: 'Fixed' }] }))).toEqual([{ label: 'Walls', amount: 900, method: 'Fixed' }])
  })
})

describe('the one main action on the quote screen', () => {
  it('follows the web\'s rules for each state', () => {
    expect(mainAction(view({ status: 'generating' }))).toBe('wait')
    expect(mainAction(view({ status: 'awaiting_clarification', questions: [{ id: 'c1', question: 'Q?' }] }))).toBe('confirm')
    // a quote the business made is hidden until approved: approve first, the link after (T-146, T-147)
    expect(mainAction(view({ status: 'pending_review' }))).toBe('send')
    expect(mainAction(view({ status: 'pending_review', held: true, pricing: { total: 0, currency: 'USD' } }))).toBe('price_request')
    expect(mainAction(view({ status: 'pending_review', pricing: { total: 0, currency: 'USD' } }))).toBe('add_price')
    expect(mainAction(view({ status: 'failed', pricing: { total: 0, currency: 'USD' } }))).toBe('contact')
    for (const status of ['sent', 'viewed', 'revised', 'accepted', 'paid', 'expired', 'feedback_received'] as const) {
      expect(mainAction(view({ status }))).toBe('share')
    }
    expect(mainAction(view({ status: 'declined' }))).toBeNull()
  })

  it('the final invoice is recorded once the customer has the quote', () => {
    expect(['sent', 'viewed', 'revised', 'accepted', 'paid'].every(canRecordInvoice)).toBe(true)
    expect(['queued', 'pending_review', 'failed', 'declined'].some(canRecordInvoice)).toBe(false)
  })
})

describe('status words are the dashboard\'s own', () => {
  const now = { now: new Date('2026-11-18T12:00:00Z'), locale: 'en-US', timeZone: 'UTC' }
  const item = (over: Partial<QuoteListItem>): QuoteListItem => ({
    quoteId: 'q',
    serviceName: 'A service',
    customerName: 'Megan Grant',
    customerEmail: '',
    status: 'sent',
    createdAt: '2026-11-18T10:00:00Z',
    sentAt: null,
    viewedAt: null,
    acceptedAt: null,
    paidAt: null,
    total: 100,
    currency: 'USD',
    ...over,
  })

  it('every label comes from the shared wording, never the raw status', () => {
    const L = QUOTE_TURN_COPY.labels
    expect(turnOfListItem(item({ status: 'pending_review' }), now).label).toBe(L.needsApproval)
    expect(turnOfListItem(item({ status: 'pending_review', held: true, total: 0 }), now).label).toBe(L.held)
    expect(turnOfListItem(item({ status: 'failed', total: 0 }), now).label).toBe(L.failed)
    expect(turnOfListItem(item({ status: 'generating' }), now).label).toBe(L.working)
    expect(turnOfListItem(item({ status: 'viewed' }), now).label).toBe(L.waiting)
    expect(turnOfListItem(item({ status: 'accepted' }), now).label).toBe(L.accepted)
    for (const status of ['queued', 'generating', 'pending_review', 'sent', 'viewed', 'accepted', 'paid', 'declined', 'expired', 'failed', 'awaiting_clarification', 'revised', 'feedback_received'] as const) {
      const label = turnOfListItem(item({ status }), now).label
      expect(label).not.toBe(status)
      expect(label).not.toMatch(/_/)
    }
  })

  it('a held request and a failed one say what happened and what to do', () => {
    const held = turnOfQuote(view({ status: 'pending_review', held: true, pricing: { total: 0, currency: 'USD' } }), now)
    expect(held).toMatchObject({ label: 'Saved, not priced yet', detail: 'Your plan limit was reached', action: 'price_request' })
    const failed = turnOfQuote(view({ status: 'failed', pricing: { total: 0, currency: 'USD' } }), now)
    expect(failed.label).toBe('Could not be priced')
    expect(failed.sentence).toContain('Contact Megan')
    expect(failed.tone).toBe('danger')
  })

  it('a quote sent with no email address is not offered "Send again" by email', () => {
    const old = turnOfQuote(view({ status: 'sent', dates: { sentAt: '2026-11-10T10:00:00Z', viewedAt: null, acceptedAt: null, paidAt: null, declinedAt: null, expiresAt: null } }), now)
    expect(old.action).toBe('contact')
    const withEmail = turnOfQuote(
      view({ status: 'sent', customer: { name: 'Megan Grant', email: 'megan@example.test', phone: null }, dates: { sentAt: '2026-11-10T10:00:00Z', viewedAt: null, acceptedAt: null, paidAt: null, declinedAt: null, expiresAt: null } }),
      now
    )
    expect(withEmail.action).toBe('send_again')
  })

  it('status colours follow the design rules: yellow only for "needs you", with dark text and its marker', () => {
    expect(TONE_STYLE.attention).toEqual({ background: colors.accent, text: colors.onAccent, marker: true })
    expect(TONE_STYLE.danger).toEqual({ background: colors.dangerLight, text: colors.danger })
    for (const tone of ['waiting', 'working', 'good', 'closed', 'danger'] as const) {
      expect(TONE_STYLE[tone].background).not.toBe(colors.accent)
      expect([colors.butter, colors.tape]).not.toContain(TONE_STYLE[tone].background)
    }
    // text is ink, never pure black; the standard button is juniper, never yellow
    expect(Object.values(colors).map((c) => c.toUpperCase())).not.toContain('#000000')
    expect(colors.brand).toBe('#205E56')
    expect(colors.accent).toBe('#FFC53D')
  })
})

describe('sharing and the words under a question', () => {
  it('the share text names the business and carries the link', () => {
    expect(shareMessage('A Business', 'https://app.test/q/1?token=t')).toBe('Your estimate from A Business: https://app.test/q/1?token=t')
    expect(shareMessage('  ', 'https://app.test/q/1')).toBe('Your estimate: https://app.test/q/1')
  })

  it('a label reading is one plain line, with the label\'s own words kept apart; no arrow, no rule name', () => {
    const words = evidenceWords('Read from the unit\'s rating plate (photo 2): "MODEL GSX140361 R410A" → 3 (model number)')
    expect(words).toEqual({ line: "Read from the unit's rating plate, photo 2: 3", labelText: 'MODEL GSX140361 R410A' })
    expect(words!.line).not.toMatch(/→|"|model number/)
    expect(evidenceWords('Read from the tank label: 50 gal')).toEqual({ line: 'Read from the tank label: 50 gal', labelText: null })
    // anything that is not a reading is shown as it is
    expect(evidenceWords('Measured from two photos')).toEqual({ line: 'Measured from two photos', labelText: null })
    expect(evidenceWords(undefined)).toBeNull()
  })
})

describe('the sign-in is stored in parts', () => {
  function memory() {
    const data = new Map<string, string>()
    const base: KeyValue = {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        if (v.length > CHUNK_CHARS) throw new Error('too long for the keychain')
        data.set(k, v)
      },
      removeItem: async (k) => {
        data.delete(k)
      },
    }
    return { data, store: chunkedStore(base) }
  }

  it('a long session is kept and read back whole, and no part is longer than the keychain takes', async () => {
    const { data, store } = memory()
    const session = JSON.stringify({ access_token: 'a'.repeat(1400), refresh_token: 'r'.repeat(60), user: { id: 'u', note: 'é'.repeat(900) } })
    await store.setItem('sb-auth', session)
    expect(await store.getItem('sb-auth')).toBe(session)
    expect([...data.values()].every((v) => v.length <= CHUNK_CHARS)).toBe(true)
    expect(data.size).toBeGreaterThan(2)
  })

  it('a shorter value after a longer one leaves no old parts behind; removing removes every part', async () => {
    const { data, store } = memory()
    await store.setItem('k', 'x'.repeat(CHUNK_CHARS * 3 + 5))
    await store.setItem('k', 'y'.repeat(CHUNK_CHARS + 5))
    expect(await store.getItem('k')).toBe('y'.repeat(CHUNK_CHARS + 5))
    expect(data.size).toBe(3)
    await store.setItem('k', 'short')
    expect(await store.getItem('k')).toBe('short')
    expect(data.size).toBe(1)
    await store.setItem('k', 'z'.repeat(CHUNK_CHARS * 2))
    await store.removeItem('k')
    expect(data.size).toBe(0)
    expect(await store.getItem('k')).toBeNull()
  })

  it('a value saved before this existed is still read; half a value is no value', async () => {
    const { data, store } = memory()
    data.set('old', 'plain-session')
    expect(await store.getItem('old')).toBe('plain-session')
    await store.setItem('k', 'x'.repeat(CHUNK_CHARS * 2))
    data.delete('k.1')
    expect(await store.getItem('k')).toBeNull()
  })
})

describe('set-up', () => {
  it('a missing setting is named, never thrown, and never shown with a value', () => {
    expect(missingSettings({ EXPO_PUBLIC_API_URL: 'https://x.test', EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined })).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    ])
    expect(missingSettings({ EXPO_PUBLIC_API_URL: 'a', EXPO_PUBLIC_SUPABASE_URL: 'b', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'c' })).toEqual([])
  })
})

// a typed draft is what the tests above build on
const _draftShape: Pick<Draft, 'id' | 'owner' | 'send'> = { id: 'd', owner: 'u', send: 'editing' }
void _draftShape
