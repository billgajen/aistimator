import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import {
  computeCalibration,
  type CalibrationQuoteInput,
  type CalibrationAmendmentInput,
} from '@qolumns/shared'
import type { QuotePricing } from '@qolumns/shared'

const LOOKBACK_DAYS = 90
const MAX_QUOTES = 500
const MAX_AMENDMENTS = 200

/**
 * GET /api/learning/calibration (T-110)
 *
 * Per-service pricing calibration computed live from quote outcomes over the
 * last 90 days: amendment deltas, acceptance rates, review load → deterministic
 * suggestions (see packages/shared/src/calibration.ts). Read-only; the business
 * applies changes themselves via the pricing composer (AD-001 holds).
 */
export async function GET() {
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

    const since = new Date()
    since.setDate(since.getDate() - LOOKBACK_DAYS)
    const sinceIso = since.toISOString()

    const [{ data: services }, { data: quotes }, { data: amendments }] = await Promise.all([
      supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', profile.tenant_id)
        .eq('active', true),
      supabase
        .from('quotes')
        // T-204: tests are told apart and "sent" is read the way every Analytics figure reads it
        .select('service_id, status, pricing_json, created_at, is_test, sent_at')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(MAX_QUOTES),
      supabase
        .from('quote_amendments')
        .select('quote_id, before_pricing, after_pricing, created_at, quotes!quote_id ( service_id, is_test )')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(MAX_AMENDMENTS),
    ])

    if (!services || services.length === 0) {
      return NextResponse.json({ services: [], lookbackDays: LOOKBACK_DAYS })
    }

    const quoteInputs: CalibrationQuoteInput[] = (quotes || []).map((q) => ({
      serviceId: q.service_id,
      status: q.status,
      total: (q.pricing_json as QuotePricing | null)?.total ?? 0,
      isTest: (q as { is_test?: boolean | null }).is_test === true,
      sentAt: (q as { sent_at?: string | null }).sent_at ?? null,
    }))

    const amendmentInputs: CalibrationAmendmentInput[] = (amendments || [])
      .map((a) => {
        const quoteRef = Array.isArray(a.quotes) ? a.quotes[0] : a.quotes
        return {
          serviceId: (quoteRef as { service_id?: string } | null)?.service_id ?? '',
          beforeTotal: (a.before_pricing as QuotePricing | null)?.total ?? 0,
          afterTotal: (a.after_pricing as QuotePricing | null)?.total ?? 0,
          // T-204: a quote edited twice is one quote, and an edit to a test is in no figure
          quoteId: (a as { quote_id?: string }).quote_id,
          createdAt: a.created_at as string,
          isTest: (quoteRef as { is_test?: boolean | null } | null)?.is_test === true,
        }
      })
      .filter((a) => a.serviceId !== '')

    const calibration = computeCalibration(services, quoteInputs, amendmentInputs)

    return NextResponse.json({
      services: calibration,
      lookbackDays: LOOKBACK_DAYS,
    })
  } catch (error) {
    console.error('Calibration error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
