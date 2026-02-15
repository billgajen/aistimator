/**
 * Amendment Pattern Analyzer
 *
 * Analyzes quote_amendments for a tenant+service pair and detects
 * recurring editing patterns. Results are stored in tenant_learning_context
 * and used to improve future AI-generated quote wording.
 *
 * NOTE: Per AD-001, price patterns are surfaced as insights only,
 * not automatically applied to pricing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  LearningPattern,
  LearningPatternType,
  AmendmentChange,
  QuotePricing,
} from '@estimator/shared'

const MIN_PATTERN_FREQUENCY = 3
const MIN_PATTERN_CONSISTENCY = 0.7 // 70%
const MAX_AMENDMENTS_TO_ANALYZE = 50

interface AmendmentRow {
  id: string
  version: number
  before_pricing: QuotePricing
  after_pricing: QuotePricing
  changes_json: AmendmentChange[]
  created_at: string
}

/**
 * Analyze amendments for a tenant+service and upsert learning context.
 * Returns the number of patterns found.
 */
export async function analyzeAmendmentPatterns(
  supabase: SupabaseClient,
  tenantId: string,
  serviceId: string
): Promise<{ patternsFound: number; promptContext: string | null }> {
  // Fetch recent amendments for this tenant+service
  const { data: amendments, error } = await supabase
    .from('quote_amendments')
    .select('id, version, before_pricing, after_pricing, changes_json, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(MAX_AMENDMENTS_TO_ANALYZE)

  if (error || !amendments || amendments.length === 0) {
    return { patternsFound: 0, promptContext: null }
  }

  // We need to filter to only amendments for quotes of this service
  // Join through quotes table
  const { data: serviceAmendments, error: joinError } = await supabase
    .from('quote_amendments')
    .select(`
      id, version, before_pricing, after_pricing, changes_json, created_at,
      quotes!quote_id ( service_id )
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(MAX_AMENDMENTS_TO_ANALYZE)

  if (joinError || !serviceAmendments) {
    return { patternsFound: 0, promptContext: null }
  }

  // Filter to this service
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = serviceAmendments.filter((a: any) => {
    const quotes = a.quotes
    const q = Array.isArray(quotes) ? quotes[0] : quotes
    return q?.service_id === serviceId
  }) as unknown as AmendmentRow[]

  if (filtered.length < MIN_PATTERN_FREQUENCY) {
    return { patternsFound: 0, promptContext: null }
  }

  // Detect patterns
  const patterns: LearningPattern[] = []

  // 1. Price change patterns
  detectPricePatterns(filtered, patterns)

  // 2. Item addition/removal patterns
  detectItemPatterns(filtered, patterns)

  // 3. Content edit patterns
  detectContentPatterns(filtered, patterns)

  // Generate natural language prompt context
  const promptContext = patterns.length > 0
    ? generatePromptContext(patterns)
    : null

  // Upsert into tenant_learning_context
  const { error: upsertError } = await supabase
    .from('tenant_learning_context')
    .upsert(
      {
        tenant_id: tenantId,
        service_id: serviceId,
        patterns_json: patterns,
        prompt_context: promptContext,
        total_amendments_analyzed: filtered.length,
        last_analyzed_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,service_id' }
    )

  if (upsertError) {
    console.error('[AmendmentAnalyzer] Failed to upsert learning context:', upsertError)
  }

  return { patternsFound: patterns.length, promptContext }
}

function detectPricePatterns(amendments: AmendmentRow[], patterns: LearningPattern[]) {
  const totalChanges: number[] = []

  for (const a of amendments) {
    const beforeTotal = a.before_pricing?.total ?? 0
    const afterTotal = a.after_pricing?.total ?? 0
    if (beforeTotal > 0) {
      const pctChange = ((afterTotal - beforeTotal) / beforeTotal) * 100
      totalChanges.push(pctChange)
    }
  }

  if (totalChanges.length < MIN_PATTERN_FREQUENCY) return

  const increases = totalChanges.filter((c) => c > 2) // More than 2% increase
  const decreases = totalChanges.filter((c) => c < -2) // More than 2% decrease

  if (increases.length / totalChanges.length >= MIN_PATTERN_CONSISTENCY) {
    const avgIncrease = increases.reduce((s, v) => s + v, 0) / increases.length
    patterns.push({
      type: 'price_increase' as LearningPatternType,
      field: 'total',
      direction: 'increase',
      frequency: increases.length,
      avgMagnitude: Math.round(avgIncrease * 10) / 10,
      description: `Business typically increases total by ~${Math.round(avgIncrease)}%`,
    })
  }

  if (decreases.length / totalChanges.length >= MIN_PATTERN_CONSISTENCY) {
    const avgDecrease = Math.abs(decreases.reduce((s, v) => s + v, 0) / decreases.length)
    patterns.push({
      type: 'price_decrease' as LearningPatternType,
      field: 'total',
      direction: 'decrease',
      frequency: decreases.length,
      avgMagnitude: Math.round(avgDecrease * 10) / 10,
      description: `Business typically decreases total by ~${Math.round(avgDecrease)}%`,
    })
  }
}

function detectItemPatterns(amendments: AmendmentRow[], patterns: LearningPattern[]) {
  // Track which labels get added or removed frequently
  const addedLabels: Record<string, number> = {}
  const removedLabels: Record<string, number> = {}

  for (const a of amendments) {
    const changes = a.changes_json || []
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
}

function detectContentPatterns(amendments: AmendmentRow[], patterns: LearningPattern[]) {
  let scopeEditCount = 0
  let noteAdditionCount = 0

  for (const a of amendments) {
    const changes = a.changes_json || []
    for (const change of changes) {
      if (change.field === 'content' && change.path === 'scopeSummary' && change.type === 'modified') {
        scopeEditCount++
      }
      if (change.field === 'content' && change.path === 'notes' && (change.type === 'added' || change.type === 'modified')) {
        noteAdditionCount++
      }
    }
  }

  if (scopeEditCount >= MIN_PATTERN_FREQUENCY) {
    patterns.push({
      type: 'scope_edit' as LearningPatternType,
      field: 'scopeSummary',
      frequency: scopeEditCount,
      description: 'Business frequently edits the scope summary',
    })
  }

  if (noteAdditionCount >= MIN_PATTERN_FREQUENCY) {
    patterns.push({
      type: 'note_addition' as LearningPatternType,
      field: 'notes',
      frequency: noteAdditionCount,
      description: 'Business frequently adds or edits notes',
    })
  }
}

function generatePromptContext(patterns: LearningPattern[]): string {
  const lines = ["This business's editing patterns:"]

  for (const p of patterns) {
    lines.push(`- ${p.description} (seen ${p.frequency} times)`)
  }

  return lines.join('\n')
}
