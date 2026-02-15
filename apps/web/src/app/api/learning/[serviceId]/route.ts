import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { LearningContextResponse, LearningPattern } from '@estimator/shared'

/**
 * GET /api/learning/[serviceId]
 * Get learning patterns and prompt context for a service
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  try {
    const { serviceId } = await params
    const supabase = await createClient()

    // Auth check
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

    // Fetch service name
    const { data: service } = await supabase
      .from('services')
      .select('id, name')
      .eq('id', serviceId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (!service) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Service not found' } },
        { status: 404 }
      )
    }

    // Fetch learning context
    const { data: context } = await supabase
      .from('tenant_learning_context')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('service_id', serviceId)
      .single()

    const response: LearningContextResponse = {
      serviceId,
      serviceName: service.name,
      patterns: (context?.patterns_json as LearningPattern[]) || [],
      promptContext: context?.prompt_context || null,
      totalAmendmentsAnalyzed: context?.total_amendments_analyzed || 0,
      lastAnalyzedAt: context?.last_analyzed_at || null,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Learning GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
