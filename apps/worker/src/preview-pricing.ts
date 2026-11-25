/**
 * T-204: the price on a service's "Test & Publish" step, worked out by the
 * same pipeline as a customer's request.
 *
 * Before this the dashboard had its own small copy of the pricing maths for
 * that step. The copy did not read a line's "only include when" condition, a
 * formula ("each additional …") or "left empty = 0", so a business testing a
 * service it had described in words saw every conditional line charged. The
 * real quotes were right; the test was wrong.
 *
 * Now the web app sends the service as the editor holds it (saved or not) and
 * the sample answers, and this runs `processQuote` in preview mode: the form
 * answers become facts exactly as they do for a request, the rules engine
 * prices them, and it stops there. No AI is asked, no photo is read, nothing
 * is written, sent or counted, and no quote exists.
 *
 * A detail the photos would give (a size read from a label, a measured area)
 * is sent as an answer under that detail's key, which is how a customer's own
 * statement of it arrives too. A line that is measured from photos and has no
 * size to try is left out of the sum and named in `unmeasured`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WidgetField } from '@qolumns/shared'
import type { PricingRules } from './pricing/rules-engine'
import { roundMoney } from '@qolumns/shared'
import { processQuote } from './quote-processor'
import type { QuoteData } from './quote-processor'
import type { Env } from './index'

export interface PreviewInput {
  tenantId: string
  /** The service as its `services` row would hold it */
  service: QuoteData['service']
  /** Its pricing rules as `service_pricing_rules.rules_json` would hold them */
  rules: PricingRules
  /** Its questions as the customer's form would hold them */
  fields: WidgetField[]
  answers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
}

export interface PreviewLine {
  label: string
  amount: number
  kind?: 'minimum'
  minimumCharge?: number
}

export type PreviewResult =
  | {
      ok: true
      currency: string
      lines: PreviewLine[]
      subtotal: number
      taxLabel?: string
      taxRate?: number
      taxAmount: number
      total: number
      notes: string[]
      /** How each line was reached, in the engine's own words */
      steps: Array<{ type: string; id?: string; description: string; calculation: string; amount: number }>
      /** Lines priced from the customer's photos that had no size to try: left out of the sum */
      unmeasured: Array<{ stepId: string; name: string; rate: number; unitLabel: string | null }>
    }
  | { ok: false; reason: 'no_business' | 'failed' }

const TENANT_COLUMNS = 'id, name, region, unit_system, currency, tax_enabled, tax_label, tax_rate, branding_json, notification_email, is_demo'

export async function previewPrice(supabase: SupabaseClient, env: Env, input: PreviewInput): Promise<PreviewResult> {
  try {
    const { data: tenant } = await supabase.from('tenants').select(TENANT_COLUMNS).eq('id', input.tenantId).single()
    if (!tenant) return { ok: false, reason: 'no_business' }

    const answers = (input.answers ?? []).filter((a) => a && typeof a.fieldId === 'string' && a.value !== undefined && a.value !== null && a.value !== '')
    const run = async (service: QuoteData['service'], rules: PricingRules) => {
      const data: QuoteData = {
        quote: {
          id: 'preview',
          tenant_id: input.tenantId,
          quote_request_id: 'preview',
          service_id: service.id,
          document_type: 'quote',
          customer_json: { name: 'Preview', email: '' },
          clarification_count: 0,
          clarification_questions_json: null,
          clarification_answers_json: null,
          signals_json: null,
          content_json: null,
          is_test: true,
          is_demo: false,
        },
        quoteRequest: { id: 'preview', customer_name: 'Preview', customer_email: null, job_answers: answers.map((a) => ({ ...a })), source_json: { type: 'preview' } },
        tenant: tenant as unknown as QuoteData['tenant'],
        service,
        otherServices: [],
        pricingRules: rules,
        widgetFields: input.fields ?? [],
        assets: [],
      }
      const result = await processQuote('preview', '', supabase, env, undefined, { preview: { data } })
      return result.success ? result.sectionRun ?? null : null
    }

    let service = { ...input.service, id: input.service.id || 'preview' }
    let rules = input.rules
    let priced = await run(service, rules)
    if (!priced) return { ok: false, reason: 'failed' }

    // A line the photos measure, with no size to try: it has no quantity, so it is left out
    // and the rest is priced again without it (the engine's own sum, not one worked out here)
    const missing = new Set(priced.missingQuantitySignals.map((m) => m.signalKey))
    const steps = service.work_steps ?? rules.workSteps ?? []
    const left = steps.filter((step) => step.quantitySource?.type === 'ai_signal' && step.quantitySource.signalKey && missing.has(step.quantitySource.signalKey))
    if (left.length > 0) {
      const kept = steps.filter((step) => !left.includes(step))
      service = { ...service, work_steps: kept }
      rules = { ...rules, workSteps: kept }
      priced = await run(service, rules)
      if (!priced) return { ok: false, reason: 'failed' }
    }

    const { pricing, pricingTrace } = priced
    return {
      ok: true,
      currency: pricing.currency,
      lines: pricing.breakdown.map((line) => ({
        label: line.label,
        amount: roundMoney(line.amount),
        ...(line.kind === 'minimum' && { kind: 'minimum' as const, minimumCharge: line.minimumCharge }),
      })),
      subtotal: roundMoney(pricing.subtotal),
      taxLabel: pricing.taxLabel,
      taxRate: pricing.taxRate,
      taxAmount: roundMoney(pricing.taxAmount),
      total: roundMoney(pricing.total),
      notes: pricing.notes ?? [],
      steps: (pricingTrace?.trace ?? []).map((step) => ({ type: step.type, id: step.id, description: step.description, calculation: step.calculation, amount: roundMoney(step.amount) })),
      unmeasured: left.map((step) => ({ stepId: step.id, name: step.name, rate: step.defaultCost, unitLabel: step.unitLabel ?? null })),
    }
  } catch (error) {
    console.error(`[Preview] Could not price a preview: ${error instanceof Error ? error.name : 'unknown error'}`)
    return { ok: false, reason: 'failed' }
  }
}
