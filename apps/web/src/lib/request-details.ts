/**
 * T-178: what the customer sent with a request, in the business's own
 * question wording, for the dashboard quote page.
 *
 * A request that could not be priced has no estimate to show; the business
 * needs the customer's answers to quote it by hand. Pure: the route reads the
 * rows, this shapes them.
 */
import type { RequestDetails } from '@qolumns/shared'
import { DESCRIPTION_FIELD } from '@/lib/service-match'

type Answer = { fieldId?: unknown; value?: unknown }
type Field = { fieldId?: string; label?: string; serviceId?: string | null }
export type FieldRow = { service_id: string | null; config_json: { fields?: Field[] } | null }

const text = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((v) => text(v)).filter(Boolean).join(', ')
  if (typeof value === 'object') return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

/** fieldId → the question as the business worded it, from the rows the form itself reads */
export function fieldLabels(rows: FieldRow[] | null | undefined, serviceId: string | null): Map<string, string> {
  const labels = new Map<string, string>()
  for (const row of rows ?? []) {
    for (const field of row.config_json?.fields ?? []) {
      if (!field.fieldId || !field.label) continue
      const applies = row.service_id === null ? !field.serviceId || field.serviceId === serviceId : row.service_id === serviceId
      if (applies && !labels.has(field.fieldId)) labels.set(field.fieldId, field.label)
    }
  }
  return labels
}

export function requestDetails(
  request: { job_answers?: unknown; job_postcode?: string | null; job_address?: string | null; job_quantity?: number | null } | null | undefined,
  labels: Map<string, string>
): RequestDetails {
  const answers = Array.isArray(request?.job_answers) ? (request.job_answers as Answer[]) : []
  const description = text(answers.find((a) => a.fieldId === DESCRIPTION_FIELD)?.value)
  const lines = answers
    // fields the app adds for itself (a leading underscore) are not the customer's answers
    .filter((a) => typeof a.fieldId === 'string' && !a.fieldId.startsWith('_'))
    .map((a) => ({ label: labels.get(a.fieldId as string) ?? (a.fieldId as string), value: text(a.value) }))
    .filter((a) => a.value !== '')
  return {
    description: description || null,
    answers: lines,
    postcode: text(request?.job_postcode) || null,
    address: text(request?.job_address) || null,
    quantity: typeof request?.job_quantity === 'number' ? request.job_quantity : null,
  }
}
