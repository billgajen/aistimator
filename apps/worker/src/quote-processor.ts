/**
 * Quote Processor
 *
 * Orchestrates the quote generation pipeline:
 * 1. Load quote and related data
 * 2. Fetch images from R2
 * 3. Extract signals using Gemini
 * 4. Calculate pricing using rules engine
 * 5. Generate wording using Gemini
 * 6. Update quote record
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createGeminiClient,
  extractSignals,
  extractStructuredSignals,
  getSignalsWithoutImages,
  getSignalsWithoutImagesV2,
  generateWording,
  generateWordingFallback,
  detectAddonsFromDescription,
  extractInventoryItems,
  matchItemsToCatalog,
  extractCrossServiceDetails,
  detectServicesFromDescription,
  autoGeneratePromptContext,
  generateSignalRecommendations,
  findUnusedSignals,
} from './ai'
import type {
  ExtractedSignals,
  QuoteContent,
  AddonForMatching,
  InventoryDetectionContext,
  CrossServiceEstimate,
  ServiceForMatching,
  SignalExtractionContext,
} from './ai'
import type { MatchedItem, ExtractedSignalsV2, PricingTrace, ExpectedSignalConfig, LowConfidenceMode, SignalRecommendation } from '@estimator/shared'
import { calculatePricingWithTrace, getDefaultPricingRules, calculateCrossServicePricing } from './pricing'
import type { PricingRules, PricingResult } from './pricing'
import type { CrossServicePricing } from '@estimator/shared'
import { sendQuoteEmails, isEmailConfigured } from './email'
import { incrementUsageCounter } from './usage'
import type { Env } from './index'

/**
 * Cross-service recommendation
 */
interface CrossServiceRecommendation {
  serviceId: string
  serviceName: string
  reason: string
  matchedKeyword: string
}

/**
 * Quote data from database
 */
interface WidgetField {
  fieldId: string
  type: string
  label: string
  required: boolean
  options?: Array<{ value: string; label: string }>
  /** Explicit mapping to a signal key for pricing */
  mapsToSignal?: string
  /** Whether this field is critical for accurate pricing */
  criticalForPricing?: boolean
}

interface QuoteData {
  quote: {
    id: string
    tenant_id: string
    quote_request_id: string
    service_id: string
    document_type: string
    customer_json: {
      name: string
      email: string
      phone?: string
    }
  }
  quoteRequest: {
    id: string
    customer_name: string
    customer_email: string
    customer_phone?: string
    job_address?: string
    job_postcode?: string
    job_quantity?: number
    job_answers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
  }
  tenant: {
    id: string
    name: string
    currency: string
    tax_enabled: boolean
    tax_label?: string
    tax_rate?: number
    branding_json?: {
      primaryColor?: string
    }
  }
  service: {
    id: string
    name: string
    description?: string
    scope_includes?: string[]
    scope_excludes?: string[]
    default_assumptions?: string[]
    media_config?: {
      minPhotos: number
      maxPhotos: number
      photoGuidance: string | null
    }
    prompt_context?: string | null
    /** Expected signals for structured extraction */
    expected_signals?: ExpectedSignalConfig[]
    /** Work steps for pricing (also passed to pricing rules) */
    work_steps?: PricingRules['workSteps']
    /** How to handle low confidence estimates */
    low_confidence_mode?: 'show_range' | 'require_review' | 'request_more_info' | 'recommend_site_visit'
    /** Confidence threshold for triggering fallback (0-1) */
    confidence_threshold?: number
    /** High value threshold for triggering fallback */
    high_value_threshold?: number | null
  }
  /** Other services from this tenant (for cross-service detection) */
  otherServices?: Array<{
    id: string
    name: string
    description?: string
    detection_keywords?: string[]
  }>
  businessOwnerEmail?: string
  pricingRules?: PricingRules
  widgetFields?: WidgetField[]
  assets: Array<{
    id: string
    type: string
    content_type: string
    r2_key: string
  }>
}

/**
 * Quote processing result
 */
export interface ProcessingResult {
  success: boolean
  error?: string
  signals?: ExtractedSignals
  structuredSignals?: ExtractedSignalsV2
  pricing?: PricingResult
  pricingTrace?: PricingTrace
  content?: QuoteContent
}

/**
 * Fallback evaluation result
 */
interface FallbackResult {
  /** Whether fallback mode was triggered */
  triggered: boolean
  /** The fallback mode that was applied */
  mode?: LowConfidenceMode
  /** Reason for triggering fallback */
  reason?: string
  /** Signals with low confidence */
  lowConfidenceSignals?: string[]
  /** Recommended status override */
  statusOverride?: 'pending_review' | 'sent'
  /** Additional notes to add to pricing */
  additionalNotes?: string[]
}

/**
 * Evaluate whether fallback mode should be triggered
 */
function evaluateFallback(
  service: QuoteData['service'],
  signals: ExtractedSignals | null,
  structuredSignals: ExtractedSignalsV2 | null,
  totalAmount: number
): FallbackResult {
  const mode = service.low_confidence_mode || 'show_range'
  const confidenceThreshold = service.confidence_threshold || 0.7
  const highValueThreshold = service.high_value_threshold

  const lowConfidenceSignals: string[] = []
  let overallConfidence = 1.0

  // Check structured signals for low confidence
  if (structuredSignals) {
    overallConfidence = structuredSignals.overallConfidence
    for (const signal of structuredSignals.signals) {
      if (signal.confidence < confidenceThreshold) {
        lowConfidenceSignals.push(signal.key)
      }
    }
    // Also include any marked as low confidence
    if (structuredSignals.lowConfidenceSignals) {
      for (const key of structuredSignals.lowConfidenceSignals) {
        if (!lowConfidenceSignals.includes(key)) {
          lowConfidenceSignals.push(key)
        }
      }
    }
  } else if (signals) {
    // Use legacy confidence
    overallConfidence = signals.confidence || 0.5
  }

  // Determine if fallback should trigger
  const lowConfidenceTrigger = overallConfidence < confidenceThreshold || lowConfidenceSignals.length > 0
  const highValueTrigger = highValueThreshold ? totalAmount > highValueThreshold : false
  const triggered = lowConfidenceTrigger || highValueTrigger

  if (!triggered) {
    return { triggered: false }
  }

  // Determine reason
  let reason = ''
  if (lowConfidenceTrigger && highValueTrigger) {
    reason = `Low confidence signals (${lowConfidenceSignals.join(', ') || 'overall'}) and high value ($${totalAmount})`
  } else if (lowConfidenceTrigger) {
    reason = lowConfidenceSignals.length > 0
      ? `Low confidence for: ${lowConfidenceSignals.join(', ')}`
      : `Overall confidence (${(overallConfidence * 100).toFixed(0)}%) below threshold`
  } else {
    reason = `Estimate exceeds $${highValueThreshold} threshold`
  }

  // Apply fallback mode behavior
  const additionalNotes: string[] = []
  let statusOverride: 'pending_review' | 'sent' | undefined

  switch (mode) {
    case 'require_review':
      // Set to pending_review status - business owner must approve
      statusOverride = 'pending_review'
      additionalNotes.push('This estimate requires business owner review before sending.')
      break

    case 'recommend_site_visit':
      // Send but strongly recommend site visit
      statusOverride = 'sent'
      additionalNotes.push(
        'We recommend a site visit for a more accurate assessment.',
        'This estimate is based on limited information and actual costs may vary.'
      )
      break

    case 'request_more_info':
      // For now, treat as recommend_site_visit (actual implementation would need UI support)
      statusOverride = 'sent'
      additionalNotes.push(
        'Additional information may be needed for a precise quote.',
        'Please contact us to discuss your specific requirements.'
      )
      break

    case 'show_range':
    default:
      // Note: Price range feature not yet implemented, so only show confirmation note
      statusOverride = 'sent'
      if (lowConfidenceSignals.length > 0) {
        additionalNotes.push(
          'Final price will be confirmed upon assessment.'
        )
      }
      break
  }

  console.log(`[Processor] Fallback triggered: ${mode} - ${reason}`)

  return {
    triggered: true,
    mode,
    reason,
    lowConfidenceSignals: lowConfidenceSignals.length > 0 ? lowConfidenceSignals : undefined,
    statusOverride,
    additionalNotes: additionalNotes.length > 0 ? additionalNotes : undefined,
  }
}

