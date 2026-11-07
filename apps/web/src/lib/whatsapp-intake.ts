/**
 * WhatsApp Guided Intake Flow
 *
 * Handles the conversational Q&A for collecting quote request details via WhatsApp.
 * State machine guides customer through: service selection -> contact info -> job details -> photos
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getRegion, listRegions, type RegionDefinition } from '@estimator/shared'
import type {
  WhatsAppIntakeState,
  WhatsAppIntakeData,
  WhatsAppConversation,
} from '@estimator/shared'
import {
  sendTextMessage,
  downloadMedia,
  type WhatsAppConfig,
  type IncomingMessage,
} from './whatsapp'
import { generateQuoteToken, getTokenExpiry } from './tokens'
import { uploadToR2, isR2Configured } from './r2'
import { enqueueQuoteJob } from './queue'
import { incrementUsageCounter } from './usage'
import { checkPlanLimit, maybeNotifyLimitReached, recordOverageQuote } from './plan-limits'

// Keywords that trigger intake start
const TRIGGER_KEYWORDS = ['quote', 'estimate', 'price', 'pricing', 'cost', 'how much']

// Keywords for affirmative responses
const YES_KEYWORDS = ['yes', 'yeah', 'yep', 'y', 'sure', 'ok', 'okay', 'confirm', 'correct', 'done', 'send', 'submit']

// Keywords for negative/skip responses
const SKIP_KEYWORDS = ['no', 'nope', 'n', 'skip', 'none', 'later']

interface IntakeContext {
  supabase: SupabaseClient
  waConfig: WhatsAppConfig
  tenantId: string
  conversation: WhatsAppConversation
  message: IncomingMessage
  /** T-133: tenant region (loaded once per message) — postal wording + formats */
  region?: RegionDefinition
}

/** T-133: the tenant's region; a lookup failure falls back to the legacy region */
async function loadTenantRegion(supabase: SupabaseClient, tenantId: string): Promise<RegionDefinition> {
  try {
    const { data } = await supabase.from('tenants').select('region').eq('id', tenantId).single()
    return getRegion((data as { region?: string | null } | null)?.region)
  } catch {
    return getRegion(null)
  }
}

/** T-133: find a postal code in free text, trying the tenant's region format first */
function extractPostalCode(address: string, region: RegionDefinition): string | undefined {
  const regions = [region, ...listRegions().filter((r) => r.code !== region.code)]
  for (const r of regions) {
    const unanchored = r.postalCodePattern.replace(/^\^/, '').replace(/\$$/, '')
    const match = address.match(new RegExp(`(${unanchored})`, 'i'))
    if (match?.[1]) return match[1].toUpperCase()
  }
  return undefined
}

