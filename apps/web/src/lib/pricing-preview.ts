/**
 * T-204: the test price on a service's "Test & Publish" step.
 *
 * The price is worked out by the worker's own pipeline (its `/preview`
 * endpoint, apps/worker/src/preview-pricing.ts), from the service exactly as
 * the editor holds it. This file only prepares the request: the service's
 * rows as saving would write them (the same builders the save uses), and the
 * sample values turned into answers the way the customer's form sends them.
 *
 * Nothing here adds up a price. The page had its own copy of the maths before
 * this, and that copy ignored a line's condition, a formula and "left empty =
 * 0": it showed a business that every conditional line was always charged.
 *
 * Relative imports only: scripts load this with tsx.
 */
import type { ExpectedSignalConfig, WorkStepConfig } from '@qolumns/shared'
import { normalizeFieldOption } from './field-options'
import { pricingRulesRow, serviceInsertRow, widgetConfigRow, type ServiceCreateBody } from './service-rows'
import { sampleKey, sampleSize, type SampleValues } from './sample-price'

/** The key of a detail the customer's photos give (a label's reading), in the sample values */
export const photoKey = (signalKey: string): string => `photo:${signalKey}`

export type PreviewValues = Record<string, string | number | boolean | string[]>

export interface PreviewAnswer {
  fieldId: string
  value: string | number | boolean | string[]
}

type Field = NonNullable<ServiceCreateBody['suggestedFields']>[number]

/**
 * The details a customer's photos give that decide a price line, and that no
 * question asks: a size read from a label, a fuel, a type. On a real request
 * the AI reads them; here the business picks one to try.
 */
export function photoDetails(service: { workSteps: readonly WorkStepConfig[]; expectedSignals: readonly ExpectedSignalConfig[]; suggestedFields: readonly Pick<Field, 'fieldId' | 'mapsToSignal'>[] }): ExpectedSignalConfig[] {
  const asked = new Set<string>()
  for (const field of service.suggestedFields) {
    asked.add(field.fieldId)
    if (field.mapsToSignal) asked.add(field.mapsToSignal)
  }
  const deciding = new Set(service.workSteps.filter((step) => step.triggerSignal && !step.when?.fieldId).map((step) => step.triggerSignal!))
  return service.expectedSignals.filter((signal) => deciding.has(signal.signalKey) && !asked.has(signal.signalKey))
}

/**
 * The sample values as answers. An empty box is no answer (so "left empty"
 * is tried as left empty); a choice is sent by its key, as the form sends it;
 * a size to try and a detail from the photos are sent under their own key,
 * which is how a customer's own statement of them arrives.
 */
export function answersFromValues(
  service: { suggestedFields: readonly Field[]; expectedSignals: readonly ExpectedSignalConfig[]; workSteps: readonly WorkStepConfig[] },
  values: PreviewValues
): { answers: PreviewAnswer[]; sampled: Array<{ signalKey: string; size: number }> } {
  const answers: PreviewAnswer[] = []
  const sampled: Array<{ signalKey: string; size: number }> = []
  const empty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

  for (const field of service.suggestedFields) {
    const value = values[field.fieldId]
    if (empty(value)) continue
    if (field.type === 'number') {
      const typed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
      if (Number.isFinite(typed)) answers.push({ fieldId: field.fieldId, value: typed })
    } else if (field.type === 'boolean') {
      answers.push({ fieldId: field.fieldId, value: value === true || value === 'true' })
    } else if (Array.isArray(value)) {
      answers.push({ fieldId: field.fieldId, value: value.map((option) => normalizeFieldOption(option).value) })
    } else if (field.type === 'dropdown' || field.type === 'radio' || field.type === 'checkbox') {
      answers.push({ fieldId: field.fieldId, value: normalizeFieldOption(String(value)).value })
    } else {
      answers.push({ fieldId: field.fieldId, value: String(value) })
    }
  }

  const answered = new Set(answers.map((a) => a.fieldId))
  const measured = new Set<string>()
  for (const step of service.workSteps) {
    if (step.quantitySource?.type !== 'ai_signal' || !step.quantitySource.signalKey) continue
    const signalKey = step.quantitySource.signalKey
    if (measured.has(signalKey) || answered.has(signalKey)) continue
    measured.add(signalKey)
    const typed = Number(values[sampleKey(signalKey)])
    if (Number.isFinite(typed) && typed > 0) {
      answers.push({ fieldId: signalKey, value: typed })
      continue
    }
    // No size typed: a sample size from the service's own range, when it gives one
    const size = sampleSize(service.expectedSignals.find((s) => s.signalKey === signalKey), values as SampleValues)
    if (size !== null) {
      answers.push({ fieldId: signalKey, value: size })
      sampled.push({ signalKey, size })
    }
  }

  for (const signal of photoDetails(service)) {
    const value = values[photoKey(signal.signalKey)]
    if (empty(value) || answered.has(signal.signalKey)) continue
    if (signal.type === 'number') {
      const typed = Number(value)
      if (Number.isFinite(typed)) answers.push({ fieldId: signal.signalKey, value: typed })
    } else if (signal.type === 'boolean') {
      answers.push({ fieldId: signal.signalKey, value: value === true || value === 'true' })
    } else {
      answers.push({ fieldId: signal.signalKey, value: String(value) })
    }
  }
  return { answers, sampled }
}

