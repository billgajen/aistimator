import { createClient, createAdminClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceDraftConfig } from '@estimator/shared'
import { validateAndNormalizeDraft, callGemini, parseGeminiJson } from '../shared'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'

/**
 * POST /api/services/ai-draft/extract-pricing
 * Extract pricing from an uploaded document for a single service
 */

const EXTRACT_PRICING_SYSTEM_PROMPT = `You are an expert pricing consultant. Extract pricing information from the uploaded document and map it to a service configuration.

Return pricing data that matches the provided service context. Extract actual prices from the document.

RULES:
- Use actual prices from the document, never invent prices
- Map line items to work steps with appropriate cost types (fixed, per_unit, per_hour)
- Identify any add-ons or optional extras
- If the document contains customer questions that affect pricing, include them as suggestedFields`

interface ExtractPricingRequest {
  assetId: string
  serviceName: string
  serviceDescription: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    const body: ExtractPricingRequest = await request.json()

    if (!body.assetId) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'assetId is required' } },
        { status: 400 }
      )
    }

    // Fetch asset (verify tenant ownership)
    const admin = createAdminClient()
    const { data: asset, error: assetError } = await admin
      .from('assets')
      .select('*')
      .eq('id', body.assetId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (assetError || !asset) {
      return NextResponse.json(
        { error: { code: 'ASSET_NOT_FOUND', message: 'Asset not found or access denied' } },
        { status: 404 }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: { code: 'AI_NOT_CONFIGURED', message: 'AI service not configured' } },
        { status: 503 }
      )
    }

    // Fetch file content
    const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> = []

    if (isR2Configured()) {
      const downloadUrl = await generateDownloadUrl(asset.r2_key, 600)
      const fileResponse = await fetch(downloadUrl)
      if (fileResponse.ok) {
        const buffer = await fileResponse.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')
        imageParts.push({
          inlineData: { mimeType: asset.content_type, data: base64 },
        })
      }
    }

    const userPrompt = `Extract pricing information from this document for the following service:

SERVICE: ${body.serviceName}
DESCRIPTION: ${body.serviceDescription || 'Not provided'}

Return a JSON object with the pricing structure:
{
  "pricing": {
    "pricingModel": "fixed|per_unit",
    "baseFee": 0,
    "minimumCharge": 0,
    "workSteps": [
      { "id": "step_1", "name": "Item Name", "description": "...", "costType": "fixed|per_unit|per_hour", "defaultCost": 50, "optional": false }
    ],
    "addOns": [
      { "name": "Add-on Name", "price": 25, "description": "..." }
    ]
  },
  "suggestedFields": [
    { "label": "Question", "fieldId": "field_1", "type": "number", "required": true, "criticalForPricing": true }
  ]
}

Extract prices exactly as shown in the document. Return ONLY JSON.`

    const responseText = await callGemini({
      apiKey,
      systemPrompt: EXTRACT_PRICING_SYSTEM_PROMPT,
      userPrompt,
      imageParts: imageParts.length > 0 ? imageParts : undefined,
      temperature: 0.3,
      maxOutputTokens: 4096,
    })

    const extracted = parseGeminiJson<Partial<ServiceDraftConfig>>(responseText)
    const normalized = validateAndNormalizeDraft(extracted)

    // Return only pricing-relevant fields as a partial draft
    return NextResponse.json({
      draft: {
        pricing: normalized.pricing,
        suggestedFields: normalized.suggestedFields,
        expectedSignals: normalized.expectedSignals,
      },
    })
  } catch (error) {
    console.error('Extract pricing error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to extract pricing from document' } },
      { status: 500 }
    )
  }
}
