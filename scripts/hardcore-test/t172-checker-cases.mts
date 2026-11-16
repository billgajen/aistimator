// T-172: four correct quotes for the quote checker, through the real pipeline.
//
// Each case is a request whose price is right by the business's own
// configuration, in a setting the checker used not to be told about:
//   minimum   one garage door spring ($275), under the business's $400 minimum charge, so the minimum applies
//   base_fee  two rooms of interior painting, with the template's base fee on top of the rooms
//   tax       a pair of springs for a business that charges sales tax
//   currency  a pair of springs for a business that prices in pounds, not dollars
// The request goes through the web app and the worker as a customer's would;
// the checker's findings are read from its log (quote_validation_logs).
//
// Used two ways:
//   npx tsx scripts/hardcore-test/t172-checker-cases.mts <out.json> [repeats]   run the cases, save the findings
//   import { runCheckerCases } from './t172-checker-cases.mts'                 from verify-t172
//
// Test data uses made-up names.
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
import { loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'
import { servicePayload } from '../../apps/web/src/lib/onboarding-service'

type Cfg = ReturnType<typeof loadEnv>
type Sb = ReturnType<typeof makeSupabase>
type Draft = Parameters<typeof servicePayload>[0]
const draftOf = (pack: { services: Array<{ name: string }> }, name: string) => pack.services.find((s) => s.name === name)! as unknown as Draft

export interface CheckerFinding {
  check: string
  category: string
  severity: string
  description: string
}
export interface CheckerCaseResult {
  case: 'minimum' | 'base_fee' | 'tax' | 'currency'
  what: string
  run: number
  quoteId: string
  tenantId: string
  status: string
  currency: string
  subtotal: number
  taxAmount: number
  total: number
  expectedTotal: number
  /** The price is what the business's configuration gives */
  priceIsRight: boolean
  outcome: string | null
  /** How the log row is marked: 'v1' before T-172, 'v2' once the checker is told the settings */
  settingsVersion: string | null
  findings: CheckerFinding[]
}

/** A finding about money the business's own settings explain: on a correct quote it is a false flag */
export const SETTINGS_FLAG = /minimum|base (service )?fee|call[- ]?out|\btax\b|\bVAT\b|currency|£|\$|€|total|subtotal|invented|unconfigured|not (found )?in (the )?config|underpric|overpric|discount/i
export const isSettingsFlag = (f: CheckerFinding) => SETTINGS_FLAG.test(`${f.check} ${f.description}`)

async function business(cfg: Cfg, sb: Sb, name: string, settings: { region: string; currency: string; taxEnabled: boolean; taxRate: number }) {
  const id = shortId()
  const email = `owner+t172-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { ...settings, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, tenantId, tenantKey: site.tenant_key as string, name }
}
type Biz = Awaited<ReturnType<typeof business>>

/** A template's service, made the way setup makes it; photos are optional so the case needs none */
async function addService(cfg: Cfg, biz: Biz, svc: Draft, change: { minimumCharge?: number } = {}) {
  const body = servicePayload({ ...svc, addons: svc.addons ?? [], multipliers: svc.multipliers ?? [] })
  const created = expectOk(`service ${svc.name}`, await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      ...body,
      mediaConfig: { ...body.mediaConfig, minPhotos: 0 },
      pricingRules: { ...body.pricingRules, ...(change.minimumCharge !== undefined && { minimumCharge: change.minimumCharge }) },
      // sent as soon as it is priced: the check is of the price, not of the approval step
      autoSend: true,
      holdUntilApproved: false,
    },
  }))
  return created.service.id as string
}

const customers = ['Marta Okafor', 'Dev Raman', 'Wanda Pemberton', 'Tomas Albrecht', 'Olive Hartwell', 'Noor Castellan', 'Priya Lindqvist', 'Rowan Vale']
const customerOf = (n: number) => { const name = customers[n % customers.length]!; return { name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-1212' } }

export async function runCheckerCases(cfg: Cfg, sb: Sb, repeats = 1): Promise<CheckerCaseResult[]> {
  const usd = await business(cfg, sb, 'Ridgeway Home Services', { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0 })
  const taxed = await business(cfg, sb, 'Kestrel Door Company', { region: 'US', currency: 'USD', taxEnabled: true, taxRate: 0.0825 })
  const pounds = await business(cfg, sb, 'Hollow Lane Doors', { region: 'GB', currency: 'GBP', taxEnabled: false, taxRate: 0 })
  const spring = draftOf(garageDoorsPackUS, 'Garage Door Spring Replacement')
  const painting = draftOf(paintingPackUS, 'Interior Painting')
  const cases = [
    { case: 'minimum' as const, what: 'one spring ($275) for a business with a $400 minimum charge: the minimum applies', biz: usd, serviceId: await addService(cfg, usd, spring, { minimumCharge: 400 }), answers: [{ fieldId: 'spring_count', value: 'one' }], expectedTotal: 400 },
    { case: 'base_fee' as const, what: 'two rooms of interior painting: the $75 base fee plus 2 x $375', biz: usd, serviceId: await addService(cfg, usd, painting), answers: [{ fieldId: 'room_count', value: 2 }], expectedTotal: 825 },
    { case: 'tax' as const, what: 'a pair of springs ($375) for a business that charges 8.25% sales tax', biz: taxed, serviceId: await addService(cfg, taxed, spring), answers: [{ fieldId: 'spring_count', value: 'two' }], expectedTotal: 405.94 },
    { case: 'currency' as const, what: 'a pair of springs for a business that prices in pounds (£375), with no tax', biz: pounds, serviceId: await addService(cfg, pounds, spring), answers: [{ fieldId: 'spring_count', value: 'two' }], expectedTotal: 375 },
  ]
  const results: CheckerCaseResult[] = []
  let n = 0
  for (let run = 1; run <= repeats; run++) {
    for (const c of cases) {
      const posted = expectOk(`submit ${c.case}`, await http('POST', `${cfg.appUrl}/api/public/quotes`, {
        body: { tenantKey: c.biz.tenantKey, serviceId: c.serviceId, customer: customerOf(n++), job: { postcodeOrZip: c.case === 'currency' ? 'SW1A 1AA' : '63021', answers: c.answers }, source: { type: 'widget' } },
        timeoutMs: 300_000,
      }))
      const token = new URL(posted.quoteViewUrl).searchParams.get('token')!
      await pollQuote(cfg, posted.quoteId, token)
      const quote = (await sb.select('quotes', `id=eq.${posted.quoteId}&select=status,pricing_json`))[0] as { status: string; pricing_json: { currency: string; subtotal: number; taxAmount: number; total: number } }
      // the checker's log row is written just after the quote is stored
      let log: { outcome: string; input_snapshot: { serviceConfigVersion?: string } | null; validation_result: { issues?: CheckerFinding[] } | null } | undefined
      for (let i = 0; i < 20 && !log; i++) {
        log = (await sb.select('quote_validation_logs', `quote_id=eq.${posted.quoteId}&select=outcome,input_snapshot,validation_result&order=created_at.desc&limit=1`))[0]
        if (!log) await new Promise((r) => setTimeout(r, 1500))
      }
      const p = quote.pricing_json
      results.push({
        case: c.case, what: c.what, run, quoteId: posted.quoteId, tenantId: c.biz.tenantId, status: quote.status,
        currency: p.currency, subtotal: p.subtotal, taxAmount: p.taxAmount, total: p.total, expectedTotal: c.expectedTotal,
        priceIsRight: Math.abs(p.total - c.expectedTotal) < 0.005,
        outcome: log?.outcome ?? null,
        settingsVersion: log?.input_snapshot?.serviceConfigVersion ?? null,
        findings: (log?.validation_result?.issues ?? []).map((i) => ({ check: i.check, category: i.category, severity: i.severity, description: i.description })),
      })
    }
  }
  return results
}

// run directly: save the findings
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out, repeats = '1'] = process.argv.slice(2)
  if (!out) throw new Error('usage: t172-checker-cases.mts <out.json> [repeats]')
  const cfg = loadEnv()
  const results = await runCheckerCases(cfg, makeSupabase(cfg), Number(repeats))
  writeFileSync(out, JSON.stringify(results, null, 1))
  for (const r of results) {
    console.log(`${r.case} run ${r.run}: ${r.currency} ${r.total} (${r.priceIsRight ? 'right' : `WRONG, expected ${r.expectedTotal}`}), checker ${r.outcome ?? 'no log'}, marked ${r.settingsVersion}, ${r.findings.length} finding(s), ${r.findings.filter(isSettingsFlag).length} about money the settings explain`)
    for (const f of r.findings) console.log(`   [${f.severity}] ${f.check}: ${f.description.slice(0, 220)}`)
  }
}
