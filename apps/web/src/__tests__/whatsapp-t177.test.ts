/**
 * T-177: the silent WhatsApp assistant, the automatic template, the plan and
 * subscription rule, Embedded Signup v5, small copies of chat photos, and the
 * legal pages. The rules that are pure, and the assistant against a stand-in
 * for the database and the model. The whole flow against a stand-in for Meta
 * (and the real model) is verify-t177.mts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOVERNING_LAW, OPERATOR, PLANS, PRODUCT_NAME, offeredPlansWithChannel, operatorStatement, planHasChannel, subscriptionLive } from '@qolumns/shared'
import type { WhatsAppConversation, WhatsAppIntakeState } from '@qolumns/shared'

const createQuoteFromIntake = vi.fn()
const storeIntakeMedia = vi.fn()
const templatesNamed = vi.fn(async (_token: string, _wabaId: string, _name: string): Promise<MetaTemplate[]> => [])
const createTemplate = vi.fn(async (_token: string, _wabaId: string, _definition: Record<string, unknown>) => ({ id: '900000000000009', status: 'PENDING', category: 'UTILITY' as string | null }))
vi.mock('@/lib/messaging/intake-engine', async (original) => ({
  ...((await original()) as object),
  createQuoteFromIntake: (ctx: unknown, data: unknown) => createQuoteFromIntake(ctx, data),
  storeIntakeMedia: (ctx: unknown) => storeIntakeMedia(ctx),
}))
vi.mock('@/lib/whatsapp-graph', async (original) => ({
  ...((await original()) as object),
  templatesNamed: (token: string, wabaId: string, name: string) => templatesNamed(token, wabaId, name),
  createTemplate: (token: string, wabaId: string, definition: Record<string, unknown>) => createTemplate(token, wabaId, definition),
}))

import { GraphError, type MetaTemplate } from '@/lib/whatsapp-graph'
import { INTENT_MIN_CONFIDENCE, NO_INTENT, buildIntentPrompt, classifyPriceIntent, intentUrl, readIntentAnswer, type IntentBusiness, type PriceIntent } from '@/lib/ai/whatsapp-intent'
import { handleCustomerMessage, recordOwnerReply } from '@/lib/whatsapp-assistant'
import { MAX_RETRIES, OWNER_PAUSE_MS, asking, emailIn, inServiceArea, needsFrom, nextStep, ownerPaused, questionStale, say, usableProfileName } from '@/lib/whatsapp-assistant-rules'
import { parseOwnerEchoes } from '@/lib/whatsapp-webhook'
import { parseWebhookPayload, type IncomingMessage } from '@/lib/whatsapp'
import { PAUSED_LINE, accessRefusal, accessView, upgradeLine, whatsappAccess, whatsappAccessFor } from '@/lib/whatsapp-access'
import { ensureEstimateTemplate, loadEstimateTemplate } from '@/lib/whatsapp-template-service'
import { ESTIMATE_TEMPLATE_NAME, estimateTemplateBody } from '@/lib/whatsapp-templates'
import { encryptSecret } from '@/lib/whatsapp-crypto'
import { notifyEstimateReady } from '@/lib/whatsapp-notify'
import { EMBEDDED_SIGNUP_VERSION, readSignupMessage, signupLoginOptions } from '@/lib/whatsapp-signup'
import { PERSONAL_NUMBER_LINE, TEST_MESSAGE_LINE } from '@/lib/whatsapp-copy'
import { applyOrientation, exifOrientation, isJpeg, makeSmallCopy, scaleDown } from '@/lib/small-photo-make'
import { SMALL_PHOTO_MAX_BYTES, SMALL_PHOTO_MAX_EDGE, smallPhotoBytesOk } from '@/lib/small-photo'
import { UPLOAD_DOCUMENT_TYPES, UPLOAD_IMAGE_TYPES, UPLOAD_MAX_DOCUMENT_BYTES, UPLOAD_MAX_IMAGE_BYTES, uploadAllowed, uploadKindOf } from '@/lib/upload-limits'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const saved = { ...process.env }
const now = new Date('2026-11-17T12:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
const HOUR = 3_600_000

beforeEach(() => {
  process.env.WHATSAPP_ENCRYPTION_KEY = 'unit-test-key-t177'
  createQuoteFromIntake.mockReset().mockResolvedValue({ success: true, newState: 'completed', newData: { _quoteId: 'qte_1', _quoteUrl: 'https://app.example/q/qte_1?token=secret-quote-token' } })
  storeIntakeMedia.mockReset().mockResolvedValue({ ok: true, assetId: 'asset-1' })
  templatesNamed.mockReset().mockResolvedValue([])
  createTemplate.mockReset().mockResolvedValue({ id: '900000000000009', status: 'PENDING', category: 'UTILITY' })
})
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------------------
// A stand-in for the service-role client: the few reads and writes these paths make
// ---------------------------------------------------------------------------------------
interface World {
  tenant: Record<string, unknown> | null
  services: Array<Record<string, unknown>>
  config?: Record<string, unknown> | null
  subscription?: { plan_id: string; status: string } | null
  conversations?: Array<Record<string, unknown>>
  writes: Array<{ table: string; op: 'insert' | 'update'; values: Record<string, unknown> }>
}
function fakeAdmin(world: World) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data: table === 'tenants' ? world.tenant : table === 'whatsapp_configs' ? (world.config ?? null) : table === 'subscriptions' ? (world.subscription ?? null) : null,
          error: null,
        }),
        insert: async (values: Record<string, unknown>) => {
          world.writes.push({ table, op: 'insert', values })
          return { error: null }
        },
        update: (values: Record<string, unknown>) => {
          world.writes.push({ table, op: 'update', values })
          return builder
        },
        then: (resolve: (value: { data: unknown[] }) => void) => resolve({ data: table === 'services' ? world.services : table === 'whatsapp_conversations' ? (world.conversations ?? []) : [] }),
      }
      return builder
    },
  } as never
}

const PAINT = { id: 'svc_paint', name: 'Interior Painting', description: 'Walls, ceilings and trim', scope_includes: ['Walls', 'Ceilings'], scope_excludes: ['Exterior painting', 'Wallpaper removal'], media_config: { minPhotos: 0 } }
const DOORS = { id: 'svc_doors', name: 'Garage Door Installation', description: null, scope_includes: ['New door', 'Removal of the old door'], scope_excludes: ['Opener repair'], media_config: { minPhotos: 2, photoGuidance: 'One of the whole opening, one of the tracks.' } }
const world = (over: Partial<World> = {}): World => ({
  tenant: { name: 'Kent Home Services', region: 'US', contact_requirement: 'email', service_area_mode: 'none', service_area_values: [] },
  services: [PAINT, DOORS],
  writes: [],
  ...over,
})
const conversation = (state: WhatsAppIntakeState = 'idle', data: Record<string, unknown> = {}, updatedAt = ago(60_000)): WhatsAppConversation =>
  ({ id: 'conv-1', tenant_id: 'tenant-a', customer_phone: '15555550142', customer_name: null, quote_request_id: null, status: 'active', intake_state: state, intake_data: data, created_at: ago(HOUR), updated_at: updatedAt }) as WhatsAppConversation
const text = (body: string): IncomingMessage => ({ messageId: 'wamid.in', from: '15555550142', timestamp: '1', type: 'text', text: body })
const photo = (caption?: string): IncomingMessage => ({ messageId: 'wamid.photo', from: '15555550142', timestamp: '1', type: 'image', mediaId: 'media-1', mimeType: 'image/jpeg', caption })
const channel = { name: 'whatsapp' as const, conversationTable: 'whatsapp_conversations' as const, senderNumberNoun: 'WhatsApp number', emphasize: (t: string) => t, downloadMedia: vi.fn(), send: vi.fn() }
const yes = (serviceId: string, jobDescribed = true) => vi.fn(async (_b: IntentBusiness, _t: string): Promise<PriceIntent> => ({ start: true, serviceId, jobDescribed }))
const no = () => vi.fn(async (_b: IntentBusiness, _t: string): Promise<PriceIntent> => NO_INTENT)
const run = (w: World, conv: WhatsAppConversation, message: IncomingMessage, classify: ReturnType<typeof yes>, profileName: string | null = 'Megan Grant') =>
  handleCustomerMessage({ admin: fakeAdmin(w), tenantId: 'tenant-a', conversation: conv, message, profileName, channel, now, classify })

describe('T-177 item 1: the assistant is silent unless a customer asks for a price for something the business offers', () => {
  it('a price request starts the request, in one short natural reply', async () => {
    const classify = yes('svc_paint', false)
    const out = await run(world(), conversation(), text('Hi, how much to get a room painted?'), classify)
    expect(classify).toHaveBeenCalledTimes(1)
    expect(out.replies).toEqual(['Hi Megan, this is Kent Home Services’s quoting assistant. I can get you a price for Interior Painting. What needs doing? Sizes or quantities help.'])
    expect(out.newState).toBe('awaiting_description')
    expect(out.newData).toMatchObject({ serviceId: 'svc_paint', serviceName: 'Interior Painting', customerName: 'Megan Grant', customerPhone: '15555550142' })
    expect(out.keepText).toBe(true)
  })

  it('a general question gets no reply, and its text is not kept', async () => {
    for (const body of ['What time do you open tomorrow?', 'Are you coming tomorrow?', 'Thanks so much!', 'I am not happy with the finish on the ceiling']) {
      const out = await run(world(), conversation(), text(body), no())
      expect(out, body).toEqual({ replies: [], keepText: false })
    }
  })

  it('a service the business does not offer gets no reply (the model names no service of this business, or one that is not its own)', async () => {
    expect(await run(world(), conversation(), text('How much to fix my boiler?'), no())).toEqual({ replies: [], keepText: false })
    // an id that is not one of this business's services never starts anything
    expect(await run(world(), conversation(), text('How much to fix my boiler?'), yes('svc_someone_elses'))).toEqual({ replies: [], keepText: false })
    expect(createQuoteFromIntake).not.toHaveBeenCalled()
  })

  it('an unclear message gets no reply: the model’s answer counts only when it is a sure yes for a real service', () => {
    const ids = ['svc_paint', 'svc_doors']
    expect(readIntentAnswer('{"wants_price": true, "service_id": "svc_paint", "confidence": 0.95, "job_described": true}', ids)).toEqual({ start: true, serviceId: 'svc_paint', jobDescribed: true })
    // not sure enough
    expect(readIntentAnswer(`{"wants_price": true, "service_id": "svc_paint", "confidence": ${INTENT_MIN_CONFIDENCE - 0.05}}`, ids)).toEqual(NO_INTENT)
    // a price request with no service of this business
    expect(readIntentAnswer('{"wants_price": true, "service_id": null, "confidence": 0.99}', ids)).toEqual(NO_INTENT)
    expect(readIntentAnswer('{"wants_price": true, "service_id": "svc_made_up", "confidence": 0.99}', ids)).toEqual(NO_INTENT)
    // not a price request, however sure
    expect(readIntentAnswer('{"wants_price": false, "service_id": "svc_paint", "confidence": 0.99}', ids)).toEqual(NO_INTENT)
    // "true" as a word, a missing confidence, broken or empty answers
    expect(readIntentAnswer('{"wants_price": "true", "service_id": "svc_paint", "confidence": 0.99}', ids)).toEqual(NO_INTENT)
    expect(readIntentAnswer('{"wants_price": true, "service_id": "svc_paint"}', ids)).toEqual(NO_INTENT)
    for (const broken of ['', 'yes', '{"wants_price": tru', 'null', '[]']) expect(readIntentAnswer(broken, ids)).toEqual(NO_INTENT)
    // a fenced answer is read
    expect(readIntentAnswer('```json\n{"wants_price": true, "service_id": "svc_doors", "confidence": 0.9, "job_described": false}\n```', ids)).toEqual({ start: true, serviceId: 'svc_doors', jobDescribed: false })
  })

  it('a photo with no words, an empty message, and a business with no services are not even put to the model', async () => {
    const classify = yes('svc_paint')
    expect(await run(world(), conversation(), photo(), classify)).toEqual({ replies: [], keepText: false })
    expect(await run(world(), conversation(), text('   '), classify)).toEqual({ replies: [], keepText: false })
    expect(await run(world({ services: [] }), conversation(), text('How much for painting?'), classify)).toEqual({ replies: [], keepText: false })
    expect(classify).not.toHaveBeenCalled()
  })

  it('when the model cannot be asked, the assistant stays silent', async () => {
    const business: IntentBusiness = { name: 'Kent Home Services', services: [{ id: 'svc_paint', name: 'Interior Painting' }] }
    // no key
    expect(await classifyPriceIntent(business, 'How much to paint a room?', '')).toEqual(NO_INTENT)
    // the model is down
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await classifyPriceIntent(business, 'How much to paint a room?', 'key')).toEqual(NO_INTENT)
    // the network is down
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await classifyPriceIntent(business, 'How much to paint a room?', 'key')).toEqual(NO_INTENT)
    // a good answer
    const good = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"wants_price": true, "service_id": "svc_paint", "confidence": 0.9, "job_described": true}' }] } }] }), { status: 200 }))
    vi.stubGlobal('fetch', good)
    expect(await classifyPriceIntent(business, 'How much to paint a room?', 'key')).toEqual({ start: true, serviceId: 'svc_paint', jobDescribed: true })
  })

  it('the model is chosen by the registry task, never named in code, and the answer is asked for at temperature 0', async () => {
    const seen = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', seen)
    process.env.AI_MODEL_WHATSAPP_INTENT = 'gemini-test-override'
    await classifyPriceIntent({ name: 'B', services: [{ id: 's', name: 'S' }] }, 'How much?', 'key')
    expect(String(seen.mock.calls[0]![0])).toContain('/gemini-test-override:generateContent')
    expect(JSON.parse(String(seen.mock.calls[0]![1].body)).generationConfig.temperature).toBe(0)
    const src = code('apps/web/src/lib/ai/whatsapp-intent.ts')
    expect(src).not.toMatch(/gemini-\d|claude-/)
    expect(src).toContain("geminiUrlFor('whatsapp_intent')")
  })

  it('the checks can stand in for the model outside production, and never in production', () => {
    process.env.WHATSAPP_INTENT_BASE_URL = 'http://127.0.0.1:8799/ai/'
    process.env.AI_MODEL_WHATSAPP_INTENT = 'gemini-test-override'
    expect(intentUrl()).toBe('http://127.0.0.1:8799/ai/gemini-test-override:generateContent')
    vi.stubEnv('NODE_ENV', 'production')
    expect(intentUrl()).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test-override:generateContent')
    vi.unstubAllEnvs()
  })

  it('the words the model is given that are OURS are the same for every business: nothing in them names a trade, a service or a business’s own terms', () => {
    const one: IntentBusiness = { name: 'Alder & Sons', services: [{ id: 'svc_a1', name: 'Zzyzx Calibration', description: 'Quarterly recalibration', scopeIncludes: ['On-site visit'], scopeExcludes: ['Parts'] }], serviceAreaMode: 'postcode_allowlist', serviceAreaValues: ['AB1'] }
    const two: IntentBusiness = { name: 'Birch Ltd', services: [{ id: 'svc_b9', name: 'Quokka Grooming', description: 'Full groom', scopeIncludes: ['Wash'], scopeExcludes: ['Nails'] }, { id: 'svc_b8', name: 'Quokka Boarding' }], serviceAreaMode: 'none' }
    /** the prompt with everything that came from the business or the customer cut out */
    const fixed = (business: IntentBusiness, message: string) => {
      const prompt = buildIntentPrompt(business, message)
      const from = prompt.indexOf("THE BUSINESS'S SERVICES")
      const to = prompt.indexOf('Answer "wants_price": true ONLY')
      const head = prompt.slice(0, from).replace(business.name, '<business>')
      const tail = prompt.slice(to).replace(/<<<MESSAGE\n[\s\S]*\nMESSAGE>>>/, '<message>')
      return head + tail
    }
    expect(fixed(one, 'How much is a calibration?')).toBe(fixed(two, 'Can you board my quokka on Friday?'))
    const ours = fixed(one, 'x')
    // nothing of either business leaked into the fixed part
    for (const word of ['Zzyzx', 'Calibration', 'Quokka', 'Grooming', 'Alder', 'Birch', 'AB1', 'svc_']) expect(ours, word).not.toContain(word)
    // and it names no trade or kind of work of its own
    expect(ours).not.toMatch(/paint|plumb|boiler|garage|door|roof|hvac|electric|clean|garden|floor|window|tile|spring|install|repair|replac/i)
  })

  it('what the model is told comes from the business’s own configuration: services, what they include and exclude, where it works', () => {
    const prompt = buildIntentPrompt(
      { name: 'Kent Home Services', services: [{ id: 'svc_paint', name: 'Interior Painting', description: 'Walls, ceilings and trim', scopeIncludes: ['Walls', 'Ceilings'], scopeExcludes: ['Exterior painting'] }], serviceAreaMode: 'postcode_allowlist', serviceAreaValues: ['630', '631'] },
      'How much to paint 3 bedrooms?'
    )
    for (const part of ['Kent Home Services', 'id: svc_paint', 'name: Interior Painting', 'about: Walls, ceilings and trim', 'includes: Walls; Ceilings', 'does NOT include: Exterior painting', 'only works in these areas: 630, 631', 'How much to paint 3 bedrooms?']) expect(prompt).toContain(part)
    expect(buildIntentPrompt({ name: 'B', services: [{ id: 's', name: 'S' }], serviceAreaMode: 'none' }, 'x')).toContain('has not limited where it works')
    // the customer's words are fenced as something to judge, and a long message is cut
    expect(prompt).toMatch(/<<<MESSAGE\nHow much to paint 3 bedrooms\?\nMESSAGE>>>/)
    expect(buildIntentPrompt({ name: 'B', services: [{ id: 's', name: 'S' }] }, 'x'.repeat(5000))).not.toContain('x'.repeat(1501))
  })

  it('no trade, service name or trigger word is written into the assistant (the anti-hardcoding rule)', () => {
    for (const file of ['apps/web/src/lib/whatsapp-assistant.ts', 'apps/web/src/lib/whatsapp-assistant-rules.ts', 'apps/web/src/lib/ai/whatsapp-intent.ts', 'apps/web/src/app/api/whatsapp/webhook/route.ts']) {
      const src = code(file)
      expect(src, file).not.toMatch(/shouldStartIntake|TRIGGER_KEYWORDS/)
      expect(src, file).not.toMatch(/paint|plumb|boiler|garage|roof|hvac|electric/i)
    }
  })

  it('no reply is a numbered menu or asks for a number or a keyword', () => {
    const w = { businessName: 'Kent Home Services', serviceName: 'Interior Painting', customerName: 'Megan Grant', postalCodeNoun: 'ZIP code', minPhotos: 2, photoGuidance: 'One of the whole opening.' }
    const all = [say.opening(w, say.description()), say.openingWithLink(w, 'https://x/q/1'), say.description(), say.descriptionAgain(), say.name(), say.email(), say.emailAgain(), say.location(w), say.locationAgain(w), say.outsideArea(w), say.photos(w), say.photosEnough(), say.photoNotKept(), say.link(w, 'https://x/q/1'), say.failed(w)]
    for (const line of all) {
      expect(line, line).not.toMatch(/reply (with|“|")|^\s*\d+[.)]\s|\n\d+[.)]\s|press \d|option \d/i)
      expect(line.length, line).toBeLessThanOrEqual(260)
      expect(line, line).not.toMatch(/[$£€]\s?\d/)
    }
  })
})

