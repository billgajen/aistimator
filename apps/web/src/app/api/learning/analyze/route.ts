import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type {
  AnalyzeLearningRequest,
  AnalyzeLearningResponse,
  LearningPattern,
  LearningPatternType,
  AmendmentChange,
  QuotePricing,
} from '@estimator/shared'

const MIN_PATTERN_FREQUENCY = 3
const MIN_PATTERN_CONSISTENCY = 0.7
const MAX_AMENDMENTS = 50

/**
 * POST /api/learning/analyze
 * Trigger amendment pattern analysis for a service
 */
export async function POST(request: NextRequest) {
  try {
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

    const body = (await request.json()) as AnalyzeLearningRequest
    if (!body.serviceId) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'serviceId is required' } },
        { status: 400 }
      )
    }

    // Verify service belongs to tenant
    const { data: service } = await supabase
      .from('services')
      .select('id')
      .eq('id', body.serviceId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (!service) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Service not found' } },
        { status: 404 }
      )
    }

    // Fetch amendments for quotes of this service
    const { data: amendments } = await supabase
      .from('quote_amendments')
      .select(`
        id, version, before_pricing, after_pricing, changes_json, created_at,
        quotes!quote_id ( service_id )
      `)
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(MAX_AMENDMENTS)

    if (!amendments || amendments.length === 0) {
      const response: AnalyzeLearningResponse = {
        success: true,
        patternsFound: 0,
        message: 'No amendments to analyze',
      }
      return NextResponse.json(response)
    }

    // Filter to this service
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = amendments.filter((a: any) => {
      const q = Array.isArray(a.quotes) ? a.quotes[0] : a.quotes
      return q?.service_id === body.serviceId
    })

    if (filtered.length < MIN_PATTERN_FREQUENCY) {
      const response: AnalyzeLearningResponse = {
        success: true,
        patternsFound: 0,
        message: `Only ${filtered.length} amendments found. Need at least ${MIN_PATTERN_FREQUENCY} for pattern detection.`,
      }
      return NextResponse.json(response)
    }

    // Analyze patterns
    const patterns: LearningPattern[] = []

    // Price patterns
    const totalChanges: number[] = []
    for (const a of filtered) {
      const before = (a.before_pricing as QuotePricing)?.total ?? 0
      const after = (a.after_pricing as QuotePricing)?.total ?? 0
      if (before > 0) {
        totalChanges.push(((after - before) / before) * 100)
      }
    }

    if (totalChanges.length >= MIN_PATTERN_FREQUENCY) {
      const increases = totalChanges.filter((c) => c > 2)
      const decreases = totalChanges.filter((c) => c < -2)

      if (increases.length / totalChanges.length >= MIN_PATTERN_CONSISTENCY) {
        const avg = increases.reduce((s, v) => s + v, 0) / increases.length
        patterns.push({
          type: 'price_increase' as LearningPatternType,
          field: 'total',
          direction: 'increase',
          frequency: increases.length,
          avgMagnitude: Math.round(avg * 10) / 10,
          description: `Business typically increases total by ~${Math.round(avg)}%`,
        })
      }

      if (decreases.length / totalChanges.length >= MIN_PATTERN_CONSISTENCY) {
        const avg = Math.abs(decreases.reduce((s, v) => s + v, 0) / decreases.length)
        patterns.push({
          type: 'price_decrease' as LearningPatternType,
          field: 'total',
          direction: 'decrease',
          frequency: decreases.length,
          avgMagnitude: Math.round(avg * 10) / 10,
          description: `Business typically decreases total by ~${Math.round(avg)}%`,
        })
      }
    }

    // Item patterns
    const addedLabels: Record<string, number> = {}
    const removedLabels: Record<string, number> = {}

    for (const a of filtered) {
      const changes = (a.changes_json || []) as AmendmentChange[]
      for (const change of changes) {
        if (change.field === 'pricing' && change.type === 'added') {
          const label = change.path.replace('breakdown.', '')
          addedLabels[label] = (addedLabels[label] || 0) + 1
        }
        if (change.field === 'pricing' && change.type === 'removed') {
          const label = change.path.replace('breakdown.', '')
          removedLabels[label] = (removedLabels[label] || 0) + 1
        }
      }
    }

    for (const [label, count] of Object.entries(addedLabels)) {
      if (count >= MIN_PATTERN_FREQUENCY) {
        patterns.push({
          type: 'item_addition' as LearningPatternType,
          field: `breakdown.${label}`,
          frequency: count,
          description: `Business frequently adds "${label}" line item`,
        })
      }
    }

    for (const [label, count] of Object.entries(removedLabels)) {
      if (count >= MIN_PATTERN_FREQUENCY) {
        patterns.push({
          type: 'item_removal' as LearningPatternType,
          field: `breakdown.${label}`,
          frequency: count,
          description: `Business frequently removes "${label}" line item`,
        })
      }
    }

    // Content patterns
    let scopeEdits = 0
    let noteAdds = 0
    for (const a of filtered) {
      const changes = (a.changes_json || []) as AmendmentChange[]
      for (const c of changes) {
        if (c.field === 'content' && c.path === 'scopeSummary' && c.type === 'modified') scopeEdits++
        if (c.field === 'content' && c.path === 'notes' && (c.type === 'added' || c.type === 'modified')) noteAdds++
      }
    }

    if (scopeEdits >= MIN_PATTERN_FREQUENCY) {
      patterns.push({
        type: 'scope_edit' as LearningPatternType,
        field: 'scopeSummary',
        frequency: scopeEdits,
        description: 'Business frequently edits the scope summary',
      })
    }

    if (noteAdds >= MIN_PATTERN_FREQUENCY) {
      patterns.push({
        type: 'note_addition' as LearningPatternType,
        field: 'notes',
        frequency: noteAdds,
        description: 'Business frequently adds or edits notes',
      })
    }

    // Generate prompt context
    const promptContext = patterns.length > 0
      ? ["This business's editing patterns:", ...patterns.map((p) => `- ${p.description} (seen ${p.frequency} times)`)].join('\n')
      : null

    // Upsert
    await supabase
      .from('tenant_learning_context')
      .upsert(
        {
          tenant_id: profile.tenant_id,
          service_id: body.serviceId,
          patterns_json: patterns,
          prompt_context: promptContext,
          total_amendments_analyzed: filtered.length,
          last_analyzed_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,service_id' }
      )

    const response: AnalyzeLearningResponse = {
      success: true,
      patternsFound: patterns.length,
      message: patterns.length > 0
        ? `Found ${patterns.length} pattern(s) from ${filtered.length} amendments`
        : `Analyzed ${filtered.length} amendments but no consistent patterns found`,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Learning analyze error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
