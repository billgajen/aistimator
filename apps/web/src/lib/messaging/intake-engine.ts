/**
 * Channel-agnostic guided intake engine (T-136, extracted from the T-111 WhatsApp intake).
 *
 * Conversational Q&A that collects a quote request over a messaging channel.
 * State machine: service selection -> description -> contact info -> address -> photos -> confirm.
 * Channel specifics (send, media download, formatting, conversation table) come
 * from the ChannelAdapter, so WhatsApp and SMS behave identically by construction.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getRegion, listRegions, type RegionDefinition } from '@qolumns/shared'
import type {
  WhatsAppIntakeState,
  WhatsAppIntakeData,
} from '@qolumns/shared'
import { generateQuoteToken, getTokenExpiry } from '../tokens'
import { uploadToR2, isR2Configured } from '../r2'
import { uploadAllowed, uploadKindOf } from '../upload-limits'
import { smallPhotoKey } from '../small-photo'
import { makeSmallCopy } from '../small-photo-make'
import { enqueueQuoteJob } from '../queue'
import { checkPlanLimit, claimPlanQuote, maybeNotifyLimitReached, maybeWarnFreeQuotesLeft, recordOverageQuote, releasePlanQuote } from '../plan-limits'
import type { PlanClaim } from '../plan-limits'
import type { IntakeContext } from './types'
import { leadHoldContent, leadHeldMessage, notifyLeadHeld } from '../lead-hold'

// Keywords that trigger intake start
const TRIGGER_KEYWORDS = ['quote', 'estimate', 'price', 'pricing', 'cost', 'how much']

// Keywords for affirmative responses
const YES_KEYWORDS = ['yes', 'yeah', 'yep', 'y', 'sure', 'ok', 'okay', 'confirm', 'correct', 'done', 'send', 'submit']

// Keywords for negative/skip responses
const SKIP_KEYWORDS = ['no', 'nope', 'n', 'skip', 'none', 'later']


/** T-133: the tenant's region; a lookup failure falls back to the legacy region */
export async function loadTenantRegion(supabase: SupabaseClient, tenantId: string): Promise<RegionDefinition> {
  try {
    const { data } = await supabase.from('tenants').select('region').eq('id', tenantId).single()
    return getRegion((data as { region?: string | null } | null)?.region)
  } catch {
    return getRegion(null)
  }
}

/** T-133: find a postal code in free text, trying the tenant's region format first */
export function extractPostalCode(address: string, region: RegionDefinition): string | undefined {
  const regions = [region, ...listRegions().filter((r) => r.code !== region.code)]
  for (const r of regions) {
    const unanchored = r.postalCodePattern.replace(/^\^/, '').replace(/\$$/, '')
    const match = address.match(new RegExp(`(${unanchored})`, 'i'))
    if (match?.[1]) return match[1].toUpperCase()
  }
  return undefined
}

export interface IntakeResult {
  success: boolean
  newState?: WhatsAppIntakeState
  newData?: Partial<WhatsAppIntakeData>
  responseText?: string
  error?: string
}

/**
 * Check if a message should trigger intake start
 */
export function shouldStartIntake(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return TRIGGER_KEYWORDS.some((keyword) => lower.includes(keyword))
}

/**
 * Process an incoming channel message through the intake flow
 */
export async function runIntake(rawCtx: IntakeContext): Promise<IntakeResult> {
  const ctx: IntakeContext = rawCtx.region
    ? rawCtx
    : { ...rawCtx, region: await loadTenantRegion(rawCtx.supabase, rawCtx.tenantId) }
  const { conversation, message } = ctx
  const currentState = conversation.intake_state || 'idle'
  const currentData = conversation.intake_data || {}

  // Handle media messages (photos/documents)
  if (message.type === 'image' || message.type === 'document') {
    return handleMediaUpload(ctx, currentState, currentData)
  }

  // Handle text messages based on current state
  const text = message.text || ''

  switch (currentState) {
    case 'idle':
      return handleIdleState(ctx, text)

    case 'awaiting_service':
      return handleServiceSelection(ctx, text, currentData)

    case 'awaiting_description':
      return handleDescriptionInput(ctx, text, currentData)

    case 'awaiting_name':
      return handleNameInput(ctx, text, currentData)

    case 'awaiting_email':
      return handleEmailInput(ctx, text, currentData)

    case 'awaiting_phone':
      return handlePhoneInput(ctx, text, currentData)

    case 'awaiting_address':
      return handleAddressInput(ctx, text, currentData)

    case 'awaiting_photos':
      return handlePhotosState(ctx, text, currentData)

    case 'awaiting_confirmation':
      return handleConfirmation(ctx, text, currentData)

    case 'processing':
      return {
        success: true,
        responseText: "Your quote is being generated. We'll send you the link shortly!",
      }

    case 'completed':
      // Start new intake if triggered
      if (shouldStartIntake(text)) {
        return handleIdleState(ctx, text)
      }
      return {
        success: true,
        responseText:
          'Your previous quote has been sent. Reply with "quote" to request a new one.',
      }

    default:
      return handleIdleState(ctx, text)
  }
}

