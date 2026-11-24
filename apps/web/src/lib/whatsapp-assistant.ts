/**
 * T-177: the WhatsApp assistant — server only. What happens when a customer
 * writes to a connected number. The rules are in
 * `lib/whatsapp-assistant-rules.ts`; this file reads the business's
 * configuration, asks the model one yes/no question, and keeps the chat's
 * state.
 *
 * In short: silent, unless a customer asks for a price for something this
 * business offers. Then a few short questions, only for what is missing, and
 * the link to the estimate. Silent again afterwards.
 *
 * Nothing about a customer's message is logged, and the text of a message the
 * assistant does not answer is never stored (`keepText`).
 */
import { getRegion } from '@qolumns/shared'
import type { WhatsAppConversation, WhatsAppIntakeState } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { classifyPriceIntent, type IntentBusiness, type PriceIntent } from '@/lib/ai/whatsapp-intent'
import { createQuoteFromIntake, extractPostalCode, storeIntakeMedia } from '@/lib/messaging/intake-engine'
import type { ChannelAdapter } from '@/lib/messaging/types'
import type { IncomingMessage } from '@/lib/whatsapp'
import {
  MAX_RETRIES,
  asking,
  emailIn,
  inServiceArea,
  needsFrom,
  nextStep,
  ownerPaused,
  questionFor,
  questionStale,
  say,
  usableProfileName,
  type AssistantData,
  type IntakeNeeds,
  type Wording,
} from '@/lib/whatsapp-assistant-rules'

type Admin = ReturnType<typeof createAdminClient>

export interface AssistantOutcome {
  /** what to send, in order (empty = stay silent) */
  replies: string[]
  newState?: WhatsAppIntakeState
  newData?: AssistantData
  /** the customer's message is part of a price request, so its text may be kept with the chat */
  keepText: boolean
  /** a request was made: this chat is finished, and the next message starts a new one */
  finished?: boolean
}

const SILENT: AssistantOutcome = { replies: [], keepText: false }

interface ServiceRow {
  id: string
  name: string
  description: string | null
  scope_includes: string[] | null
  scope_excludes: string[] | null
  media_config: { minPhotos?: number; photoGuidance?: string | null } | null
}

interface Business {
  name: string
  region: string | null
  contactRequirement: string | null
  serviceAreaMode: string | null
  serviceAreaValues: string[] | null
  services: ServiceRow[]
}

/** The business's own configuration: everything the assistant decides from */
async function loadBusiness(admin: Admin, tenantId: string): Promise<Business | null> {
  const [{ data: tenant }, { data: services }] = await Promise.all([
    admin.from('tenants').select('name, region, contact_requirement, service_area_mode, service_area_values').eq('id', tenantId).maybeSingle(),
    admin.from('services').select('id, name, description, scope_includes, scope_excludes, media_config').eq('tenant_id', tenantId).eq('active', true).order('name'),
  ])
  const t = tenant as { name: string; region?: string | null; contact_requirement?: string | null; service_area_mode?: string | null; service_area_values?: string[] | null } | null
  if (!t) return null
  return {
    name: t.name,
    region: t.region ?? null,
    contactRequirement: t.contact_requirement ?? null,
    serviceAreaMode: t.service_area_mode ?? null,
    serviceAreaValues: t.service_area_values ?? null,
    services: (services ?? []) as unknown as ServiceRow[],
  }
}

const intentBusiness = (b: Business): IntentBusiness => ({
  name: b.name,
  services: b.services.map((s) => ({ id: s.id, name: s.name, description: s.description, scopeIncludes: s.scope_includes, scopeExcludes: s.scope_excludes })),
  serviceAreaMode: b.serviceAreaMode,
  serviceAreaValues: b.serviceAreaValues,
})

export interface AssistantInput {
  admin: Admin
  tenantId: string
  conversation: WhatsAppConversation
  message: IncomingMessage
  /** the name WhatsApp shows for the customer, when Meta sent one */
  profileName?: string | null
  channel: ChannelAdapter
  now?: Date
  /** for tests: the model's answer */
  classify?: (business: IntentBusiness, text: string) => Promise<PriceIntent>
}

/**
 * One customer message in, what to do about it out. Never throws for an
 * ordinary failure: when something breaks before a request is under way, the
 * assistant stays silent.
 */
