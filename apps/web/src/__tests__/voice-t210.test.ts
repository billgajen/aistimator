/**
 * T-210: the private voice test ("Oumn test call").
 *
 * Her tools (the business is the session's, bad arguments are turned away, an estimate writes
 * nothing), the made-up slots, the cost of a call, and the amounts she says held against the
 * engine's. What the page does in a browser, and that a call leaves no row behind, is
 * scripts/hardcore-test/verify-t210.mts.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CUSTOMER_BANNED_WORDS, DEFAULT_LIVE_VOICE, LIVE_VOICES, getLivePrice, getRegion, resolveModelRoute } from '@qolumns/shared'
import registry from '../../../../packages/shared/src/ai-models.json'
import type { WorkerPreview } from '@/lib/pricing-preview'
import type { VoiceBusiness } from '@/lib/voice/business'
import { measurementsOf } from '@/lib/voice/business'
import { ASSISTANT_NAME, CALL_LIMIT_SECONDS, THINGS_TO_TRY, TOKEN_LIFE_SECONDS, WRAP_UP_SECONDS, liveSocketUrl, voiceTestEnabled } from '@/lib/voice/config'
import { NO_TOKENS, addUsage, callCost, median, worst } from '@/lib/voice/cost'
import { buildInstruction } from '@/lib/voice/instructions'
import { lockedSetup, mintLiveToken, tokenRequest } from '@/lib/voice/live-token'
import { bannedWordsSaid, priceChecks, resultsText, type CallResults } from '@/lib/voice/results'
import { readSession, signSession, type CallSession } from '@/lib/voice/session'
import { TEST_SLOT_DAYS, TEST_SLOT_HOURS, isTestSlot, testSlots } from '@/lib/voice/slots'
import { checkSpokenPrice, spokenAmounts, wordsToNumber } from '@/lib/voice/spoken'
import { TOOL_NAMES, businessInfo, runTool, toolDeclarations, toolResponse } from '@/lib/voice/tools'
import { VOICE_WORKLETS } from '@/lib/voice/worklets'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const VOICE_DIR = 'apps/web/src/lib/voice'
const VOICE_FILES = readdirSync(join(ROOT, VOICE_DIR)).map((f) => `${VOICE_DIR}/${f}`)
const ROUTES = ['apps/web/src/app/api/admin/voice-test/session/route.ts', 'apps/web/src/app/api/admin/voice-test/tool/route.ts']
const PAGE = 'apps/web/src/app/admin/voice-test/page.tsx'
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** A business as the loader hands it over. Its two services are priced from its own made-up rules. */
function business(over: Partial<VoiceBusiness> = {}): VoiceBusiness {
  const us = getRegion('US')
  return {
    id: 'tnt_one',
    name: 'Harlow Works',
    region: 'US',
    locale: us.locale,
    languageVariant: us.copy.languageVariant,
    emergencyNumber: us.emergencyNumber,
    timeZone: 'America/New_York',
    currency: 'USD',
    serviceArea: { everywhere: false, areas: ['63021', 'Missouri'], postalCodeLabel: 'ZIP code' },
    terms: 'Half is due before work starts.',
    services: [
      {
        id: 'svc_a',
        name: 'Service A',
        description: 'The first service.',
        included: ['Part one'],
        notIncluded: ['Part nine'],
        assumptions: ['Access from the ground'],
        questions: [
          { id: 'size', question: 'How large is it?', type: 'number', required: true, choices: [], help: null },
          { id: 'finish', question: 'Which finish?', type: 'select', required: false, choices: [{ value: 'std', label: 'Standard' }, { value: 'prem', label: 'Premium' }], help: null },
          { id: 'rush', question: 'Is it urgent?', type: 'boolean', required: false, choices: [], help: null },
        ],
        measurements: [{ id: 'measured_area', what: 'Area read from photos', unit: 'sq ft' }],
        row: { id: 'svc_a', name: 'Service A' },
        rules: { baseFee: 0 },
        fields: [
          { fieldId: 'size', type: 'number', label: 'How large is it?', required: true },
          { fieldId: 'finish', type: 'select', label: 'Which finish?', required: false, options: [{ value: 'std', label: 'Standard' }, { value: 'prem', label: 'Premium' }] },
          { fieldId: 'rush', type: 'boolean', label: 'Is it urgent?', required: false },
        ],
      },
      { id: 'svc_b', name: 'Service B', description: null, included: [], notIncluded: [], assumptions: [], questions: [], measurements: [], row: { id: 'svc_b', name: 'Service B' }, rules: null, fields: [] },
    ],
    ...over,
  }
}

const priced = (over: Partial<Extract<WorkerPreview, { success: true }>> = {}): WorkerPreview => ({ success: true, currency: 'USD', lines: [{ label: 'Base', amount: 75 }, { label: 'Work', amount: 375 }], subtotal: 450, taxAmount: 0, total: 450, notes: [], steps: [], unmeasured: [], ...over })
const NOW = new Date('2026-11-27T15:00:00Z') // a Friday