/**
 * Handle idle state (T-111): ANY first message starts the quote flow — the
 * business's WhatsApp number exists to quote, and requiring a magic keyword
 * ("quote") lost customers who opened with "Hi, do you paint houses?".
 */
async function handleIdleState(ctx: IntakeContext, text: string): Promise<IntakeResult> {
  if (!text.trim()) {
    return {
      success: true,
      responseText: 'Hi! Send us a message to get an instant quote for our services.',
    }
  }

  // Get available services for this tenant
  const { data: services } = await ctx.supabase
    .from('services')
    .select('id, name')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .order('name')

  if (!services || services.length === 0) {
    return {
      success: false,
      error: 'No services configured for this tenant',
      responseText: "Sorry, we're not set up to provide quotes yet. Please contact us directly.",
    }
  }

  // If only one service, skip selection
  if (services.length === 1) {
    const service = services[0]!
    return {
      success: true,
      newState: 'awaiting_description',
      newData: { serviceId: service.id, serviceName: service.name },
      responseText: `Hi! I'll get you an instant quote for ${ctx.channel.emphasize(service.name)}.\n\nFirst — briefly describe the job. What needs doing? Sizes, quantities or any details help us quote accurately.`,
    }
  }

  // Multiple services - ask for selection
  const serviceList = services
    .map((s, i) => `${i + 1}. ${s.name}`)
    .join('\n')

  // Store services in context for selection
  const serviceMap = Object.fromEntries(services.map((s, i) => [String(i + 1), s]))

  return {
    success: true,
    newState: 'awaiting_service',
    newData: { _availableServices: serviceMap } as unknown as Partial<WhatsAppIntakeData>,
    responseText: `Hi! I can help you get a quote.\n\nWhich service are you interested in?\n\n${serviceList}\n\nReply with the number.`,
  }
}

/**
 * Handle service selection
 */
async function handleServiceSelection(
  ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): Promise<IntakeResult> {
  const selection = text.trim()

  // Get available services
  const { data: services } = await ctx.supabase
    .from('services')
    .select('id, name')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .order('name')

  if (!services || services.length === 0) {
    return {
      success: false,
      error: 'No services available',
      responseText: "Sorry, we couldn't find any available services.",
    }
  }

  // Try to match by number
  const index = parseInt(selection, 10) - 1
  let matchedService: { id: string; name: string } | undefined

  if (!isNaN(index) && index >= 0 && index < services.length) {
    matchedService = services[index]
  } else {
    // Try to match by name (case-insensitive partial match)
    matchedService = services.find((s) =>
      s.name.toLowerCase().includes(selection.toLowerCase())
    )
  }

  if (!matchedService) {
    const serviceList = services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')
    return {
      success: true,
      responseText: `I didn't understand that. Please reply with the number:\n\n${serviceList}`,
    }
  }

  return {
    success: true,
    newState: 'awaiting_description',
    newData: { ...currentData, serviceId: matchedService.id, serviceName: matchedService.name },
    responseText: `Great choice! ${ctx.channel.emphasize(matchedService.name)}\n\nBriefly describe the job — what needs doing? Sizes, quantities or any details help us quote accurately.`,
  }
}

/**
 * Handle job description (T-111) — the primary text signal for AI extraction.
 * Without it, quotes were priced from base fees alone.
 */
function handleDescriptionInput(
  _ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const description = text.trim()

  if (description.length < 10) {
    return {
      success: true,
      responseText:
        'Could you add a little more detail? Even one or two sentences about the job helps us price it accurately.',
    }
  }

  return {
    success: true,
    newState: 'awaiting_name',
    newData: { ...currentData, projectDescription: description },
    responseText: `Perfect, thanks!\n\nNow, what's your name?`,
  }
}

