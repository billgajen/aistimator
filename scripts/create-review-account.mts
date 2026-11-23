// T-191: the App Store reviewer's sign-in. One test business with two services and three sample quotes, so a
// reviewer who signs into the app sees a real-looking account.
//
//   Local:       npx tsx scripts/create-review-account.mts
//   Production:  npx tsx scripts/create-review-account.mts --prod
//   New password for the account that exists:   add --new-password
//   A second reviewer's account (T-199, Google Play):   add --email-name=review --one-service
//     --email-name=<name>   the sign-in is <name>@<APP_DOMAIN> instead of the App Store one
//     --one-service         the first service only, and the two sample quotes that are for it
//
// What it makes:
//   - a user with a random password, its email already confirmed. Creating the user makes its business, as
//     sign-up does (the handle_new_user trigger);
//   - the business: invented name, US, set up (no setup wizard), no notification email, so nothing is ever
//     emailed for it;
//   - two services from the US trade packs, exactly as setup builds them (servicePayload);
//   - a FREE TEST PLAN (a subscriptions row with no Stripe customer, as scripts/set-test-plan.sh makes): never
//     billed, never counted as revenue;
//   - three sample quotes from invented customers (one waiting for approval, one sent, one accepted). Their
//     lines are the services' own prices at the sample sizes (lib/sample-price.ts, the "Test & Publish"
//     sample). No model is asked, the worker is not used, no email or message is sent.
//
// The sign-in details are printed once, here, and are not written anywhere. Keep them for App Store Connect
// ("App Review Information", sign-in required). Production's service key is read through the Supabase
// management API with the keychain token "Supabase CLI", as scripts/seed-demo-tenant.mts does; it is never
// printed or written to disk.
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { loadEnv, http } from './hardcore-test/lib.mjs'
import { servicePayload } from '../apps/web/src/lib/onboarding-service'
import { serviceInsertRow, pricingRulesRow, widgetConfigRow, type ServiceCreateBody } from '../apps/web/src/lib/service-rows'
import { samplePrice } from '../apps/web/src/lib/sample-price'
import { paintingPackUS } from '../apps/web/src/lib/vertical-packs/painting-us'
import { garageDoorsPackUS } from '../apps/web/src/lib/vertical-packs/garage-doors-us'
import { APP_DOMAIN } from '../packages/shared/src/brand'
import { reviewAccountQuotes, REVIEW_ACCOUNT, reviewLabel } from '../packages/shared/src/review-account'

const PROJECT_REF = 'ygsuzeveesgrafgpkrev'
const prod = process.argv.includes('--prod')
const newPassword = process.argv.includes('--new-password')
const oneService = process.argv.includes('--one-service')
const emailName = process.argv.find((a) => a.startsWith('--email-name='))?.slice('--email-name='.length) ?? REVIEW_ACCOUNT.emailLocalPart
if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(emailName)) throw new Error('--email-name takes lower case letters, digits and hyphens only')

