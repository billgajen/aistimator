/**
 * T-210: the business a test call is about, read from its own configuration.
 *
 * Everything she can say about a business comes from here: its services (name, description,
 * what is and is not included, the questions its request form asks), its service area, its
 * standard terms, its region and time zone. Nothing about any trade is written in this file.
 *
 * Read only. The service rows, rules and questions kept beside each service are what the pricing
 * worker is sent for an estimate (the same three things "Test your pricing" sends); they are
 * never given to the model.
 */
import { getRegion, readAreaEntry } from '@qolumns/shared'
import type { ExpectedSignalConfig, RegionCode, WidgetField, WorkStepConfig } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { knownTimeZone } from './slots'

type Admin = ReturnType<typeof createAdminClient>

/** The columns of a service the pricing worker prices from (its own list, apps/worker quote-processor) */
const SERVICE_COLUMNS =
  'id, name, description, scope_includes, scope_excludes, default_assumptions, media_config, prompt_context, expected_signals, work_steps, low_confidence_mode, confidence_threshold, high_value_threshold, draft_config, tax_exempt, auto_send, hold_until_approved'

export interface VoiceQuestion {
  id: string
  question: string
  type: WidgetField['type']
  required: boolean
  /** For a choice: what the customer can pick, as [value, label] */
  choices: Array<{ value: string; label: string }>
  help: string | null
}

export interface VoiceService {
  id: string
  name: string
  description: string | null
  included: string[]
  notIncluded: string[]
  assumptions: string[]
  /** The questions this service's request form asks */
  questions: VoiceQuestion[]
  /** Sizes the customer's photos normally give: there are no photos on a call, so a customer can state one */
  measurements: Array<{ id: string; what: string; unit: string | null }>
  /** For the pricing worker only */
  row: Record<string, unknown>
  rules: unknown
  fields: WidgetField[]
}

export interface VoiceBusiness {
  id: string
  name: string
  region: RegionCode
  locale: string
  languageVariant: string
  emergencyNumber: string
  timeZone: string
  currency: string
  serviceArea: { everywhere: boolean; areas: string[]; postalCodeLabel: string }
  /** The business's standard terms, as it wrote them. Null when it wrote none. */
  terms: string | null
  services: VoiceService[]
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()) : [])

/** The sizes a service prices from that no question asks for (the request's photos give them) */
export function measurementsOf(steps: readonly WorkStepConfig[], signals: readonly ExpectedSignalConfig[], fields: readonly WidgetField[]): VoiceService['measurements'] {
  const asked = new Set<string>()
  for (const f of fields) {
    asked.add(f.fieldId)
    if (f.mapsToSignal) asked.add(f.mapsToSignal)
  }
  const out: VoiceService['measurements'] = []
  for (const step of steps) {
    const key = step.quantitySource?.type === 'ai_signal' ? step.quantitySource.signalKey : undefined
    if (!key || asked.has(key) || out.some((m) => m.id === key)) continue
    const signal = signals.find((s) => s.signalKey === key)
    out.push({ id: key, what: signal?.description || step.name, unit: signal?.unit ?? step.unitLabel ?? null })
  }
  return out
}

export const questionsOf = (fields: readonly WidgetField[]): VoiceQuestion[] =>
  fields.map((f) => ({ id: f.fieldId, question: f.label, type: f.type, required: f.required === true, choices: (f.options ?? []).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) })), help: f.helpText ?? null }))

/** One business with its active services, or null when there is no such business */
export async function loadVoiceBusiness(admin: Admin, tenantId: string): Promise<VoiceBusiness | null> {
  const [{ data: tenant }, { data: services }, { data: rules }, { data: configs }] = await Promise.all([
    admin.from('tenants').select('id, name, region, currency, time_zone, service_area_mode, service_area_values, default_terms_text').eq('id', tenantId).maybeSingle(),
    admin.from('services').select(SERVICE_COLUMNS).eq('tenant_id', tenantId).eq('active', true).order('name'),
    admin.from('service_pricing_rules').select('service_id, rules_json').eq('tenant_id', tenantId),
    admin.from('widget_configs').select('service_id, config_json').eq('tenant_id', tenantId),
  ])
  const t = tenant as { id: string; name: string; region?: string | null; currency?: string | null; time_zone?: string | null; service_area_mode?: string | null; service_area_values?: unknown[] | null; default_terms_text?: string | null } | null
  if (!t) return null
  const region = getRegion(t.region)
  const fieldsFor = (serviceId: string): WidgetField[] => {
    const rows = (configs ?? []) as Array<{ service_id: string | null; config_json: { fields?: WidgetField[] } | null }>
    // the service's own form first, then the business's default one: the worker's rule
    const own = rows.find((c) => c.service_id === serviceId)?.config_json
    return (own ? own.fields : rows.find((c) => c.service_id === null)?.config_json?.fields) ?? []
  }
  const everywhere = !t.service_area_mode || t.service_area_mode === 'none'
  return {
    id: t.id,
    name: t.name,
    region: region.code,
    locale: region.locale,
    languageVariant: region.copy.languageVariant,
    emergencyNumber: region.emergencyNumber,
    timeZone: knownTimeZone(t.time_zone) ? t.time_zone : region.timeZone,
    currency: t.currency || region.currency,
    serviceArea: {
      everywhere,
      areas: everywhere ? [] : (t.service_area_values ?? []).map((entry) => readAreaEntry(entry, region.areas)?.text).filter((text): text is string => !!text),
      postalCodeLabel: region.copy.postalCodeLabel,
    },
    terms: t.default_terms_text?.trim() || null,
    services: ((services ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
      const fields = fieldsFor(String(row.id))
      return {
        id: String(row.id),
        name: String(row.name),
        description: typeof row.description === 'string' && row.description.trim() ? row.description.trim() : null,
        included: strings(row.scope_includes),
        notIncluded: strings(row.scope_excludes),
        assumptions: strings(row.default_assumptions),
        questions: questionsOf(fields),
        measurements: measurementsOf((row.work_steps as WorkStepConfig[] | null) ?? [], (row.expected_signals as ExpectedSignalConfig[] | null) ?? [], fields),
        row,
        rules: ((rules ?? []) as Array<{ service_id: string; rules_json: unknown }>).find((r) => r.service_id === row.id)?.rules_json ?? null,
        fields,
      }
    }),
  }
}
