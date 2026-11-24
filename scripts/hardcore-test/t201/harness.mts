// T-201: what the sections of verify-t201 share. Local stack only; no model is asked, no email is
// sent, nothing here touches production.
import { loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, shortId } from '../lib.mjs'

export type Row = Record<string, unknown>

const cfg = loadEnv()
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(cfg.supabaseUrl)) {
  console.error('This check runs on the local stack only.')
  process.exit(2)
}
const sb = makeSupabase(cfg)
const checks: Array<{ name: string; pass: boolean }> = []

/** One named check. `detail` is printed only when it fails. */
function check(name: string, pass: boolean, detail?: unknown) {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${!pass && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 500)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const rows = async (table: string, query: string) => (await sb.select(table, query)) as Row[]

/** A business that has finished sign-up (US, USD unless told otherwise), with its session cookie */
async function business(label: string, region: { region: string; currency: string } = { region: 'US', currency: 'USD' }) {
  const id = shortId()
  const email = `owner+t201-${label}-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const name = `Harlow ${label} ${id}`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok && setup.json?.tenantId ? setup.json.tenantId : (await rows('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0]?.tenant_id) as string
  expectOk(`${label} region`, await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { ...region, taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  return { cookie, tenantId, email, password, name, userId: user.id as string }
}

type Biz = Awaited<ReturnType<typeof business>>
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }

/** Change rows by hand, as the service role (a date moved back, a status set) */
const patch = (table: string, query: string, body: unknown) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=representation' }, body })

/** The key a request form sends for this business (its site on localhost) */
async function siteKey(biz: Biz): Promise<string> {
  const site = await sb.insert('tenant_sites', { tenant_id: biz.tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return site.tenant_key as string
}

/** A service priced from the form alone (no photo, no model): wall area at 18 a unit, trim at 7.35 */
const PAINT_STEPS = [
  { id: 'walls', name: 'Exterior walls', description: 'Prepare and paint the exterior walls', costType: 'per_unit', defaultCost: 18, optional: false, unitLabel: 'sq ft', quantitySource: { type: 'form_field', fieldId: 'wall_area' } },
  { id: 'trim', name: 'Trim and sills', description: 'Paint the trim and window sills', costType: 'per_unit', defaultCost: 7.35, optional: false, unitLabel: 'ft', quantitySource: { type: 'form_field', fieldId: 'trim_length' } },
]
async function paintService(biz: Biz): Promise<string> {
  const created = expectOk('paint service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: 'Exterior wall painting', description: 'Painting of exterior walls, trim and sills, priced by measured area.', documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['Preparation and two coats on exterior walls', 'Trim and window sills'], scopeExcludes: ['Roofline replacement'], defaultAssumptions: ['Walls are sound and accessible from the ground'],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: 'A photo of each wall', requiredAngles: [] },
      workSteps: PAINT_STEPS, expectedSignals: [],
      suggestedFields: [
        { fieldId: 'wall_area', label: 'Wall area (square feet)', type: 'number', required: true, criticalForPricing: true },
        { fieldId: 'trim_length', label: 'Trim length (feet)', type: 'number', required: true, criticalForPricing: true },
      ],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: PAINT_STEPS },
    },
  }))
  return created.service.id as string
}

/** One customer request through the public route; answers the quote's id and the customer's token */
async function submit(tenantKey: string, serviceId: string, customerName: string, answers: unknown[] = [
  { fieldId: '_project_description', value: 'Paint the outside walls and the trim' },
  { fieldId: 'wall_area', value: 40 },
  { fieldId: 'trim_length', value: 20 },
]) {
  const posted = await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: {
      tenantKey, serviceId,
      customer: { name: customerName, email: `${customerName.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-3434' },
      job: { postcodeOrZip: '63021', answers },
      source: { type: 'widget' },
    },
    timeoutMs: 150_000,
  })
  const body = expectOk('submit', posted) as { quoteId: string; quoteViewUrl?: string; token?: string }
  const token = body.token ?? (body.quoteViewUrl ? new URL(body.quoteViewUrl, cfg.appUrl).searchParams.get('token') : null)
  return { id: body.quoteId, token: token ?? '' }
}

/** Wait until a quote row satisfies `done` (the worker prices a request a moment after it is sent) */
async function waitForQuote(id: string, done: (row: Row) => boolean, seconds = 90): Promise<Row> {
  let row: Row = {}
  for (let i = 0; i < seconds; i++) {
    row = (await rows('quotes', `id=eq.${id}&select=*`))[0] ?? {}
    if (done(row)) return row
    await new Promise((r) => setTimeout(r, 1000))
  }
  return row
}

export const h = { cfg, sb, app: cfg.appUrl, http, expectOk, shortId, check, section, rows, business, patch, siteKey, paintService, submit, waitForQuote }
export type Harness = typeof h

/** Prints the line the runner reads ("20/20 pass") and returns the exit code */
export function finish(): number {
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass`)
  if (failed.length) {
    console.log('Failed:')
    for (const f of failed) console.log(`  - ${f.name}`)
  }
  return failed.length ? 1 : 0
}