interface IntakeResult {
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
 * Process an incoming WhatsApp message through the intake flow
 */
export async function processIntakeMessage(rawCtx: IntakeContext): Promise<IntakeResult> {
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
      responseText: `Hi! I'll get you an instant quote for *${service.name}*.\n\nFirst — briefly describe the job. What needs doing? Sizes, quantities or any details help us quote accurately.`,
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
    responseText: `Great choice! *${matchedService.name}*\n\nBriefly describe the job — what needs doing? Sizes, quantities or any details help us quote accurately.`,
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
  _ctx: IntakeContext,
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
    responseText: `Got it!\n\nWhat's your phone number? (Reply "skip" to use your WhatsApp number)`,
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
    // Use WhatsApp number
    phone = ctx.message.from
  } else {
    // Clean up phone number
    phone = text.replace(/[^0-9+]/g, '')
    if (phone.length < 10) {
      return {
        success: true,
        responseText: 'Please enter a valid phone number, or reply "skip" to use your WhatsApp number.',
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
  _ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const input = text.trim().toLowerCase()

  if (YES_KEYWORDS.includes(input) || input === 'done' || input === 'finished') {
    // Move to confirmation
    return generateConfirmationMessage(currentData)
  }

  if (SKIP_KEYWORDS.includes(input)) {
    // Skip photos, move to confirmation
    return generateConfirmationMessage(currentData)
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
  const { supabase, waConfig, tenantId, message } = ctx

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

  // Download the media from WhatsApp
  if (!message.mediaId) {
    return {
      success: true,
      responseText: 'Photo received! Send more, or reply "done" when finished.',
    }
  }

  try {
    const mediaResult = await downloadMedia(waConfig.accessToken, message.mediaId)

    if (!mediaResult.success || !mediaResult.data) {
      console.error('[WhatsApp Intake] Failed to download media:', mediaResult.error)
      return {
        success: true,
        responseText: 'Photo received! Send more, or reply "done" when finished.',
      }
    }

    // Upload the actual bytes to R2 BEFORE creating the asset record (T-111).
    // Previously only the asset row was created — the object was never written,
    // so the worker fetched nothing and photos silently vanished from AI extraction.
    const r2Key = `whatsapp/${tenantId}/${ctx.conversation.id}/${Date.now()}_${message.mediaId}`
    const contentType = mediaResult.contentType || 'image/jpeg'

    if (!isR2Configured()) {
      console.error('[WhatsApp Intake] R2 not configured — cannot store media')
      return {
        success: true,
        responseText:
          "We couldn't save that photo — please continue, and mention key details in text instead.",
      }
    }

    try {
      await uploadToR2(r2Key, mediaResult.data, contentType)
    } catch (uploadError) {
      console.error('[WhatsApp Intake] R2 upload failed:', uploadError)
      return {
        success: true,
        responseText:
          "We couldn't save that photo — please try sending it again, or reply \"done\" to continue without it.",
      }
    }

    // Store asset record in database (only after the object actually exists)
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        tenant_id: tenantId,
        type: message.type === 'image' ? 'image' : 'document',
        file_name: `whatsapp_${message.type}_${Date.now()}`,
        content_type: contentType,
        size_bytes: mediaResult.data.length,
        r2_key: r2Key,
      })
      .select('id')
      .single()

    if (assetError) {
      console.error('[WhatsApp Intake] Failed to create asset record:', assetError)
    }

    // Update photo count and asset IDs
    const assetIds = [...(currentData.assetIds || [])]
    if (asset?.id) {
      assetIds.push(asset.id)
    }
    const photoCount = (currentData.photoCount || 0) + 1

    return {
      success: true,
      newState: 'awaiting_photos',
      newData: { ...currentData, assetIds, photoCount },
      responseText: `Photo ${photoCount} received! Send more, or reply "done" when finished.`,
    }
  } catch (error) {
    console.error('[WhatsApp Intake] Media processing error:', error)
    return {
      success: true,
      responseText: 'Photo received! Send more, or reply "done" when finished.',
    }
  }
}

/**
 * Generate confirmation message with summary
 */
function generateConfirmationMessage(data: WhatsAppIntakeData): IntakeResult {
  const photoText = data.photoCount
    ? `\n- Photos: ${data.photoCount} received`
    : '\n- Photos: None'

  const descriptionText = data.projectDescription
    ? `\n- Job: ${data.projectDescription.length > 80 ? `${data.projectDescription.slice(0, 77)}...` : data.projectDescription}`
    : ''

  const summary = `Great! Here's a summary of your quote request:\n
- Service: *${data.serviceName}*${descriptionText}
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
 * Create quote request from intake data and trigger processing
 */
async function createQuoteFromIntake(
  ctx: IntakeContext,
  data: WhatsAppIntakeData
): Promise<IntakeResult> {
  const { supabase, tenantId, conversation } = ctx

  if (!data.serviceId || !data.customerName || !data.customerEmail) {
    return {
      success: false,
      error: 'Missing required data',
      responseText: "Sorry, something went wrong. Please reply 'quote' to start again.",
      newState: 'idle',
      newData: {},
    }
  }

  try {
    // Enforce plan limit (T-101/T-102) before creating any records.
    // Over the limit with overage available → proceed and meter; otherwise block.
    // Neutral customer-facing message — never expose the business's billing state.
    const planLimit = await checkPlanLimit(supabase, tenantId)
    const isOverageQuote = !planLimit.allowed && planLimit.overageAvailable
    if (!planLimit.allowed && !planLimit.overageAvailable) {
      console.warn(
        `[WhatsApp Intake] Plan limit reached (${planLimit.used}/${planLimit.limit}) — rejecting intake`
      )
      return {
        success: false,
        error: 'PLAN_LIMIT_REACHED',
        responseText:
          'Sorry, instant quoting is temporarily unavailable. Please contact the business directly and they will get you a quote.',
        newState: 'idle',
        newData: {},
      }
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
        customer_email: data.customerEmail,
        customer_phone: data.customerPhone || conversation.customer_phone,
        job_postcode: data.jobPostcode || null,
        job_address: data.jobAddress || null,
        // T-111: the description feeds triage + AI signal extraction downstream
        // (the worker reads the _project_description fieldId)
        job_answers: data.projectDescription
          ? [{ fieldId: '_project_description', value: data.projectDescription }]
          : [],
        asset_ids: data.assetIds || [],
        source_json: { type: 'whatsapp' },
      })
      .select()
      .single()

    if (qrError || !quoteRequest) {
      throw new Error(`Failed to create quote request: ${qrError?.message}`)
    }

    // Generate token
    const { token, hash } = generateQuoteToken()
    const tokenExpiry = getTokenExpiry(30)

    // Create quote record
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        tenant_id: tenantId,
        quote_request_id: quoteRequest.id,
        service_id: data.serviceId,
        customer_json: {
          name: data.customerName,
          email: data.customerEmail,
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
        content_json: {},
        status: 'queued',
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
      })
      .select()
      .single()

    if (quoteError || !quote) {
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
      .from('whatsapp_conversations')
      .update({
        quote_request_id: quoteRequest.id,
        intake_state: 'processing',
      })
      .eq('id', conversation.id)

    // Increment usage counter
    await incrementUsageCounter(supabase, tenantId, 'estimates_created')

    // If this consumed the last quote in the plan, notify the business once (T-101)
    await maybeNotifyLimitReached(supabase, tenantId, tenant.name)

    // Meter this quote to Stripe when it's beyond the plan limit (T-102)
    if (isOverageQuote) {
      await recordOverageQuote(planLimit, quote.id)
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
      responseText: `Your quote request has been submitted!\n\nWe're generating your personalized quote now. You'll receive it at ${data.customerEmail} shortly.\n\nYou can also view it here:\n${quoteViewUrl}`,
    }
  } catch (error) {
    console.error('[WhatsApp Intake] Failed to create quote:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseText: "Sorry, something went wrong creating your quote. Please try again later or contact us directly.",
      newState: 'idle',
      newData: {},
    }
  }
}

/**
 * Send response message via WhatsApp
 */
export async function sendIntakeResponse(
  config: WhatsAppConfig,
  to: string,
  text: string
): Promise<boolean> {
  const result = await sendTextMessage(config, { to, text })
  return result.success
}