describe('T-177 item 1: it asks only for what is missing, then sends the link', () => {
  it('everything known already (the job, the name from WhatsApp, nothing else required): the first reply is the link', async () => {
    const out = await run(world(), conversation(), text('How much to paint 3 bedrooms and a hallway, walls and ceilings?'), yes('svc_paint'))
    expect(createQuoteFromIntake).toHaveBeenCalledTimes(1)
    expect(createQuoteFromIntake.mock.calls[0]![1]).toMatchObject({ serviceId: 'svc_paint', customerName: 'Megan Grant', customerPhone: '15555550142', projectDescription: 'How much to paint 3 bedrooms and a hallway, walls and ceilings?' })
    // no email was asked for, and none is invented
    expect(createQuoteFromIntake.mock.calls[0]![1].customerEmail).toBeUndefined()
    expect(out.replies).toEqual(['Hi Megan, this is Kent Home Services’s quoting assistant. Your estimate for Interior Painting will be here in a moment: https://app.example/q/qte_1?token=secret-quote-token'])
    expect(out.newState).toBe('completed')
    expect(out.finished).toBe(true)
    expect(out.newData?._quoteId).toBe('qte_1')
  })

  it('what the business’s settings ask for is asked, one thing at a time, and nothing else', () => {
    const none = needsFrom({ contactRequirement: 'email', serviceAreaMode: 'none', minPhotos: 0 })
    expect(none).toEqual({ email: false, location: false, minPhotos: 0 })
    const all = needsFrom({ contactRequirement: 'both', serviceAreaMode: 'postcode_allowlist', minPhotos: 2 })
    expect(all).toEqual({ email: true, location: true, minPhotos: 2 })
    expect(nextStep({}, all)).toBe('awaiting_description')
    expect(nextStep({ projectDescription: 'Paint a room' }, all)).toBe('awaiting_name')
    expect(nextStep({ projectDescription: 'Paint a room', customerName: 'Megan' }, all)).toBe('awaiting_email')
    expect(nextStep({ projectDescription: 'Paint a room', customerName: 'Megan', customerEmail: 'm@example.com' }, all)).toBe('awaiting_address')
    expect(nextStep({ projectDescription: 'Paint a room', customerName: 'Megan', customerEmail: 'm@example.com', jobPostcode: '63021' }, all)).toBe('awaiting_photos')
    expect(nextStep({ projectDescription: 'Paint a room', customerName: 'Megan', customerEmail: 'm@example.com', jobPostcode: '63021' }, all, { photosDone: true })).toBe('ready')
    expect(nextStep({ projectDescription: 'Paint a room', customerName: 'Megan' }, none)).toBe('ready')
  })

  it('WhatsApp gave no usable name: it asks for one; an answer is taken as it comes', async () => {
    const out = await run(world(), conversation(), text('How much to paint 3 bedrooms?'), yes('svc_paint'), '🙂')
    expect(out.newState).toBe('awaiting_name')
    expect(out.replies[0]).toMatch(/^Hi, this is Kent Home Services’s quoting assistant\. I can get you a price for Interior Painting\. What name should I put on the estimate\?$/)
    const named = await run(world(), conversation('awaiting_name', out.newData as Record<string, unknown>), text('Megan Grant'), no())
    expect(named.finished).toBe(true)
    expect(createQuoteFromIntake.mock.calls[0]![1]).toMatchObject({ customerName: 'Megan Grant' })
    expect(usableProfileName('  Megan   Grant ')).toBe('Megan Grant')
    for (const bad of ['', 'M', '12345', '🙂', 'x'.repeat(80), null]) expect(usableProfileName(bad)).toBeNull()
  })

  it('a business that limits where it works is asked for the ZIP code, and a job outside it is turned away politely', async () => {
    const w = () => world({ tenant: { name: 'Kent Home Services', region: 'US', contact_requirement: 'email', service_area_mode: 'postcode_allowlist', service_area_values: ['630', '631'] } })
    const first = await run(w(), conversation(), text('How much to paint 3 bedrooms?'), yes('svc_paint'))
    expect(first.newState).toBe('awaiting_address')
    expect(first.replies[0]).toMatch(/What’s the ZIP code for the job\?$/)
    const inside = await run(w(), conversation('awaiting_address', first.newData as Record<string, unknown>), text('12 Elm Street, St Louis MO 63021'), no())
    expect(inside.finished).toBe(true)
    expect(createQuoteFromIntake.mock.calls[0]![1]).toMatchObject({ jobPostcode: '63021', jobAddress: '12 Elm Street, St Louis MO 63021' })
    const outside = await run(w(), conversation('awaiting_address', first.newData as Record<string, unknown>), text('It is in 90210'), no())
    expect(outside.replies).toEqual(['Sorry, Kent Home Services doesn’t cover that area.'])
    expect(outside.newState).toBe('idle')
    expect(outside.newData).toEqual({})
    expect(inServiceArea('63021', 'postcode_allowlist', ['630'])).toBe(true)
    expect(inServiceArea('90210', 'postcode_allowlist', ['630'])).toBe(false)
    expect(inServiceArea('90210', 'none', [])).toBe(true)
  })

  it('an email is asked for only when the business requires both an email and a phone', async () => {
    const w = () => world({ tenant: { name: 'Kent Home Services', region: 'US', contact_requirement: 'both', service_area_mode: 'none', service_area_values: [] } })
    const first = await run(w(), conversation(), text('How much to paint 3 bedrooms?'), yes('svc_paint'))
    expect(first.newState).toBe('awaiting_email')
    const answered = await run(w(), conversation('awaiting_email', first.newData as Record<string, unknown>), text('Sure, it is Megan.Grant@Example.com.'), no())
    expect(answered.finished).toBe(true)
    expect(createQuoteFromIntake.mock.calls[0]![1]).toMatchObject({ customerEmail: 'megan.grant@example.com' })
    expect(emailIn('megan@example.com')).toBe('megan@example.com')
    expect(emailIn('no thanks')).toBeNull()
  })

  it('a service that requires photos asks for them, waits for more, and any word moves on', async () => {
    const first = await run(world(), conversation(), text('How much for a new double garage door, 16 ft?'), yes('svc_doors'))
    expect(first.newState).toBe('awaiting_photos')
    expect(first.replies[0]).toMatch(/Could you send 2 photos of the job\? One of the whole opening, one of the tracks\.$/)
    let data = first.newData as Record<string, unknown>
    const one = await run(world(), conversation('awaiting_photos', data), photo(), no())
    expect(one.replies).toEqual([])
    data = one.newData as Record<string, unknown>
    const two = await run(world(), conversation('awaiting_photos', data), photo(), no())
    expect(two.replies).toEqual(['Got it, thanks. Send any more photos now, or say “that’s all” and I’ll send your estimate.'])
    data = two.newData as Record<string, unknown>
    const three = await run(world(), conversation('awaiting_photos', data), photo(), no())
    expect(three.replies).toEqual([])
    expect(createQuoteFromIntake).not.toHaveBeenCalled()
    const done = await run(world(), conversation('awaiting_photos', three.newData as Record<string, unknown>), text('that’s all'), no())
    expect(done.finished).toBe(true)
    expect(createQuoteFromIntake.mock.calls[0]![1]).toMatchObject({ photoCount: 3, assetIds: ['asset-1', 'asset-1', 'asset-1'] })
    expect(done.replies[0]).toMatch(/^Thanks, Megan\. Your estimate from Kent Home Services will be here in a moment: /)
  })

  it('an answer that cannot be used is asked for once more, then the assistant goes quiet and keeps nothing', async () => {
    expect(MAX_RETRIES).toBe(1)
    const data = { serviceId: 'svc_paint', serviceName: 'Interior Painting', customerName: 'Megan Grant', _retries: 0 }
    const first = await run(world(), conversation('awaiting_description', data), text('ok'), no())
    expect(first.replies).toEqual(['Could you say a little more about the job? One or two sentences is enough.'])
    expect(first.newData?._retries).toBe(1)
    const second = await run(world(), conversation('awaiting_description', first.newData as Record<string, unknown>), text('hm'), no())
    expect(second).toEqual({ replies: [], keepText: false, newState: 'idle', newData: {} })
  })

  it('a question left unanswered for a day is dropped: the next message is judged afresh', async () => {
    const data = { serviceId: 'svc_paint', serviceName: 'Interior Painting', customerName: 'Megan Grant' }
    const classify = no()
    const late = await run(world(), conversation('awaiting_description', data, ago(25 * HOUR)), text('Morning! Are you still coming at 9?'), classify)
    expect(classify).toHaveBeenCalledTimes(1)
    expect(late).toEqual({ replies: [], keepText: false, newState: 'idle', newData: {} })
    expect(questionStale(ago(23 * HOUR), now)).toBe(false)
    expect(questionStale(ago(25 * HOUR), now)).toBe(true)
    expect(asking('awaiting_photos')).toBe(true)
    for (const state of ['idle', 'completed', 'processing', 'awaiting_confirmation', 'awaiting_service'] as const) expect(asking(state)).toBe(false)
  })

  it('once the link is sent the chat is finished: the webhook closes it, so the next message starts fresh and is judged again', () => {
    const route = code('apps/web/src/app/api/whatsapp/webhook/route.ts')
    expect(route).toContain("if (outcome.finished) updates.status = 'completed'")
    expect(route).toContain(".eq('status', 'active')")
  })

  it('the price is never the assistant’s: it makes the same request every channel makes and sends a link', () => {
    const src = code('apps/web/src/lib/whatsapp-assistant.ts') + code('apps/web/src/lib/whatsapp-assistant-rules.ts') + code('apps/web/src/lib/ai/whatsapp-intent.ts')
    expect(src).not.toMatch(/pricing_json|subtotal|total:|price:|formatMoney|calculate/i)
    expect(src).toContain('createQuoteFromIntake(')
  })
})