async function target(): Promise<{ url: string; key: string; label: string }> {
  if (!prod) {
    const cfg = loadEnv()
    if (!/127\.0\.0\.1|localhost/.test(cfg.supabaseUrl)) throw new Error('Without --prod this runs on the local database only, and the local settings name another one: stopping')
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
async function call(method: string, path: string, body?: unknown, prefer = 'return=representation') {
  const res = await http(method, `${t.url}${path}`, { headers: { ...headers, Prefer: prefer }, body })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} failed (HTTP ${res.status}): ${JSON.stringify(res.json ?? res.text).slice(0, 300)}`)
  return res.json as unknown
}
const rest = (method: string, path: string, body?: unknown, prefer?: string) => call(method, `/rest/v1/${path}`, body, prefer) as Promise<Array<Record<string, unknown>> | null>

const email = `${emailName}@${APP_DOMAIN}`
const password = `${randomBytes(9).toString('base64url')}-${randomBytes(9).toString('base64url')}`
console.log(`App Store review account on ${t.label}`)

// 0. Is there one already?
const users = (await call('GET', `/auth/v1/admin/users?per_page=1000`)) as { users?: Array<{ id: string; email?: string }> }
const existing = users.users?.find((u) => u.email?.toLowerCase() === email)
if (existing) {
  if (!newPassword) {
    console.log(`  It exists already (${email}). Nothing changed. To give it a new password, run again with --new-password.`)
    process.exit(0)
  }
  await call('PUT', `/auth/v1/admin/users/${existing.id}`, { password })
  await checkSignIn()
  printOnce(email, password)
  process.exit(0)
}

// 1. The user; the trigger makes its business, as sign-up does
const user = (await call('POST', '/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { business_name: REVIEW_ACCOUNT.businessName } })) as { id: string }
const profile = (await rest('GET', `user_profiles?id=eq.${user.id}&select=tenant_id`))?.[0]
const tenantId = profile?.tenant_id as string | undefined
if (!tenantId) throw new Error('The business was not made for the new user')
console.log(`  user and business ${tenantId}`)

// 2. The business, set up: US, no emails, no setup wizard
const now = new Date().toISOString()
await rest('PATCH', `tenants?id=eq.${tenantId}`, {
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
})

// 3. Two services from the packs, as setup builds them
const picks = [
  { pack: paintingPackUS, name: 'Interior Painting' },
  { pack: garageDoorsPackUS, name: 'Garage Door Spring Replacement' },
].slice(0, oneService ? 1 : 2)
const made: Array<{ id: string; body: ServiceCreateBody }> = []
for (const { pack, name } of picks) {
  const svc = pack.services.find((s) => s.name === name)
  if (!svc) throw new Error(`Pack ${pack.id} has no service "${name}"`)
  const body: ServiceCreateBody = { ...servicePayload({ ...svc, addons: svc.addons ?? [], multipliers: svc.multipliers ?? [] }), autoSend: false, holdUntilApproved: false }
  const id = (await rest('POST', 'services', serviceInsertRow(tenantId, body)))?.[0]?.id as string
  await rest('POST', 'service_pricing_rules', pricingRulesRow(tenantId, id, body))
  const widget = widgetConfigRow(tenantId, id, body)
  if (widget) await rest('POST', 'widget_configs', widget)
  made.push({ id, body })
  console.log(`  service ${body.name}`)
}

// 4. A free test plan: no Stripe customer, so never billed and not revenue
await rest('POST', 'subscriptions?on_conflict=tenant_id', { tenant_id: tenantId, plan_id: REVIEW_ACCOUNT.planId, status: 'active', stripe_customer_id: null, stripe_subscription_id: null }, 'resolution=merge-duplicates,return=representation')
console.log(`  free test plan ${REVIEW_ACCOUNT.planId}`)

// 5. Three sample quotes, priced from the services' own prices at the sample sizes
for (const sample of reviewAccountQuotes(new Date()).filter((q) => q.service < made.length)) {
  const { id: serviceId, body } = made[sample.service]!
  const rules = body.pricingRules ?? {}
  const result = samplePrice(
    {
      baseFee: rules.baseFee ?? 0,
      minimumCharge: rules.minimumCharge ?? 0,
      workSteps: rules.workSteps ?? body.workSteps ?? [],
      multipliers: rules.multipliers ?? [],
      suggestedFields: (body.suggestedFields ?? body.draftConfig?.suggestedFields ?? []) as never,
      expectedSignals: body.expectedSignals ?? [],
    },
    {},
    '$'
  )
  const breakdown = result.lineItems.filter((l) => l.amount !== null).map((l) => ({ label: reviewLabel(l.name, l.calculation), amount: l.amount as number }))
  const total = result.subtotal
  const request = (await rest('POST', 'quote_requests', {
    tenant_id: tenantId,
    service_id: serviceId,
    customer_name: sample.customer.name,
    customer_email: sample.customer.email,
    job_address: sample.customer.address,
    source_json: { type: 'app_review_sample' },
  }))?.[0]
  await rest('POST', 'quotes', {
    tenant_id: tenantId,
    quote_request_id: request?.id,
    service_id: serviceId,
    customer_json: { name: sample.customer.name, email: sample.customer.email, address: sample.customer.address },
    pricing_json: { currency: 'USD', subtotal: total, taxRate: 0, taxAmount: 0, total, breakdown },
    content_json: { scopeSummary: body.name, assumptions: [], exclusions: [], notes: [], validityDays: 30 },
    status: sample.status,
    created_at: sample.createdAt,
    sent_at: sample.sentAt,
    viewed_at: sample.viewedAt,
    accepted_at: sample.acceptedAt,
  })
  console.log(`  quote for ${sample.customer.name}: ${sample.status}, $${total.toFixed(2)}`)
}

await checkSignIn()
printOnce(email, password)

// The reviewer's first step: the email and the new password sign in
async function checkSignIn() {
  await call('POST', '/auth/v1/token?grant_type=password', { email, password })
  console.log('  sign-in checked: the email and the password work')
}

function printOnce(address: string, secret: string) {
  console.log('\n  Sign-in for the store reviewer (shown once, not saved anywhere):')
  console.log(`    email     ${address}`)
  console.log(`    password  ${secret}`)
}
