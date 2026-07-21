import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceDraftConfig } from '@estimator/shared'
import { validateAndNormalizeDraftBulk, callGemini, parseGeminiJson } from '../shared'
import { fetchWebsiteContent } from '@/lib/website-extract'

/**
 * POST /api/services/ai-draft/extract-from-website (T-105)
 *
 * "Paste your website URL" onboarding: fetches the business's site (plus up to
 * 3 relevant same-origin pages), extracts readable text, and drafts a full
 * service set. Same response contract as extract-services so the bulk review
 * UI is reused unchanged.
 */

export const maxDuration = 60 // page fetches + Gemini can exceed the default

const EXTRACT_WEBSITE_SYSTEM_PROMPT = `You are an expert business consultant who reads a business's website and drafts their service catalogue for a quoting platform.

Your job is to identify ALL distinct services the business offers based on the website text. For each service, extract as much real configuration as the text supports.

CRITICAL RULES:
- Each distinct service the business offers = one service entry
- Extract prices ONLY when the website states them ("from £40", "£12 per sqm", "$99 flat"). Use the stated amount as a workStep defaultCost. "From X" prices are still X — the platform treats configured prices as starting points.
- NEVER invent prices. If the site shows no price for a service, create the service with an empty workSteps array and baseFee 0 — the business will add pricing later.
- Rates ("per sqm", "per hour", "per room") → costType "per_unit" (or "per_hour") with a clear unitLabel
- Write scope.included/excluded from what the site actually says the service covers
- Write a genuinely useful one-sentence description per service from the site's own wording
- Skip navigation junk, blog posts, testimonials, legal pages — services only
- Marketing pages often describe one service across many words; consolidate into one clean entry`

interface ExtractWebsiteRequest {
  /** Website URL to read (fetched server-side) */
  url?: string
  /** Alternative: plain-text description of the business's services (T-106 interview path) */
  text?: string
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

    const body: ExtractWebsiteRequest = await request.json()

    if (!body.url?.trim() && !body.text?.trim()) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'url or text is required' } },
        { status: 400 }
      )
    }

    if (body.text && body.text.length > 20000) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'text is too long (max 20,000 characters)' } },
        { status: 400 }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: { code: 'AI_NOT_CONFIGURED', message: 'AI service not configured' } },
        { status: 503 }
      )
    }

    let content: { pages: Array<{ url: string; text: string }>; combinedText: string }
    if (body.text?.trim()) {
      // Interview path: the business described their services directly
      content = {
        pages: [{ url: 'business description', text: body.text.trim() }],
        combinedText: body.text.trim(),
      }
    } else {
      try {
        content = await fetchWebsiteContent(body.url!.trim())
      } catch (fetchError) {
        return NextResponse.json(
          {
            error: {
              code: 'FETCH_FAILED',
              message: fetchError instanceof Error ? fetchError.message : 'Could not fetch that website',
            },
          },
          { status: 400 }
        )
      }
    }

    if (content.combinedText.length < (body.text ? 30 : 200)) {
      return NextResponse.json(
        {
          error: {
            code: 'INSUFFICIENT_CONTENT',
            message:
              'Not enough readable text found on that site. If your site is heavily JavaScript-rendered, try uploading a pricing document instead.',
          },
        },
        { status: 422 }
      )
    }

    const userPrompt = `Website text (${content.pages.length} page${content.pages.length === 1 ? '' : 's'}: ${content.pages.map((p) => p.url).join(', ')}):

"""
${content.combinedText}
"""

Identify every service this business offers and return JSON:
{
  "services": [
    {
      "name": "Service name",
      "description": "One-sentence description from the site's own wording",
      "draft": {
        "scope": { "included": ["..."], "excluded": ["..."], "assumptions": ["..."] },
        "media": { "minPhotos": 1, "maxPhotos": 8, "photoGuidance": "..." },
        "pricing": {
          "pricingModel": "fixed",
          "unitType": null,
          "baseFee": 0,
          "minimumCharge": 0,
          "workSteps": [
            { "id": "step_1", "name": "...", "description": "...", "costType": "fixed", "defaultCost": 50, "optional": false }
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

Include workSteps ONLY for prices actually stated on the site. Return ONLY JSON.`

    const responseText = await callGemini({
      apiKey,
      systemPrompt: EXTRACT_WEBSITE_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.3,
      maxOutputTokens: 8192,
    })

    const extracted = parseGeminiJson<ExtractedServices>(responseText)

    const services = (extracted.services || []).map((svc) => ({
      name: svc.name || 'Unnamed Service',
      description: svc.description || '',
      draft: validateAndNormalizeDraftBulk(svc.draft || {}),
    }))

    return NextResponse.json({
      services,
      pagesRead: content.pages.map((p) => p.url),
    })
  } catch (error) {
    console.error('Extract from website error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to extract services from website' } },
      { status: 500 }
    )
  }
}
