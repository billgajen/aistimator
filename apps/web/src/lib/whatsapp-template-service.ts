/**
 * T-176: creating the business's message template and reading Meta's review
 * of it — server only. T-177: there is no button. The template is looked for
 * when a business connects and created only if Meta has none with our name
 * (`ensureEstimateTemplate`); the page only reads its status. Every function takes the service-role client and a
 * tenant id the caller has already authorised (the signed-in user's own).
 *
 * Nothing is stored: Meta is the record. The status is read from Meta each
 * time, because Meta changes it (approves, rejects, pauses) without telling us.
 * No token is logged or returned.
 */
import { getRegion } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/whatsapp-crypto'
import { GraphError, META_ERROR, createTemplate, templatesNamed, type MetaTemplate } from '@/lib/whatsapp-graph'
import { ESTIMATE_TEMPLATE_NAME, estimateTemplateDefinition, pickTemplate, templateLanguage, templateView, type TemplateView } from '@/lib/whatsapp-templates'

type Admin = ReturnType<typeof createAdminClient>

export type TemplateResult =
  | { ok: true; template: TemplateView; problem: string | null }
  | { ok: false; status: number; code: string; message: string }

const fail = (status: number, code: string, message: string): TemplateResult => ({ ok: false, status, code, message })

/** The public address, for the sample link shown beside the wording (never a real customer's link) */
const sampleLink = () => `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}/q/…`
/** Meta requires an example of the variable when the template is created: a link of the right shape, to nothing */
const exampleLink = () => `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}/q/example?token=example`

interface Account {
  token: string
  wabaId: string
  businessId: string | null
  businessName: string
  language: string
}

/** The business's WhatsApp account, when it has one that can hold templates (a connection made through Meta) */
async function account(admin: Admin, tenantId: string): Promise<Account | null> {
  const { data: row } = await admin
    .from('whatsapp_configs')
    .select('access_token_encrypted, waba_id, business_id, connection_method')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const config = row as { access_token_encrypted: string; waba_id: string | null; business_id: string | null; connection_method: string } | null
  if (!config || config.connection_method !== 'embedded' || !config.waba_id) return null
  const { data: tenant } = await admin.from('tenants').select('name, region').eq('id', tenantId).maybeSingle()
  const t = tenant as { name: string; region?: string | null } | null
  if (!t) return null
  return {
    token: decryptSecret(config.access_token_encrypted),
    wabaId: config.waba_id,
    businessId: config.business_id,
    businessName: t.name,
    language: templateLanguage(getRegion(t.region).locale),
  }
}

const view = (acc: Account, found: MetaTemplate | null): TemplateView =>
  templateView({ found, businessName: acc.businessName, language: acc.language, sampleLink: sampleLink(), wabaId: acc.wabaId, businessId: acc.businessId })

/** What to log about a failure: Meta's status and code, never a message we did not write */
function describe(error: unknown): string {
  if (error instanceof GraphError) return `Meta HTTP ${error.status}, code ${error.code ?? 'none'}`
  return error instanceof Error ? error.name : 'unknown error'
}

function metaProblem(error: unknown): string {
  if (error instanceof GraphError && error.code === META_ERROR.TOKEN) return 'Meta says the connection has expired or was removed. Reconnect WhatsApp, then try again.'
  if (error instanceof GraphError && error.status === 0) return 'Meta could not be reached. Try again in a minute.'
  return `Meta did not answer as expected${error instanceof GraphError && error.code ? ` (code ${error.code})` : ''}. Try again in a minute.`
}

/** The template as Meta has it now: not made yet, in review, approved, rejected, … */
export async function loadEstimateTemplate(admin: Admin, tenantId: string): Promise<TemplateResult> {
  let acc: Account | null
  try {
    acc = await account(admin, tenantId)
  } catch {
    return fail(500, 'INTERNAL_ERROR', 'Could not read the WhatsApp connection.')
  }
  if (!acc) return fail(404, 'NOT_CONNECTED', 'Connect WhatsApp first. Templates belong to the WhatsApp account you connect.')
  try {
    const found = pickTemplate(await templatesNamed(acc.token, acc.wabaId, ESTIMATE_TEMPLATE_NAME), acc.language)
    return { ok: true, template: view(acc, found), problem: null }
  } catch (error) {
    console.error(`[WhatsApp template] could not read the template: ${describe(error)}`)
    return fail(502, 'META_REFUSED', metaProblem(error))
  }
}

/**
 * T-177: make sure the business has the template, with no button. Called when
 * a business connects (and reconnects):
 *   - Meta already lists a template with our name, in any language and any
 *     state: that one is used. NOTHING is created.
 *   - Meta lists none: it is created, and Meta reviews the wording.
 * `created` says which happened. Reading it for the page (`loadEstimateTemplate`)
 * never creates anything.
 */
export async function ensureEstimateTemplate(admin: Admin, tenantId: string): Promise<TemplateResult & { created?: boolean }> {
  let acc: Account | null
  try {
    acc = await account(admin, tenantId)
  } catch {
    return fail(500, 'INTERNAL_ERROR', 'Could not read the WhatsApp connection.')
  }
  if (!acc) return fail(404, 'NOT_CONNECTED', 'Connect WhatsApp first. Templates belong to the WhatsApp account you connect.')
  try {
    const existing = pickTemplate(await templatesNamed(acc.token, acc.wabaId, ESTIMATE_TEMPLATE_NAME), acc.language)
    if (existing) return { ok: true, template: view(acc, existing), problem: null, created: false }
  } catch (error) {
    // Meta could not be asked: do NOT create blind, or a second one could be made
    console.error(`[WhatsApp template] could not read the template: ${describe(error)}`)
    return fail(502, 'META_REFUSED', metaProblem(error))
  }
  const definition = estimateTemplateDefinition({ businessName: acc.businessName, language: acc.language, exampleLink: exampleLink() })
  try {
    const created = await createTemplate(acc.token, acc.wabaId, definition)
    const made: MetaTemplate = {
      id: created.id,
      name: definition.name,
      language: definition.language,
      status: created.status,
      category: created.category,
      rejectedReason: null,
      bodyText: definition.components[0]?.text ?? null,
    }
    return { ok: true, template: view(acc, made), problem: null, created: true }
  } catch (error) {
    console.error(`[WhatsApp template] Meta refused the template: ${describe(error)}`)
    // Meta says "already exists" with a code it shares with other refusals: look again before reporting a failure
    try {
      const now = pickTemplate(await templatesNamed(acc.token, acc.wabaId, ESTIMATE_TEMPLATE_NAME), acc.language)
      if (now) return { ok: true, template: view(acc, now), problem: null, created: false }
    } catch {
      // the first refusal is the one to report
    }
    return fail(error instanceof GraphError && error.status === 0 ? 502 : 422, 'META_REFUSED', `Meta did not accept the template${error instanceof GraphError && error.code ? ` (code ${error.code})` : ''}. Nothing was created.`)
  }
}

/**
 * The approved template to send with, or null. Read with a token the caller
 * already holds (the approval path), so the token is decrypted once.
 */
export async function approvedEstimateTemplate(token: string, wabaId: string, language: string): Promise<{ name: string; language: string } | null> {
  const found = pickTemplate(await templatesNamed(token, wabaId, ESTIMATE_TEMPLATE_NAME), language)
  return found && found.status === 'APPROVED' ? { name: found.name, language: found.language } : null
}