describe('T-177 item 1: the owner takes over', () => {
  it('after the business replies to a customer itself, the assistant leaves that chat alone for 24 hours, a price request included', async () => {
    const classify = yes('svc_paint')
    const paused = await run(world(), conversation('idle', { _ownerRepliedAt: ago(2 * HOUR) }), text('How much to paint 3 bedrooms?'), classify)
    expect(paused).toEqual({ replies: [], keepText: false })
    expect(classify).not.toHaveBeenCalled()
    // and a request it was in the middle of is not carried on
    const mid = await run(world(), conversation('awaiting_description', { serviceId: 'svc_paint', _ownerRepliedAt: ago(HOUR) }), text('Three bedrooms, walls only'), classify)
    expect(mid).toEqual({ replies: [], keepText: false })
    // a day later it listens again
    const later = await run(world(), conversation('idle', { _ownerRepliedAt: ago(25 * HOUR) }), text('How much to paint 3 bedrooms?'), classify)
    expect(later.finished).toBe(true)
    expect(OWNER_PAUSE_MS).toBe(24 * HOUR)
    expect(ownerPaused(ago(23 * HOUR), now)).toBe(true)
    expect(ownerPaused(ago(24 * HOUR), now)).toBe(false)
    expect(ownerPaused(null, now)).toBe(false)
    expect(ownerPaused('nonsense', now)).toBe(false)
  })

  it('Meta’s echo of the owner’s own message is read for who and when only', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ id: '102290129340398', changes: [{ field: 'smb_message_echoes', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' }, message_echoes: [
        { from: '15550783881', to: '16505551234', id: 'wamid.echo1', timestamp: '1700255121', type: 'text', text: { body: 'Here is the info you asked for' } },
        // Meta leaves the number out when it does not share it: nothing to pause
        { from: '15550783881', to_user_id: 'BSUID', id: 'wamid.echo2', timestamp: '1700255122', type: 'text', text: { body: 'x' } },
      ] } }] }],
    }
    const echoes = parseOwnerEchoes(body)
    expect(echoes).toEqual([{ phoneNumberId: '106540352242922', to: '16505551234', messageId: 'wamid.echo1', at: new Date(1700255121 * 1000) }])
    expect(JSON.stringify(echoes)).not.toContain('Here is the info')
    // a customer's message is not an echo, and an echo is not a customer's message
    expect(parseWebhookPayload(body)).toEqual([])
    expect(parseOwnerEchoes({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1' }, message_echoes: [{ to: '1', id: 'x' }] } }] }] })).toEqual([])
    expect(parseOwnerEchoes(null)).toEqual([])
  })

  it('an owner’s reply is recorded on the chat, and stops a request that was under way', async () => {
    const at = new Date('2026-11-17T11:00:00.000Z')
    const under = world({ conversations: [{ id: 'conv-1', intake_state: 'awaiting_address', intake_data: { serviceId: 'svc_paint', projectDescription: 'Three bedrooms' } }] })
    await recordOwnerReply(fakeAdmin(under), 'tenant-a', '16505551234', at)
    expect(under.writes).toEqual([{ table: 'whatsapp_conversations', op: 'update', values: { intake_data: { _ownerRepliedAt: at.toISOString() }, intake_state: 'idle' } }])
    const idle = world({ conversations: [{ id: 'conv-1', intake_state: 'idle', intake_data: {} }] })
    await recordOwnerReply(fakeAdmin(idle), 'tenant-a', '16505551234', at)
    expect(idle.writes).toEqual([{ table: 'whatsapp_conversations', op: 'update', values: { intake_data: { _ownerRepliedAt: at.toISOString() } } }])
    // a customer the assistant has never seen: only the number and the time are kept
    const fresh = world()
    await recordOwnerReply(fakeAdmin(fresh), 'tenant-a', '16505551234', at)
    expect(fresh.writes).toEqual([{ table: 'whatsapp_conversations', op: 'insert', values: { tenant_id: 'tenant-a', customer_phone: '16505551234', status: 'active', intake_state: 'idle', intake_data: { _ownerRepliedAt: at.toISOString() } } }])
  })

  it('the echo is acted on only when signed by the app the number is connected through, and never for a message we sent', () => {
    const route = code('apps/web/src/app/api/whatsapp/webhook/route.ts')
    const echoes = route.slice(route.indexOf('parseOwnerEchoes(body)'))
    expect(echoes.indexOf('signedForConnection(')).toBeGreaterThan(0)
    expect(echoes.indexOf('recordOwnerReply(')).toBeGreaterThan(echoes.indexOf('signedForConnection('))
    expect(echoes.indexOf("eq('wa_message_id', echo.messageId)")).toBeLessThan(echoes.indexOf('recordOwnerReply('))
  })
})