/**
 * Handle name input
 */
function handleNameInput(
  _ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const name = text.trim()

  if (name.length < 2) {
    return {
      success: true,
      responseText: 'Please enter your full name.',
    }
  }

  return {
    success: true,
    newState: 'awaiting_email',
    newData: { ...currentData, customerName: name },
    responseText: `Thanks, ${name}!\n\nWhat's your email address? (We'll send your quote here)`,
  }
}

/**
 * Handle email input
 */
function handleEmailInput(
  ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const email = text.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRegex.test(email)) {
    return {
      success: true,
      responseText: "That doesn't look like a valid email. Please enter your email address.",
    }
  }

  return {
    success: true,
    newState: 'awaiting_phone',
    newData: { ...currentData, customerEmail: email },
    responseText: `Got it!\n\nWhat's your phone number? (Reply "skip" to use your ${ctx.channel.senderNumberNoun})`,
  }
}

/**
 * Handle phone input
 */
function handlePhoneInput(
  ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const input = text.trim().toLowerCase()

  let phone: string
  if (SKIP_KEYWORDS.includes(input)) {
    // Use the number the customer is messaging from
    phone = ctx.message.from
  } else {
    // Clean up phone number
    phone = text.replace(/[^0-9+]/g, '')
    if (phone.length < 10) {
      return {
        success: true,
        responseText: `Please enter a valid phone number, or reply "skip" to use your ${ctx.channel.senderNumberNoun}.`,
      }
    }
  }

  return {
    success: true,
    newState: 'awaiting_address',
    newData: { ...currentData, customerPhone: phone },
    responseText: `Perfect!\n\nWhat's the address or ${(ctx.region ?? getRegion(null)).copy.postalCodeNoun} for the job?`,
  }
}

/**
 * Handle address/postcode input
 */
function handleAddressInput(
  ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const address = text.trim()

  if (address.length < 3) {
    return {
      success: true,
      responseText: `Please enter the job address or ${(ctx.region ?? getRegion(null)).copy.postalCodeNoun}.`,
    }
  }

  // T-133: postal code format comes from region data (tenant's region first)
  const postcode = extractPostalCode(address, ctx.region ?? getRegion(null))

  return {
    success: true,
    newState: 'awaiting_photos',
    newData: {
      ...currentData,
      jobAddress: address,
      jobPostcode: postcode,
      assetIds: [],
      photoCount: 0,
    },
    responseText: `Got it!\n\nNow, please send photos of the job area. This helps us give you an accurate quote.\n\nSend your photos, then reply "done" when finished (or "skip" if you don't have any).`,
  }
}

/**
 * Handle photos state - waiting for images or done/skip command
 */
function handlePhotosState(
  ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const input = text.trim().toLowerCase()

  if (YES_KEYWORDS.includes(input) || input === 'done' || input === 'finished') {
    // Move to confirmation
    return generateConfirmationMessage(ctx, currentData)
  }

  if (SKIP_KEYWORDS.includes(input)) {
    // Skip photos, move to confirmation
    return generateConfirmationMessage(ctx, currentData)
  }

  return {
    success: true,
    responseText: `Please send photos of the job, then reply "done" when finished.\n\nOr reply "skip" if you don't have any photos.`,
  }
}

/**
 * Handle media upload (photos/documents)
 */
async function handleMediaUpload(
  ctx: IntakeContext,
  currentState: WhatsAppIntakeState,
  currentData: WhatsAppIntakeData
): Promise<IntakeResult> {
  // If in address state and user sends photo, accept it and move to photos state
  if (currentState === 'awaiting_address') {
    currentData = {
      ...currentData,
      jobAddress: 'Address pending - photo received first',
      assetIds: [],
      photoCount: 0,
    }
  } else if (currentState !== 'awaiting_photos') {
    // Only accept media during awaiting_photos or awaiting_address states
    return {
      success: true,
      responseText: "I got your photo! Let's continue with the quote request first, then you can send more photos.",
    }
  }

  const stored = await storeIntakeMedia(ctx)
  if (!stored.ok) {
    if (stored.reason === 'not_allowed') {
      return {
        success: true,
        responseText: "We can't use that file: please send a photo (JPEG or PNG, up to 10 MB), or reply \"done\" to continue without it.",
      }
    }
    if (stored.reason === 'no_storage') {
      return {
        success: true,
        responseText: "We couldn't save that photo — please continue, and mention key details in text instead.",
      }
    }
    if (stored.reason === 'storage') {
      return {
        success: true,
        responseText: "We couldn't save that photo — please try sending it again, or reply \"done\" to continue without it.",
      }
    }
    return {
      success: true,
      responseText: 'Photo received! Send more, or reply "done" when finished.',
    }
  }

  // Update photo count and asset IDs
  const assetIds = [...(currentData.assetIds || [])]
  if (stored.assetId) {
    assetIds.push(stored.assetId)
  }
  const photoCount = (currentData.photoCount || 0) + 1

  return {
    success: true,
    newState: 'awaiting_photos',
    newData: { ...currentData, assetIds, photoCount },
    responseText: `Photo ${photoCount} received! Send more, or reply "done" when finished.`,
  }
}