describe('T-210 her tools: the business is the session’s', () => {
  const SECRET = 'a-server-only-value'
  const session: CallSession = { v: 1, callId: 'call-1', tenantId: 'tnt_one', adminId: 'admin-1', voice: 'Aoede', exp: 2_000_000_000 }

  it('a signed session comes back as it was, for the admin who started the call', () => {
    expect(readSession(signSession(session, SECRET), SECRET, { adminId: 'admin-1', nowSeconds: 1_900_000_000 })).toEqual(session)
  })

  it('a session whose business was changed, signed with another secret, run out, or another admin’s, is refused', () => {
    const signed = signSession(session, SECRET)
    const [payload, signature] = signed.split('.') as [string, string]
    const other = Buffer.from(JSON.stringify({ ...session, tenantId: 'tnt_two' }), 'utf8').toString('base64url')
    expect(readSession(`${other}.${signature}`, SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
    expect(readSession(`${payload}.${signature.replace(/.$/, signature.endsWith('0') ? '1' : '0')}`, SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
    expect(readSession(signSession(session, 'another-secret'), SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
    expect(readSession(signed, SECRET, { adminId: 'admin-1', nowSeconds: session.exp })).toBeNull()
    expect(readSession(signed, SECRET, { adminId: 'admin-2', nowSeconds: 1 })).toBeNull()
    for (const junk of [undefined, null, 42, '', 'nodot', '.', `${payload}.`, 'x'.repeat(3000)]) expect(readSession(junk, SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
  })

  it('the tool route takes the business from the session and from nothing in the call', () => {
    const route = code(ROUTES[1]!)
    expect(route).toContain('const session = readSession(body.session, secret, { adminId: admin.userId, nowSeconds: Math.floor(Date.now() / 1000) })')
    expect(route).toContain('const business = await loadVoiceBusiness(createAdminClient(), session.tenantId)')
    expect(route).toContain('await runTool(business, body.name, body.args, { price: previewPriceNow })')
    // the arguments are handed to the tool whole and read nowhere else
    expect(route.match(/body\.args/g)).toHaveLength(1)
    expect(route).not.toMatch(/tenantId:\s*body|args\.tenant|args\?\.tenant/)
  })

  it('no tool takes a business: an argument naming one is turned away, on every tool', async () => {
    const price = vi.fn(async () => priced())
    for (const name of TOOL_NAMES) {
      for (const stray of [{ tenantId: 'tnt_two' }, { businessId: 'tnt_two' }, { tenant_id: 'tnt_two' }]) {
        const outcome = await runTool(business(), name, { ...stray }, { price, now: () => NOW })
        expect(outcome, `${name} ${JSON.stringify(stray)}`).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
      }
      const declared = toolDeclarations().find((d) => d.name === name)!
      expect(Object.keys((declared.parameters as { properties: Record<string, unknown> }).properties).join(' ')).not.toMatch(/tenant|business/i)
    }
    expect(price).not.toHaveBeenCalled()
  })

  it('an estimate is priced for the session’s business, for one of its own services only', async () => {
    const price = vi.fn(async (_input: unknown) => priced())
    const outcome = await runTool(business(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '40' }] }, { price })
    expect(outcome.ok).toBe(true)
    expect(price).toHaveBeenCalledTimes(1)
    expect(price.mock.calls[0]![0]).toEqual({ tenantId: 'tnt_one', service: { id: 'svc_a', name: 'Service A' }, rules: { baseFee: 0 }, fields: business().services[0]!.fields, answers: [{ fieldId: 'size', value: 40 }] })
    // a service of another business is not in this one's list
    expect(await runTool(business(), 'get_estimate', { serviceId: 'svc_of_another_business', answers: [] }, { price })).toMatchObject({ ok: false, code: 'UNKNOWN_SERVICE' })
    expect(price).toHaveBeenCalledTimes(1)
  })

  it('she is told the business’s configuration, and nothing the pricing worker needs', () => {
    const info = businessInfo(business())
    expect(info).toMatchObject({ name: 'Harlow Works', timeZone: 'America/New_York', currency: 'USD', standardTerms: 'Half is due before work starts.' })
    expect(info.serviceArea).toEqual({ covers: 'Only the areas listed (each is a ZIP code, the start of one, or a named area).', areas: ['63021', 'Missouri'] })
    expect(info.services[0]).toEqual({
      id: 'svc_a', name: 'Service A', description: 'The first service.', included: ['Part one'], notIncluded: ['Part nine'], assumptions: ['Access from the ground'],
      questions: [
        { id: 'size', ask: 'How large is it?', kind: 'number', required: true },
        { id: 'finish', ask: 'Which finish?', kind: 'select', required: false, choices: [{ value: 'std', label: 'Standard' }, { value: 'prem', label: 'Premium' }] },
        { id: 'rush', ask: 'Is it urgent?', kind: 'boolean', required: false },
      ],
      measurements: [{ id: 'measured_area', what: 'Area read from photos', unit: 'sq ft' }],
    })
    expect(JSON.stringify(info)).not.toMatch(/rules|baseFee|"row"|"fields"/)
    expect(businessInfo(business({ serviceArea: { everywhere: true, areas: [], postalCodeLabel: 'ZIP code' }, terms: null }))).toMatchObject({ serviceArea: { covers: 'The business has not limited the area it covers.' }, standardTerms: 'None written.' })
  })

  it('a size the photos would give is offered as a measurement only when no question asks for it', () => {
    const steps = [
      { id: 'a', name: 'Walls', quantitySource: { type: 'ai_signal', signalKey: 'wall_area' }, unitLabel: 'sq ft' },
      { id: 'b', name: 'Trim', quantitySource: { type: 'ai_signal', signalKey: 'trim_length' } },
      { id: 'c', name: 'Visit', quantitySource: { type: 'constant' } },
    ] as never
    const signals = [{ signalKey: 'wall_area', type: 'number', description: 'Wall area', unit: 'sqft' }] as never
    expect(measurementsOf(steps, signals, [{ fieldId: 'trim', type: 'number', label: 'Trim', required: false, mapsToSignal: 'trim_length' }])).toEqual([{ id: 'wall_area', what: 'Wall area', unit: 'sqft' }])
  })
})

describe('T-210 her tools: bad arguments are turned away', () => {
  const deps = { price: vi.fn(async () => priced()), now: () => NOW }
  const refused = async (name: string, args: unknown) => {
    const outcome = await runTool(business(), name, args, deps)
    expect(outcome.ok, `${name} ${JSON.stringify(args)}`).toBe(false)
    return outcome as Extract<typeof outcome, { ok: false }>
  }

  it('a name that is not a tool’s, and arguments that are not an object', async () => {
    expect((await refused('delete_everything', {})).code).toBe('UNKNOWN_TOOL')
    expect((await refused('', {})).code).toBe('UNKNOWN_TOOL')
    for (const args of ['a string', 42, ['a list'], true]) expect((await refused('get_business_info', args)).code).toBe('INVALID_ARGUMENT')
    expect((await refused('get_business_info', { anything: 1 })).code).toBe('INVALID_ARGUMENT')
  })

  it('get_estimate: every answer is one of that service’s own questions, of the right kind', async () => {
    const ask = (answers: unknown) => refused('get_estimate', { serviceId: 'svc_a', answers })
    expect((await ask('size is 40')).code).toBe('INVALID_ARGUMENT')
    expect((await ask([{ questionId: 'not_a_question', value: '1' }])).message).toContain('is not one of this service\'s questions')
    expect((await ask([{ questionId: 'size', value: 'forty' }])).message).toBe('"How large is it?" needs a number.')
    expect((await ask([{ questionId: 'size', value: '-3' }])).code).toBe('INVALID_ARGUMENT')
    expect((await ask([{ questionId: 'size', value: '40' }, { questionId: 'finish', value: 'Gold' }])).message).toBe('"Which finish?" must be one of: Standard, Premium.')
    expect((await ask([{ questionId: 'size', value: '40' }, { questionId: 'rush', value: 'maybe' }])).message).toBe('"Is it urgent?" needs yes or no.')
    expect((await ask([{ questionId: 'size', value: '40', extra: 'x' }])).code).toBe('INVALID_ARGUMENT')
    expect((await ask([{ value: '40' }])).code).toBe('INVALID_ARGUMENT')
    expect((await ask(Array.from({ length: 61 }, () => ({ questionId: 'size', value: '1' })))).code).toBe('INVALID_ARGUMENT')
    // a required question with no answer: she is told what to ask, and no price is worked out
    expect(await ask([{ questionId: 'finish', value: 'std' }])).toMatchObject({ code: 'MISSING_ANSWERS', message: 'Ask the customer first: How large is it?.' })
    expect((await refused('get_estimate', { serviceId: 42, answers: [] })).code).toBe('UNKNOWN_SERVICE')
    expect((await refused('get_estimate', { serviceId: 'svc_b', answers: [] })).code).toBe('NO_PRICE')
    expect(deps.price).not.toHaveBeenCalled()
  })

  it('answers are sent the way the request form sends them: a number, a choice by its key, yes or no', async () => {
    const price = vi.fn(async (_input: unknown) => priced())
    await runTool(business(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '1,250' }, { questionId: 'finish', value: 'premium' }, { questionId: 'rush', value: 'Yes' }, { questionId: 'measured_area', value: '400' }, { questionId: 'size', value: '40' }] }, { price })
    expect((price.mock.calls[0]![0] as { answers: unknown }).answers).toEqual([{ fieldId: 'size', value: 40 }, { fieldId: 'finish', value: 'prem' }, { fieldId: 'rush', value: true }, { fieldId: 'measured_area', value: 400 }])
  })

  it('when the engine gives no price she is told to give none', async () => {
    for (const reason of ['unreachable', 'failed', 'no_business'] as const) {
      const outcome = await runTool(business(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '40' }] }, { price: async () => ({ success: false, reason }) })
      expect(outcome).toMatchObject({ ok: false, code: 'ESTIMATE_UNAVAILABLE' })
      expect(toolResponse(outcome)).toEqual({ error: 'The estimate is not available right now. Do not give a price: say the business will confirm it.' })
    }
  })

  it('the estimate she gets is the engine’s own figures, unchanged, and is called an estimate', async () => {
    const outcome = await runTool(business(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '40' }] }, { price: async () => priced({ subtotal: 450, taxAmount: 37.13, taxLabel: 'Sales tax', total: 487.13, unmeasured: [{ stepId: 's', name: 'Ceiling', rate: 2, unitLabel: 'sq ft' }] }) })
    expect(outcome).toMatchObject({ ok: true, engine: { currency: 'USD', total: 487.13, subtotal: 450, taxAmount: 37.13, lines: [75, 375] } })
    expect(toolResponse(outcome)).toEqual({
      service: 'Service A', currency: 'USD', total: 487.13, totalAsText: '$487.13', subtotal: 450, tax: { label: 'Sales tax', amount: 37.13 },
      lines: [{ label: 'Base', amount: 75 }, { label: 'Work', amount: 375 }],
      notInThisEstimate: ['Ceiling'], notInThisEstimateWhy: 'These are priced from a size the business measures. They are not in the total.',
      status: 'An estimate. The business will confirm it.',
    })
  })

  it('get_free_times, book_time and request_person check what they are given', async () => {
    expect((await refused('get_free_times', { fromDate: 'next Tuesday' })).message).toBe('fromDate must be a date as YYYY-MM-DD.')
    expect((await refused('get_free_times', { fromDate: '2026-02-30' })).code).toBe('INVALID_ARGUMENT')
    const slot = testSlots({ timeZone: 'America/New_York', now: NOW }).slots[0]!.id
    expect((await refused('book_time', { slot: '2026-11-28T08:00', name: 'Dana Reyes', phone: '555 201 3434' })).code).toBe('UNKNOWN_SLOT') // a Saturday
    expect((await refused('book_time', { slot: '2026-11-30T09:00', name: 'Dana Reyes', phone: '555 201 3434' })).code).toBe('UNKNOWN_SLOT') // not a window
    expect((await refused('book_time', { slot, name: '', phone: '555 201 3434' })).code).toBe('INVALID_ARGUMENT')
    expect((await refused('book_time', { slot, name: 'Dana Reyes' })).code).toBe('MISSING_CONTACT')
    expect((await refused('book_time', { slot, name: 'Dana Reyes', phone: '12' })).code).toBe('INVALID_ARGUMENT')
    expect((await refused('book_time', { slot, name: 'Dana Reyes', email: 'dana at example' })).code).toBe('INVALID_ARGUMENT')
    expect((await refused('request_person', {})).code).toBe('INVALID_ARGUMENT')
    expect((await refused('request_person', { reason: 'x'.repeat(501) })).code).toBe('INVALID_ARGUMENT')
    expect((await refused('request_person', { reason: 'A leak', urgent: 'yes' })).code).toBe('INVALID_ARGUMENT')
  })

  it('book_time and request_person do nothing but say what would have happened', async () => {
    const slot = testSlots({ timeZone: 'America/New_York', now: NOW }).slots[1]!
    const booked = await runTool(business(), 'book_time', { slot: slot.id, name: 'Dana Reyes', phone: '(555) 201-3434', email: 'dana@example.com' }, deps)
    expect(booked).toMatchObject({ ok: true, wouldDo: `would book: ${slot.label} (America/New_York) for Dana Reyes, (555) 201-3434, dana@example.com`, result: { status: 'noted', tellTheCustomer: `The visit is noted for ${slot.label}. Harlow Works will confirm it.` } })
    expect(await runTool(business(), 'request_person', { reason: 'Wants to talk about a large job' }, deps)).toMatchObject({ ok: true, wouldDo: 'would pass to a person: Wants to talk about a large job', result: { tellTheCustomer: 'Someone from Harlow Works will get back to them.' } })
    expect(await runTool(business(), 'request_person', { reason: 'Water coming through the ceiling', urgent: true }, deps)).toMatchObject({ ok: true, wouldDo: 'would pass to a person (URGENT): Water coming through the ceiling' })
  })
})

