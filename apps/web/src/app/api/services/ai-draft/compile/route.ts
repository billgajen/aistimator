import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import { callGemini } from '../shared'
import { COMPILE_SYSTEM_PROMPT, compileUserPrompt, finishCompile, type CompileRequest } from '@/lib/pricing-compile'
import { resolveRegionContext, regionPromptBlock } from '@qolumns/shared'

// Vercel function budget: this route runs the full AI pipeline synchronously
// (Cloudflare Queues needs the paid Workers plan - revisit post-launch)
export const maxDuration = 60

/**
 * POST /api/services/ai-draft/compile (T-104, AD-021/AD-024)
 *
 * Compiles a plain-language pricing description into the deterministic
 * pricing configuration. The AI authors config ONCE at compile time; the
 * review summary shown to the business is rendered deterministically from
 * the compiled output (lib/pricing-describe.ts), never by the AI.
 *
 * Where the description is ambiguous the AI must ASK (ambiguities[]),
 * not invent numbers.
 *
 * T-204: the prompt and everything done to the AI's answer live in
 * lib/pricing-compile.ts, so the tests and the live check run the same code.
 */

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

    const body: CompileRequest = await request.json()

    if (!body.description?.trim()) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'description is required' } },
        { status: 400 }
      )
    }

    if (body.description.length > 20000) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'description is too long (max 20,000 characters)' } },
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

    // T-133: the tenant's region decides currency and units for parsing
    // ("$2.50/sqft", "per linear foot") and for the wording the compiler writes
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('region, currency, unit_system, tax_label')
      .eq('id', profile.tenant_id)
      .single()
    const regionCtx = resolveRegionContext({
      ...(tenantRow ?? {}),
      currency: body.currency || tenantRow?.currency,
    })

    const userPrompt = compileUserPrompt(body, regionPromptBlock(regionCtx))

    const responseText = await callGemini({
      apiKey,
      systemPrompt: COMPILE_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.2, // compilation should be precise, not creative
      // thinking tokens count against this budget (same trap as the
      // measurement 4096 truncation) — 16384 leaves headroom for long price lists
      maxOutputTokens: 16384,
    })

    // T-204: everything after the AI's answer is code (lib/pricing-compile.ts): normalise, tie the
    // loose links, flag what is still loose
    return NextResponse.json(finishCompile(responseText, body))
  } catch (error) {
    console.error('Compile error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to compile pricing description' } },
      { status: 500 }
    )
  }
}