export type StoredMedia =
  | { ok: true; assetId: string | null }
  | { ok: false; reason: 'no_media' | 'download' | 'not_allowed' | 'no_storage' | 'storage' }

/**
 * Keep a photo or document a customer sent in a chat: download it from the
 * channel, store the original privately, and record it as an asset.
 *
 * T-177:
 * - the upload limits of the request form apply here too (type and size); a
 *   file outside them is not stored;
 * - a photo gets a small copy beside the original (`<key>.small`), as a photo
 *   from the request form does, so the dashboard and the quote page do not
 *   load the full picture for a thumbnail. The original is what the AI reads.
 */
export async function storeIntakeMedia(ctx: IntakeContext): Promise<StoredMedia> {
  const { supabase, tenantId, message } = ctx
  if (!message.mediaId) return { ok: false, reason: 'no_media' }

  try {
    const mediaResult = await ctx.channel.downloadMedia(message)

    if (!mediaResult.success || !mediaResult.data) {
      console.error('[Intake] Failed to download media:', mediaResult.error)
      return { ok: false, reason: 'download' }
    }

    const contentType = (mediaResult.contentType || 'image/jpeg').split(';')[0]!.trim().toLowerCase()
    if (!uploadAllowed(contentType, mediaResult.data.length)) {
      console.warn(`[Intake] A ${ctx.channel.name} file was not kept: outside the upload limits`)
      return { ok: false, reason: 'not_allowed' }
    }
    const kind = uploadKindOf(contentType)

    // Upload the actual bytes to R2 BEFORE creating the asset record (T-111).
    // Previously only the asset row was created — the object was never written,
    // so the worker fetched nothing and photos silently vanished from AI extraction.
    const r2Key = `${ctx.channel.name}/${tenantId}/${ctx.conversation.id}/${Date.now()}_${safeKeyPart(message.messageId)}`

    if (!isR2Configured()) {
      console.error('[Intake] R2 not configured — cannot store media')
      return { ok: false, reason: 'no_storage' }
    }

    try {
      await uploadToR2(r2Key, mediaResult.data, contentType)
    } catch (uploadError) {
      console.error('[Intake] R2 upload failed:', uploadError instanceof Error ? uploadError.name : 'unknown error')
      return { ok: false, reason: 'storage' }
    }

    // T-177: the small copy. Best effort: a photo without one is served as its original.
    if (kind === 'image') {
      try {
        const small = makeSmallCopy(mediaResult.data)
        if (small) await uploadToR2(smallPhotoKey(r2Key), small, 'image/jpeg')
      } catch (smallError) {
        console.warn('[Intake] no small copy was made:', smallError instanceof Error ? smallError.name : 'unknown error')
      }
    }

    // Store asset record in database (only after the object actually exists)
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        tenant_id: tenantId,
        type: kind === 'document' ? 'document' : 'image',
        file_name: `${ctx.channel.name}_${message.type}_${Date.now()}`,
        content_type: contentType,
        size_bytes: mediaResult.data.length,
        r2_key: r2Key,
      })
      .select('id')
      .single()

    if (assetError) {
      console.error('[Intake] Failed to create asset record:', assetError.message)
    }
    return { ok: true, assetId: (asset?.id as string | undefined) ?? null }
  } catch (error) {
    console.error('[Intake] Media processing error:', error instanceof Error ? error.name : 'unknown error')
    return { ok: false, reason: 'download' }
  }
}

/**
 * Generate confirmation message with summary
 */