describe('T-210 get_estimate writes nothing', () => {
  it('her tools have one way out, the pricing worker’s /preview, and no way to write', async () => {
    const tools = code(`${VOICE_DIR}/tools.ts`)
    expect(tools).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(|createAdminClient|createClient|fetch\(|sendEmail|postmark/i)
    // the only thing a tool is handed that can reach outside is `price`
    expect(tools).toContain('const priced = await deps.price({ tenantId: b.id, service: service.row, rules: service.rules, fields: service.fields, answers: read.answers })')
    expect(code(ROUTES[1]!)).toContain("import { previewPriceNow } from '@/lib/pricing-preview'")
    expect(code('apps/web/src/lib/pricing-preview.ts')).toContain('`${workerUrl}/preview`')
  })

  it('it is the same path as Test your pricing: the worker’s preview, which runs the pipeline and writes nothing', () => {
    expect(code('apps/web/src/app/api/services/preview-price/route.ts')).toContain('const priced = await previewPriceNow(input)')
    const preview = code('apps/worker/src/preview-pricing.ts')
    expect(preview).toContain("processQuote('preview', '', supabase, env, undefined, { preview: { data } })")
    expect(preview).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/)
  })

  it('nothing in the voice test writes a row: the loader, the routes and the page only read', () => {
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, 'apps/web/src/components/voice-test/VoiceTest.tsx']) {
      // (the one `.update(` in these files is the session's signature being computed, over a template string)
      expect(code(file), file).not.toMatch(/\.(insert|upsert|delete|rpc)\(|\.update\((?!`qolumns:voice-test)/)
    }
    const loader = code(`${VOICE_DIR}/business.ts`)
    expect(loader.match(/admin\.from\('/g)).toHaveLength(4)
    expect(loader.match(/\.select\(/g)).toHaveLength(4)
    // nothing of a call is logged
    for (const file of ROUTES) expect(code(file), file).not.toMatch(/console\.(log|info|warn)\(|logAdminActivity/)
  })
})

describe('T-210 the made-up free times (test data)', () => {
  it('weekdays only, from tomorrow, four two-hour windows a day', () => {
    const free = testSlots({ timeZone: 'America/New_York', now: NOW }) // Friday 27 Nov in New York
    expect(free.testData).toBe(true)
    expect(free.slots).toHaveLength(TEST_SLOT_DAYS * TEST_SLOT_HOURS.length)
    expect([...new Set(free.slots.map((s) => s.date))]).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
    expect([...new Set(free.slots.map((s) => s.weekday))]).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    expect(free.slots.slice(0, 4).map((s) => [s.id, s.start, s.end, s.label])).toEqual([
      ['2026-11-30T08:00', '08:00', '10:00', 'Monday, November 30, 8 am to 10 am'],
      ['2026-11-30T10:00', '10:00', '12:00', 'Monday, November 30, 10 am to 12 pm'],
      ['2026-11-30T13:00', '13:00', '15:00', 'Monday, November 30, 1 pm to 3 pm'],
      ['2026-11-30T15:00', '15:00', '17:00', 'Monday, November 30, 3 pm to 5 pm'],
    ])
    for (const s of free.slots) expect(Number(s.end.slice(0, 2)) - Number(s.start.slice(0, 2))).toBe(2)
  })

  it('"tomorrow" is the business’s tomorrow, not the server’s', () => {
    const lateUtc = new Date('2026-11-25T03:30:00Z') // Tuesday 24 Nov, 10:30 pm in New York; Wednesday 25 Nov, 3:30 am in London
    expect(testSlots({ timeZone: 'America/New_York', now: lateUtc }).slots[0]!.date).toBe('2026-11-25')
    expect(testSlots({ timeZone: 'Europe/London', now: lateUtc }).slots[0]!.date).toBe('2026-11-26')
    expect(testSlots({ timeZone: 'Pacific/Auckland', now: lateUtc }).slots[0]!.date).toBe('2026-11-26')
    expect(testSlots({ timeZone: 'Europe/London', locale: 'en-GB', now: lateUtc }).slots[0]!.label).toBe('Thursday 26 November, 8 am to 10 am')
  })

  it('a later first day is kept; an earlier one, or today, is moved to tomorrow', () => {
    expect(testSlots({ fromDate: '2026-12-12', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-12-14') // the 12th is a Saturday
    expect(testSlots({ fromDate: '2026-12-09', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-12-09')
    expect(testSlots({ fromDate: '2020-01-01', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-11-30')
    expect(testSlots({ fromDate: '2026-11-27', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-11-30')
    expect(testSlots({ fromDate: 'not a date', timeZone: 'America/New_York', now: NOW }).slots[0]!.date).toBe('2026-11-30')
  })

  it('only a slot on offer can be booked', () => {
    expect(isTestSlot('2026-11-30T08:00', { timeZone: 'America/New_York', now: NOW })?.label).toBe('Monday, November 30, 8 am to 10 am')
    for (const bad of ['2026-11-29T08:00', '2026-11-30T09:00', '2026-11-27T08:00', '2020-01-06T08:00', 'tomorrow', '', null, 5]) expect(isTestSlot(bad, { timeZone: 'America/New_York', now: NOW }), String(bad)).toBeNull()
  })

  it('the code says it is test data, and get_free_times uses nothing else', async () => {
    expect(read(`${VOICE_DIR}/slots.ts`)).toMatch(/FAKE free times[\s\S]*TEST DATA\. No calendar exists yet/)
    const outcome = await runTool(business(), 'get_free_times', {}, { price: async () => priced(), now: () => NOW })
    expect(outcome).toMatchObject({ ok: true, wouldDo: 'TEST DATA: 20 made-up free times from 2026-11-30' })
    expect((toolResponse(outcome) as { freeTimes: unknown[] }).freeTimes[0]).toEqual({ id: '2026-11-30T08:00', when: 'Monday, November 30, 8 am to 10 am' })
  })
})

describe('T-210 what a call cost', () => {
  const price = getLivePrice(resolveModelRoute('voice_call').model)!

  it('adds each turn’s usage by modality; what has no modality is text', () => {
    // the two shapes the Live API sent on 27 Nov 2026: a tool call's turn, and a spoken turn
    let sum = addUsage(NO_TOKENS, { promptTokenCount: 609, responseTokenCount: 6, totalTokenCount: 615, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 370 }, { modality: 'AUDIO', tokenCount: 194 }], thoughtsTokenCount: 54 })
    expect(sum).toEqual({ turns: 1, textIn: 415, audioIn: 194, otherIn: 0, textOut: 6, audioOut: 0, thoughts: 54 })
    sum = addUsage(sum, { promptTokenCount: 596, responseTokenCount: 68, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 357 }, { modality: 'AUDIO', tokenCount: 194 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 68 }], thoughtsTokenCount: 27 })
    expect(sum).toEqual({ turns: 2, textIn: 817, audioIn: 388, otherIn: 0, textOut: 6, audioOut: 68, thoughts: 81 })
    expect(addUsage(NO_TOKENS, {})).toEqual({ ...NO_TOKENS, turns: 1 })
    expect(addUsage(NO_TOKENS, { promptTokenCount: 10, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 4 }], toolUsePromptTokenCount: 3 })).toMatchObject({ textIn: 9, otherIn: 4 })
  })

  it('charges each kind at the registry’s price, and thinking as text out', () => {
    const tokens = { turns: 4, textIn: 1_000_000, audioIn: 1_000_000, otherIn: 0, textOut: 1_000_000, audioOut: 1_000_000, thoughts: 1_000_000 }
    const cost = callCost(tokens, price, 120)!
    expect(cost).toMatchObject({ textInUsd: price.textInPerMTok, audioInUsd: price.audioInPerMTok, textOutUsd: price.textOutPerMTok, audioOutUsd: price.audioOutPerMTok, thoughtsUsd: price.textOutPerMTok })
    expect(cost.totalUsd).toBeCloseTo(price.textInPerMTok + price.audioInPerMTok + 2 * price.textOutPerMTok + price.audioOutPerMTok, 9)
    expect(cost.perMinuteUsd).toBeCloseTo(cost.totalUsd / 2, 9)
  })

  it('a minute of her speech and a minute of the caller’s, at the registry’s prices', () => {
    // 25 tokens a second of audio: 1,500 a minute each way
    const cost = callCost({ ...NO_TOKENS, audioIn: 1500, audioOut: 1500 }, { ...price, textInPerMTok: 0.75, audioInPerMTok: 3, textOutPerMTok: 4.5, audioOutPerMTok: 12 }, 60)!
    expect(cost.audioInUsd).toBeCloseTo(0.0045, 6)
    expect(cost.audioOutUsd).toBeCloseTo(0.018, 6)
    expect(cost.perMinuteUsd).toBeCloseTo(0.0225, 6)
  })

  it('no price in the registry, no cost; no time yet, no per-minute figure', () => {
    expect(callCost(NO_TOKENS, null, 60)).toBeNull()
    expect(callCost({ ...NO_TOKENS, audioOut: 100 }, price, 0)!.perMinuteUsd).toBeNull()
    expect(callCost({ ...NO_TOKENS, otherIn: 7 }, price, 10)).toMatchObject({ totalUsd: 0, unpricedTokens: 7 })
  })

  it('the median and the worst of the delays', () => {
    expect([median([]), worst([])]).toEqual([null, null])
    expect([median([900]), median([1200, 600, 900]), median([400, 1000, 600, 800])]).toEqual([900, 900, 700])
    expect(worst([900, 2400, 650])).toBe(2400)
  })
})

describe('T-210 the amounts she said, against the engine’s total', () => {
  const amounts = (speech: string) => spokenAmounts(speech).map((a) => [a.amount, a.money ? a.currency : null])

  it('reads an amount said in words, in figures, and with either currency', () => {
    expect(amounts('That comes to four hundred and fifty dollars.')).toEqual([[450, 'USD']])
    expect(amounts('It is $450.')).toEqual([[450, 'USD']])
    expect(amounts('About 450 pounds.')).toEqual([[450, 'GBP']])
    expect(amounts('£450.00 in all')).toEqual([[450, 'GBP']])
    expect(amounts('four hundred fifty dollars')).toEqual([[450, 'USD']])
    expect(amounts('four fifty dollars')).toEqual([[450, 'USD']])
    expect(amounts('$7,347.00 USD')).toEqual([[7347, 'USD']])
    expect(amounts('seven thousand three hundred and forty-seven dollars')).toEqual([[7347, 'USD']])
    expect(amounts('twelve hundred and fifty dollars and fifty cents')).toEqual([[1250.5, 'USD']])
    expect(amounts('one thousand two hundred fifty pounds and 50 pence')).toEqual([[1250.5, 'GBP']])
    expect(amounts('a hundred dollars')).toEqual([[100, 'USD']])
    expect(amounts('2 thousand dollars')).toEqual([[2000, 'USD']])
    expect(amounts('four hundred fifty point five zero dollars')).toEqual([[450.5, 'USD']])
    expect(amounts('ninety nine euros')).toEqual([[99, 'EUR']])
  })

  it('a number that is not money is not taken for a price', () => {
    expect(spokenAmounts('I can do Monday, 8 am to 10 am, for 2 rooms. Call 555 201 3434.').filter((a) => a.money)).toEqual([])
    expect(spokenAmounts('One moment while I check.').filter((a) => a.money)).toEqual([])
    expect(wordsToNumber(['one', 'two', 'three'])).toBeNull()
    expect([wordsToNumber(['twenty', 'five']), wordsToNumber(['nine', 'ninety', 'nine']), wordsToNumber(['twelve', 'fifty']), wordsToNumber(['a', 'thousand'])]).toEqual([25, 999, 1250, 1000])
  })

  it('match: she said the engine’s total, in any of those ways', () => {
    const engine = { currency: 'USD', total: 450, subtotal: 450, taxAmount: 0, lines: [75, 375] }
    for (const speech of ['That is four hundred and fifty dollars.', 'An estimate of $450.', '$450.00, which they will confirm.', 'It comes to four fifty dollars.', 'It comes to four hundred and fifty.']) expect(checkSpokenPrice(engine, speech).verdict, speech).toBe('match')
    // the lines, the subtotal and the tax are the engine's too
    const lines = checkSpokenPrice({ currency: 'USD', total: 487.13, subtotal: 450, taxAmount: 37.13, lines: [75, 375] }, 'Seventy five dollars base and three hundred seventy five dollars for the work, $450 before tax, $37.13 sales tax, so $487.13.')
    expect(lines.verdict).toBe('match')
    expect(lines.said.map((s) => s.is)).toEqual(['line', 'line', 'subtotal', 'tax', 'total'])
  })

  it('mismatch: she said an amount of money the engine did not give, or the wrong currency', () => {
    const engine = { currency: 'USD', total: 452.38, subtotal: 452.38, taxAmount: 0, lines: [452.38] }
    expect(checkSpokenPrice(engine, 'That is about four hundred and fifty dollars.')).toMatchObject({ verdict: 'mismatch', said: [{ amount: 450, is: 'not_the_engines' }] })
    expect(checkSpokenPrice(engine, 'That is $452.38, or $500 with a second coat.').verdict).toBe('mismatch')
    expect(checkSpokenPrice({ ...engine, total: 450, lines: [450] }, 'That is 450 pounds.')).toMatchObject({ verdict: 'mismatch', said: [{ is: 'total', wrongCurrency: true }] })
    expect(checkSpokenPrice({ ...engine, total: 450, currency: 'GBP', lines: [450] }, 'That is 450 pounds.').verdict).toBe('match')
  })

  it('not said: no amount yet, or only a line', () => {
    const engine = { currency: 'USD', total: 450, lines: [75, 375] }
    expect(checkSpokenPrice(engine, 'Let me check that for you.')).toEqual({ verdict: 'not_said', said: [] })
    expect(checkSpokenPrice(engine, 'The base fee is $75.').verdict).toBe('not_said')
  })

  const results = (over: Partial<CallResults> = {}): CallResults => ({
    business: 'Harlow Works', model: 'a-live-model', voice: 'Aoede', browser: 'A browser', seconds: 95, status: 'ended', endedBecause: 'ended on the page',
    transcript: [
      { who: 'her', at: 1, text: 'Hello, I am Oumn.' },
      { who: 'caller', at: 9, text: 'How much for forty?' },
      { who: 'her', at: 14, text: 'That is an estimate of four hundred and fifty dollars, which Harlow Works will confirm.' },
      { who: 'caller', at: 30, text: 'And for eighty?' },
      { who: 'her', at: 36, text: 'About nine hundred dollars. That is guaranteed.' },
    ],
    turns: [{ n: 1, at: 1, ms: null, tools: ['get_business_info'], overlapped: false }, { n: 2, at: 14, ms: 1400, tools: ['get_estimate'], overlapped: false }, { n: 3, at: 36, ms: 2200, tools: ['get_estimate'], overlapped: true }],
    tools: [
      { at: 0.5, name: 'get_business_info', args: {}, ok: true, response: { name: 'Harlow Works' }, ms: 80 },
      { at: 12, name: 'get_estimate', args: { serviceId: 'svc_a' }, ok: true, response: { service: 'Service A', total: 450 }, ms: 240, engine: { currency: 'USD', total: 450, lines: [450] } },
      { at: 34, name: 'get_estimate', args: { serviceId: 'svc_a' }, ok: true, response: { service: 'Service A', total: 912.5 }, ms: 250, engine: { currency: 'USD', total: 912.5, lines: [912.5] } },
      { at: 60, name: 'book_time', args: { slot: 'x' }, ok: false, response: { error: 'That is not one of the free times.' }, ms: 30 },
    ],
    tokens: { turns: 3, textIn: 9000, audioIn: 2000, otherIn: 0, textOut: 80, audioOut: 900, thoughts: 300 },
    problems: [],
    ...over,
  })

  it('each estimate is held against what she said until the next one', () => {
    const checks = priceChecks(results())
    expect(checks.map((c) => [c.service, c.engine.total, c.verdict, c.said.map((s) => s.amount)])).toEqual([['Service A', 450, 'match', [450]], ['Service A', 912.5, 'mismatch', [900]]])
    expect(bannedWordsSaid(results().transcript).join(' ')).toMatch(/guaranteed/)
    expect(priceChecks({ tools: [], transcript: [] })).toEqual([])
  })

  it('"Copy results" is the whole panel as plain text', () => {
    const text = resultsText(results(), getLivePrice(resolveModelRoute('voice_call').model))
    for (const part of ['OUMN TEST CALL', 'Business: Harlow Works', 'Voice: Aoede', 'Length: 1:35', '1. COST', 'Per minute:', 'Audio in: 2000 tokens', '2. DELAY BEFORE SHE ANSWERS', 'Median: 1800 ms   Worst: 2200 ms   Turns measured: 2', 'Turn 3 at 0:36: 2200 ms (after get_estimate) (she began over the caller)', '4. PRICE CHECK', 'engine total 450.00 USD | she said: "four hundred and fifty dollars" = 450.00 (total) | MATCH', "(NOT THE ENGINE'S) | MISMATCH", '5. TOOL CALLS', 'book_time({"slot":"x"}) REFUSED in 30 ms', 'TRANSCRIPT', '0:14 Oumn: That is an estimate', '0:09 Caller: How much for forty?', '3. HOW SHE SOUNDS']) expect(text, part).toContain(part)
    expect(resultsText(results(), null)).toContain('No Live API price in the registry for this model')
  })
})

describe('T-210 her instructions are built from the business', () => {
  const us = buildInstruction({ businessName: 'Harlow Works', languageVariant: getRegion('US').copy.languageVariant, emergencyNumber: getRegion('US').emergencyNumber, currency: 'USD' })
  const gb = buildInstruction({ businessName: 'Marlow & Sons', languageVariant: getRegion('GB').copy.languageVariant, emergencyNumber: getRegion('GB').emergencyNumber, currency: 'GBP' })

  it('she is Oumn, the business’s AI assistant, and says so when asked', () => {
    expect(ASSISTANT_NAME).toBe('Oumn')
    expect(us.split('\n')[0]).toBe('You are Oumn, the AI assistant for Harlow Works. You are on a voice call with someone who has called Harlow Works.')
    expect(us).toContain('Open the call by saying that you are Oumn, the AI assistant for Harlow Works')
    expect(us).toContain('say truthfully that you are an AI assistant')
  })

  it('a price comes only from the tool, is called an estimate, and is never worked out by her', () => {
    expect(us).toContain('A price comes only from the get_estimate tool. Never work out, add up, round, convert or guess a price yourself, and never say a price before the tool has answered.')
    expect(us).toContain('Call it "an estimate that Harlow Works will confirm".')
    expect(us).toContain('If the tool returns an error, do not give a price.')
  })

  it('she makes nothing up, asks the service’s questions, and takes a name and a contact before booking', () => {
    expect(us).toContain('Never make up a service, a policy, a promise about the work, an opening time or a free time.')
    expect(us).toContain(`say "I'll get them to confirm that."`)
    expect(us).toContain('ask the customer the questions listed for that service, one at a time')
    expect(us).toContain("get the customer's name and a phone number or an email address")
    expect(us).toContain('When you are told that time is short')
  })

  it('urgent: she alerts the business; danger: the region’s own emergency number', () => {
    expect([getRegion('US').emergencyNumber, getRegion('GB').emergencyNumber]).toEqual(['911', '999'])
    expect(us).toContain('tell them first to call 911 now')
    expect(gb).toContain('tell them first to call 999 now')
    expect(us).not.toContain('999')
    expect(gb).not.toContain('911')
    expect(us).toContain('call request_person with urgent set to true')
  })

  it('the words she must not use are the customer language guard’s own list', () => {
    expect(us).toContain(`Never use these words about a price or about the work: ${CUSTOMER_BANNED_WORDS.join(', ')}.`)
    // her own instructions use none of them anywhere else
    const rest = us.replace(/Never use these words[^\n]*\n/, '')
    for (const word of CUSTOMER_BANNED_WORDS) expect(rest.toLowerCase(), word).not.toMatch(new RegExp(`(^|[^a-z])${word}([^a-z]|$)`))
  })

  it('nothing in it, or in the code, is about one trade: only the business’s name and region differ', () => {
    const neutral = (text: string, name: string, region: 'US' | 'GB', currency: string) => text.split(name).join('NAME').split(getRegion(region).copy.languageVariant).join('LANG').split(getRegion(region).emergencyNumber).join('NUM').split(currency).join('CUR')
    expect(neutral(us, 'Harlow Works', 'US', 'USD')).toBe(neutral(gb, 'Marlow & Sons', 'GB', 'GBP'))
    const trades = /\b(paint|painting|painter|plumb\w*|roof\w*|clean\w*|boiler|hvac|electric\w*|garden\w*|carpet|window|fenc\w*|pressure wash\w*)\b/i
    expect(us).not.toMatch(trades)
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, 'apps/web/src/components/voice-test/VoiceTest.tsx']) expect(code(file), file).not.toMatch(trades)
  })
})

describe('T-210 the call’s token locks the call', () => {
  const setup = { model: 'a-live-model', voice: 'Aoede', instruction: 'You are Oumn.', tools: toolDeclarations() }

  it('the model, the instructions, the voice and the tools are in the token; no field is left to the browser', () => {
    const request = tokenRequest(setup, NOW)
    expect(request.uses).toBe(1)
    expect(request).not.toHaveProperty('fieldMask')
    expect(request.bidiGenerateContentSetup).toEqual(lockedSetup(setup))
    expect(request.bidiGenerateContentSetup).toMatchObject({
      model: 'models/a-live-model',
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
      systemInstruction: { parts: [{ text: 'You are Oumn.' }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    })
    expect(request.bidiGenerateContentSetup.tools[0]!.functionDeclarations.map((d) => (d as { name: string }).name)).toEqual([...TOOL_NAMES])
    expect(new Date(request.newSessionExpireTime).getTime() - NOW.getTime()).toBe(60_000)
    expect(new Date(request.expireTime).getTime() - NOW.getTime()).toBe(TOKEN_LIFE_SECONDS * 1000)
    expect([CALL_LIMIT_SECONDS, WRAP_UP_SECONDS, TOKEN_LIFE_SECONDS]).toEqual([480, 360, 540])
  })

  it('the key goes to Google in a header and is in nothing that comes back', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await mintLiveToken('the-api-key', setup, { now: NOW, fetchImpl })).toEqual({ ok: true, token: 'auth_tokens/abc123' })
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens')
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('the-api-key')
    expect(String(calls[0]!.init.body)).not.toContain('the-api-key')
    expect(calls[0]!.url).not.toContain('the-api-key')
    expect(await mintLiveToken('k', setup, { fetchImpl: (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch })).toEqual({ ok: false, status: 403 })
    expect(await mintLiveToken('k', setup, { fetchImpl: (async () => { throw new Error('down') }) as unknown as typeof fetch })).toEqual({ ok: false, status: 0 })
  })

  it('the browser opens the constrained service with the token, and is never sent the key', () => {
    expect(liveSocketUrl('auth_tokens/a b')).toBe('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fa%20b')
    const session = code(ROUTES[0]!)
    expect(session.match(/GEMINI_API_KEY/g)).toHaveLength(1)
    expect(session).toContain('const minted = await mintLiveToken(apiKey, { model: route.model, voice, instruction, tools: toolDeclarations() }, { now })')
    const answered = session.slice(session.indexOf('return NextResponse.json({\n      token: minted.token'))
    expect(answered).not.toMatch(/apiKey|secret\b/)
    for (const file of ['apps/web/src/components/voice-test/VoiceTest.tsx', `${VOICE_DIR}/call-client.ts`, PAGE]) expect(code(file), file).not.toMatch(/GEMINI_API_KEY|x-goog-api-key|NEXT_PUBLIC_GEMINI/)
  })

  it('the tools are declared for the Live API with the arguments they take, and she waits for each answer', () => {
    const declared = toolDeclarations()
    expect(declared.map((d) => d.name)).toEqual(['get_business_info', 'get_estimate', 'get_free_times', 'book_time', 'request_person'])
    for (const d of declared) expect(d.behavior, d.name).toBe('BLOCKING')
    const props = (name: string) => Object.keys((declared.find((d) => d.name === name)!.parameters as { properties: Record<string, unknown> }).properties)
    expect([props('get_business_info'), props('get_estimate'), props('get_free_times'), props('book_time'), props('request_person')]).toEqual([[], ['serviceId', 'answers'], ['fromDate'], ['slot', 'name', 'phone', 'email'], ['reason', 'urgent']])
  })
})

describe('T-210 the registry holds the model, the prices and the voices', () => {
  it('the task "voice_call" has a Live model, switched by AI_MODEL_VOICE_CALL', () => {
    expect(registry.tasks.voice_call).toEqual({ provider: 'gemini', model: resolveModelRoute('voice_call').model, overflow: 'none' })
    expect(resolveModelRoute('voice_call').model).toMatch(/live/)
    expect(resolveModelRoute('voice_call', { AI_MODEL_VOICE_CALL: 'another-live-model' })).toEqual({ provider: 'gemini', model: 'another-live-model' })
  })

  it('the Live API prices are beside it, per modality, with the date and the page they were read from', () => {
    const price = getLivePrice(resolveModelRoute('voice_call').model)!
    for (const key of ['textInPerMTok', 'audioInPerMTok', 'textOutPerMTok', 'audioOutPerMTok'] as const) expect(price[key], key).toBeGreaterThan(0)
    expect(price.audioOutPerMTok).toBeGreaterThan(price.audioInPerMTok)
    expect(price.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(price.source).toMatch(/^aistudio\.google\.com\//)
    expect(getLivePrice('a-model-with-no-live-price')).toBeNull()
  })

  it('the voices are the registry’s list, and the default is Aoede', () => {
    expect(DEFAULT_LIVE_VOICE).toBe('Aoede')
    expect(LIVE_VOICES).toContain('Aoede')
    expect(LIVE_VOICES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(LIVE_VOICES).size).toBe(LIVE_VOICES.length)
  })

  it('no model name, voice or price is written in the voice test’s code', () => {
    const names = new RegExp(`gemini-\\d|${LIVE_VOICES.filter((v) => v !== 'Aoede').join('|')}`)
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, 'apps/web/src/components/voice-test/VoiceTest.tsx']) {
      expect(code(file), file).not.toMatch(names)
      expect(code(file), file).not.toMatch(/PerMTok\s*[:=]\s*\d/)
      expect(code(file), file).not.toContain("'Aoede'")
    }
  })
})

describe('T-210 the page is private and off by default', () => {
  it('it is on only when VOICE_TEST_ENABLED is exactly "true"', () => {
    expect(voiceTestEnabled({ VOICE_TEST_ENABLED: 'true' })).toBe(true)
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes', ' true']) expect(voiceTestEnabled({ VOICE_TEST_ENABLED: value }), String(value)).toBe(false)
  })

  it('the page and both routes ask the one rule first: switched on, and a platform admin', () => {
    const access = code(`${VOICE_DIR}/access.ts`)
    expect(access).toMatch(/if \(!voiceTestEnabled\(\)\) return null\s+return verifyAdmin\(\)/)
    expect(access).toContain("{ status: 404 }")
    for (const file of ROUTES) expect(code(file), file).toMatch(/export async function POST\(request: NextRequest\) \{\s+const admin = await voiceTestAdmin\(\)\s+if \(!admin\) return notThere\(\)/)
    expect(code(PAGE)).toMatch(/const admin = await voiceTestAdmin\(\)\s+if \(!admin\) notFound\(\)/)
  })

  it('both routes are rate limited, by the admin', () => {
    expect(code(ROUTES[0]!)).toContain("checkRateLimit('voice_test_start', { ip: getClientIp(request), key: admin.userId })")
    expect(code(ROUTES[1]!)).toContain("checkRateLimit('voice_test_tool', { ip: getClientIp(request), key: admin.userId })")
  })

  it('.env.example has the switch, and nothing links to the page', () => {
    expect(read('apps/web/.env.example')).toMatch(/^# VOICE_TEST_ENABLED=true$/m)
    expect(read('apps/web/src/app/admin/layout.tsx')).not.toContain('voice-test')
    expect(read('apps/web/src/app/admin/page.tsx')).not.toContain('voice-test')
  })

  it('the page lists the eight things to try', () => {
    expect(THINGS_TO_TRY).toHaveLength(8)
    expect(THINGS_TO_TRY.join(' ')).toMatch(/price[\s\S]*does not offer[\s\S]*outside its service area[\s\S]*guarantee, parking[\s\S]*real person[\s\S]*for a person[\s\S]*urgent[\s\S]*Book a visit/)
  })
})

describe('T-210 the audio worklets', () => {
  /** Load the worklet source the way an audio thread does, at a given device rate */
  function load(deviceRate: number) {
    const registered: Record<string, new (options: unknown) => { port: { posted: unknown[]; onmessage: ((e: { data: unknown }) => void) | null }; process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean }> = {}
    class AudioWorkletProcessor {
      port = { posted: [] as unknown[], onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(message: unknown) { this.posted.push(message) } }
    }
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', VOICE_WORKLETS)(AudioWorkletProcessor, (name: string, cls: never) => { registered[name] = cls }, deviceRate)
    return registered
  }

  it('the microphone goes up at 16 kHz in pieces of 40 ms, whatever the device’s rate', () => {
    for (const rate of [48000, 44100, 16000]) {
      const Capture = load(rate)['voice-capture']!
      const capture = new Capture({ processorOptions: { outRate: 16000, chunkSamples: 640 } })
      // one second of a 440 Hz tone, in the 128-sample blocks an audio thread hands over
      for (let start = 0; start < rate; start += 128) {
        const block = new Float32Array(Math.min(128, rate - start))
        for (let i = 0; i < block.length; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (start + i)) / rate)
        capture.process([[block]], [])
      }
      const pieces = capture.port.posted as Array<{ pcm: ArrayBuffer; rms: number }>
      expect(pieces.length, String(rate)).toBeGreaterThanOrEqual(24)
      expect(pieces.length, String(rate)).toBeLessThanOrEqual(25)
      for (const piece of pieces) {
        expect(piece.pcm.byteLength).toBe(1280)
        expect(piece.rms).toBeGreaterThan(0.3)
        expect(piece.rms).toBeLessThan(0.4)
      }
      const samples = new Int16Array(pieces[3]!.pcm)
      expect(Math.max(...samples)).toBeGreaterThan(15000)
      expect(Math.max(...samples)).toBeLessThanOrEqual(16384)
    }
  })

  it('her 24 kHz audio is played in order at the device’s rate, and a flush drops what is waiting', () => {
    const Playback = load(48000)['voice-playback']!
    const playback = new Playback({ processorOptions: { inRate: 24000 } })
    const ramp = Int16Array.from({ length: 240 }, (_, i) => i * 100)
    playback.port.onmessage!({ data: { pcm: ramp.buffer } })
    const out = [new Float32Array(128)]
    playback.process([], [out])
    // two device samples for each of hers, rising as hers do
    expect(out[0]![0]).toBe(0)
    expect(out[0]![2]).toBeCloseTo(100 / 32768, 6)
    expect(out[0]![1]).toBeCloseTo(50 / 32768, 6)
    expect(playback.port.posted).toEqual([{ playing: true }])
    playback.port.onmessage!({ data: { flush: true } })
    const after = [new Float32Array(128)]
    playback.process([], [after])
    expect([...after[0]!].every((s) => s === 0)).toBe(true)
    expect(playback.port.posted).toEqual([{ playing: true }, { playing: false }])
  })
})