export async function handleCustomerMessage(input: AssistantInput): Promise<AssistantOutcome> {
  const { conversation, message } = input
  const now = input.now ?? new Date()
  const data = (conversation.intake_data ?? {}) as AssistantData
  const state = (conversation.intake_state || 'idle') as WhatsAppIntakeState

  // The business is talking to this customer itself: leave the chat alone
  if (ownerPaused(data._ownerRepliedAt, now)) return SILENT

  const stale = asking(state) && questionStale(conversation.updated_at, now)
  if (asking(state) && !stale) return continueRequest(input, state, data)

  // Not in the middle of a request: is this a price request?
  const dropped: Pick<AssistantOutcome, 'newState' | 'newData'> = stale ? { newState: 'idle', newData: keepOnly(data) } : {}
  const text = (message.text || message.caption || '').trim()
  if (!text) return { ...SILENT, ...dropped }

  const business = await loadBusiness(input.admin, input.tenantId)
  if (!business || business.services.length === 0) return { ...SILENT, ...dropped }

  const intent = await (input.classify ?? classifyPriceIntent)(intentBusiness(business), text)
  const service = intent.start ? business.services.find((s) => s.id === intent.serviceId) : undefined
  if (!service) return { ...SILENT, ...dropped }

  const start: AssistantData = {
    ...keepOnly(data),
    serviceId: service.id,
    serviceName: service.name,
    customerName: usableProfileName(input.profileName) ?? undefined,
    customerPhone: message.from,
    projectDescription: intent.jobDescribed ? text : undefined,
    assetIds: [],
    photoCount: 0,
    _retries: 0,
  }
  // a photo that came with the request is part of it
  const withMedia = message.mediaId ? await addMedia(input, start) : { data: start, kept: true }
  return advance(input, business, service, withMedia.data, { opening: true, from: 'idle' })
}

/** What survives when a request is dropped or a new one starts: only the business's own reply time */
function keepOnly(data: AssistantData): AssistantData {
  return data._ownerRepliedAt ? { _ownerRepliedAt: data._ownerRepliedAt } : {}
}

async function addMedia(input: AssistantInput, data: AssistantData): Promise<{ data: AssistantData; kept: boolean }> {
  const stored = await storeIntakeMedia({ supabase: input.admin, channel: input.channel, tenantId: input.tenantId, conversation: input.conversation, message: input.message })
  if (!stored.ok) return { data, kept: false }
  return {
    data: { ...data, assetIds: stored.assetId ? [...(data.assetIds ?? []), stored.assetId] : (data.assetIds ?? []), photoCount: (data.photoCount ?? 0) + 1 },
    kept: true,
  }
}

function wording(business: Business, service: ServiceRow, data: AssistantData, needs: IntakeNeeds): Wording {
  return {
    businessName: business.name,
    serviceName: service.name,
    customerName: data.customerName,
    postalCodeNoun: getRegion(business.region).copy.postalCodeNoun,
    minPhotos: needs.minPhotos,
    photoGuidance: service.media_config?.photoGuidance ?? null,
  }
}

const needsOf = (business: Business, service: ServiceRow): IntakeNeeds =>
  needsFrom({ contactRequirement: business.contactRequirement, serviceAreaMode: business.serviceAreaMode, minPhotos: service.media_config?.minPhotos })

/** The customer answered (or sent a photo) while the assistant was asking */
async function continueRequest(input: AssistantInput, state: WhatsAppIntakeState, data: AssistantData): Promise<AssistantOutcome> {
  const { message } = input
  const business = await loadBusiness(input.admin, input.tenantId)
  const service = business?.services.find((s) => s.id === data.serviceId)
  // the service was switched off or removed while the chat was open: drop the request quietly
  if (!business || !service) return { replies: [], keepText: false, newState: 'idle', newData: keepOnly(data) }
  const needs = needsOf(business, service)
  const w = wording(business, service, data, needs)
  const text = (message.text || '').trim()

  const again = (reply: string): AssistantOutcome =>
    (data._retries ?? 0) >= MAX_RETRIES
      ? { replies: [], keepText: false, newState: 'idle', newData: keepOnly(data) }
      : { replies: [reply], keepText: true, newData: { ...data, _retries: (data._retries ?? 0) + 1 } }

  // A photo or a document, at any point of the request
  if (message.mediaId) {
    const added = await addMedia(input, data)
    if (!added.kept) return { replies: state === 'awaiting_photos' ? [say.photoNotKept()] : [], keepText: true }
    const count = added.data.photoCount ?? 0
    if (state !== 'awaiting_photos') return { replies: [], keepText: true, newData: added.data }
    // exactly enough: say so once, and wait for more photos or any word
    return { replies: count === needs.minPhotos ? [say.photosEnough()] : [], keepText: true, newData: added.data }
  }
  if (!text) return { replies: [], keepText: false }

  let next: AssistantData = { ...data, _retries: 0 }
  let photosDone = false
  switch (state) {
    case 'awaiting_description':
      if (text.length < 10) return again(say.descriptionAgain())
      next.projectDescription = text
      break
    case 'awaiting_name': {
      const name = usableProfileName(text)
      if (!name) return again(say.name())
      next.customerName = name
      break
    }
    case 'awaiting_email': {
      const email = emailIn(text)
      if (!email) return again(say.emailAgain())
      next.customerEmail = email
      break
    }
    case 'awaiting_address': {
      const postcode = extractPostalCode(text, getRegion(business.region))
      if (!postcode) return again(say.locationAgain(w))
      if (!inServiceArea(postcode, business.serviceAreaMode, business.serviceAreaValues, { address: text, areas: getRegion(business.region).areas })) {
        return { replies: [say.outsideArea(w)], keepText: true, newState: 'idle', newData: keepOnly(data) }
      }
      next = { ...next, jobAddress: text.slice(0, 300), jobPostcode: postcode }
      break
    }
    case 'awaiting_photos':
      // any word moves on: with the photos sent so far, or with none
      photosDone = true
      break
    default:
      return SILENT
  }
  return advance(input, business, service, next, { opening: false, from: state, photosDone })
}

