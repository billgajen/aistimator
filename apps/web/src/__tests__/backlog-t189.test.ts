/**
 * T-189: backlog fixes before launch (the web side).
 *
 *   1. the sample price on "Test & Publish" never prices a line measured from
 *      photos at a quantity of 1;
 *   2. there is one document style: no choice anywhere, and the stored value
 *      is ignored;
 *   3. a trade template's service can be added after setup, once;
 *   4. the Terms' data-processing section, and the one list of providers;
 *   5. the owner's alert from the web app;
 *   6. where a new business came from;
 *   7. the customer reads an added line's real source.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { OPERATOR, PRODUCT_NAME, SUPPORT_EMAIL, addedForCustomer } from '@qolumns/shared'
import type { ExpectedSignalConfig, WorkStepConfig } from '@qolumns/shared'
import { measuredLines, sampleKey, sampleNote, samplePrice, sampleSize, type SampleService } from '@/lib/sample-price'
import { serviceInsertRow } from '@/lib/service-rows'
import { servicePayload } from '@/lib/onboarding-service'
import { startingPrice, templateGroups, templatePayload } from '@/lib/service-templates'
import { listPacks } from '@/lib/vertical-packs'
import { NOT_SUB_PROCESSORS, SUB_PROCESSORS, subProcessorLine, subProcessorSentence } from '@/lib/legal/sub-processors'
import { FIRST_VISIT_KEY, cleanSignupSource, firstVisitSource, signupSourceLine } from '@/lib/signup-source'
import { quoteUnderstanding } from '@/lib/quote-understanding'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const src = (path: string) => read(`apps/web/src/${path}`)
/** A source file without its comments, so a rule about the code is not met or broken by a note */
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---------------------------------------------------------------------------------------------
describe('T-189 item 1: the sample price', () => {
  const measuredStep = (over: Partial<WorkStepConfig> = {}): WorkStepConfig =>
    ({
      id: 'step_area',
      name: 'Surface A',
      description: '',
      costType: 'per_unit',
      defaultCost: 18,
      optional: false,
      unitLabel: 'sq m',
      quantitySource: { type: 'ai_signal', signalKey: 'area_a' },
      ...over,
    }) as WorkStepConfig
  const signal = (envelope?: ExpectedSignalConfig['envelope']): ExpectedSignalConfig => ({ signalKey: 'area_a', type: 'number', description: 'The area', ...(envelope && { envelope }) })
  const service = (over: Partial<SampleService> = {}): SampleService => ({
    baseFee: 0,
    minimumCharge: 120,
    workSteps: [measuredStep()],
    multipliers: [],
    suggestedFields: [],
    expectedSignals: [signal()],
    ...over,
  })

  it('the owner’s case: a line measured from photos, no photos, is never priced at 1', () => {
    const result = samplePrice(service(), {}, '$')
    const line = result.lineItems[0]!
    // before: "1 sq m × $18.00 = $18.00", then topped up to the minimum
    expect(line.amount).toBeNull()
    expect(line.calculation).toBe('$18.00 per sq m')
    expect(line.quantitySource).toBe('photos')
    expect(result.unmeasured).toEqual(['Surface A'])
    // no sum, so nothing "came to less than the minimum"
    expect(result.subtotal).toBe(0)
    expect(result.minimumCharge).toBeNull()
    expect(sampleNote(result)).toBe("The real price comes from the customer's photos: Surface A is measured from them. Type a size above to see a sample price.")
    expect(JSON.stringify(result)).not.toMatch(/\b1 sq m ×/)
  })

  it('with the service’s own plausible range, the sample is a realistic size from it, and says it is a sample', () => {
    const ranged = service({ expectedSignals: [signal({ driverKey: 'levels', minPerUnit: 100, maxPerUnit: 1000, defaultDriver: 2, absoluteMin: 80, absoluteMax: 6000 })] })
    // the middle of the range per level (550), times the service's own default of 2 levels
    expect(sampleSize(ranged.expectedSignals[0], {})).toBe(1100)
    const result = samplePrice(ranged, {}, '$')
    expect(result.lineItems[0]).toMatchObject({ amount: 19800, calculation: '1,100 sq m × $18.00 = $19800.00', sample: true })
    expect(result.unmeasured).toEqual([])
    expect(result.sampled).toEqual(['Surface A: 1,100 sq m'])
    expect(sampleNote(result)).toBe("A sample, not a real job (Surface A: 1,100 sq m). On a real request the size is measured from the customer's photos.")
    // the driver follows the sample values when the business sets it (one level: 550)
    expect(sampleSize(ranged.expectedSignals[0], { levels: 1 })).toBe(550)
    // and stays inside the range's outer bounds
    expect(sampleSize(ranged.expectedSignals[0], { levels: 40 })).toBe(6000)
  })

  it('outer bounds alone give no sample: the edges of what is possible are not a size anyone has', () => {
    expect(sampleSize(signal({ absoluteMin: 5, absoluteMax: 9000 }), {})).toBeNull()
    expect(sampleSize(undefined, {})).toBeNull()
  })

  it('a size the business types is used, for a service with a range or without', () => {
    const result = samplePrice(service(), { [sampleKey('area_a')]: 40 }, '£')
    expect(result.lineItems[0]).toMatchObject({ amount: 720, calculation: '40 sq m × £18.00 = £720.00', sample: true })
    expect(result.subtotal).toBe(720)
    expect(measuredLines(service(), {})).toEqual([{ key: 'sample:area_a', name: 'Surface A', unit: 'sq m', suggested: null }])
  })

  it('the lines that never needed photos are priced as they always were', () => {
    const steps = [
      { id: 's1', name: 'Per item', description: '', costType: 'per_unit', defaultCost: 375, optional: false, unitLabel: 'items', quantitySource: { type: 'form_field', fieldId: 'count' } },
      { id: 's2', name: 'Callout', description: '', costType: 'fixed', defaultCost: 60, optional: false },
      { id: 's3', name: 'Always two', description: '', costType: 'per_unit', defaultCost: 10, optional: false, unitLabel: 'visits', quantitySource: { type: 'constant', value: 2 } },
      { id: 's4', name: 'Only when asked', description: '', costType: 'fixed', defaultCost: 99, optional: true, triggerSignal: 'extra', triggerCondition: { operator: 'equals', value: 'yes' } },
    ] as WorkStepConfig[]
    const plain = service({ baseFee: 75, minimumCharge: 0, workSteps: steps, expectedSignals: [], multipliers: [{ when: { fieldId: 'day', equals: 'Weekend' }, multiplier: 1.2 }] as SampleService['multipliers'] })
    const result = samplePrice(plain, { count: 3, day: 'Weekend' }, '$')
    // 75 + 3×375 + 60 + 2×10 = 1,280; +20% = 1,536
    expect(result.lineItems.map((l) => [l.name, Math.round((l.amount ?? 0) * 100) / 100])).toEqual([['Base Fee', 75], ['Per item', 1125], ['Callout', 60], ['Always two', 20], ['day = Weekend', 256]])
    expect(result.subtotal).toBeCloseTo(1536, 6)
    expect(result.unmeasured).toEqual([])
    expect(sampleNote(result)).toBeNull()
    // the floor still applies when every line could be priced
    const small = samplePrice(service({ workSteps: [steps[1]!], expectedSignals: [] }), {}, '$')
    expect(small).toMatchObject({ subtotal: 120, minimumCharge: 120 })
  })

  it('every template with a line measured from photos shows a sample size or says so: none shows quantity 1', () => {
    let measuredServices = 0
    for (const pack of listPacks()) {
      for (const svc of pack.services) {
        const config: SampleService = {
          baseFee: svc.draft.pricing.baseFee,
          minimumCharge: svc.draft.pricing.minimumCharge,
          workSteps: svc.draft.pricing.workSteps,
          multipliers: svc.multipliers || [],
          suggestedFields: svc.draft.suggestedFields || [],
          expectedSignals: svc.draft.expectedSignals || [],
        }
        if (measuredLines(config, {}).length === 0) continue
        measuredServices++
        const result = samplePrice(config, {}, '$')
        for (const line of result.lineItems.filter((l) => l.quantitySource === 'photos')) {
          expect(line.amount === null || line.sample === true, `${pack.id} / ${svc.name} / ${line.name}`).toBe(true)
          expect(line.calculation, `${pack.id} / ${svc.name}`).not.toMatch(/^1 \D/)
        }
        expect(sampleNote(result), `${pack.id} / ${svc.name}`).not.toBeNull()
      }
    }
    expect(measuredServices).toBeGreaterThan(0)
  })

  it('the page uses that one module, offers a size to try, and no longer says "AI signal"', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('setSimulatorResult(samplePrice(sampleService, simulatorValues, currencySymbol))')
    expect(page).toContain('measured.map((line) => (')
    expect(page).toContain("placeholder={line.suggested !== null ? String(line.suggested) : 'Size to try'}")
    expect(page).toContain('{sampleNote(simulatorResult)}')
    expect(page).not.toMatch(/uses AI signal|AI signals default to 1/)
    // no dollar sign typed into the preview: the business's own currency
    expect(page).not.toMatch(/\$\$\{|>\$\{(item|simulatorResult)/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 2: one document style', () => {
  const NAMES = /Instant Estimate|Formal Quote|Statement of Work|Document type|Document Type|DOCUMENT_TYPES/

  it('the services page, bulk upload, setup and the AI draft offer no choice', () => {
    for (const path of [
      'app/(dashboard)/app/services/page.tsx',
      'components/services/BulkServiceUpload.tsx',
      'components/onboarding/OnboardingFlow.tsx',
      'lib/onboarding-service.ts',
      'app/api/services/ai-draft/route.ts',
    ]) {
      expect(code(path), path).not.toMatch(NAMES)
      expect(code(path), path).not.toMatch(/documentType|document_type/)
    }
    expect(Object.keys(servicePayload({ name: 'A', description: '', draft: listPacks()[0]!.services[0]!.draft, addons: [], multipliers: [] }))).not.toContain('documentTypeDefault')
  })

  it('a stored or sent value is ignored: an older caller is not refused, and nothing is written from it', () => {
    const row = serviceInsertRow('tnt_1', { name: 'Service A', documentTypeDefault: 'proposal' } as Parameters<typeof serviceInsertRow>[1])
    expect(row).not.toHaveProperty('document_type_default')
    expect(row.name).toBe('Service A')
    const update = code('app/api/services/[id]/route.ts')
    expect(update).not.toMatch(/document_type_default|documentTypeDefault/)
  })

  it('no migration touches the stored values', () => {
    const migration = read('supabase/migrations/00000000000045_signup_source_and_alerts.sql')
    expect(migration).not.toMatch(/document_type/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 3: add a service from a template after setup', () => {
  const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`

  it('lists the packs setup lists for the business’s region, every service with a starting price', () => {
    for (const region of ['US', 'GB'] as const) {
      const groups = templateGroups(region, [], money)
      const setup = listPacks(region).filter((p) => p.region === region)
      expect(groups.map((g) => g.packId)).toEqual(setup.map((p) => p.id))
      expect(groups.length).toBeGreaterThan(0)
      for (const group of groups) {
        const pack = setup.find((p) => p.id === group.packId)!
        expect(group.services.map((s) => s.name)).toEqual(pack.services.map((s) => s.name))
        for (const svc of group.services) {
          expect(svc.price, `${group.packName} / ${svc.name}`).toMatch(/^(From )?\$\d/)
          expect(svc.owned).toBe(false)
        }
      }
    }
  })

  it('the starting price is the template’s own number', () => {
    for (const pack of listPacks()) {
      for (const svc of pack.services) {
        const price = startingPrice(svc, money)
        const amount = Number(/\$([\d.]+)/.exec(price)?.[1])
        const own = [...svc.draft.pricing.workSteps.map((s) => s.defaultCost), svc.draft.pricing.baseFee, svc.draft.pricing.minimumCharge]
        expect(own, `${pack.id} / ${svc.name}: ${price}`).toContain(amount)
      }
    }
  })

  it('a service the business already has is marked, and cannot be added twice', () => {
    const [group] = templateGroups('US', [], money)
    const first = group!.services[0]!
    const marked = templateGroups('US', [`  ${first.name.toUpperCase()} `], money)[0]!.services
    expect(marked[0]!.owned).toBe(true)
    expect(marked.slice(1).every((s) => !s.owned)).toBe(true)
    expect(templatePayload('US', first.key, [first.name])).toBeNull()
    // a key that names no template, or another region's, adds nothing
    expect(templatePayload('US', 'no-such-pack:0', [])).toBeNull()
    expect(templatePayload('GB', first.key, [])).toBeNull()
  })

  it('picking one sends exactly what setup sends for that service', () => {
    const pack = listPacks('US').filter((p) => p.region === 'US')[0]!
    const svc = pack.services[0]!
    const payload = templatePayload('US', `${pack.id}:0`, [])
    // T-201: the same body, except that the service starts switched off until its example prices are checked
    expect(payload).toEqual({ ...servicePayload({ name: svc.name, description: svc.description, draft: svc.draft, addons: svc.addons || [], multipliers: svc.multipliers || [] }), active: false })
    expect(payload!.workSteps).toBe(svc.draft.pricing.workSteps)
  })

  it('the page has the button and opens the new service at its prices', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('Add from a template')
    expect(page).toContain('ownedNames={services.map((s) => s.name)}')
    expect(page).toContain("setActiveStep('pricing')")
    const picker = code('components/services/TemplatePicker.tsx')
    expect(picker).toContain('You have this')
    expect(picker).toContain("fetch('/api/services', { method: 'POST'")
    // nothing about a trade is typed into the picker: it is all the packs' data
    expect(picker).not.toMatch(/paint|plumb|hvac|electric|garage/i)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 4: data processing in the Terms', () => {
  const terms = src('app/terms/page.tsx')
  const section = terms.slice(terms.indexOf("title: '7. Data processing'"), terms.indexOf("title: '8. Availability and changes'"))

  it('the section is there, between the customers’ data and availability, and the numbers still run in order', () => {
    expect(section.length).toBeGreaterThan(500)
    const titles = [...terms.matchAll(/title: '(\d+)\. /g)].map((m) => Number(m[1]))
    expect(titles).toEqual(titles.map((_, i) => i + 1))
    expect(titles).toHaveLength(13)
    expect(terms).toContain('Last updated: 19 November 2026')
  })

  it('it says each thing the ticket asked for, in plain words', () => {
    for (const label of ['What is collected', 'Where it is stored and who else handles it', 'How long it is kept', 'How it is deleted', 'Security', 'If there is a breach', 'A written agreement', 'Who we are']) {
      expect(section, label).toContain(`label: '${label}'`)
    }
    expect(section).toContain('you are the controller')
    expect(section).toContain('${OPERATOR.name} is your processor')
    expect(section).toMatch(/only to provide the service to you/)
    expect(section).toMatch(/name and contact details \(email and phone\), the address of the job, the photos and documents they send, their answers/)
    expect(section).toMatch(/stays available for export for 30 days and is then deleted/)
    expect(section).toMatch(/we will tell you without undue delay, by email to your account’s address/)
    expect(section).toContain('If your business needs a data-processing agreement, ask for one at ${SUPPORT_EMAIL}.')
    expect(section).toContain('governed by ${GOVERNING_LAW}')
    expect(OPERATOR).toEqual({ name: 'Billiom Limited', registeredIn: 'England and Wales' })
    expect(SUPPORT_EMAIL).toMatch(/@qolumns\.com$/)
    // the company and the product are named from the constants, never typed
    expect(section).not.toMatch(/Billiom|Qolumns/)
  })

  it('it promises nothing about keeping or deleting that the Privacy Policy does not', () => {
    const privacy = src('app/privacy/page.tsx')
    expect(privacy).toMatch(/kept while the business account remains active/)
    expect(privacy).toMatch(/Closed accounts are deleted after the 30-day export window/)
    expect(privacy).toMatch(/Businesses can request deletion of individual enquiries/)
  })

  it('the providers are one list, proven by the settings the code really has', () => {
    const env = read('apps/web/.env.example')
    const settings = [...env.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!)
    for (const p of SUB_PROCESSORS) expect(settings, `${p.name}: ${p.setting}`).toContain(p.setting)
    expect(SUB_PROCESSORS.map((p) => p.name)).toEqual(['Supabase', 'Cloudflare', 'Vercel', 'Google', 'Postmark', 'DocRaptor', 'Upstash', 'Stripe', 'Meta'])
    // the other way round: every outside service with keys in that file is listed, or is named with the reason it is not
    const owner: Record<string, string> = {
      SUPABASE: 'Supabase', UPSTASH: 'Upstash', R2: 'Cloudflare', CLOUDFLARE: 'Cloudflare', GEMINI: 'Google', DOCRAPTOR: 'DocRaptor',
      POSTMARK: 'Postmark', STRIPE: 'Stripe', WHATSAPP: 'Meta',
    }
    // T-199: the own-address host and the key its Worker sends are our own settings (the Worker runs on Cloudflare, already listed)
    const ours = /^(NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_OWN_ADDRESS_HOST|ADDRESS_PROXY_KEY|NEXT_PUBLIC_COMPANY_NUMBER|SYNC_QUOTE_PROCESSING|CRON_SECRET|DEMO_DAILY_CAP|APP_STORE_URL|PLAY_STORE_URL|ALERT_EMAIL|SMS_TEST_MODE|NEXT_PUBLIC_TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|RATE_LIMIT.*)$/
    const listed = new Set(SUB_PROCESSORS.map((p) => p.name))
    for (const setting of settings) {
      if (ours.test(setting)) continue
      const name = setting.replace(/^NEXT_PUBLIC_/, '')
      const notOne = Object.keys(NOT_SUB_PROCESSORS).find((prefix) => name.startsWith(prefix))
      if (notOne) continue
      const provider = Object.entries(owner).find(([prefix]) => name.startsWith(prefix))?.[1]
      expect(provider, `${setting} belongs to a provider this test does not know: add it to the list of providers, or to NOT_SUB_PROCESSORS with the reason`).toBeDefined()
      expect(listed.has(provider!), `${setting}: ${provider}`).toBe(true)
    }
    // AI goes to one provider unless a setting overrides it: the registry names no other
    const registry = JSON.parse(read('packages/shared/src/ai-models.json')) as { tasks: Record<string, { provider: string }> }
    expect([...new Set(Object.values(registry.tasks).map((t) => t.provider))]).toEqual(['gemini'])
  })

  it('the Terms and the Privacy Policy both print that list, so they cannot drift apart', () => {
    expect(section).toContain('list: SUB_PROCESSORS.map(subProcessorLine)')
    expect(src('app/privacy/page.tsx')).toContain('${subProcessorSentence()}')
    const sentence = subProcessorSentence()
    for (const p of SUB_PROCESSORS) expect(sentence).toContain(p.name)
    expect(sentence).toMatch(/; and, for a business that connects its WhatsApp number, Meta \(WhatsApp messages to and from that number\)\.$/)
    // no bracket inside a bracket
    expect(sentence).not.toMatch(/\([^)]*\(/)
    expect(subProcessorLine(SUB_PROCESSORS.find((p) => p.name === 'Postmark')!)).toBe('Postmark: sending email')
    expect(subProcessorLine(SUB_PROCESSORS.find((p) => p.name === 'Meta')!)).toBe('Meta, for a business that connects its WhatsApp number: WhatsApp messages to and from that number')
    // neither page types a provider's name into its own text any more
    for (const name of ['Supabase', 'Postmark', 'DocRaptor', 'Upstash', 'Vercel']) {
      expect(section, name).not.toContain(name)
      expect(src('app/privacy/page.tsx').replace(/Stripe and never touch/, ''), name).not.toContain(name)
    }
  })

  it('the owner is told to have it checked', () => {
    expect(read('OWNER-TODO.md')).toMatch(/## T-189[\s\S]*legal check/i)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 5: the owner’s alert from the web app', () => {
  it('when a request cannot be handed to the worker, the owner is told, with ids only', () => {
    const failed = code('lib/failed-quote.ts')
    expect(failed).toContain("kind: 'worker_error'")
    expect(failed).toContain("details: { Where: 'the web app could not hand a request to the worker', Quote: quoteId")
    // never a customer's name or contact details in an alert
    expect(failed.slice(failed.indexOf('sendOpsAlert(supabase'))).not.toMatch(/customer_json|customerName|customerEmail/)
  })

  it('it is off without the address, and the setting is written down by name only', () => {
    const alert = code('lib/ops-alert.ts')
    expect(alert).toContain('to: env.ALERT_EMAIL')
    expect(alert).toContain("supabase.rpc('claim_ops_alert'")
    expect(read('apps/web/.env.example')).toMatch(/^ALERT_EMAIL=$/m)
    expect(read('apps/worker/wrangler.toml')).toMatch(/# - ALERT_EMAIL/)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 6: where a new business came from', () => {
  const NOW = new Date('2026-11-19T12:00:00Z')

  it('a first visit keeps the campaign tags, the site it came from (a host) and the first page (a path)', () => {
    const source = firstVisitSource({
      url: 'https://qolumns.com/pricing?utm_source=newsletter&utm_medium=email&utm_campaign=launch&ref=abc&email=someone%40example.com',
      referrer: 'https://www.example.org/some/page?q=private+words',
      now: NOW,
    })
    expect(source).toEqual({
      utm: { source: 'newsletter', medium: 'email', campaign: 'launch' },
      referrer: 'example.org',
      landing: '/pricing',
      at: '2026-11-19T12:00:00.000Z',
    })
    // nothing else from either address is kept
    expect(JSON.stringify(source)).not.toMatch(/private|someone|abc|\?/)
  })

  it('coming from our own pages is not a referrer, and no tags means none', () => {
    expect(firstVisitSource({ url: 'https://qolumns.com/', referrer: 'https://qolumns.com/pricing', now: NOW })).toEqual({ landing: '/', at: NOW.toISOString() })
    expect(firstVisitSource({ url: 'https://qolumns.com/signup', referrer: '', now: NOW })).toEqual({ landing: '/signup', at: NOW.toISOString() })
    expect(firstVisitSource({ url: 'not an address', now: NOW })).toEqual({})
  })

  it('the server keeps only the known keys, short and plain, whatever a browser sends', () => {
    expect(cleanSignupSource(null)).toBeNull()
    expect(cleanSignupSource('utm')).toBeNull()
    expect(cleanSignupSource({ anything: 'else' })).toBeNull()
    const cleaned = cleanSignupSource({
      utm: { source: `  ${'x'.repeat(500)}`, medium: '<script>alert(1)</script>', other: 'dropped', campaign: 42 },
      referrer: 'https://Sub.Example.org/path?secret=1',
      landing: '/features?x=1#top',
      at: '2026-11-19T12:00:00Z',
      email: 'someone@example.com',
    })!
    expect(cleaned.utm!.source).toHaveLength(120)
    expect(cleaned.utm!.medium).toBe('scriptalert(1)/script')
    expect(cleaned.utm).not.toHaveProperty('other')
    expect(cleaned.utm).not.toHaveProperty('campaign')
    expect(cleaned.referrer).toBe('sub.example.org')
    expect(cleaned.landing).toBe('/features')
    expect(cleaned).not.toHaveProperty('email')
    expect(cleanSignupSource({ landing: 'javascript:alert(1)', referrer: 'not a host!' })).toBeNull()
  })

  it('the admin reads it as one line', () => {
    expect(signupSourceLine({ utm: { source: 'newsletter', medium: 'email', campaign: 'launch' }, referrer: 'example.org', landing: '/pricing' })).toBe('newsletter / email / launch · from example.org · first page /pricing')
    expect(signupSourceLine({ landing: '/' })).toBe('came directly · first page /')
    expect(signupSourceLine(null)).toBe('Not recorded')
    expect(code('app/api/admin/tenants/route.ts')).toContain('cameFrom: signupSourceLine(')
    expect(code('app/admin/tenants/page.tsx')).toContain('{tenant.cameFrom}')
  })

  it('no cookie: the tab’s own storage, written once, sent only with the sign-up form', () => {
    const module_ = code('lib/signup-source.ts')
    expect(module_).not.toMatch(/document\.cookie|localStorage/)
    expect(module_).toContain('window.sessionStorage.getItem(FIRST_VISIT_KEY)) return')
    expect(FIRST_VISIT_KEY).toBe('qolumns:first-visit')
    expect(code('components/marketing/SiteNav.tsx')).toContain('<FirstVisit />')
    const signup = code('app/(auth)/signup/page.tsx')
    expect(signup).toContain('source: readFirstVisit() ?? undefined')
    // it goes nowhere else: no other file reads it
    expect(code('components/marketing/FirstVisit.tsx')).not.toMatch(/fetch\(/)
  })

  it('the server cleans it at sign-up and saves it on the business when the address is confirmed', () => {
    expect(code('app/api/auth/signup/route.ts')).toContain('signupSource: cleanSignupSource(body.source)')
    expect(code('lib/auth-flow.ts')).toContain('...(input.signupSource && { signup_source: input.signupSource })')
    const confirm = code('app/api/auth/confirm/route.ts')
    expect(confirm).toContain("if (kind === 'signup' && data.user) await saveSignupSource(data.user.id, data.user.user_metadata)")
    const save = code('lib/signup-choices.ts')
    expect(save).toContain("update({ signup_source: source }).eq('id', tenantId).is('signup_source', null)")
    expect(save).toContain('cleanSignupSource(userMetadata?.signup_source)')
  })

  it('the database keeps it server-only, and the Privacy Policy says it is kept', () => {
    const migration = read('supabase/migrations/00000000000045_signup_source_and_alerts.sql')
    expect(migration).toContain('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_source JSONB;')
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF signup_source ON tenants')
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i)
    const privacy = src('app/privacy/page.tsx')
    expect(privacy).toMatch(/When a business signs up we also keep how it found us: the site it came from, any campaign tags on the link it followed, and the first page of ours it opened\./)
    expect(privacy).toMatch(/This is not a cookie, holds nothing that identifies you, and reaches us only if you sign up\./)
    // T-198 added what is sent to Help and to the help assistant
    expect(privacy).toContain('Last updated: 21 November 2026')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-189 item 7: the customer reads an added line’s real source', () => {
  it('photos, description, or just "added" when the source was never stored', () => {
    expect(addedForCustomer('seen')).toBe('Added for you — from your photos')
    expect(addedForCustomer('words')).toBe('Added for you — from your description')
    expect(addedForCustomer(undefined)).toBe('Added for you')
    expect(addedForCustomer('choice')).toBe('Added for you')
  })

  it('the customer’s page words it from the line’s source, never from the engine’s one reason', () => {
    const page = code('app/q/[quoteId]/page.tsx')
    expect(page).toContain('{addedForCustomer(item.source)}')
    expect(page).not.toContain('recommendationReason')
    expect(page).not.toMatch(/detected from your description/i)
  })

  it('the dashboard’s "what was understood" does the same: an extra the photos called for is a photo finding', () => {
    const understood = quoteUnderstanding({
      request: { description: null, answers: [], postcode: null, address: null, quantity: null },
      pricing: {
        currency: 'USD',
        subtotal: 250,
        total: 250,
        breakdown: [{ label: 'Extra A', amount: 250, autoRecommended: true, recommendationReason: 'Detected from your description', source: 'seen' }],
      },
      content: {},
      questions: null,
      answers: null,
    } as unknown as Parameters<typeof quoteUnderstanding>[0])
    const all = JSON.stringify(understood)
    expect(all).toContain('Extra A')
    // filed with what the photos showed, not with what was written
    expect(JSON.stringify(understood.photos ?? [])).toContain('Extra A')
    expect(JSON.stringify(understood.words ?? [])).not.toContain('Extra A')
  })

  it('the product name is never typed in this ticket’s new files', () => {
    for (const path of ['lib/sample-price.ts', 'lib/service-templates.ts', 'lib/legal/sub-processors.ts', 'lib/ops-alert.ts', 'components/services/TemplatePicker.tsx']) {
      expect(code(path), path).not.toContain(PRODUCT_NAME)
    }
    vi.restoreAllMocks()
  })
})