function generateConfirmationMessage(ctx: IntakeContext, data: WhatsAppIntakeData): IntakeResult {
  const photoText = data.photoCount
    ? `\n- Photos: ${data.photoCount} received`
    : '\n- Photos: None'

  const descriptionText = data.projectDescription
    ? `\n- Job: ${data.projectDescription.length > 80 ? `${data.projectDescription.slice(0, 77)}...` : data.projectDescription}`
    : ''

  const summary = `Great! Here's a summary of your quote request:\n
- Service: ${ctx.channel.emphasize(data.serviceName ?? '')}${descriptionText}
- Name: ${data.customerName}
- Email: ${data.customerEmail}
- Phone: ${data.customerPhone}
- Location: ${data.jobAddress}${photoText}

Does this look correct? Reply "yes" to submit, or "no" to start over.`

  return {
    success: true,
    newState: 'awaiting_confirmation',
    newData: data,
    responseText: summary,
  }
}

/**
 * Handle confirmation response
 */
async function handleConfirmation(
  ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): Promise<IntakeResult> {
  const input = text.trim().toLowerCase()

  if (SKIP_KEYWORDS.includes(input) || input === 'no' || input === 'restart') {
    return {
      success: true,
      newState: 'idle',
      newData: {},
      responseText: 'No problem! Reply "quote" when you\'re ready to start again.',
    }
  }

  if (!YES_KEYWORDS.includes(input)) {
    return {
      success: true,
      responseText: 'Reply "yes" to submit your quote request, or "no" to start over.',
    }
  }

  // Create the quote request
  return createQuoteFromIntake(ctx, currentData)
}

/**
 * Create quote request from intake data and trigger processing.
 *
 * T-177: exported for the WhatsApp assistant, and an email is no longer
 * required when the customer's phone number is known (a request needs a name
 * and one way to reach the customer, as on the request form since T-151).
 * The scripted flow always collects an email, so nothing changes for it.
 */