describe('T-177 item 1: nothing more is stored or logged than is needed', () => {
  it('a message is kept without its text, and the text is added only when it is part of a price request', () => {
    const route = code('apps/web/src/app/api/whatsapp/webhook/route.ts')
    expect(route).toMatch(/content: null,\s*media_url: null,/)
    expect(route).toMatch(/if \(outcome\.keepText && kept\?\.id\)/)
    // the link to an estimate carries its token: what is kept of a reply has it cut off
    expect(route).toContain(".replace(/\\?token=[A-Za-z0-9_-]+/g, '')")
  })

  it('no log line in the assistant, the model call or the webhook carries a message, a name or a number', () => {
    for (const file of ['apps/web/src/lib/whatsapp-assistant.ts', 'apps/web/src/lib/ai/whatsapp-intent.ts', 'apps/web/src/app/api/whatsapp/webhook/route.ts', 'apps/web/src/lib/whatsapp-access.ts']) {
      const logs = code(file).match(/console\.\w+\([^\n]*\)/g) ?? []
      for (const line of logs) expect(line, `${file}: ${line}`).not.toMatch(/\btext\b|message\.|\.from\b|profileName|customer|phone|\.body\b/i)
    }
  })
})

// ---------------------------------------------------------------------------------------
describe('T-177 item 2: the template is automatic, with no button', () => {
  const connected = (): World =>
    world({
      config: { access_token_encrypted: encryptSecret('EAAtoken'), waba_id: '102289599326934', business_id: '506914307656634', connection_method: 'embedded' },
      tenant: { name: 'Kent Home Services', region: 'US' },
    })
  const existing = (over: Partial<MetaTemplate> = {}): MetaTemplate => ({ id: '1', name: ESTIMATE_TEMPLATE_NAME, language: 'en_US', status: 'APPROVED', category: 'UTILITY', rejectedReason: null, bodyText: estimateTemplateBody('Bluum Painting'), ...over })

  it('it exists on Meta: it is used, and nothing is created', async () => {
    templatesNamed.mockResolvedValue([existing()])
    const result = await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')
    expect(result).toMatchObject({ ok: true, created: false, template: { state: 'approved' } })
    expect(createTemplate).not.toHaveBeenCalled()
    // whatever language or state Meta has it in, the one that exists is the one used
    for (const variant of [existing({ language: 'en_GB' }), existing({ status: 'PENDING' }), existing({ status: 'PAUSED' }), existing({ status: 'DISABLED' })]) {
      templatesNamed.mockResolvedValue([variant])
      expect((await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')).ok).toBe(true)
    }
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('it is missing: it is created once, as a utility template in the business’s language, and shown as in review', async () => {
    const result = await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')
    expect(createTemplate).toHaveBeenCalledTimes(1)
    expect(createTemplate.mock.calls[0]![0]).toBe('EAAtoken')
    expect(createTemplate.mock.calls[0]![1]).toBe('102289599326934')
    expect(createTemplate.mock.calls[0]![2]).toMatchObject({ name: ESTIMATE_TEMPLATE_NAME, language: 'en_US', category: 'UTILITY' })
    expect(result).toMatchObject({ ok: true, created: true, template: { state: 'pending', metaStatus: 'PENDING' } })
  })

  it('it was rejected: Meta’s reason is shown, and no second one is made', async () => {
    templatesNamed.mockResolvedValue([existing({ status: 'REJECTED', rejectedReason: 'PROMOTIONAL' })])
    const result = await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')
    expect(result).toMatchObject({ ok: true, created: false, template: { state: 'rejected' } })
    expect(result.ok && result.template.reason).toMatch(/advertising/)
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('Meta cannot be asked: nothing is created blind, and the page is told plainly', async () => {
    templatesNamed.mockRejectedValue(new GraphError(0, null, 'Meta could not be reached'))
    const result = await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')
    expect(result).toMatchObject({ ok: false, status: 502, code: 'META_REFUSED' })
    expect(createTemplate).not.toHaveBeenCalled()
    // Meta refuses the creation: reported, with its code and nothing of ours
    templatesNamed.mockReset().mockResolvedValue([])
    createTemplate.mockRejectedValue(new GraphError(400, 80008, 'too many'))
    const refused = await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')
    expect(refused).toMatchObject({ ok: false, code: 'META_REFUSED' })
    expect(!refused.ok && refused.message).toMatch(/code 80008/)
    expect(JSON.stringify(refused)).not.toContain('EAAtoken')
    // Meta says "already exists" as a refusal: the one that exists is used
    templatesNamed.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([existing({ status: 'PENDING' })])
    createTemplate.mockRejectedValue(new GraphError(400, 100, 'Content in This Language Already Exists'))
    expect(await ensureEstimateTemplate(fakeAdmin(connected()), 'tenant-a')).toMatchObject({ ok: true, created: false, template: { state: 'pending' } })
  })

  it('opening the page only reads: it can never create a template (Bluum’s is not duplicated)', async () => {
    // nothing on Meta, and the page is loaded: still nothing is created
    const shown = await loadEstimateTemplate(fakeAdmin(connected()), 'tenant-a')
    expect(shown).toMatchObject({ ok: true, template: { state: 'none' } })
    expect(createTemplate).not.toHaveBeenCalled()
    const route = code('apps/web/src/app/api/whatsapp/template/route.ts')
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    expect(route).not.toContain('ensureEstimateTemplate')
    // the one place a template can be created is the connect route, after a successful connect
    const connect = code('apps/web/src/app/api/whatsapp/connect/route.ts')
    expect(connect.indexOf('ensureEstimateTemplate(')).toBeGreaterThan(connect.indexOf('if (!result.ok) return'))
    const callers = ['apps/web/src/app/api/whatsapp/config/route.ts', 'apps/web/src/app/api/whatsapp/status/route.ts', 'apps/web/src/app/api/whatsapp/send/route.ts', 'apps/web/src/lib/whatsapp-notify.ts', 'apps/web/src/app/api/whatsapp/webhook/route.ts']
    for (const file of callers) expect(code(file), file).not.toMatch(/ensureEstimateTemplate|createTemplate\(/)
  })

  it('the page has no button for it: it shows the status only', () => {
    const section = code('apps/web/src/components/whatsapp/MessageTemplates.tsx')
    expect(section).not.toMatch(/template-create|Create the template|method: 'POST'/)
    expect(section).not.toContain('template-refresh')
    for (const label of ['Approved', 'In review with Meta', 'Rejected by Meta']) expect(section).toContain(label)
    expect(section).toContain('data-testid="template-reason"')
  })
})

// ---------------------------------------------------------------------------------------
describe('T-177 items 3 and 4: the two lines on the page', () => {
  it('the test message: one line before the button, and no "will probably not arrive" afterwards', () => {
    expect(TEST_MESSAGE_LINE).toBe('Send “Hi” to your business number from your phone first. WhatsApp only lets businesses reply within 24 hours of a customer’s last message.')
    const card = code('apps/web/src/components/whatsapp/ConnectedCard.tsx')
    expect(card).not.toMatch(/will probably not arrive|will not arrive yet|Meta accepted the message/)
    expect(card.indexOf('{TEST_MESSAGE_LINE}')).toBeGreaterThan(0)
    expect(card.indexOf('{TEST_MESSAGE_LINE}')).toBeLessThan(card.indexOf('data-testid="send-test"'))
  })

  it('the personal number warning: the owner’s words, in one place, in the text that introduces Meta’s window', () => {
    expect(PERSONAL_NUMBER_LINE).toBe('Use your business WhatsApp number. Don’t connect a personal number, it can stop working in the normal WhatsApp app.')
    const page = code('apps/web/src/app/(dashboard)/app/whatsapp/page.tsx')
    expect(page.match(/\{PERSONAL_NUMBER_LINE\}/g)).toHaveLength(1)
    expect(page.indexOf('data-testid="connect-intro"')).toBeLessThan(page.indexOf('{PERSONAL_NUMBER_LINE}'))
    expect(page.indexOf('{PERSONAL_NUMBER_LINE}')).toBeLessThan(page.indexOf('<ConnectWhatsApp settings={data.connect} onConnected={onConnected} />'))
    for (const file of ['apps/web/src/components/whatsapp/ManualConnect.tsx', 'apps/web/src/components/whatsapp/ConnectedCard.tsx', 'apps/web/src/components/whatsapp/ConnectWhatsApp.tsx']) expect(code(file), file).not.toContain('PERSONAL_NUMBER')
    // not a popup
    expect(page).not.toMatch(/role="dialog"|aria-modal|window\.(alert|confirm)/)
  })
})

// ---------------------------------------------------------------------------------------
describe('T-177 items 5 and 7: the plan must include WhatsApp, and the subscription must be live', () => {
  it('the plan definitions decide which plans have WhatsApp', () => {
    const withWhatsApp = PLANS.filter((p) => p.channels.includes('whatsapp')).map((p) => p.id)
    for (const plan of PLANS) expect(planHasChannel(plan.id, 'whatsapp'), plan.id).toBe(withWhatsApp.includes(plan.id))
    expect(planHasChannel(null, 'whatsapp')).toBe(false)
    expect(planHasChannel('plan_made_up', 'whatsapp')).toBe(false)
    // of the plans on offer, the cheapest has none and the others have it
    const offered = PLANS.filter((p) => p.offered)
    expect(offered.some((p) => !p.channels.includes('whatsapp'))).toBe(true)
    expect(offeredPlansWithChannel('whatsapp').length).toBeGreaterThan(0)
  })

  it('a live subscription on a plan with WhatsApp may speak; every other case is silent', () => {
    const has = PLANS.find((p) => p.offered && p.channels.includes('whatsapp'))!.id
    const lacks = PLANS.find((p) => p.offered && !p.channels.includes('whatsapp'))!.id
    for (const status of ['active', 'trialing']) expect(whatsappAccessFor({ plan_id: has, status }), status).toEqual({ allowed: true })
    // cancelled, and anything a later billing change may add
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', null]) {
      expect(whatsappAccessFor({ plan_id: has, status }), String(status)).toEqual({ allowed: false, why: 'subscription' })
      expect(subscriptionLive(status)).toBe(false)
    }
    // a plan without WhatsApp, and no plan at all (the free allowance)
    expect(whatsappAccessFor({ plan_id: lacks, status: 'active' })).toEqual({ allowed: false, why: 'plan' })
    expect(whatsappAccessFor(null)).toEqual({ allowed: false, why: 'plan' })
    expect(whatsappAccessFor({ plan_id: null, status: 'active' })).toEqual({ allowed: false, why: 'plan' })
  })

  it('a payment that failed and is being retried (past due) does not pause WhatsApp: it has the same grace as the quote limit', () => {
    const has = PLANS.find((p) => p.offered && p.channels.includes('whatsapp'))!.id
    expect(whatsappAccessFor({ plan_id: has, status: 'past_due' })).toEqual({ allowed: true })
    // one rule for both: the assistant and the quote limit read the same function
    expect(subscriptionLive('past_due')).toBe(true)
    expect(code('apps/web/src/lib/whatsapp-access.ts')).toContain('subscriptionLive(subscription.status)')
    expect(code('apps/web/src/lib/plan-limits.ts')).toContain('subscriptionLive(subscription.status as string)')
    // and when the subscription is then cancelled, it pauses
    expect(whatsappAccessFor({ plan_id: has, status: 'canceled' })).toEqual({ allowed: false, why: 'subscription' })
  })

  it('the two lines the page shows: the owner’s words when paused, the plans that have it (from the definitions) when not included', () => {
    expect(PAUSED_LINE).toBe('Your WhatsApp assistant is paused until your plan is active again.')
    expect(accessView({ allowed: false, why: 'subscription' })).toEqual({ allowed: false, why: 'subscription', line: PAUSED_LINE })
    const names = offeredPlansWithChannel('whatsapp').map((p) => p.name)
    for (const name of names) expect(upgradeLine()).toContain(name)
    expect(accessView({ allowed: false, why: 'plan' })).toEqual({ allowed: false, why: 'plan', line: upgradeLine() })
    expect(accessView({ allowed: true })).toEqual({ allowed: true, why: null, line: null })
    expect(accessRefusal({ allowed: true })).toBeNull()
    expect(accessRefusal({ allowed: false, why: 'plan' })).toMatchObject({ status: 403, code: 'PLAN_REQUIRED' })
    expect(accessRefusal({ allowed: false, why: 'subscription' })).toMatchObject({ status: 403, code: 'ASSISTANT_PAUSED', message: PAUSED_LINE })
  })

  it('no plan is named in the WhatsApp page or its components', () => {
    const names = PLANS.map((p) => p.name.replace(/ \(legacy\)$/, ''))
    for (const file of ['apps/web/src/app/(dashboard)/app/whatsapp/page.tsx', 'apps/web/src/components/whatsapp/ConnectedCard.tsx', 'apps/web/src/components/whatsapp/PausedConnection.tsx', 'apps/web/src/components/whatsapp/MessageTemplates.tsx', 'apps/web/src/lib/whatsapp-access.ts']) {
      const src = code(file)
      // as a quoted word, or as "the … plan" ("WhatsApp Business app" is the app's name, not a plan)
      for (const name of new Set(names)) expect(src, `${file}: ${name}`).not.toMatch(new RegExp(`['"\`]${name}['"\`]|\\b${name} plans?\\b`))
      expect(src, file).not.toMatch(/plan_us_|plan_pro|plan_growth|plan_starter/)
    }
  })

  it('a subscription that cannot be read counts as not live: silent rather than speaking for a business that may have lapsed', async () => {
    const broken = { from: () => { throw new Error('db down') } } as never
    expect(await whatsappAccess(broken, 'tenant-a')).toEqual({ allowed: false, why: 'subscription' })
    expect(await whatsappAccess(fakeAdmin(world({ subscription: { plan_id: 'plan_us_pro', status: 'active' } })), 'tenant-a')).toEqual({ allowed: true })
    expect(await whatsappAccess(fakeAdmin(world({ subscription: null })), 'tenant-a')).toEqual({ allowed: false, why: 'plan' })
  })

  it('an inactive subscription means no outbound message in any path', async () => {
    // 1. the approval notice (the ordinary message and the template alike)
    const lapsed = world({
      conversations: [{ id: 'conv-1', customer_phone: '15555550142' }],
      config: { phone_number_id: '1065', display_phone_number: '+1 555-555-0100', access_token_encrypted: encryptSecret('EAAtoken'), waba_id: '1022', connection_method: 'embedded', is_active: true },
      subscription: { plan_id: 'plan_us_pro', status: 'canceled' },
    })
    expect(await notifyEstimateReady({ tenantId: 'tenant-a', quoteId: 'qte_1', businessName: 'B', quoteViewUrl: 'https://x/q/1?token=t', now }, fakeAdmin(lapsed))).toEqual({ sent: null, why: 'paused' })
    expect(lapsed.writes).toEqual([])
    const notify = code('apps/web/src/lib/whatsapp-notify.ts')
    expect(notify.indexOf('whatsappAccess(admin, tenantId)')).toBeGreaterThan(0)
    expect(notify.indexOf('whatsappAccess(admin, tenantId)')).toBeLessThan(notify.indexOf('sendTextMessage('))
    expect(notify.indexOf('whatsappAccess(admin, tenantId)')).toBeLessThan(notify.indexOf('sendTemplateMessage('))

    // 2. a customer's message: the webhook stops before the assistant, so nothing is sent and the model is not asked
    const hook = code('apps/web/src/app/api/whatsapp/webhook/route.ts')
    expect(hook.indexOf('if (!access.allowed) continue')).toBeGreaterThan(0)
    expect(hook.indexOf('if (!access.allowed) continue')).toBeLessThan(hook.indexOf('handleCustomerMessage('))
    // the only send in the webhook is the reply, which sits after that line
    expect(hook.match(/sendTextMessage\(/g)).toHaveLength(1)
    expect(hook.indexOf('if (!access.allowed) continue')).toBeLessThan(hook.indexOf('sendTextMessage('))

    // 3. the test message, 4. a new connection (which is also where the template is created), 5. the manual method
    const send = code('apps/web/src/app/api/whatsapp/send/route.ts')
    expect(send.indexOf('accessRefusal(await whatsappAccess(admin, tenantId))')).toBeLessThan(send.indexOf('sendTextMessage('))
    const connect = code('apps/web/src/app/api/whatsapp/connect/route.ts')
    expect(connect.indexOf('accessRefusal(await whatsappAccess(admin, auth.tenantId))')).toBeLessThan(connect.indexOf('connectWithEmbeddedSignup('))
    expect(connect.indexOf('accessRefusal(await whatsappAccess(admin, auth.tenantId))')).toBeLessThan(connect.indexOf('ensureEstimateTemplate('))
    const config = code('apps/web/src/app/api/whatsapp/config/route.ts')
    expect(config.indexOf('accessRefusal(await whatsappAccess(admin, auth.tenantId))')).toBeLessThan(config.indexOf('saveManualConnection('))

    // and those are all the places a WhatsApp message can leave from
    const senders = ['apps/web/src/lib/whatsapp-notify.ts', 'apps/web/src/app/api/whatsapp/webhook/route.ts', 'apps/web/src/app/api/whatsapp/send/route.ts', 'apps/web/src/lib/whatsapp-intake.ts']
    expect(senders).toHaveLength(4)
  })

  it('the connection is kept, never removed, when the assistant is paused', () => {
    for (const file of ['apps/web/src/lib/whatsapp-access.ts', 'apps/web/src/lib/whatsapp-assistant.ts']) expect(code(file), file).not.toMatch(/\.delete\(\)|disconnect\(/)
  })
})

// ---------------------------------------------------------------------------------------
describe('T-177 item 6: Embedded Signup v5', () => {
  it('Meta’s window is opened as v5, with the configuration id it is given', () => {
    expect(EMBEDDED_SIGNUP_VERSION).toBe('v5')
    expect(signupLoginOptions('900000000000176')).toEqual({ config_id: '900000000000176', response_type: 'code', override_default_response_type: true, extras: { setup: {}, version: 'v5' } })
    // v5 turns the WhatsApp Business app option on by default: nothing opts out of it
    expect(JSON.stringify(signupLoginOptions('1'))).not.toMatch(/features|enabled/)
  })

  it('v5’s finish message is read: the account from messaging_account_ids, and whether the number stays on the Business app', () => {
    expect(readSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { phone_number_id: '106540352242922', is_on_biz_app: true, messaging_account_ids: ['102289599326934'], primary_waac_ids: [], business_id: '506914307656634' } })).toEqual({ kind: 'finished', wabaId: '102289599326934', phoneNumberId: '106540352242922', businessId: '506914307656634', onBusinessApp: true })
    expect(readSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '106540352242922', is_on_biz_app: false, messaging_account_ids: ['102289599326934'], business_id: '506914307656634' } })).toMatchObject({ kind: 'finished', onBusinessApp: false, wabaId: '102289599326934' })
  })

  it('the ids still come from the environment, and a stored connection is not touched by the version', () => {
    const client = read('apps/web/src/components/whatsapp/ConnectWhatsApp.tsx') + read('apps/web/src/lib/whatsapp-signup.ts')
    expect(client).not.toMatch(/4654271271562035|1566858898811795/)
    expect(code('apps/web/src/app/api/whatsapp/config/route.ts')).toContain('process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID')
    expect(code('apps/web/src/lib/whatsapp-connect.ts')).not.toContain('EMBEDDED_SIGNUP_VERSION')
  })
})

// ---------------------------------------------------------------------------------------
describe('T-177 item 8: a photo sent in a chat gets a small copy, within the upload limits', () => {
  /** A JPEG of this size: left half red, right half blue */
  function picture(width: number, height: number, orientation?: number): Buffer {
    const data = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        data[at] = x < width / 2 ? 230 : 20
        data[at + 1] = 20
        data[at + 2] = x < width / 2 ? 20 : 230
        data[at + 3] = 255
      }
    }
    const bytes = Buffer.from(jpeg.encode({ width, height, data }, 85).data)
    if (!orientation) return bytes
    // an EXIF block saying how the picture should be turned, put straight after the start marker
    const exif = Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
    return Buffer.concat([bytes.subarray(0, 2), exif, bytes.subarray(2)])
  }
  const pixel = (image: { width: number; data: Uint8Array }, x: number, y: number) => {
    const at = (y * image.width + x) * 4
    return (image.data[at] as number) > (image.data[at + 2] as number) ? 'red' : 'blue'
  }

  it('a phone photo comes out as a JPEG at most 480 px on its longest side, within the small-copy limit', () => {
    const original = picture(1600, 1200)
    const small = makeSmallCopy(original)!
    expect(small).not.toBeNull()
    const decoded = jpeg.decode(small, { useTArray: true })
    expect([decoded.width, decoded.height]).toEqual([SMALL_PHOTO_MAX_EDGE, 360])
    expect(small.length).toBeLessThanOrEqual(SMALL_PHOTO_MAX_BYTES)
    expect(small.length).toBeLessThan(original.length)
    // it is what the server's own check before serving accepts
    expect(smallPhotoBytesOk(small.subarray(0, 12), small.length)).toBe(true)
    // the picture is the same picture: red on the left, blue on the right
    expect([pixel(decoded, 20, 180), pixel(decoded, 460, 180)]).toEqual(['red', 'blue'])
  })

  it('a small photo is not made bigger', () => {
    const decoded = jpeg.decode(makeSmallCopy(picture(200, 100))!, { useTArray: true })
    expect([decoded.width, decoded.height]).toEqual([200, 100])
  })

  it('a photo stored on its side comes out upright', () => {
    expect(exifOrientation(picture(40, 20))).toBe(1)
    expect(exifOrientation(picture(40, 20, 6))).toBe(6)
    // stored 800 wide, to be seen turned a quarter: the copy is tall, with red at the top
    const turned = jpeg.decode(makeSmallCopy(picture(800, 400, 6))!, { useTArray: true })
    expect([turned.width, turned.height]).toEqual([240, 480])
    expect([pixel(turned, 120, 20), pixel(turned, 120, 460)]).toEqual(['red', 'blue'])
    const other = jpeg.decode(makeSmallCopy(picture(800, 400, 8))!, { useTArray: true })
    expect([pixel(other, 120, 20), pixel(other, 120, 460)]).toEqual(['blue', 'red'])
    const upsideDown = jpeg.decode(makeSmallCopy(picture(800, 400, 3))!, { useTArray: true })
    expect([upsideDown.width, upsideDown.height]).toEqual([480, 240])
    expect([pixel(upsideDown, 20, 120), pixel(upsideDown, 460, 120)]).toEqual(['blue', 'red'])
    // the eight orientations keep or swap the sides as they should
    const grid = { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) }
    for (const o of [1, 2, 3, 4]) expect([applyOrientation(grid, o).width, applyOrientation(grid, o).height], String(o)).toEqual([2, 1])
    for (const o of [5, 6, 7, 8]) expect([applyOrientation(grid, o).width, applyOrientation(grid, o).height], String(o)).toEqual([1, 2])
    expect(scaleDown({ width: 2, height: 2, data: new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 100, 100, 100, 255, 200, 200, 200, 255]) }, 1, 1).data.slice(0, 3)).toEqual(new Uint8Array([100, 100, 100]))
  })

  it('anything that is not a JPEG, or is broken, simply has no small copy (the original is served)', () => {
    expect(makeSmallCopy(Buffer.from('<html>not a photo</html>'))).toBeNull()
    expect(makeSmallCopy(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull()
    expect(makeSmallCopy(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]))).toBeNull()
    expect(makeSmallCopy(new Uint8Array(0))).toBeNull()
    expect(isJpeg(picture(8, 8))).toBe(true)
    expect(exifOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBe(1)
  })

  it('the upload limits of the request form apply to a file from a chat, and the two lists cannot drift apart', () => {
    const init = read('apps/web/src/app/api/public/uploads/init/route.ts')
    expect(init).toContain('const MAX_IMAGE_SIZE = 10 * 1024 * 1024')
    expect(init).toContain('const MAX_DOC_SIZE = 25 * 1024 * 1024')
    expect(init).toContain(`const ALLOWED_IMAGE_TYPES = [${UPLOAD_IMAGE_TYPES.map((t) => `'${t}'`).join(', ')}]`)
    expect(init).toContain(`const ALLOWED_DOC_TYPES = [${UPLOAD_DOCUMENT_TYPES.map((t) => `'${t}'`).join(', ')}]`)
    expect([UPLOAD_MAX_IMAGE_BYTES, UPLOAD_MAX_DOCUMENT_BYTES]).toEqual([10 * 1024 * 1024, 25 * 1024 * 1024])
    expect(uploadAllowed('image/jpeg', 10 * 1024 * 1024)).toBe(true)
    expect(uploadAllowed('image/jpeg', 10 * 1024 * 1024 + 1)).toBe(false)
    expect(uploadAllowed('application/pdf', 25 * 1024 * 1024)).toBe(true)
    expect(uploadAllowed('application/pdf', 25 * 1024 * 1024 + 1)).toBe(false)
    expect(uploadAllowed('image/jpeg; charset=binary', 1000)).toBe(true)
    for (const type of ['video/mp4', 'audio/ogg', 'text/html', 'application/zip', '', null]) expect(uploadAllowed(type, 1000), String(type)).toBe(false)
    expect(uploadAllowed('image/jpeg', 0)).toBe(false)
    expect(uploadKindOf('IMAGE/PNG')).toBe('image')
  })

  it('the chat photo path keeps the original private, checks the limits, then makes the copy beside it', () => {
    const engine = code('apps/web/src/lib/messaging/intake-engine.ts')
    const store = engine.slice(engine.indexOf('export async function storeIntakeMedia('))
    expect(store.indexOf('uploadAllowed(')).toBeGreaterThan(0)
    expect(store.indexOf('uploadAllowed(')).toBeLessThan(store.indexOf('uploadToR2(r2Key'))
    expect(store.indexOf('uploadToR2(r2Key')).toBeLessThan(store.indexOf('uploadToR2(smallPhotoKey(r2Key)'))
    expect(store).toContain("uploadToR2(smallPhotoKey(r2Key), small, 'image/jpeg')")
    // one new dependency, pinned, and it is the JPEG codec
    const deps = JSON.parse(read('apps/web/package.json')).dependencies as Record<string, string>
    expect(deps['jpeg-js']).toBe('0.4.4')
    expect(Object.keys(deps)).not.toContain('sharp')
  })
})