/** Ask for the next missing thing, or make the request and send the link */
async function advance(
  input: AssistantInput,
  business: Business,
  service: ServiceRow,
  data: AssistantData,
  opts: { opening: boolean; from: WhatsAppIntakeState; photosDone?: boolean }
): Promise<AssistantOutcome> {
  const needs = needsOf(business, service)
  const w = wording(business, service, data, needs)
  // photos that arrived before they were asked for count
  const photosDone = opts.photosDone || (opts.from !== 'awaiting_photos' && (data.photoCount ?? 0) >= needs.minPhotos && needs.minPhotos > 0)
  const step = nextStep(data, needs, { photosDone })

  if (step !== 'ready') {
    const question = questionFor(step, w)
    return { replies: [opts.opening ? say.opening(w, question) : (question as string)], keepText: true, newState: step, newData: { ...data, _retries: 0 } }
  }

  try {
    const result = await createQuoteFromIntake(
      { supabase: input.admin, channel: input.channel, tenantId: input.tenantId, conversation: input.conversation, message: input.message, region: getRegion(business.region) },
      data
    )
    const made = (result.newData ?? {}) as AssistantData
    if (!result.success || !made._quoteId) {
      return { replies: [say.failed(w)], keepText: true, newState: 'idle', newData: keepOnly(data) }
    }
    // a request held at the plan's limit has no estimate to show yet: the engine's own sentence says so
    const reply = made._quoteUrl ? (opts.opening ? say.openingWithLink(w, made._quoteUrl) : say.link(w, made._quoteUrl)) : (result.responseText ?? say.failed(w))
    return { replies: [reply], keepText: true, newState: 'completed', newData: { ...data, _quoteId: made._quoteId, _retries: 0 }, finished: true }
  } catch (error) {
    console.error('[WhatsApp assistant] the request could not be made:', error instanceof Error ? error.name : 'unknown error')
    return { replies: [say.failed(w)], keepText: true, newState: 'idle', newData: keepOnly(data) }
  }
}

/**
 * The business replied to a customer from its own WhatsApp Business app
 * (Meta's `smb_message_echoes`). The assistant leaves that chat alone for 24
 * hours, and drops a request it was in the middle of: the owner has taken
 * over. Only the customer's number and the time are kept; the owner's
 * message is not read.
 */
export async function recordOwnerReply(admin: Admin, tenantId: string, customerPhone: string, at: Date): Promise<void> {
  const { data: rows } = await admin
    .from('whatsapp_conversations')
    .select('id, intake_state, intake_data')
    .eq('tenant_id', tenantId)
    .eq('customer_phone', customerPhone)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
  const existing = rows?.[0] as { id: string; intake_state: WhatsAppIntakeState; intake_data: AssistantData | null } | undefined
  const repliedAt = at.toISOString()
  if (existing) {
    const under = asking(existing.intake_state)
    await admin
      .from('whatsapp_conversations')
      .update({
        intake_data: under ? { _ownerRepliedAt: repliedAt } : { ...(existing.intake_data ?? {}), _ownerRepliedAt: repliedAt },
        ...(under && { intake_state: 'idle' }),
      })
      .eq('id', existing.id)
    return
  }
  await admin.from('whatsapp_conversations').insert({ tenant_id: tenantId, customer_phone: customerPhone, status: 'active', intake_state: 'idle', intake_data: { _ownerRepliedAt: repliedAt } })
}
