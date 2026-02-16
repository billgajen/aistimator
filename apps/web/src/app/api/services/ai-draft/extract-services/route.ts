import { createClient, createAdminClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceDraftConfig } from '@estimator/shared'
import { validateAndNormalizeDraftBulk, callGemini, parseGeminiJson } from '../shared'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'

/**
 * POST /api/services/ai-draft/extract-services
 * Extract multiple services from an uploaded pricing document
 */

const EXTRACT_SERVICES_SYSTEM_PROMPT = `You are an expert business consultant who extracts service configurations from pricing documents.

Your job is to identify ALL distinct service CATEGORIES in the uploaded document. Each category/section heading becomes one service entry. The individual line items under each category become workSteps within that service.

CRITICAL RULES:
- Each section/category heading = one service (e.g., "Spa Package", "Facial", "Waxing" = 3 services)
- Each line item under a category = one workStep with its exact price as defaultCost
- Extract prices EXACTLY as shown in the document — never invent prices
- Do NOT skip any line items or categories
- Use costType "fixed" for flat-price items, "per_unit" for per-unit pricing
- Keep service names matching the document headings`

interface ExtractServicesRequest {
  assetId: string
}

interface ExtractedServices {
  services: Array<{
    name: string
    description: string
    draft: Partial<ServiceDraftConfig>
  }>
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

    const body: ExtractServicesRequest = await request.json()

    if (!body.assetId) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'assetId is required' } },
        { status: 400 }
      )
    }

    // Fetch asset record (verify tenant ownership)
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

    // Build image parts for Gemini if the file is an image or PDF
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

    const userPrompt = `Analyze this pricing document and extract ALL service categories with their line items.

Each section/heading in the document = one service.
Each line item under that section = one workStep within that service.

EXAMPLE: If the document shows:
  "Facial Spa"
    Classic Facial ......... $40
    Deep Cleansing ......... $45
  "Waxing"
    Full Legs .............. $40

Then return 2 services:
- "Facial Spa" with 2 workSteps (Classic Facial $40, Deep Cleansing $45)
- "Waxing" with 1 workStep (Full Legs $40)

Return JSON:
{
  "services": [
    {
      "name": "Category Name from document",
      "description": "One-sentence description",
      "draft": {
        "scope": { "included": ["what this service includes"], "excluded": ["not included"], "assumptions": ["standard assumptions"] },
        "media": { "minPhotos": 1, "maxPhotos": 8, "photoGuidance": "Upload relevant photos" },
        "pricing": {
          "pricingModel": "fixed",
          "unitType": null,
          "baseFee": 0,
          "minimumCharge": 0,
          "workSteps": [
            { "id": "step_1", "name": "Line Item Name", "description": "...", "costType": "fixed", "defaultCost": 50, "optional": false }
          ],
          "addOns": [],
          "siteVisit": { "alwaysRecommend": false, "confidenceBelowPct": 60, "estimateAbove": 1000 }
        },
        "expectedSignals": [],
        "suggestedFields": []
      }
    }
  ]
}

Extract ALL categories and ALL line items with exact prices. Return ONLY JSON.`

    const responseText = await callGemini({
      apiKey,
      systemPrompt: EXTRACT_SERVICES_SYSTEM_PROMPT,
      userPrompt,
      imageParts: imageParts.length > 0 ? imageParts : undefined,
      temperature: 0.5,
      maxOutputTokens: 8192,
    })

    const extracted = parseGeminiJson<ExtractedServices>(responseText)

    // Validate and normalize each service draft
    const services = (extracted.services || []).map(svc => ({
      name: svc.name || 'Unnamed Service',
      description: svc.description || '',
      draft: validateAndNormalizeDraftBulk(svc.draft || {}),
    }))

    return NextResponse.json({ services })
  } catch (error) {
    console.error('Extract services error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to extract services from document' } },
      { status: 500 }
    )
  }
}