// ---------------------------------------------------------------------------------------
describe('T-177 item 9: the Privacy and Terms pages', () => {
  it('both say who runs the product, with the company number from a setting, not from the page', () => {
    expect(OPERATOR).toEqual({ name: 'Billiom Limited', registeredIn: 'England and Wales' })
    expect(operatorStatement('12345678')).toBe(`${PRODUCT_NAME} is run by Billiom Limited, a company registered in England and Wales (company number 12345678).`)
    // until the number is set, the sentence is whole without it
    expect(operatorStatement(undefined)).toBe(`${PRODUCT_NAME} is run by Billiom Limited, a company registered in England and Wales.`)
    expect(operatorStatement('  ')).toBe(operatorStatement(null))
    for (const page of ['apps/web/src/app/privacy/page.tsx', 'apps/web/src/app/terms/page.tsx']) {
      const src = code(page)
      expect(src, page).toContain('{operatorStatement(process.env.NEXT_PUBLIC_COMPANY_NUMBER)}')
      // T-180 added a paragraph to the Terms (payments and tax), so its date moved on a day
      expect(src, page).toContain(page.includes('terms') ? 'Last updated: 18 November 2026' : 'Last updated: 17 November 2026')
      expect(src, page).not.toMatch(/Billiom|company number \d/)
    }
    expect(read('apps/web/.env.example')).toMatch(/^NEXT_PUBLIC_COMPANY_NUMBER=$/m)
  })

  it('the Terms name the governing law and carry the WhatsApp section', () => {
    expect(GOVERNING_LAW).toBe('the law of England and Wales')
    const terms = code('apps/web/src/app/terms/page.tsx')
    expect(terms).toContain('These terms are governed by ${GOVERNING_LAW}.')
    const whatsapp = terms.slice(terms.indexOf("title: '10. WhatsApp'"), terms.indexOf("title: '11. Governing law'"))
    expect(whatsapp).toMatch(/a number your business owns and has the right to use/)
    expect(whatsapp).toMatch(/WhatsApp Business Messaging Policy and the WhatsApp Commerce Policy/)
    expect(whatsapp).toMatch(/may pause the assistant on your number if Meta restricts or suspends it/)
    // the sections are still numbered in order
    const titles = [...terms.matchAll(/title: '(\d+)\. /g)].map((m) => Number(m[1]))
    expect(titles).toEqual(titles.map((_, i) => i + 1))
  })

  it('the Privacy page says what happens to a WhatsApp message that is not a price request', () => {
    const privacy = code('apps/web/src/app/privacy/page.tsx')
    expect(privacy).toMatch(/A message that does not is not answered by us and its text is not kept/)
  })
})