export interface PreviewRequest {
  /** The service as the editor would save it */
  service: ServiceCreateBody
  values: PreviewValues
  /** The saved service being edited, when there is one */
  serviceId?: string
}

/** What the worker's /preview is sent */
export function previewInput(tenantId: string, request: PreviewRequest, taxExempt = false) {
  const body = request.service
  const fields = body.suggestedFields ?? body.draftConfig?.suggestedFields ?? []
  const row = serviceInsertRow(tenantId, body)
  const { answers, sampled } = answersFromValues({ suggestedFields: fields, expectedSignals: body.expectedSignals ?? [], workSteps: body.workSteps ?? [] }, request.values)
  return {
    input: {
      tenantId,
      service: { ...row, id: request.serviceId || 'preview', tax_exempt: taxExempt },
      rules: pricingRulesRow(tenantId, request.serviceId || 'preview', body).rules_json,
      fields: widgetConfigRow(tenantId, request.serviceId || 'preview', { ...body, suggestedFields: fields })?.config_json.fields ?? [],
      answers,
    },
    sampled,
  }
}

export interface PreviewLine {
  label: string
  amount: number
  kind?: 'minimum'
  minimumCharge?: number
}

export interface PreviewPrice {
  currency: string
  lines: PreviewLine[]
  subtotal: number
  taxLabel?: string
  taxRate?: number
  taxAmount: number
  total: number
  notes: string[]
  steps: Array<{ type: string; id?: string; description: string; calculation: string; amount: number }>
  unmeasured: Array<{ stepId: string; name: string; rate: number; unitLabel: string | null }>
}

export type WorkerPreview = ({ success: true } & PreviewPrice) | { success: false; reason: 'no_business' | 'failed' | 'unreachable' }

/** Ask the worker for the price. It answers within a second or two; it is deterministic and reads no photo. */
export async function previewPriceNow(input: unknown, { timeoutMs = 20_000 }: { timeoutMs?: number } = {}): Promise<WorkerPreview> {
  const workerUrl = process.env.CLOUDFLARE_WORKER_URL
  if (!workerUrl) return { success: false, reason: 'unreachable' }
  try {
    const token = process.env.CLOUDFLARE_WORKER_TOKEN
    const response = await fetch(`${workerUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const json = (await response.json().catch(() => null)) as WorkerPreview | null
    if (json && typeof json.success === 'boolean') return json
    return { success: false, reason: 'failed' }
  } catch (error) {
    console.error(`[Preview] The pricing worker did not answer: ${error instanceof Error ? error.name : 'unknown error'}`)
    return { success: false, reason: 'unreachable' }
  }
}