/**
 * Process a quote - main entry point
 */
export async function processQuote(
  quoteId: string,
  _quoteRequestId: string, // Used for logging/tracking, actual data loaded from DB
  supabase: SupabaseClient,
  env: Env,
  quoteToken?: string // Plain text token for email links
): Promise<ProcessingResult> {
  console.log(`[Processor] Starting quote processing: ${quoteId}`)

  // 1. Load all quote data
  const quoteData = await loadQuoteData(supabase, quoteId)
  if (!quoteData) {
    return { success: false, error: 'Failed to load quote data' }
  }

  const { quoteRequest, tenant, service, pricingRules, assets } = quoteData

  // 2. Extract signals from images
  let signals: ExtractedSignals
  let structuredSignals: ExtractedSignalsV2 | null = null

  const imageAssets = assets.filter((a) => a.type === 'image')
  const gemini = createGeminiClient(env.GEMINI_API_KEY)

  // Extract customer notes for context
  const notesAnswer = quoteRequest.job_answers?.find(
    (a) => a.fieldId === '_project_description' || a.fieldId === 'notes' || a.fieldId === 'description'
  )
  const customerNotes = notesAnswer ? String(notesAnswer.value) : undefined

  // Auto-generate AI prompt context from business configuration
  // This replaces manual prompt_context - businesses configure pricing rules,
  // and AI guidance is derived automatically
  const autoPromptContext = autoGeneratePromptContext(
    {
      name: service.name,
      description: service.description,
      scopeIncludes: service.scope_includes,
      scopeExcludes: service.scope_excludes,
    },
    pricingRules
  )

  // Build rich context for signal extraction
  // The measurement model is the key signal that tells AI what to measure
  const signalContext: SignalExtractionContext = {
    serviceName: service.name,
    serviceDescription: service.description,
    scopeIncludes: service.scope_includes,
    scopeExcludes: service.scope_excludes,
    jobAddress: quoteRequest.job_address,
    customerNotes,
    // Pass measurement model so AI knows what to measure (sqft, items, rooms, etc.)
    measurementModel: pricingRules?.measurementModel?.unit
      ? { unit: pricingRules.measurementModel.unit, unitLabel: pricingRules.measurementModel.unitLabel || pricingRules.measurementModel.unit }
      : undefined,
    // Pass catalog items so AI knows what specific items to look for
    catalogItems: pricingRules?.itemCatalog?.map((i) => i.name),
    catalogCategories: [...new Set(pricingRules?.itemCatalog?.map((i) => i.category).filter((c): c is string => Boolean(c)))],
    // Pass form field labels so AI understands what the business cares about
    formFieldLabels: quoteData.widgetFields?.map((f) => f.label).filter(Boolean),
    // Use auto-generated prompt context from pricing rules (replaces manual input)
    promptContext: autoPromptContext,
    // Pass expected signals for structured extraction (if configured)
    expectedSignals: service.expected_signals,
  }

  if (imageAssets.length > 0 && gemini) {
    console.log(`[Processor] Extracting signals from ${imageAssets.length} images`)
    const extractionResult = await extractSignalsFromAssets(gemini, imageAssets, signalContext, env)
    signals = extractionResult.signals
    structuredSignals = extractionResult.structuredSignals
  } else if (imageAssets.length > 0 && !gemini) {
    console.warn('[Processor] Gemini not configured, skipping signal extraction')
    signals = getSignalsWithoutImages()
    structuredSignals = getSignalsWithoutImagesV2()
    signals.warnings.push('AI image analysis not available')
  } else {
    console.log('[Processor] No images provided, using form data only')
    signals = getSignalsWithoutImages()
    structuredSignals = getSignalsWithoutImagesV2()
  }

  console.log(`[Processor] Signals extracted, confidence: ${signals.confidence}`)

  // 2.3 Convert form inputs to signals - ALWAYS merge form signals regardless of expected_signals config
  // AD-007: Form signals must ALWAYS override AI-extracted signals
  // This ensures form-provided values (like leak_count=2) are used in pricing even if expected_signals is empty
  // Form inputs OVERRIDE low-confidence vision signals (user knows better than AI guessing)
  if (structuredSignals) {
    const formAnswers = quoteRequest.job_answers || []
    const widgetFields = quoteData.widgetFields || []

    console.log(`[Processor] Processing ${formAnswers.length} form answers for signal merge`)
    console.log(`[Processor] Form fieldIds: ${formAnswers.map(a => a.fieldId).join(', ')}`)

    // Build explicit mapping from fieldId -> signalKey using widget config
    const fieldToSignalMap = new Map<string, string>()
    for (const field of widgetFields) {
      if (field.mapsToSignal) {
        fieldToSignalMap.set(field.fieldId, field.mapsToSignal)
        console.log(`[Processor] Explicit mapping: ${field.fieldId} -> ${field.mapsToSignal}`)
      }
    }

    // Process EACH form answer, not just expected_signals
    for (const answer of formAnswers) {
      // Skip internal fields like _project_description
      if (answer.fieldId.startsWith('_')) continue
      if (answer.value === undefined || answer.value === null || answer.value === '') continue

      // Determine the signal key: use explicit mapsToSignal or derive from fieldId
      const field = widgetFields.find(f => f.fieldId === answer.fieldId)
      const signalKey = field?.mapsToSignal || answer.fieldId

      // Determine the signal type: check expected_signals config or infer from value
      let signalType: string = 'string'
      if (service.expected_signals && service.expected_signals.length > 0) {
        const expectedSignal = service.expected_signals.find(s => s.signalKey === signalKey)
        if (expectedSignal) {
          signalType = expectedSignal.type
        }
      }
      // Infer type if not found in expected_signals
      if (signalType === 'string') {
        if (typeof answer.value === 'number') signalType = 'number'
        else if (typeof answer.value === 'boolean') signalType = 'boolean'
        else if (typeof answer.value === 'string' && !isNaN(parseFloat(answer.value))) signalType = 'number'
      }

      // Convert to appropriate type with support for comma-separated values
      const value = convertFormValueToSignal(answer.value, signalType)

      if (value === null) continue

      const formSignal = {
        key: signalKey,
        value,
        confidence: 1.0,
        source: 'form' as const,
        evidence: `Customer-provided: ${field?.label || answer.fieldId}`
      }

      // Check if we already have this signal
      const existingSignalIndex = structuredSignals.signals.findIndex(s => s.key === signalKey)
      const existingSignal = existingSignalIndex >= 0 ? structuredSignals.signals[existingSignalIndex] : null

      if (existingSignal) {
        // ALWAYS override non-form signals with form input (AD-007)
        // User-provided form data is the source of truth - they know their project better than AI vision
        if (existingSignal.source !== 'form' || existingSignal.value === null) {
          console.log(`[Processor] Form override: ${signalKey} = ${value} (was: ${existingSignal.value} from ${existingSignal.source})`)
          structuredSignals.signals[existingSignalIndex] = formSignal
        } else {
          console.log(`[Processor] Keeping existing form signal "${signalKey}" = ${existingSignal.value}`)
        }
      } else {
        // Add new form signal
        structuredSignals.signals.push(formSignal)
        console.log(`[Processor] Added form signal: ${signalKey} = ${value}`)
      }
    }

    // Recalculate overall confidence if we have signals
    if (structuredSignals.signals.length > 0) {
      const avgConfidence = structuredSignals.signals.reduce((sum, s) => sum + s.confidence, 0) / structuredSignals.signals.length
      structuredSignals.overallConfidence = Math.max(structuredSignals.overallConfidence, avgConfidence)
    }

    // Bug fix: Regenerate lowConfidenceSignals after form signals are merged
    // Form signals have confidence: 1.0, so they should NOT appear in lowConfidenceSignals
    const confidenceThreshold = service.confidence_threshold || 0.7
    structuredSignals.lowConfidenceSignals = structuredSignals.signals
      .filter(s => s.confidence < confidenceThreshold)
      .map(s => s.key)
    console.log(`[Processor] Regenerated lowConfidenceSignals after form merge: [${structuredSignals.lowConfidenceSignals.join(', ')}]`)
  }

  // 2.5 Extract inventory items if catalog is configured (works for any industry)
  let matchedItems: MatchedItem[] = []

  if (gemini && pricingRules?.itemCatalog && pricingRules.itemCatalog.length > 0 && imageAssets.length > 0) {
    console.log(`[Processor] Extracting inventory items (catalog has ${pricingRules.itemCatalog.length} items)`)

    // Build context for AI from service and catalog (works for any industry)
    const inventoryContext: InventoryDetectionContext = {
      serviceName: service.name,
      serviceDescription: service.description,
      catalogCategories: signalContext.catalogCategories,
      catalogItems: signalContext.catalogItems,
      customerNotes,
    }

    try {
      // Fetch images for inventory detection
      const images: Array<{ mimeType: string; base64: string }> = []
      for (const asset of imageAssets.slice(0, 5)) {
        try {
          const imageData = await fetchImageFromR2(asset.r2_key, asset.content_type, env)
          if (imageData) {
            images.push(imageData)
          }
        } catch (error) {
          console.error(`[Processor] Failed to fetch image ${asset.id} for inventory:`, error)
        }
      }

      if (images.length > 0) {
        // Step 1: Detect items from images using service context
        const detectedItems = await extractInventoryItems(gemini, images, inventoryContext)

        if (detectedItems.length > 0) {
          // Step 2: Match detected items to catalog
          matchedItems = await matchItemsToCatalog(gemini, detectedItems, pricingRules!.itemCatalog!)

          // Store detected items in signals for reference
          signals.detectedItems = detectedItems

          console.log(`[Processor] Matched ${matchedItems.length}/${detectedItems.length} items to catalog`)
        }
      }
    } catch (error) {
      console.error('[Processor] Inventory detection failed:', error)
      // Continue without inventory items
    }
  }

  // 3. Calculate pricing using rules engine
  const rules = pricingRules || getDefaultPricingRules()
  const formAnswers = (quoteRequest.job_answers || []).map((a) => ({
    fieldId: a.fieldId,
    value: a.value,
  }))

  // Extract project description for addon detection
  const descriptionAnswer = quoteRequest.job_answers?.find(
    (a) => a.fieldId === '_project_description' || a.fieldId === 'description' || a.fieldId === 'notes'
  )
  const projectDescription = descriptionAnswer ? String(descriptionAnswer.value) : undefined

  // Track AI-detected addon IDs so we can mark them as autoRecommended in pricing
  const aiDetectedAddonIds = new Set<string>()

  // 3.5 AI-powered addon detection from customer description
  if (gemini && projectDescription && rules.addons && rules.addons.length > 0) {
    console.log('[Processor] Running AI addon detection on customer description')
    try {
      const availableAddons: AddonForMatching[] = rules.addons.map((a) => ({
        id: a.id,
        label: a.label,
        // description is optional, addon label is used for matching
      }))

      const detectedAddons = await detectAddonsFromDescription(
        gemini,
        service.name,
        projectDescription,
        availableAddons
      )

      // Add detected addons as form answers so they get applied by pricing engine
      for (const detected of detectedAddons) {
        // Skip if addon functionality is already part of the core service
        if (isAddonCoveredByService(detected.addonId, service.name, service.scope_includes)) {
          console.log(`[Processor] Skipping addon ${detected.addonId} - already part of core service "${service.name}"`)
          continue
        }

        // Only add if not already selected by customer
        const alreadySelected = formAnswers.some(
          (a) => a.fieldId === detected.addonId && a.value === true
        )
        if (!alreadySelected) {
          formAnswers.push({
            fieldId: detected.addonId,
            value: true,
          })
          // Track as AI-detected so pricing engine marks it as autoRecommended
          aiDetectedAddonIds.add(detected.addonId)
          console.log(`[Processor] Auto-applying addon: ${detected.addonId} - ${detected.reason}`)
        }
      }
    } catch (error) {
      console.error('[Processor] AI addon detection failed:', error)
      // Continue without AI addon detection
    }
  }

  // 3.6 AI-powered addon detection from IMAGE-detected conditions
  if (gemini && signals.detectedConditions && signals.detectedConditions.length > 0 && rules.addons && rules.addons.length > 0) {
    console.log('[Processor] Running AI addon detection on image-detected conditions:', signals.detectedConditions)
    try {
      const availableAddons: AddonForMatching[] = rules.addons.map((a) => ({
        id: a.id,
        label: a.label,
      }))

      // Convert detected conditions to descriptive text for AI matching
      const conditionsText = signals.detectedConditions
        .map((c) => c.replace(/_/g, ' '))
        .join(', ') + ' detected in photos'

      const detectedAddons = await detectAddonsFromDescription(
        gemini,
        service.name,
        conditionsText,
        availableAddons
      )

      // Add detected addons as form answers so they get applied by pricing engine
      for (const detected of detectedAddons) {
        // Skip if addon functionality is already part of the core service
        if (isAddonCoveredByService(detected.addonId, service.name, service.scope_includes)) {
          console.log(`[Processor] Skipping addon ${detected.addonId} from image - already part of core service "${service.name}"`)
          continue
        }

        // Only add if not already selected
        const alreadySelected = formAnswers.some(
          (a) => a.fieldId === detected.addonId && a.value === true
        )
        if (!alreadySelected) {
          formAnswers.push({
            fieldId: detected.addonId,
            value: true,
          })
          // Track as AI-detected so pricing engine marks it as autoRecommended
          aiDetectedAddonIds.add(detected.addonId)
          console.log(`[Processor] Auto-applying addon from image: ${detected.addonId} - ${detected.reason}`)
        }
      }
    } catch (error) {
      console.error('[Processor] AI image addon detection failed:', error)
      // Continue without AI addon detection
    }
  }

  // Build job data with optional quantity and matched inventory items
  const jobData = {
    ...(quoteRequest.job_quantity && { quantity: quoteRequest.job_quantity }),
    ...(matchedItems.length > 0 && { matchedItems }),
  }

  // Use work steps from service if available, otherwise from pricing rules
  const rulesWithWorkSteps: PricingRules = {
    ...rules,
    workSteps: service.work_steps || rules.workSteps,
  }

  // Calculate pricing with full trace for transparency
  const { result: pricing, trace: pricingTrace } = calculatePricingWithTrace(
    rulesWithWorkSteps,
    signals,
    structuredSignals,
    formAnswers,
    {
      enabled: tenant.tax_enabled,
      label: tenant.tax_label,
      rate: tenant.tax_rate,
    },
    tenant.currency,
    // Pass job data with quantity and/or matched items
    Object.keys(jobData).length > 0 ? jobData : undefined,
    // Pass addon detection context
    {
      projectDescription,
      formAnswers,
    },
    // Pass AI-detected addon IDs so they get marked as autoRecommended
    aiDetectedAddonIds.size > 0 ? aiDetectedAddonIds : undefined,
    // Pass service context for addon filtering
    {
      name: service.name,
      scopeIncludes: service.scope_includes,
    },
    // Config version for trace
    'v1'
  )

  console.log(`[Processor] Pricing calculated: ${pricing.currency} ${pricing.total}`)
  if (pricingTrace.trace.length > 0) {
    console.log(`[Processor] Pricing trace has ${pricingTrace.trace.length} steps`)
  }

  // 3.5 Check for image vs form condition discrepancy
  const conditionDiscrepancy = detectConditionDiscrepancy(signals, quoteRequest.job_answers || [])
  if (conditionDiscrepancy) {
    pricing.notes.push(conditionDiscrepancy.note)
    console.log(`[Processor] Condition discrepancy detected: ${conditionDiscrepancy.note}`)
  }

  // 3.6 Detect unused signals and generate AI recommendations
  let signalRecommendations: SignalRecommendation[] = []
  if (structuredSignals && structuredSignals.signals.length > 0 && gemini) {
    // Find signals extracted by AI but not used in pricing
    // Pass form answers and widget fields to filter out numeric signals that customer already provided
    const unusedSignals = findUnusedSignals(
      structuredSignals.signals,
      pricingTrace,
      quoteRequest.job_answers || [],
      quoteData.widgetFields || []
    )

    if (unusedSignals.length > 0) {
      console.log(`[Processor] Found ${unusedSignals.length} unused signals: ${unusedSignals.map(s => s.key).join(', ')}`)

      try {
        signalRecommendations = await generateSignalRecommendations(
          gemini,
          unusedSignals,
          service.name,
          {
            workSteps: service.work_steps,
            serviceDescription: service.description,
          }
        )
        console.log(`[Processor] Generated ${signalRecommendations.length} signal recommendations`)
      } catch (error) {
        console.error('[Processor] Failed to generate signal recommendations:', error)
        // Continue without recommendations
      }
    } else {
      console.log('[Processor] All extracted signals were used in pricing')
    }
  }

  // 4. Generate wording
  let content: QuoteContent

  // Build form answers with labels for wording context
  const formAnswersForWording = buildFormAnswersWithLabels(
    quoteRequest.job_answers,
    quoteData.widgetFields || []
  )

  // Build wording context with service profile data
  const wordingContext = {
    businessName: tenant.name,
    serviceName: service.name,
    serviceDescription: service.description,
    scopeIncludes: service.scope_includes,
    scopeExcludes: service.scope_excludes,
    defaultAssumptions: service.default_assumptions,
    customerName: quoteRequest.customer_name,
    jobAddress: quoteRequest.job_address,
    signals,
    pricing,
    formAnswers: formAnswersForWording,
    projectDescription, // Customer's detailed project description
    documentType: quoteData.quote.document_type as 'instant_estimate' | 'formal_quote' | 'proposal' | 'sow',
  }

  if (gemini) {
    console.log('[Processor] Generating wording with Gemini')
    try {
      content = await generateWording(gemini, wordingContext)
    } catch (error) {
      console.error('[Processor] Wording generation failed, using fallback:', error)
      content = generateWordingFallback(wordingContext)
    }
  } else {
    console.log('[Processor] Generating wording without AI')
    content = generateWordingFallback(wordingContext)
  }

  // 4.5 Detect cross-service mentions and calculate pricing (with AI + keyword fallback)
  const crossServiceRecommendations = await detectCrossServiceMentionsWithAI(
    gemini,
    projectDescription || '',
    service.name,
    quoteData.otherServices || []
  )

  const crossServicePricing: CrossServicePricing[] = []

  if (crossServiceRecommendations.length > 0) {
    console.log(`[Processor] Detected ${crossServiceRecommendations.length} cross-service recommendations`)

    // Calculate pricing for each cross-service
    for (const rec of crossServiceRecommendations) {
      try {
        // Load pricing rules for this service
        const { data: servicePricingRule } = await supabase
          .from('service_pricing_rules')
          .select('rules_json')
          .eq('service_id', rec.serviceId)
          .single()

        // Skip if no pricing rules configured
        if (!servicePricingRule?.rules_json) {
          console.log(`[Processor] No pricing rules for cross-service ${rec.serviceName}, skipping`)
          continue
        }

        const serviceRules = servicePricingRule.rules_json as PricingRules

        // Extract details using AI if Gemini is available
        let crossServiceEstimate: CrossServiceEstimate
        if (gemini && projectDescription) {
          crossServiceEstimate = await extractCrossServiceDetails(
            gemini,
            service.name,
            rec.serviceName,
            projectDescription
          )
          console.log(`[Processor] Extracted cross-service details for ${rec.serviceName}: confidence=${crossServiceEstimate.confidence}`)
        } else {
          // Fallback without AI
          crossServiceEstimate = {
            serviceName: rec.serviceName,
            estimatedQuantity: null,
            quantityUnit: null,
            extractedDetails: [],
            confidence: 0.3,
          }
        }

        // Calculate pricing
        const pricingResult = calculateCrossServicePricing(
          serviceRules,
          crossServiceEstimate,
          {
            enabled: tenant.tax_enabled,
            label: tenant.tax_label,
            rate: tenant.tax_rate,
          },
          tenant.currency
        )

        // Bug fix: Only include cross-service recommendations with valid pricing (> £0)
        // Showing £0.00 looks broken and unprofessional
        if (pricingResult.estimatedTotal <= 0) {
          console.log(`[Processor] Skipping cross-service ${rec.serviceName} - invalid pricing: ${tenant.currency} ${pricingResult.estimatedTotal}`)
          continue
        }

        // Add to cross-service pricing list
        crossServicePricing.push({
          serviceId: rec.serviceId,
          serviceName: rec.serviceName,
          reason: rec.reason,
          baseFee: pricingResult.baseFee,
          estimatedTotal: pricingResult.estimatedTotal,
          breakdown: pricingResult.breakdown,
          extractedDetails: crossServiceEstimate.extractedDetails,
          isEstimate: pricingResult.isEstimate,
          note: pricingResult.note,
        })

        console.log(`[Processor] Calculated cross-service pricing for ${rec.serviceName}: ${tenant.currency} ${pricingResult.estimatedTotal}`)
      } catch (error) {
        console.error(`[Processor] Failed to process cross-service ${rec.serviceName}:`, error)
        // Continue with other cross-services
      }
    }
  }

  // 4.6 Evaluate confidence-based fallbacks
  const fallbackResult = evaluateFallback(service, signals, structuredSignals, pricing.total)

  // Add fallback notes to pricing
  if (fallbackResult.additionalNotes && fallbackResult.additionalNotes.length > 0) {
    pricing.notes.push(...fallbackResult.additionalNotes)
  }

  // Determine final status based on fallback
  const finalStatus = fallbackResult.statusOverride || 'sent'

  if (fallbackResult.triggered) {
    console.log(`[Processor] Fallback mode: ${fallbackResult.mode}, status: ${finalStatus}`)
  }

  // 5. Update quote record with signals and pricing trace
  const { error: updateError } = await supabase
    .from('quotes')
    .update({
      pricing_json: {
        currency: pricing.currency,
        subtotal: pricing.subtotal,
        taxLabel: pricing.taxLabel,
        taxRate: pricing.taxRate,
        taxAmount: pricing.taxAmount,
        total: pricing.total,
        breakdown: pricing.breakdown,
        // Include pricing notes (warnings, site visit recommendations)
        ...(pricing.notes && pricing.notes.length > 0 && {
          notes: pricing.notes,
        }),
        // Include recommended addons info
        ...(pricing.recommendedAddons && {
          recommendedAddons: pricing.recommendedAddons,
        }),
        // Include fallback info if triggered
        ...(fallbackResult.triggered && {
          _fallback: {
            mode: fallbackResult.mode,
            reason: fallbackResult.reason,
            lowConfidenceSignals: fallbackResult.lowConfidenceSignals,
          },
        }),
      },
      content_json: {
        scopeSummary: content.scopeSummary,
        assumptions: content.assumptions,
        exclusions: content.exclusions,
        notes: content.notes,
        validityDays: content.validityDays,
        // Store signals for reference (not displayed to customer)
        _signals: {
          confidence: signals.confidence,
          siteVisitRecommended: signals.siteVisitRecommended,
          complexity: signals.complexity.level,
          materials: signals.materials,
          detectedConditions: signals.detectedConditions,
          assessedCondition: signals.assessedCondition,
        },
        // Store condition discrepancy if detected
        ...(conditionDiscrepancy && {
          _conditionDiscrepancy: {
            formCondition: conditionDiscrepancy.formCondition,
            imageCondition: conditionDiscrepancy.imageCondition,
          },
        }),
        // Store cross-service pricing (with calculated estimates)
        ...(crossServicePricing.length > 0 && {
          crossServicePricing,
        }),
        // Store range if available
        ...(pricing.range && {
          priceRange: pricing.range,
        }),
        // Store AI-recommended additional work based on unused signals
        ...(signalRecommendations.length > 0 && {
          signalRecommendations,
        }),
      },
      // Store full signals for debugging and learning
      signals_json: structuredSignals,
      // Store pricing trace for transparency
      pricing_trace_json: pricingTrace,
      status: finalStatus,
      // Only set sent_at if actually sending (not pending_review)
      ...(finalStatus === 'sent' && {
        sent_at: new Date().toISOString(),
      }),
    })
    .eq('id', quoteId)

  if (updateError) {
    console.error('[Processor] Failed to update quote:', updateError)
    return { success: false, error: `Database error: ${updateError.message}` }
  }

  // 6. Increment usage counter for estimates_sent
  await incrementUsageCounter(supabase, quoteData.quote.tenant_id, 'estimates_sent')

  // 7. Send notification emails (skip if pending review)
  if (finalStatus === 'pending_review') {
    console.log('[Processor] Quote pending review - emails will be sent after approval')
  } else if (isEmailConfigured(env.POSTMARK_API_TOKEN, env.POSTMARK_FROM_EMAIL)) {
    const businessOwnerEmail = quoteData.businessOwnerEmail || env.POSTMARK_FROM_EMAIL!

    if (quoteToken) {
      console.log('[Processor] Sending notification emails')

      try {
        const emailResult = await sendQuoteEmails(
          {
            postmarkApiToken: env.POSTMARK_API_TOKEN!,
            fromEmail: env.POSTMARK_FROM_EMAIL!,
            fromName: tenant.name,
            appUrl: env.APP_URL || 'http://localhost:3000',
          },
          {
            quoteId,
            quoteToken,
            customer: {
              name: quoteRequest.customer_name,
              email: quoteRequest.customer_email,
              phone: quoteRequest.customer_phone,
            },
            business: {
              name: tenant.name,
              ownerEmail: businessOwnerEmail,
              primaryColor: tenant.branding_json?.primaryColor,
            },
            service: {
              name: service.name,
            },
            job: {
              address: quoteRequest.job_address,
            },
            pricing: {
              total: pricing.total,
              currency: pricing.currency,
            },
            content: {
              scopeSummary: content.scopeSummary,
              validityDays: content.validityDays,
            },
          }
        )

        if (!emailResult.customerEmail.success) {
          console.error('[Processor] Failed to send customer email:', emailResult.customerEmail.error)
        }
        if (!emailResult.businessEmail.success) {
          console.error('[Processor] Failed to send business email:', emailResult.businessEmail.error)
        }
      } catch (emailError) {
        // Don't fail the whole process if email fails
        console.error('[Processor] Email sending error:', emailError)
      }
    } else {
      console.warn('[Processor] No quote token available, skipping emails')
    }
  } else {
    console.log('[Processor] Email not configured, skipping notifications')
  }

  console.log(`[Processor] Quote ${quoteId} processed successfully`)

  return {
    success: true,
    signals,
    structuredSignals: structuredSignals || undefined,
    pricing,
    pricingTrace,
    content,
  }
}

