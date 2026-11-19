/**
 * T-184: the app as a professional on-site tool. The rules that are plain
 * functions are held here; what only a phone shows (the camera, haptics,
 * fonts, VoiceOver) is the owner's test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { AppAccountResponse, QuoteListItem } from '@qolumns/shared'
import { ApiError } from '../lib/api'
import { planLine, shortLink, usageFraction, usageLine } from '../lib/account'
import { plainError, PLAIN } from '../lib/errors'
import { clamp01, fractionOf, toNumber } from '../lib/numbers'
import { createOutbox, type NewPhoto } from '../lib/outbox'
import { pricingStages } from '../lib/pricing-stages'
import { qrMatrix, rowRuns } from '../lib/qr'
import { groupQuotes, listGroupOf, matchesSearch, rowWords } from '../lib/quote-list'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')

// ---------------------------------------------------------------------------
// 1. The BigInt error
// ---------------------------------------------------------------------------

describe('T-184: numbers from the phone', () => {
  it('the fault itself: a BigInt handed to Math.min throws (this is what the red message was)', () => {
    const sent = BigInt(50)
    const total = BigInt(200)
    // what the old code did with iOS's 64-bit counts: divide them, then clamp the result
    expect(() => Math.min(1, (sent / total) as unknown as number)).toThrow(/BigInt/)
  })

  it('upload progress is right whether the counts are numbers, BigInts or text', () => {
    expect(fractionOf(50, 200)).toBe(0.25)
    expect(fractionOf(BigInt(50), BigInt(200))).toBe(0.25)
    expect(fractionOf('50', '200')).toBe(0.25)
    expect(fractionOf(BigInt(200), BigInt(200))).toBe(1)
    // nothing to divide by, or nonsense: no progress, never an error
    expect(fractionOf(BigInt(5), BigInt(0))).toBe(0)
    expect(fractionOf(undefined, null)).toBe(0)
    expect(fractionOf(BigInt(900), BigInt(200))).toBe(1)
  })

  it('toNumber never throws and never returns something that is not a number', () => {
    expect(toNumber(BigInt(1234567))).toBe(1234567)
    expect(toNumber(12.5)).toBe(12.5)
    expect(toNumber('42')).toBe(42)
    for (const odd of [undefined, null, NaN, Infinity, '', 'abc', {}, [], Symbol('x'), () => 1]) expect(toNumber(odd, 7)).toBe(7)
    expect(clamp01(BigInt(3))).toBe(1)
    expect(clamp01(-2)).toBe(0)
  })

  it('a photo whose size or progress arrives as a BigInt is stored and sent as ordinary numbers', async () => {
    let saved: string | null = null
    const starts: unknown[] = []
    const outbox = createOutbox({
      api: {
        startUpload: async (_key: string, file: unknown) => {
          starts.push(file)
          return { assetId: 'ast_1', uploadUrl: 'https://upload.test/1' }
        },
        createQuote: async () => ({ quoteId: 'qte_1', status: 'queued' as const }),
      } as never,
      tenantKey: async () => 'tkey_test',
      store: { read: async () => saved, write: async (json) => void (saved = json) },
      files: {
        // the phone reports progress in BigInts, as iOS does
        put: async (_url, _photo, onProgress) => {
          onProgress(BigInt(0) as unknown as number)
          onProgress(BigInt(1) as unknown as number)
        },
        remove: async () => undefined,
      },
      saveQuoteLink: async () => undefined,
      owner: () => 'user_1',
      now: () => 1_000,
      newId: (() => {
        let n = 0
        return () => `id-${++n}`
      })(),
    })
    await outbox.load()
    const draft = outbox.start()!
    const photo = { uri: 'file:///p.jpg', fileName: 'p.jpg', contentType: 'image/jpeg', sizeBytes: BigInt(34567) as unknown as number, angleId: null } satisfies NewPhoto
    outbox.addPhoto(draft.id, photo)
    await outbox.pump()
    const kept = outbox.find(draft.id)!.photos[0]!
    expect(kept.state).toBe('done')
    expect(typeof kept.sizeBytes).toBe('number')
    expect(kept.sizeBytes).toBe(34567)
    expect(starts[0]).toMatchObject({ sizeBytes: 34567 })
    // and the draft can be written to the phone (a BigInt cannot be turned into JSON)
    expect(saved).toContain('"sizeBytes":34567')
  })

  it('the upload code converts the phone’s counts before using them, and cannot throw from the progress callback', () => {
    const files = read('src/lib/device-files.ts')
    expect(files).toContain('onProgress(fractionOf(event?.bytesSent, event?.totalBytes))')
    expect(files).not.toContain('bytesSent / totalBytes')
    expect(files).toContain('sizeBytes: toNumber(kept.size)')
    expect(read('src/lib/outbox.ts')).toContain('progress: clamp01(fraction)')
  })
})

// ---------------------------------------------------------------------------
// 1b. No raw error text reaches the screen
// ---------------------------------------------------------------------------

describe('T-184: errors are plain sentences', () => {
  it('a fault inside the app is never shown in its own words', () => {
    for (const thrown of [new TypeError('Cannot convert BigInt to number'), new Error('undefined is not a function'), 'boom', null, { code: 1 }]) {
      const said = plainError(thrown)
      expect(said).toBe(PLAIN.unknown)
      expect(said).not.toMatch(/BigInt|undefined|function/)
    }
  })

  it('the server’s own sentence is shown as it is; a program’s text from the server is not', () => {
    // T-191: the plan limit has the app's own line (the server's words name a plan to buy, which the app may not)
    expect(plainError(new ApiError(409, 'CONFLICT', 'Your free quotes are used up.'))).toBe('Your free quotes are used up.')
    expect(plainError(new ApiError(402, 'PLAN_LIMIT_REACHED', 'Your free quotes are used up.'))).toBe(PLAIN.planLimit)
    expect(plainError(new ApiError(500, 'HTTP_ERROR', 'Request failed (500)'))).toBe(PLAIN.unknown)
    expect(plainError(new ApiError(500, 'INTERNAL', 'TypeError: x is not a function'))).toBe(PLAIN.unknown)
    expect(plainError(new ApiError(400, 'BAD', '{"error":"x"}'), 'Try again.')).toBe('Try again.')
  })

  it('no signal and a lapsed sign-in have their own plain lines', () => {
    expect(plainError(new ApiError(0, 'NETWORK', 'No signal'))).toBe(PLAIN.offline)
    expect(plainError(new ApiError(401, 'UNAUTHORIZED', 'Not authenticated'))).toBe(PLAIN.signIn)
  })

  it('no screen shows a thrown error’s own message', () => {
    for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/new.tsx', 'app/(tabs)/account.tsx', 'app/quote/[id].tsx', 'app/link.tsx', 'app/login.tsx']) {
      const source = read(file)
      expect(source, file).not.toMatch(/set\w*Error\((e|error|failure|authError)\.message\)/)
      expect(source, file).not.toMatch(/e instanceof Error \? e\.message/)
    }
    // and a fault while a screen is drawn is caught at the top
    expect(read('app/_layout.tsx')).toContain('<ErrorBoundary>')
  })
})

// ---------------------------------------------------------------------------
// 3. The Quotes tab
// ---------------------------------------------------------------------------

const NOW = new Date('2026-11-19T12:00:00Z')
const item = (over: Partial<QuoteListItem>): QuoteListItem => ({
  quoteId: `qte_${Math.random().toString(36).slice(2, 8)}`,
  serviceName: 'Service A',
  customerName: 'Megan Grant',
  customerEmail: '',
  status: 'pending_review',
  createdAt: '2026-11-19T10:00:00Z',
  sentAt: null,
  viewedAt: null,
  acceptedAt: null,
  paidAt: null,
  total: 250,
  currency: 'USD',
  ...over,
})

describe('T-184: the Quotes tab is what needs me now', () => {
  const list = [
    item({ status: 'sent', customerName: 'Sam Carter' }),
    item({ status: 'accepted', customerName: 'Dana Whitfield' }),
    item({ status: 'pending_review', customerName: 'Megan Grant' }),
    item({ status: 'failed', customerName: 'Jordan Reyes', total: 0 }),
    item({ status: 'pending_review', held: true, total: 0, customerName: 'Alex Morgan' }),
    item({ status: 'declined', customerName: 'Chris Lane' }),
    item({ status: 'generating', customerName: 'Pat Quinn', total: 0 }),
  ]

  it('groups in the dashboard’s order, "Needs you" first with its count', () => {
    const groups = groupQuotes(list)
    expect(groups.map((g) => [g.title, g.count])).toEqual([
      ['Needs you', 3],
      ['Waiting for customer', 1],
      ['Accepted', 1],
      ['Everything else', 2],
    ])
  })

  it('a request that could not be priced and one held at the limit are in "Needs you", with their reason and no figure', () => {
    const failed = list[3]!
    const held = list[4]!
    expect(listGroupOf(failed)).toBe('needs_you')
    expect(listGroupOf(held)).toBe('needs_you')
    const failedWords = rowWords(failed, { now: NOW })
    const heldWords = rowWords(held, { now: NOW })
    expect(failedWords.state).toBe('Could not be priced')
    expect(heldWords.state).toBe('Saved, not priced yet')
    expect(failedWords.total).toBeNull()
    expect(heldWords.total).toBeNull()
    expect(`${failedWords.spoken}${heldWords.spoken}`).not.toContain('0.00')
  })

  it('a group with nothing in it is left out', () => {
    expect(groupQuotes([item({ status: 'accepted' })]).map((g) => g.key)).toEqual(['accepted'])
    expect(groupQuotes([])).toEqual([])
  })

  it('each row says the customer, the service, the total, the state and when', () => {
    const words = rowWords(item({ status: 'sent', total: 1400, sentAt: '2026-11-19T10:05:00Z' }), { now: NOW })
    expect(words.customer).toBe('Megan Grant')
    expect(words.service).toBe('Service A')
    expect(words.total).toBe('$1,400.00')
    expect(words.state).toBe('Waiting for customer')
    expect(words.when).toBeTruthy()
    expect(words.spoken).toContain('Megan Grant, Service A, $1,400.00, Waiting for customer')
  })

  it('search is by customer name, whatever the case', () => {
    expect(matchesSearch({ customerName: 'Megan Grant' }, 'gra')).toBe(true)
    expect(matchesSearch({ customerName: 'Megan Grant' }, '  MEGAN ')).toBe(true)
    expect(matchesSearch({ customerName: 'Megan Grant' }, 'carter')).toBe(false)
    expect(matchesSearch({ customerName: 'Megan Grant' }, '')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. The stages while a job is priced
// ---------------------------------------------------------------------------

describe('T-184: the live pricing stages', () => {
  const states = (input: Parameters<typeof pricingStages>[0]) => pricingStages(input).map((s) => `${s.key}:${s.state}`)

  it('photos uploading, then sent, then priced, then ready: each stage in turn', () => {
    expect(states({ photosTotal: 3, photosDone: 1, sent: false })).toEqual(['photos:now', 'sent:next', 'pricing:next', 'ready:next'])
    expect(states({ photosTotal: 3, photosDone: 3, sent: false })).toEqual(['photos:done', 'sent:now', 'pricing:next', 'ready:next'])
    expect(states({ photosTotal: 3, photosDone: 3, sent: true, status: 'queued' })).toEqual(['photos:done', 'sent:done', 'pricing:now', 'ready:next'])
    expect(states({ photosTotal: 3, photosDone: 3, sent: true, status: 'generating' })).toEqual(['photos:done', 'sent:done', 'pricing:now', 'ready:next'])
    expect(states({ photosTotal: 3, photosDone: 3, sent: true, status: 'pending_review' })).toEqual(['photos:done', 'sent:done', 'pricing:done', 'ready:done'])
  })

  it('says how many photos have gone, and says "waiting for a signal" where it is stuck', () => {
    const uploading = pricingStages({ photosTotal: 3, photosDone: 1, sent: false })
    expect(uploading[0]!.note).toBe('1 of 3 uploaded')
    const stuck = pricingStages({ photosTotal: 2, photosDone: 2, sent: false, waitingForSignal: true })
    expect(stuck[1]!.state).toBe('stuck')
    expect(stuck[1]!.note).toMatch(/Waiting for a signal/)
  })

  it('a job with no photos says so and moves straight on', () => {
    const none = pricingStages({ photosTotal: 0, photosDone: 0, sent: false })
    expect(none[0]).toMatchObject({ label: 'No photos to upload', state: 'done' })
    expect(none[1]!.state).toBe('now')
  })

  it('names only stages the app knows for certain: nothing about reading photos or measuring is pretended', () => {
    const labels = pricingStages({ photosTotal: 1, photosDone: 1, sent: true, status: 'generating' }).map((s) => s.label)
    expect(labels).toEqual(['Photo uploaded', 'Job sent', 'Working out the price', 'Price ready'])
  })
})

// ---------------------------------------------------------------------------
// 5. The Account tab
// ---------------------------------------------------------------------------

const account = (over: Partial<AppAccountResponse> = {}): AppAccountResponse => ({
  businessName: 'Business A',
  logoUrl: null,
  planName: 'Pro',
  usage: { used: 37, limit: 200, unlimited: false, per: 'month' },
  quoteLink: 'https://qolumns.com/quote/business-a',
  supportEmail: 'hello@qolumns.com',
  ...over,
})

describe('T-184: the Account tab', () => {
  it('names the plan and counts its use', () => {
    expect(planLine(account())).toBe('Pro')
    expect(usageLine(account())).toBe('37 of 200 quotes used this month')
    expect(usageFraction(account())).toBeCloseTo(0.185)
  })

  it('the free allowance never resets, and is said so', () => {
    const free = account({ planName: null, usage: { used: 8, limit: 10, unlimited: false, per: 'total' } })
    expect(planLine(free)).toBe('Free quotes')
    expect(usageLine(free)).toBe('8 of 10 free quotes used')
  })

  it('a plan with no limit has a count and no bar', () => {
    const open = account({ usage: { used: 1, limit: 0, unlimited: true, per: 'month' } })
    expect(usageLine(open)).toBe('1 quote this month')
    expect(usageFraction(open)).toBeNull()
  })

  it('says nothing about money and offers no way to buy (App Store rule)', () => {
    const words = [planLine(account()), usageLine(account()), usageLine(account({ planName: null, usage: { used: 10, limit: 10, unlimited: false, per: 'total' } }))].join(' ')
    expect(words).not.toMatch(/[$£€]|\bprice|upgrade|billing|buy|subscribe|per month|a month\b/i)
    const screen = read('app/(tabs)/account.tsx')
    expect(screen).not.toMatch(/upgrade|billing|checkout|[$£€]\d/i)
    // and the quote screen no longer sends anyone to billing
    expect(read('app/quote/[id].tsx')).not.toMatch(/Billing|upgrade/i)
  })

  it('the quote link is read out without its scheme', () => {
    expect(shortLink('https://qolumns.com/quote/business-a/')).toBe('qolumns.com/quote/business-a')
  })

  it('the QR code holds the link: finder patterns in three corners, and rows drawn as runs', () => {
    const matrix = qrMatrix('https://qolumns.com/quote/business-a')
    const n = matrix.length
    expect(n).toBeGreaterThanOrEqual(21)
    expect(matrix.every((row) => row.length === n)).toBe(true)
    // a finder pattern's outer ring is dark: top-left, top-right and bottom-left corners
    for (const [r, c] of [[0, 0], [0, n - 1], [n - 1, 0]] as const) expect(matrix[r]![c]).toBe(true)
    // the fourth corner has no finder pattern
    const runs = rowRuns(matrix[0]!)
    expect(runs.reduce((sum, run) => sum + run.length, 0)).toBe(n)
    expect(runs[0]).toEqual({ dark: true, length: 7 })
    expect(runs.length).toBeLessThan(n)
    expect(qrMatrix('https://qolumns.com/quote/another')).not.toEqual(matrix)
  })
})

// ---------------------------------------------------------------------------
// 2, 6, 7. The structure, the scan card, the look: what the source must hold
// ---------------------------------------------------------------------------

describe('T-184: structure, the room scan card, look and feel', () => {
  it('three tabs: Quotes, New quote in the centre, Account', () => {
    const tabs = read('app/(tabs)/_layout.tsx')
    const order = ['name="index"', 'name="new"', 'name="account"'].map((n) => tabs.indexOf(n))
    expect(order.every((i) => i > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(tabs).toContain('insets.bottom')
    for (const label of ["'Quotes'", "'New quote'", "'Account'"]) expect(tabs).toContain(label)
  })

  it('sign out is on Account, not in the quotes list', () => {
    expect(read('app/(tabs)/index.tsx')).not.toMatch(/sign out|signOut/i)
    expect(read('app/(tabs)/account.tsx')).toContain('title="Sign out"')
  })

  it('an unfinished quote is reachable from Quotes and from New quote', () => {
    expect(read('app/(tabs)/index.tsx')).toContain('Unfinished quote')
    expect(read('app/(tabs)/_layout.tsx')).toContain("unfinished ? 'Carry on' : 'New quote'")
  })

  it('the steps are in the screen’s own top, above the part that scrolls', () => {
    const screen = read('app/(tabs)/new.tsx')
    const top = screen.indexOf('<TopBar title={service?.name')
    const steps = screen.indexOf('Step {position + 1} of {stepsShown.length}')
    const scroll = screen.indexOf('<ScrollView', top)
    expect(top).toBeGreaterThan(-1)
    expect(steps).toBeGreaterThan(top)
    expect(steps).toBeLessThan(scroll)
    expect(screen).not.toContain('Stack.Screen')
  })

  it('the scan card shows wherever a service can use a scan, and says why when the scan cannot run here', () => {
    const screen = read('app/(tabs)/new.tsx')
    expect(screen).toContain("const showScan = scanSignals.length > 0 && scanState !== 'not_ios' && scanState !== 'no_lidar'")
    expect(screen).toContain('{showScan ? (')
    expect(screen).toContain('disabled={!canScan}')
    const scan = read('modules/room-scan/index.ts')
    expect(scan).toContain("if (!native) return 'needs_full_app'")
    expect(scan).toContain("'Room scan needs the full app'")
  })

  it('the quote screen: no grade letter, photos open full screen, the link can be sent again and copied, editing is on the web', () => {
    const screen = read('app/quote/[id].tsx')
    expect(screen).not.toMatch(/Grade \{|estimate\.grade|estimate\.label/)
    // T-185: the sentence comes from the shared rule, never the stored words as they are
    // T-186: the sentence is the server's (the dashboard's own), with the shared one for an older server
    expect(screen).toContain('quote.pricing.certainty')
    expect(screen).toContain("router.push(`/photo?index=${index}`)")
    expect(screen).toContain('title="Send the link again"')
    expect(screen).toContain('Clipboard.setStringAsync')
    expect(screen).toContain('title="Edit in the dashboard"')
    expect(screen).toContain('Customer also asked for')
    expect(screen).toContain('story.steps')
    expect(screen).toContain('<PricingStages')
  })

  it('the brand faces are named by family, never by a weight beside them; one icon set', () => {
    const theme = read('src/theme.ts')
    // T-185: figures are in the text face with tabular digits; the mono face is no longer in the app
    for (const face of ['BricolageGrotesque_800ExtraBold', 'InstrumentSans_400Regular', 'InstrumentSans_700Bold']) expect(theme).toContain(face)
    for (const file of ['src/components/ui.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/new.tsx', 'app/(tabs)/account.tsx', 'app/quote/[id].tsx', 'app/link.tsx', 'app/login.tsx', 'src/components/PricingStages.tsx']) {
      const source = read(file)
      expect(source, file).not.toMatch(/fontWeight:/)
      // every icon comes through the one Icon component (Ionicons)
      if (file !== 'src/components/ui.tsx') expect(source, file).not.toMatch(/from '@expo\/vector-icons'/)
    }
    expect(read('src/components/ui.tsx')).toContain("import { Ionicons } from '@expo/vector-icons'")
  })

  it('no button is yellow; yellow stays for "needs you"', () => {
    const ui = read('src/components/ui.tsx')
    expect(ui.slice(ui.indexOf('buttonPrimary:'), ui.indexOf('buttonText:'))).not.toContain('accent')
    expect(read('app/(tabs)/_layout.tsx')).toContain('backgroundColor: colors.brand')
  })

  it('haptics, Reduce Motion and screen-reader labels', () => {
    const ui = read('src/components/ui.tsx')
    expect(ui).toContain("if (variant === 'primary') tap()")
    expect(ui).toContain('const still = useReduceMotion()')
    const feel = read('src/lib/feel.ts')
    expect(feel).toContain('isReduceMotionEnabled')
    expect(feel).toContain('.catch(() => undefined)')
    // every pressable thing says what it is
    for (const file of ['src/components/ui.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/new.tsx', 'app/quote/[id].tsx', 'app/photo.tsx']) {
      const source = read(file)
      const pressables = source.split('<Pressable').slice(1)
      for (const block of pressables) expect(block.slice(0, block.indexOf('>')), file).toMatch(/accessibilityLabel|accessibilityRole/)
    }
  })

  it('an icon and a splash are set', () => {
    const app = JSON.parse(read('app.json')) as { expo: { icon?: string; plugins: unknown[] } }
    expect(app.expo.icon).toBe('./assets/icon.png')
    expect(JSON.stringify(app.expo.plugins)).toContain('"expo-splash-screen"')
    expect(JSON.stringify(app.expo.plugins)).toContain('./assets/splash.png')
  })
})
