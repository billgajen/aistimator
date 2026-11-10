/**
 * T-123 measurement memory: every confirmed quantity is a calibration
 * example (what the AI measured vs what a human says is true). Shared by the
 * customer's clarification and the business app's on-site confirmation (a
 * business measuring on site is the best example there is).
 * Fire-and-forget: failures never affect the confirmation flow.
 */

import type { createAdminClient } from '@/lib/supabase/server'

export async function recordMeasurementExamples(
  supabase: ReturnType<typeof createAdminClient>,
  quote: {
    tenant_id: string
    service_id: string
    clarification_questions_json: unknown
    signals_json: unknown
    /** T-153: a visitor's demo answers never become the demo business's calibration */
    is_demo?: boolean | null
  },
  answers: Array<{ questionId: string; answer: string }>
): Promise<void> {
  if (quote.is_demo) return
  try {
    const questions = (quote.clarification_questions_json || []) as Array<{ id: string; targetSignalKey: string }>
    const signals = ((quote.signals_json as { signals?: Array<{ key: string; value: unknown }> } | null)?.signals) || []
    const examples = answers
      .map((answer) => {
        const question = questions.find((q) => q.id === answer.questionId)
        if (!question?.targetSignalKey) return null
        const signal = signals.find((s) => s.key === question.targetSignalKey)
        const measured = Number(String(signal?.value ?? '').replace(/,/g, ''))
        const confirmed = Number(String(answer.answer).replace(/,/g, ''))
        if (!Number.isFinite(measured) || measured <= 0) return null
        if (!Number.isFinite(confirmed) || confirmed <= 0) return null
        return {
          tenant_id: quote.tenant_id,
          service_id: quote.service_id,
          signal_key: question.targetSignalKey,
          measured_value: measured,
          confirmed_value: confirmed,
          // On-site business answers are a clarification round too (the
          // column allows 'clarification' | 'amendment')
          source: 'clarification' as const,
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    if (examples.length > 0) {
      const { error } = await supabase.from('measurement_examples').insert(examples)
      if (error) console.error('[MeasurementMemory] Failed to store examples:', error.message)
      else console.log(`[MeasurementMemory] Stored ${examples.length} example(s)`)
    }
  } catch (memoryError) {
    console.error('[MeasurementMemory] Capture failed:', memoryError)
  }
}