/**
 * Load all data needed for quote processing
 */
async function loadQuoteData(
  supabase: SupabaseClient,
  quoteId: string
): Promise<QuoteData | null> {
  // Load quote with joins
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select(`
      *,
      quote_requests!quote_request_id (*),
      tenants!tenant_id (
        id,
        name,
        currency,
        tax_enabled,
        tax_label,
        tax_rate,
        branding_json
      ),
      services!service_id (
        id,
        name,
        description,
        scope_includes,
        scope_excludes,
        default_assumptions,
        media_config,
        prompt_context,
        expected_signals,
        work_steps,
        low_confidence_mode,
        confidence_threshold,
        high_value_threshold
      )
    `)
    .eq('id', quoteId)
    .single()

  if (quoteError || !quote) {
    console.error('[Processor] Failed to load quote:', quoteError)
    return null
  }

  // Load pricing rules for service
  const { data: pricingRule } = await supabase
    .from('service_pricing_rules')
    .select('rules_json')
    .eq('service_id', quote.service_id)
    .single()

  // Load assets for quote request
  const { data: assets } = await supabase
    .from('assets')
    .select('id, type, content_type, r2_key')
    .eq('quote_request_id', quote.quote_request_id)

  // Load business owner email (first user for the tenant)
  const { data: ownerProfile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', quote.tenant_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  let businessOwnerEmail: string | undefined
  if (ownerProfile?.id) {
    // Get the user's email from auth.users
    const { data: authUser } = await supabase.auth.admin.getUserById(ownerProfile.id)
    businessOwnerEmail = authUser?.user?.email || undefined
  }

  // Load widget config to get field labels and mapsToSignal mappings
  // First try service-specific config, then fall back to tenant default
  let widgetFields: WidgetField[] = []

  // Try service-specific widget config first
  const { data: serviceWidgetConfig } = await supabase
    .from('widget_configs')
    .select('config_json')
    .eq('tenant_id', quote.tenant_id)
    .eq('service_id', quote.service_id)
    .single()

  if (serviceWidgetConfig?.config_json) {
    const config = serviceWidgetConfig.config_json as { fields?: WidgetField[] }
    widgetFields = config.fields || []
    console.log(`[Processor] Loaded service-specific widget config with ${widgetFields.length} fields`)
  } else {
    // Fall back to tenant default (service_id is null)
    const { data: defaultWidgetConfig } = await supabase
      .from('widget_configs')
      .select('config_json')
      .eq('tenant_id', quote.tenant_id)
      .is('service_id', null)
      .single()

    if (defaultWidgetConfig?.config_json) {
      const config = defaultWidgetConfig.config_json as { fields?: WidgetField[] }
      widgetFields = config.fields || []
      console.log(`[Processor] Loaded default widget config with ${widgetFields.length} fields`)
    }
  }

  // Load other services for cross-service detection (include description for AI matching)
  const { data: otherServices } = await supabase
    .from('services')
    .select('id, name, description, detection_keywords')
    .eq('tenant_id', quote.tenant_id)
    .eq('active', true)
    .neq('id', quote.service_id)

  return {
    quote: {
      id: quote.id,
      tenant_id: quote.tenant_id,
      quote_request_id: quote.quote_request_id,
      service_id: quote.service_id,
      document_type: quote.document_type,
      customer_json: quote.customer_json as QuoteData['quote']['customer_json'],
    },
    quoteRequest: quote.quote_requests as unknown as QuoteData['quoteRequest'],
    tenant: quote.tenants as unknown as QuoteData['tenant'],
    service: quote.services as unknown as QuoteData['service'],
    otherServices: (otherServices || []) as QuoteData['otherServices'],
    businessOwnerEmail,
    pricingRules: pricingRule?.rules_json as PricingRules | undefined,
    widgetFields,
    assets: (assets || []) as QuoteData['assets'],
  }
}

/**
 * Result of signal extraction including both legacy and structured formats
 */
interface SignalExtractionResult {
  signals: ExtractedSignals
  structuredSignals: ExtractedSignalsV2 | null
}

/**
 * Extract signals from R2 assets using rich context
 * Returns both legacy ExtractedSignals and new ExtractedSignalsV2 for trace support
 */
async function extractSignalsFromAssets(
  gemini: ReturnType<typeof createGeminiClient>,
  assets: QuoteData['assets'],
  signalContext: SignalExtractionContext,
  env: Env
): Promise<SignalExtractionResult> {
  if (!gemini) {
    return {
      signals: getSignalsWithoutImages(),
      structuredSignals: getSignalsWithoutImagesV2(),
    }
  }

  // Fetch images from R2
  const images: Array<{ mimeType: string; base64: string }> = []

  for (const asset of assets.slice(0, 5)) {
    // Limit to 5 images
    try {
      const imageData = await fetchImageFromR2(asset.r2_key, asset.content_type, env)
      if (imageData) {
        images.push(imageData)
      }
    } catch (error) {
      console.error(`[Processor] Failed to fetch image ${asset.id}:`, error)
    }
  }

  if (images.length === 0) {
    console.warn('[Processor] No images could be fetched from R2')
    return {
      signals: getSignalsWithoutImages(),
      structuredSignals: getSignalsWithoutImagesV2(),
    }
  }

  // Try to extract signals with Gemini using rich context
  try {
    // Use structured extraction when expected signals are configured
    if (signalContext.expectedSignals && signalContext.expectedSignals.length > 0) {
      console.log(`[Processor] Using structured signal extraction with ${signalContext.expectedSignals.length} expected signals`)
      const structuredSignals = await extractStructuredSignals(gemini, images, signalContext)

      // Also extract legacy signals for backward compatibility
      const signals = await extractSignals(gemini, images, signalContext)

      return { signals, structuredSignals }
    }

    // Default: extract legacy signals and convert to structured format
    const signals = await extractSignals(gemini, images, signalContext)

    // Convert legacy signals to structured format for trace support
    const structuredSignals: ExtractedSignalsV2 = {
      extractedAt: new Date().toISOString(),
      overallConfidence: signals.confidence,
      signals: [], // Will be populated from legacy fields by pricing engine
      dimensions: signals.dimensions,
      condition: signals.condition,
      complexity: signals.complexity,
      siteVisitRecommended: signals.siteVisitRecommended,
      siteVisitReason: signals.siteVisitReason,
      lowConfidenceSignals: [],
    }

    return { signals, structuredSignals }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Processor] Signal extraction failed: ${errorMsg}`)

    // Check if it's a rate limit error
    if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate limit')) {
      console.warn('[Processor] Gemini rate limited, using fallback signals')
      const signals = getSignalsWithoutImages()
      signals.warnings.push('AI image analysis temporarily unavailable (rate limited)')
      signals.observations.push(`${images.length} images were uploaded but could not be analyzed`)
      return {
        signals,
        structuredSignals: getSignalsWithoutImagesV2(),
      }
    }

    // For other errors, use default signals
    const signals = getSignalsWithoutImages()
    signals.warnings.push(`AI image analysis failed: ${errorMsg}`)
    return {
      signals,
      structuredSignals: getSignalsWithoutImagesV2(),
    }
  }
}

/**
 * Fetch image from R2 and convert to base64
 * Uses native R2 binding first, falls back to S3 API for dev mode
 */
async function fetchImageFromR2(
  r2Key: string,
  contentType: string,
  env: Env
): Promise<{ mimeType: string; base64: string } | null> {
  // Try native R2 binding first (works in production)
  if (env.ASSETS) {
    const object = await env.ASSETS.get(r2Key)
    if (object) {
      const arrayBuffer = await object.arrayBuffer()
      const base64 = arrayBufferToBase64(arrayBuffer)
      return { mimeType: contentType, base64 }
    }
    console.log(`[Processor] R2 binding didn't find object, trying S3 API fallback`)
  }

  // Fallback to S3-compatible API (for dev mode where binding is simulated)
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME) {
    try {
      const result = await fetchImageFromR2ViaS3(r2Key, contentType, env)
      if (result) return result
    } catch (error) {
      console.error(`[Processor] S3 API fallback failed:`, error)
    }
  }

  console.warn(`[Processor] R2 object not found: ${r2Key}`)
  return null
}

