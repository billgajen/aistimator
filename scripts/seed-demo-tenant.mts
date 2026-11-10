// T-153: create or refresh the public demo business ("Example Home Services").
// Idempotent: re-running updates the tenant and its three services to the
// current pack prices and settings; it never creates a second demo business.
//
//   Local:       npx tsx scripts/seed-demo-tenant.mts
//   Production:  npx tsx scripts/seed-demo-tenant.mts --prod
//                (service key fetched through the Supabase management API with
//                 the keychain token "Supabase CLI", same as deploy-migration-*.sh;
//                 it is never written to disk)
//
// The demo tenant has no user and no owner or notification email, so nobody can
// sign into it and nothing is ever emailed. Its services are created with the
// same rows POST /api/services writes (apps/web/src/lib/service-rows.ts), from
// the packs exactly as setup does (apps/web/src/lib/demo/demo-services.ts).
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { loadEnv, http } from './hardcore-test/lib.mjs'
import { demoServiceBodies } from '../apps/web/src/lib/demo/demo-services'
import { serviceInsertRow, pricingRulesRow, widgetConfigRow } from '../apps/web/src/lib/service-rows'
import { DEMO_TENANT_ID, DEMO_BUSINESS_NAME, DEMO_SLUG, DEMO_PRIMARY_COLOR, DEMO_MAX_PHOTOS } from '../packages/shared/src/demo'

const PROJECT_REF = 'ygsuzeveesgrafgpkrev'
const prod = process.argv.includes('--prod')

async function target(): Promise<{ url: string; key: string; label: string }> {
  if (!prod) {
    const cfg = loadEnv()
    return { url: cfg.supabaseUrl, key: cfg.serviceKey, label: `local (${cfg.supabaseUrl})` }
  }
  const token = execSync("security find-generic-password -s 'Supabase CLI' -w", { encoding: 'utf8' }).trim()
  const res = await http('GET', `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } })
  const key = (res.json as Array<{ name: string; api_key: string }> | null)?.find((k) => k.name === 'service_role')?.api_key
  if (!res.ok || !key) throw new Error(`Could not read the service key (HTTP ${res.status})`)
  return { url: `https://${PROJECT_REF}.supabase.co`, key, label: `production (${PROJECT_REF})` }
}

const t = await target()
const headers = { apikey: t.key, Authorization: `Bearer ${t.key}` }
async function rest(method: string, path: string, body?: unknown, prefer = 'return=representation') {
  const res = await http(method, `${t.url}/rest/v1/${path}`, { headers: { ...headers, Prefer: prefer }, body })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} failed (HTTP ${res.status}): ${JSON.stringify(res.json ?? res.text).slice(0, 400)}`)
  return res.json as Array<Record<string, unknown>> | null
}

console.log(`Seeding the demo business on ${t.label}`)

// 1. The tenant: invented name, our own colour and logo, no owner, no emails
const now = new Date().toISOString()
await rest('POST', 'tenants?on_conflict=id', {
  id: DEMO_TENANT_ID,
  name: DEMO_BUSINESS_NAME,
  slug: DEMO_SLUG,
  is_demo: true,
  region: 'US',
  currency: 'USD',
  tax_enabled: false,
  tax_rate: 0,
  service_area_mode: 'none',
  service_area_values: [],
  notification_email: null,
  benchmarks_opt_in: false,
  contact_requirement: 'email',
  prices_checked_at: now,
  onboarding_skipped_at: now,
  branding_json: {
    logoAssetId: null, // the widget serves DEMO_LOGO_PATH for the demo business
    primaryColor: DEMO_PRIMARY_COLOR,
    footerNotes: 'This is an example business with example prices.',
    tagline: 'An example business with example prices',
    phone: null,
    email: null,
    website: null,
  },
}, 'resolution=merge-duplicates,return=representation')
console.log(`  tenant ${DEMO_TENANT_ID} (${DEMO_SLUG})`)

// 2. Its widget key (kept once created, so /demo links stay stable)
const sites = await rest('GET', `tenant_sites?tenant_id=eq.${DEMO_TENANT_ID}&select=tenant_key,is_active`)
let tenantKey = sites?.[0]?.tenant_key as string | undefined
if (!tenantKey) {
  tenantKey = `tkey_demo_${randomBytes(12).toString('hex')}`
  await rest('POST', 'tenant_sites', { tenant_id: DEMO_TENANT_ID, domain: 'demo', tenant_key: tenantKey, is_active: true })
} else if (!sites?.[0]?.is_active) {
  await rest('PATCH', `tenant_sites?tenant_id=eq.${DEMO_TENANT_ID}`, { is_active: true })
}
console.log(`  widget key ${tenantKey}`)

// 3. The three services, from the packs
const existing = (await rest('GET', `services?tenant_id=eq.${DEMO_TENANT_ID}&select=id,name`)) ?? []
const keep: string[] = []
for (const body of demoServiceBodies({ maxPhotos: DEMO_MAX_PHOTOS })) {
  const row = serviceInsertRow(DEMO_TENANT_ID, body)
  let serviceId = existing.find((s) => s.name === row.name)?.id as string | undefined
  if (serviceId) {
    const { tenant_id: _tenant, ...update } = row
    void _tenant
    await rest('PATCH', `services?id=eq.${serviceId}&tenant_id=eq.${DEMO_TENANT_ID}`, update)
    await rest('DELETE', `service_pricing_rules?service_id=eq.${serviceId}&tenant_id=eq.${DEMO_TENANT_ID}`)
    await rest('DELETE', `widget_configs?service_id=eq.${serviceId}&tenant_id=eq.${DEMO_TENANT_ID}`)
  } else {
    serviceId = (await rest('POST', 'services', row))?.[0]?.id as string
  }
  await rest('POST', 'service_pricing_rules', pricingRulesRow(DEMO_TENANT_ID, serviceId, body))
  const widget = widgetConfigRow(DEMO_TENANT_ID, serviceId, body)
  if (widget) await rest('POST', 'widget_configs', widget)
  keep.push(serviceId)
  console.log(`  service ${row.name} (${serviceId}), photos ${row.media_config.minPhotos}–${row.media_config.maxPhotos}, sends automatically`)
}
for (const s of existing) {
  if (!keep.includes(s.id as string)) await rest('PATCH', `services?id=eq.${s.id}`, { active: false })
}

console.log(`Done. /demo now uses ${DEMO_BUSINESS_NAME}.`)