export async function createQuoteFromIntake(
  ctx: IntakeContext,
  data: WhatsAppIntakeData
): Promise<IntakeResult> {
  const { supabase, tenantId, conversation } = ctx
  const reachable = Boolean(data.customerEmail || data.customerPhone || conversation.customer_phone)

  if (!data.serviceId || !data.customerName || !reachable) {
    return {
      success: false,
      error: 'Missing required data',
      responseText: "Sorry, something went wrong. Please reply 'quote' to start again.",
      newState: 'idle',
      newData: {},
    }
  }

  try {
    // The plan limit (T-101/T-102), read before any record is created. The
    // decision that counts is the claim below (T-180), made and counted in one
    // step inside the database. Neutral customer-facing message — never expose
    // the business's billing state.
    const planLimit = await checkPlanLimit(supabase, tenantId)
    // T-134 (AD-026): over the limit with overage off → capture as an unpriced lead.
    // T-180: the same for a business a platform admin has suspended.
    const expectHold = !planLimit.allowed && !planLimit.overageAvailable
    if (expectHold) {
      console.warn(
        planLimit.suspended
          ? '[Intake] Business is suspended — capturing as held lead'
          : `[Intake] Plan limit reached (${planLimit.used}/${planLimit.limit}) — capturing as held lead`
      )
    }

    // Get tenant details
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('name, currency, tax_enabled, tax_label, tax_rate')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      throw new Error('Failed to get tenant details')
    }

    // Get service details
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('document_type_default')
      .eq('id', data.serviceId)
      .single()

    if (serviceError || !service) {
      throw new Error('Failed to get service details')
    }

    // Create quote request
    const { data: quoteRequest, error: qrError } = await supabase
      .from('quote_requests')
      .insert({
        tenant_id: tenantId,
        service_id: data.serviceId,
        customer_name: data.customerName,
        customer_email: data.customerEmail || null,
        customer_phone: data.customerPhone || conversation.customer_phone,
        job_postcode: data.jobPostcode || null,
        job_address: data.jobAddress || null,
        // T-111: the description feeds triage + AI signal extraction downstream
        // (the worker reads the _project_description fieldId)
        job_answers: data.projectDescription
          ? [{ fieldId: '_project_description', value: data.projectDescription }]
          : [],
        asset_ids: data.assetIds || [],
        source_json: { type: ctx.channel.name },
      })
      .select()
      .single()

    if (qrError || !quoteRequest) {
      throw new Error(`Failed to create quote request: ${qrError?.message}`)
    }

    // Generate token
    const { token, hash } = generateQuoteToken()
    const tokenExpiry = getTokenExpiry(30)

    // T-180 (AD-063): is this a priced quote? Decided AND counted in one step inside the database
    let claim: PlanClaim | null = null
    if (!expectHold) claim = await claimPlanQuote(supabase, tenantId)
    const limitHold = expectHold || claim?.claimed === false
    const holdStatus = claim?.status ?? planLimit

    // Create quote record
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        tenant_id: tenantId,
        quote_request_id: quoteRequest.id,
        service_id: data.serviceId,
        customer_json: {
          name: data.customerName,
          ...(data.customerEmail && { email: data.customerEmail }),
          phone: data.customerPhone || conversation.customer_phone,
        },
        pricing_json: {
          currency: tenant.currency,
          subtotal: 0,
          taxLabel: tenant.tax_enabled ? tenant.tax_label : undefined,
          // DB stores rate as decimal (0.20 = 20%), display expects whole number (20 = 20%)
          taxRate: tenant.tax_enabled ? (tenant.tax_rate || 0) * 100 : undefined,
          taxAmount: 0,
          total: 0,
          breakdown: [],
        },
        document_type: service.document_type_default,
        content_json: limitHold ? leadHoldContent(tenant.name) : {},
        status: limitHold ? 'pending_review' : 'queued',
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
      })
      .select()
      .single()

    if (quoteError || !quote) {
      // The quote was counted but could not be saved: give the count back
      if (claim) await releasePlanQuote(supabase, tenantId, claim)
      throw new Error(`Failed to create quote: ${quoteError?.message}`)
    }

    // Link assets to quote request
    if (data.assetIds && data.assetIds.length > 0) {
      await supabase
        .from('assets')
        .update({ quote_request_id: quoteRequest.id })
        .in('id', data.assetIds)
    }

    // Update conversation with quote request ID
    await supabase
      .from(ctx.channel.conversationTable)
      .update({
        quote_request_id: quoteRequest.id,
        intake_state: 'processing',
      })
      .eq('id', conversation.id)

    // T-134: held leads are not priced and don't consume the plan
    if (limitHold) {
      // A suspended business is not told to "pick a plan": the hold is ours, not its plan's
      if (!holdStatus.suspended) {
        await notifyLeadHeld({
          tenantId,
          businessName: tenant.name,
          customerName: data.customerName,
          serviceName: data.serviceName || 'your service',
          quoteId: quote.id,
          used: holdStatus.used,
          limit: holdStatus.limit,
          per: holdStatus.per,
        })
      }
      return {
        success: true,
        newState: 'completed',
        newData: { ...data, _quoteId: quote.id } as unknown as Partial<WhatsAppIntakeData>,
        responseText: leadHeldMessage(tenant.name),
      }
    }

    // The quote was counted by the claim above (T-180). Tell the business, once each:
    // two free quotes left, and the last quote of the allowance or the month used (T-101)
    if (claim?.claimed) {
      await maybeWarnFreeQuotesLeft(supabase, tenantId, tenant.name, claim.status)
      await maybeNotifyLimitReached(supabase, tenantId, tenant.name)
    }

    // Meter this quote to Stripe when it's beyond the plan limit (T-102)
    if (claim?.overage) {
      await recordOverageQuote(claim.status, quote.id)
    }

    // Enqueue for processing
    await enqueueQuoteJob({
      quoteId: quote.id,
      quoteRequestId: quoteRequest.id,
      tenantId: tenantId,
      timestamp: Date.now(),
      quoteToken: token,
    })

    // Store quote info for sending link later
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const quoteViewUrl = `${appUrl}/q/${quote.id}?token=${token}`

    return {
      success: true,
      newState: 'completed',
      newData: { ...data, _quoteId: quote.id, _quoteUrl: quoteViewUrl } as unknown as Partial<WhatsAppIntakeData>,
      responseText: data.customerEmail
        ? `Your quote request has been submitted!\n\nWe're generating your personalized quote now. You'll receive it at ${data.customerEmail} shortly.\n\nYou can also view it here:\n${quoteViewUrl}`
        : `Your quote request has been submitted!\n\nWe're generating your personalized quote now. You can view it here:\n${quoteViewUrl}`,
    }
  } catch (error) {
    console.error('[Intake] Failed to create quote:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseText: "Sorry, something went wrong creating your quote. Please try again later or contact us directly.",
      newState: 'idle',
      newData: {},
    }
  }
}

/** R2-safe key fragment from a channel message id */
function safeKeyPart(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '').slice(-64) || 'media'
}