/**
 * Fetch image from R2 using S3-compatible API
 */
async function fetchImageFromR2ViaS3(
  r2Key: string,
  contentType: string,
  env: Env
): Promise<{ mimeType: string; base64: string } | null> {
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const bucket = env.R2_BUCKET_NAME!
  const accessKeyId = env.R2_ACCESS_KEY_ID!
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY!

  // Build the request
  const url = `${endpoint}/${bucket}/${r2Key}`

  // Simple AWS Signature Version 4 for GET request
  const response = await fetch(url, {
    method: 'GET',
    headers: await generateAwsHeaders('GET', bucket, r2Key, accessKeyId, secretAccessKey, env.R2_ACCOUNT_ID!),
  })

  if (!response.ok) {
    console.warn(`[Processor] S3 API returned ${response.status} for ${r2Key}`)
    return null
  }

  const arrayBuffer = await response.arrayBuffer()
  const base64 = arrayBufferToBase64(arrayBuffer)

  console.log(`[Processor] Successfully fetched image via S3 API: ${r2Key}`)
  return { mimeType: contentType, base64 }
}

/**
 * Generate AWS Signature V4 headers for S3 request
 */
async function generateAwsHeaders(
  method: string,
  bucket: string,
  key: string,
  accessKeyId: string,
  secretAccessKey: string,
  accountId: string
): Promise<Record<string, string>> {
  const region = 'auto'
  const service = 's3'
  const host = `${accountId}.r2.cloudflarestorage.com`

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const canonicalUri = `/${bucket}/${key}`
  const canonicalQueryString = ''
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const algorithm = 'AWS4-HMAC-SHA256'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  const encoder = new TextEncoder()
  const canonicalRequestHash = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest))
  const canonicalRequestHashHex = Array.from(new Uint8Array(canonicalRequestHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHashHex,
  ].join('\n')

  // Calculate signature
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = await hmacSha256Hex(kSigning, stringToSign)

  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    'Host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'Authorization': authorization,
  }
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const result = await hmacSha256(key, data)
  return Array.from(new Uint8Array(result))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/**
 * Build form answers with labels for wording context
 */
