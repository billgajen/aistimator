/**
 * WhatsApp Guided Intake Flow
 *
 * Handles the conversational Q&A for collecting quote request details via WhatsApp.
 * State machine guides customer through: service selection -> contact info -> job details -> photos
 */

import type { SupabaseClient } from '@supabase/supabase-js'
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
import { enqueueQuoteJob } from './queue'
import { incrementUsageCounter } from './usage'

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
export async function processIntakeMessage(ctx: IntakeContext): Promise<IntakeResult> {
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
 * Handle idle state - check for trigger keywords
 */
async function handleIdleState(ctx: IntakeContext, text: string): Promise<IntakeResult> {
  if (!shouldStartIntake(text)) {
    return {
      success: true,
      responseText:
        'Hi! Reply with "quote" or "estimate" to get a price for our services.',
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
      newState: 'awaiting_name',
      newData: { serviceId: service.id, serviceName: service.name },
      responseText: `Great! I'll help you get a quote for *${service.name}*.\n\nFirst, what's your name?`,
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
    newState: 'awaiting_name',
    newData: { ...currentData, serviceId: matchedService.id, serviceName: matchedService.name },
    responseText: `Great choice! *${matchedService.name}*\n\nWhat's your name?`,
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
    responseText: `Perfect!\n\nWhat's the address or postcode for the job?`,
  }
}

/**
 * Handle address/postcode input
 */
function handleAddressInput(
  _ctx: IntakeContext,
  text: string,
  currentData: WhatsAppIntakeData
): IntakeResult {
  const address = text.trim()

  if (address.length < 3) {
    return {
      success: true,
      responseText: 'Please enter the job address or postcode.',
    }
  }

  // Try to extract postcode (UK format or US ZIP)
  const postcodeMatch = address.match(/([A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2})/i) ||
    address.match(/(\d{5}(-\d{4})?)/)
  const postcode = postcodeMatch?.[1]?.toUpperCase()

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

    // Upload to R2 via the upload API
    const r2Key = `whatsapp/${tenantId}/${ctx.conversation.id}/${Date.now()}_${message.mediaId}`

    // Store asset record in database
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        tenant_id: tenantId,
        type: message.type === 'image' ? 'image' : 'document',
        file_name: `whatsapp_${message.type}_${Date.now()}`,
        content_type: mediaResult.contentType || 'image/jpeg',
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

  const summary = `Great! Here's a summary of your quote request:\n
- Service: *${data.serviceName}*
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
    // Get tenant details
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('currency, tax_enabled, tax_label, tax_rate')
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
        job_answers: [],
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