function buildFormAnswersWithLabels(
  answers: Array<{ fieldId: string; value: string | number | boolean | string[] }>,
  fields: WidgetField[]
): Array<{ question: string; answer: string; fieldId: string; value: string | number | boolean | string[] }> {
  if (!answers || answers.length === 0) return []

  const fieldMap = new Map(fields.map((f) => [f.fieldId, f]))

  return answers
    .filter((a) => {
      // Skip internal/system fields
      if (a.fieldId.startsWith('_')) return false
      // Skip empty values
      if (a.value === undefined || a.value === null || a.value === '') return false
      return true
    })
    .map((a) => {
      const field = fieldMap.get(a.fieldId)
      const question = field?.label || a.fieldId

      // Format the answer value based on field type
      let answerText: string
      if (Array.isArray(a.value)) {
        // For checkbox multi-select, join the selected values
        // Try to find option labels if available
        if (field?.options) {
          const labels = a.value.map((v) => {
            const opt = field.options?.find((o) => o.value === v)
            return opt?.label || v
          })
          answerText = labels.join(', ')
        } else {
          answerText = a.value.join(', ')
        }
      } else if (typeof a.value === 'boolean') {
        answerText = a.value ? 'Yes' : 'No'
      } else if (field?.options) {
        // For select/radio, try to find the option label
        const opt = field.options.find((o) => o.value === String(a.value))
        answerText = opt?.label || String(a.value)
      } else {
        answerText = String(a.value)
      }

      return {
        question,
        answer: answerText,
        fieldId: a.fieldId,
        value: a.value,
      }
    })
}

/**
 * Condition discrepancy result
 */
interface ConditionDiscrepancy {
  formCondition: string
  imageCondition: string
  note: string
}

/**
 * Condition mapping from various form values to normalized levels
 */
const CONDITION_LEVELS: Record<string, number> = {
  // Excellent = 4
  excellent: 4,
  new: 4,
  'like new': 4,
  perfect: 4,
  // Good = 3
  good: 3,
  fine: 3,
  okay: 3,
  ok: 3,
  decent: 3,
  // Fair = 2
  fair: 2,
  average: 2,
  moderate: 2,
  used: 2,
  // Poor = 1
  poor: 1,
  bad: 1,
  damaged: 1,
  worn: 1,
  deteriorated: 1,
  terrible: 1,
}

/**
 * Detect discrepancy between form-selected condition and image-assessed condition
 */
function detectConditionDiscrepancy(
  signals: ExtractedSignals,
  formAnswers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
): ConditionDiscrepancy | null {
  // Only check if we have an image-assessed condition
  if (!signals.assessedCondition) {
    return null
  }

  // Find condition-related form answers
  const conditionAnswer = formAnswers.find((a) => {
    const fieldId = a.fieldId.toLowerCase()
    return (
      fieldId.includes('condition') ||
      fieldId.includes('state') ||
      fieldId.includes('quality')
    )
  })

  if (!conditionAnswer || typeof conditionAnswer.value !== 'string') {
    return null
  }

  const formConditionStr = conditionAnswer.value.toLowerCase()
  const imageCondition = signals.assessedCondition

  // Get numeric levels for comparison
  const formLevel = CONDITION_LEVELS[formConditionStr]
  const imageLevel = CONDITION_LEVELS[imageCondition]

  if (formLevel === undefined || imageLevel === undefined) {
    return null
  }

  // Check for significant discrepancy (difference of 2 or more levels)
  const levelDifference = formLevel - imageLevel

  if (Math.abs(levelDifference) < 2) {
    // Minor or no discrepancy - don't flag
    return null
  }

  // Generate appropriate note
  const imageConditionDisplay = imageCondition.charAt(0).toUpperCase() + imageCondition.slice(1)
  const formConditionDisplay = formConditionStr.charAt(0).toUpperCase() + formConditionStr.slice(1)

  if (levelDifference > 0) {
    // Form says worse than images show (customer pessimistic)
    return {
      formCondition: formConditionStr,
      imageCondition,
      note: `Note: Based on the photos provided, the condition appears to be ${imageConditionDisplay.toLowerCase()}, which differs from the "${formConditionDisplay}" condition selected. Price is based on actual condition observed in photos.`,
    }
  } else {
    // Form says better than images show (customer optimistic)
    return {
      formCondition: formConditionStr,
      imageCondition,
      note: `Note: Based on the photos provided, the condition appears to be ${imageConditionDisplay.toLowerCase()} rather than "${formConditionDisplay}" as indicated. Additional work may be required and has been factored into the quote.`,
    }
  }
}

/**
 * Detect mentions of other services using hybrid AI + keyword approach
 *
 * This first tries AI detection (more intelligent), then falls back to
 * keyword matching for any services not detected by AI.
 */
async function detectCrossServiceMentionsWithAI(
  gemini: ReturnType<typeof createGeminiClient>,
  projectDescription: string,
  primaryServiceName: string,
  otherServices: Array<{ id: string; name: string; description?: string; detection_keywords?: string[] }>
): Promise<CrossServiceRecommendation[]> {
  // Comprehensive logging for debugging
  console.log(`[CrossService] Description length: ${projectDescription?.length || 0}`)
  console.log(`[CrossService] Available services: ${otherServices.map((s) => s.name).join(', ') || 'none'}`)

  if (!projectDescription || projectDescription.trim().length < 10) {
    console.log('[CrossService] SKIP: Description too short or empty')
    return []
  }

  if (otherServices.length === 0) {
    console.log('[CrossService] SKIP: No other services configured for this tenant')
    return []
  }

  const recommendations: CrossServiceRecommendation[] = []
  const detectedServiceIds = new Set<string>()

  // Try AI detection first (if Gemini is available)
  if (gemini) {
    console.log('[CrossService] Attempting AI-powered service detection')
    try {
      const servicesForMatching: ServiceForMatching[] = otherServices.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        detection_keywords: s.detection_keywords,
      }))

      const aiDetected = await detectServicesFromDescription(
        gemini,
        primaryServiceName,
        projectDescription,
        servicesForMatching
      )

      for (const detected of aiDetected) {
        recommendations.push({
          serviceId: detected.serviceId,
          serviceName: detected.serviceName,
          reason: detected.reason,
          matchedKeyword: detected.matchedPhrase,
        })
        detectedServiceIds.add(detected.serviceId)
        console.log(`[CrossService] AI detected: ${detected.serviceName} (conf: ${detected.confidence})`)
      }
    } catch (error) {
      console.error('[CrossService] AI detection failed, falling back to keywords:', error)
    }
  } else {
    console.log('[CrossService] Gemini not available, using keyword-only matching')
  }

  // Fall back to keyword matching for services not detected by AI
  const keywordMatches = detectCrossServiceMentionsKeywords(
    projectDescription,
    otherServices.filter((s) => !detectedServiceIds.has(s.id))
  )

  for (const match of keywordMatches) {
    recommendations.push(match)
    console.log(`[CrossService] Keyword detected: ${match.serviceName} (keyword: "${match.matchedKeyword}")`)
  }

  console.log(`[CrossService] Total detected: ${recommendations.length} services`)
  return recommendations
}

/**
 * Keyword-based service detection (fallback)
 */
function detectCrossServiceMentionsKeywords(
  projectDescription: string,
  otherServices: Array<{ id: string; name: string; detection_keywords?: string[] }>
): CrossServiceRecommendation[] {
  if (!projectDescription || otherServices.length === 0) {
    return []
  }

  const textLower = projectDescription.toLowerCase()
  const recommendations: CrossServiceRecommendation[] = []

  for (const service of otherServices) {
    // Check service name first
    const serviceNameLower = service.name.toLowerCase()
    if (textLower.includes(serviceNameLower)) {
      recommendations.push({
        serviceId: service.id,
        serviceName: service.name,
        reason: `You mentioned "${service.name}" in your description`,
        matchedKeyword: service.name,
      })
      continue
    }

    // Check detection keywords (only if they exist and have content)
    if (service.detection_keywords && service.detection_keywords.length > 0) {
      let matched = false
      for (const keyword of service.detection_keywords) {
        const keywordLower = keyword.toLowerCase().trim()
        if (!keywordLower) continue

        // Use word boundary matching
        const regex = new RegExp(`\\b${escapeRegExp(keywordLower)}\\b`, 'i')
        if (regex.test(textLower)) {
          recommendations.push({
            serviceId: service.id,
            serviceName: service.name,
            reason: `Based on "${keyword}" in your description`,
            matchedKeyword: keyword,
          })
          matched = true
          break // Only one match per service
        }
      }

      if (!matched) {
        // Log when keywords exist but didn't match
        console.log(`[CrossService] Keywords for "${service.name}" didn't match: [${service.detection_keywords.join(', ')}]`)
      }
    } else {
      // Log when no keywords configured
      console.log(`[CrossService] No detection keywords configured for "${service.name}"`)
    }
  }

  return recommendations
}

/**
 * Escape special regex characters
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract main keyword from addon ID for scope matching
 * e.g., "paint_blending" → "paint", "deep_scratch_repair" → "scratch"
 */
function getAddonKeyword(addonId: string): string {
  const keywords = ['paint', 'scratch', 'dent', 'rust', 'polish', 'wax', 'seal', 'buff', 'clear', 'coat']
  const idLower = addonId.toLowerCase()
  return keywords.find(kw => idLower.includes(kw)) || ''
}

/**
 * Check if an addon's functionality is already part of the core service
 * Returns true if the addon should be filtered out (not recommended)
 */
function isAddonCoveredByService(
  addonId: string,
  serviceName: string,
  scopeIncludes: string[] = []
): boolean {
  const addonKeyword = getAddonKeyword(addonId)
  if (!addonKeyword) return false

  const serviceNameLower = serviceName.toLowerCase()
  const scopeText = scopeIncludes.join(' ').toLowerCase()

  // Check if the addon's core functionality is already in the service name or scope
  return serviceNameLower.includes(addonKeyword) || scopeText.includes(addonKeyword)
}

/**
 * Find matching form answer with flexible matching
 * Supports exact match, normalized match, and semantic matching for common patterns
 *
 * NOTE: Kept for potential backward compatibility but unused after AD-007 refactor.
 * The new approach iterates form answers directly instead of matching expected signals.
 * Exported for potential use by other modules.
 */
export function findMatchingFormAnswer(
  formAnswers: Array<{ fieldId: string; value: string | number | boolean | string[] }>,
  signalKey: string
): { fieldId: string; value: string | number | boolean | string[] } | undefined {
  // 1. Exact match
  let match = formAnswers.find(a => a.fieldId === signalKey)
  if (match) return match

  // 2. Normalized match (remove underscores, spaces, case insensitive)
  const normalizedKey = signalKey.toLowerCase().replace(/[_\s]/g, '')
  match = formAnswers.find(a =>
    a.fieldId.toLowerCase().replace(/[_\s]/g, '') === normalizedKey
  )
  if (match) return match

  // 3. Semantic matching for common patterns
  // Maps signal keys to possible form field ID patterns
  // This handles cases where AI generates different IDs for signals vs form fields
  // IMPORTANT: Patterns are checked in order - put more specific patterns first
  // IMPORTANT: Avoid overly broad patterns that could match wrong fields
  const semanticPatterns: Record<string, string[]> = {
    // Area/size signals - these should match "room_sizes", "area", "sqft" fields
    'total_area': ['room_sizes', 'total_area', 'area_sqft', 'sqft', 'square_footage'],
    'total_area_sqft': ['room_sizes', 'room_sizes_sqft', 'area_sqft', 'square_footage', 'total_sqft', 'total_area'],
    'surface_area': ['room_sizes', 'area_sqft', 'sqft', 'square_footage', 'total_area'],
    // Stair signals
    'has_stairs': ['staircase_present', 'has_staircase', 'stairs_present'],
    'stair_count': ['stair_count', 'number_of_stairs', 'stairs_count', 'stair_quantity', 'num_stairs'],
    // Furniture signals
    'requires_furniture_moving': ['furniture_moving', 'furniture_moving_required', 'move_furniture', 'furniture_moving_needed'],
    'furniture_moving_needed': ['furniture_moving', 'furniture_moving_required', 'move_furniture', 'requires_furniture_moving'],
    'furniture_moving_required': ['furniture_moving', 'furniture_moving_needed', 'move_furniture'],
    // Count signals - be specific to avoid matching "room_sizes" for "room_count"
    'item_count': ['number_of_items', 'item_quantity', 'num_items', 'total_items'],
    'room_count': ['number_of_rooms', 'room_count', 'num_rooms', 'total_rooms', 'how_many_rooms'],
    'window_count': ['number_of_windows', 'window_count', 'num_windows', 'total_windows'],
    // Condition signals
    'subfloor_condition': ['subfloor_material', 'subfloor', 'floor_condition', 'subfloor_state'],
    'condition_rating': ['condition', 'state', 'quality'],
    // Type signals
    'floor_type': ['flooring_type', 'flooring', 'floor'],
    'carpet_type': ['carpet_style', 'carpet_grade', 'carpet'],
  }

  const patterns = semanticPatterns[signalKey.toLowerCase()] || []
  for (const pattern of patterns) {
    // Match against normalized pattern - require EXACT match to avoid false positives
    // e.g., "room_sizes" should NOT match "room_count" just because both contain "room"
    const normalizedPattern = pattern.toLowerCase().replace(/[_\s]/g, '')
    match = formAnswers.find(a => {
      const normalizedFieldId = a.fieldId.toLowerCase().replace(/[_\s]/g, '')
      // Exact match only - no substring matching to avoid false positives
      return normalizedFieldId === normalizedPattern
    })
    if (match) {
      console.log(`[Processor] Semantic match: signal "${signalKey}" matched form field "${match.fieldId}"`)
      return match
    }
  }

  return undefined
}

/**
 * Convert form value to signal type
 * Handles comma-separated numeric values by summing them (e.g., "130,120,95,80" → 425)
 */
function convertFormValueToSignal(
  value: string | number | boolean | string[],
  expectedType: string
): string | number | boolean | null {
  if (expectedType === 'number') {
    // Handle array of values (sum them)
    if (Array.isArray(value)) {
      const nums = value.map(v => parseFloat(String(v))).filter(n => !isNaN(n))
      return nums.length > 0 ? nums.reduce((sum, n) => sum + n, 0) : null
    }

    // Handle comma-separated values (sum them)
    if (typeof value === 'string') {
      // Check if it contains commas (comma-separated numbers)
      if (value.includes(',')) {
        const parts = value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
        if (parts.length > 0) {
          const total = parts.reduce((sum, n) => sum + n, 0)
          console.log(`[Processor] Parsed comma-separated values "${value}" → total: ${total}`)
          return total
        }
        return null
      }
      // Single number
      const parsed = parseFloat(value)
      return isNaN(parsed) ? null : parsed
    }

    if (typeof value === 'number') return value
    return null
  }

  if (expectedType === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const lower = value.toLowerCase()
      return ['true', 'yes', '1', 'on'].includes(lower)
    }
    return null
  }

  // String or enum - convert to string
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  return String(value)
}
