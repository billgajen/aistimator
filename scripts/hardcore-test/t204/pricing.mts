// T-204, the "pricing" section of verify-t204: items 1, 2, 3, 4, 7, 20 and the note of item 29.
// Local stack only. No model is asked (the worker runs with its AI stand-in) and no email is sent.
//
// What it proves
//   Item 1
//   A. the AC Tune-Up service exactly as "Describe your pricing" compiled it for the test business:
//      "Test Your Pricing" gives the ticket's prices (129; 263; 323; refrigerant 0 when left empty),
//      because it is now the worker's own pipeline
//   B. real requests through the customer's form are priced the same, line for line: the test price
//      is the customer's price
//   C. a service that is not saved yet is tested as the editor holds it
//   Item 2
//   D. a detail the customer's photos give (a water heater's tank size and fuel) can be tried, and
//      the price follows it (the template's own lines); without it the preview says what it was
//   Items 1, 2, 3, 7 and 20, in a browser
//   E. "Test & Publish" shows the flags ("This question does not change the price"), prices the
//      answers typed, and lists the lines not charged with the answer that decides each; the line
//      editor shows a line's condition and its "minus 1" in words
//   F. "Water Heater Replacement" has no "Repair" warning, and the details from photos are offered
//   G. "Photos required" is shown, 0 means optional, and the customer's form respects both
//   H. a switched-off service says so in the warning colour, and "Save and switch on" switches it on
//   Item 4
//   I. "Add to this quote" on "Customer also asked for": on a held quote the service is added as a
//      section (one quote, one total, nothing counted); a service that needs an answer asks for it;
//      on a sent quote the business is asked first and the quote becomes a revision
//   Item 29
//   J. a quote whose photos could not be read: the dashboard and the approval page say so, and the
//      customer is given no figure (the pipeline's own decision is held by the worker's unit tests:
//      at this level no model is asked, so no reading can fail)
//
// The compile itself asks a real model: scripts/hardcore-test/t204/compile-live.mts, run by hand.
import type { Harness, Row } from '../t201/harness.mts'
import { AC_TUNE_UP_CASES, AC_TUNE_UP_FIELDS, AC_TUNE_UP_STEPS } from './ac-tune-up'
import { servicePayload } from '../../../apps/web/src/lib/onboarding-service'
import { waterHeaterPackUS } from '../../../apps/web/src/lib/vertical-packs/water-heater-us'
import { photoKey } from '../../../apps/web/src/lib/pricing-preview'
import { QUESTION_UNUSED_MESSAGE } from '../../../packages/shared/src/pricing-links'
import { PHOTOS_UNREAD_NOTE, photosUnreadSentence } from '../../../packages/shared/src/photos-unread'

type Biz = Awaited<ReturnType<Harness['business']>>
interface Price {
  lines: Array<{ label: string; amount: number }>
  subtotal: number
  total: number
  steps: Array<{ id?: string; type: string }>
  unmeasured: Array<{ name: string }>
}

const AC_BODY = {
  name: 'AC Tune-Up',
  description: 'Seasonal tune-up of central air conditioning systems.',
  autoSend: true,
  scopeIncludes: ['Tune-up of each system'],
  scopeExcludes: [],
  defaultAssumptions: [],
  mediaConfig: { minPhotos: 0, maxPhotos: 6, photoGuidance: null, requiredAngles: [] },
  workSteps: AC_TUNE_UP_STEPS,
  expectedSignals: [],
  suggestedFields: AC_TUNE_UP_FIELDS,
  pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: AC_TUNE_UP_STEPS },
  // the editor reads a service's questions from its draft (T-201), so the service carries one, as a
  // service saved from the editor does
  draftConfig: {
    source: 'manual',
    scope: { included: ['Tune-up of each system'], excluded: [], assumptions: [] },
    media: { minPhotos: 0, maxPhotos: 6, photoGuidance: '' },
    pricing: { pricingModel: 'fixed', unitType: null, baseFee: 0, minimumCharge: 0, workSteps: AC_TUNE_UP_STEPS, addOns: [], siteVisit: { alwaysRecommend: false, confidenceBelowPct: 60, estimateAbove: 1000 } },
    expectedSignals: [],
    suggestedFields: AC_TUNE_UP_FIELDS,
  },
}

export async function run(h: Harness): Promise<void> {
  const { app, http, expectOk, check, section, rows, patch } = h
  const done = (row: Row) => row.pricing_json != null && !['queued', 'generating', 'processing', 'pending'].includes(String(row.status))
  const preview = async (biz: Biz, service: unknown, values: Record<string, unknown>, serviceId?: string) => {
    const res = await http('POST', `${app}/api/services/preview-price`, { headers: biz.cookie, body: { service, values, ...(serviceId && { serviceId }) }, timeoutMs: 60_000 })
    return { status: res.status, price: (res.json?.price ?? null) as Price | null, sampled: (res.json?.sampled ?? []) as unknown[], error: res.json?.error as { code?: string } | undefined }
  }

  // ---------------------------------------------------------------------------
  section('Pricing A. "Test Your Pricing" gives the ticket’s prices for the AC Tune-Up (item 1)')
  const biz = await h.business('pricing')
  const key = await h.siteKey(biz)
  const ac = expectOk('AC service', await http('POST', `${app}/api/services`, { headers: biz.cookie, body: AC_BODY })).service as { id: string }

  for (const proof of AC_TUNE_UP_CASES) {
    const got = await preview(biz, AC_BODY, proof.answers, ac.id)
    check(`${proof.what}: $${proof.subtotal}`, got.status === 200 && got.price?.subtotal === proof.subtotal, { status: got.status, subtotal: got.price?.subtotal, lines: got.price?.lines, error: got.error })
  }
  const weekday = await preview(biz, AC_BODY, { system_count: 1, indoor_location: 'Basement', weekend_visit: false }, ac.id)
  const charged = new Set((weekday.price?.steps ?? []).map((s) => s.id))
  check('with the weekend box not ticked and the unit in the basement, neither surcharge is a line', !!weekday.price && !charged.has('weekend_visit_surcharge') && !charged.has('attic_unit_surcharge') && !weekday.price.lines.some((l) => /weekend|attic/i.test(l.label)), weekday.price?.lines)
  check('refrigerant left empty is 0 lb: no line, never 1 lb', !!weekday.price && !charged.has('refrigerant_top_up') && !weekday.price.lines.some((l) => /refrigerant/i.test(l.label)), weekday.price?.lines)
  const untouched = await preview(biz, AC_BODY, { system_count: 3 }, ac.id)
  check('3 systems and nothing else answered: 129 + 2 × 89 = 307', untouched.price?.subtotal === 307, untouched.price?.lines)
  const signedOut = await http('POST', `${app}/api/services/preview-price`, { body: { service: AC_BODY, values: {} } })
  check('the test price is for the signed-in business only', signedOut.status === 401, signedOut.status)

  // ---------------------------------------------------------------------------
  section('Pricing B. A real request is priced the same as the test (item 1)')
  const before = (await rows('usage_counters', `tenant_id=eq.${biz.tenantId}&select=estimates_created`)).reduce((sum, r) => sum + Number(r.estimates_created), 0)
  const request = async (who: string, answers: Array<{ fieldId: string; value: unknown }>) => {
    const sent = await h.submit(key, ac.id, who, [{ fieldId: '_project_description', value: 'Please tune up the air conditioning before summer' }, ...answers])
    const row = await h.waitForQuote(sent.id, done)
    return { id: sent.id, row, pricing: (row.pricing_json ?? {}) as { subtotal?: number; breakdown?: Array<{ label: string; amount: number }> } }
  }
  // the form sends a choice by its key (lower case, underscores), and a tick as true or false
  const one = await request('Nora Whitfield', [{ fieldId: 'system_count', value: 1 }, { fieldId: 'system_operational', value: 'yes,_it_is_running_normally' }, { fieldId: 'indoor_location', value: 'basement' }, { fieldId: 'weekend_visit', value: false }])
  check('1 system, basement, weekday, refrigerant left empty: $129, one line', one.pricing.subtotal === 129 && one.pricing.breakdown?.length === 1, one.pricing)
  const two = await request('Owen Marsh', [{ fieldId: 'system_count', value: 2 }, { fieldId: 'system_operational', value: 'yes,_it_is_running_normally' }, { fieldId: 'indoor_location', value: 'attic' }, { fieldId: 'weekend_visit', value: false }])
  check('2 systems, one in the attic: $263', two.pricing.subtotal === 263, two.pricing)
  const three = await request('Petra Lang', [{ fieldId: 'system_count', value: 2 }, { fieldId: 'system_operational', value: 'no,_it_is_not_cooling_/_broken' }, { fieldId: 'indoor_location', value: 'attic' }, { fieldId: 'weekend_visit', value: true }])
  check('2 systems, attic, weekend: $323, the four lines 129, 89, 45 and 60', three.pricing.subtotal === 323 && JSON.stringify(three.pricing.breakdown?.map((l) => l.amount)) === '[129,89,45,60]', three.pricing)
  const sameAsTest = await preview(biz, AC_BODY, { system_count: 2, indoor_location: 'Attic', weekend_visit: true }, ac.id)
  check('…and the test price for the same answers has the same lines and amounts', JSON.stringify(sameAsTest.price?.lines.map((l) => [l.label, l.amount])) === JSON.stringify(three.pricing.breakdown?.map((l) => [l.label, l.amount])), { test: sameAsTest.price?.lines, real: three.pricing.breakdown })
  const after = (await rows('usage_counters', `tenant_id=eq.${biz.tenantId}&select=estimates_created`)).reduce((sum, r) => sum + Number(r.estimates_created), 0)
  check('testing a price counts nothing: only the three real requests were counted', after - before === 3, { before, after })
  check('…and made no quote of its own', (await rows('quotes', `tenant_id=eq.${biz.tenantId}&select=id`)).length === 3)

  // ---------------------------------------------------------------------------
  section('Pricing C. A service that is not saved yet is tested as the editor holds it (item 1)')
  const dearer = { ...AC_BODY, name: 'AC Tune-Up, new prices', workSteps: AC_TUNE_UP_STEPS.map((s) => (s.id === 'weekend_visit_surcharge' ? { ...s, defaultCost: 75 } : s)) }
  const unsaved = await preview(biz, { ...dearer, pricingRules: { ...AC_BODY.pricingRules, workSteps: dearer.workSteps } }, { system_count: 2, indoor_location: 'Attic', weekend_visit: true })
  check('a weekend price changed in the editor and not saved is the one tested: 263 + 75 = 338', unsaved.price?.subtotal === 338, unsaved.price?.lines)
  check('…and the saved service is untouched', ((await rows('services', `id=eq.${ac.id}&select=work_steps`))[0]?.work_steps as Array<{ id: string; defaultCost: number }>).find((s) => s.id === 'weekend_visit_surcharge')?.defaultCost === 60)

  // ---------------------------------------------------------------------------
  section('Pricing D. A detail the photos give can be tried (item 2)')
  // the template's service as "Add from a template" posts it: the pack's own service, switched off
  const template = waterHeaterPackUS.services[0]!
  const heaterBody = { ...servicePayload({ name: template.name, description: template.description, draft: template.draft, addons: template.addons || [], multipliers: template.multipliers || [] }), active: false }
  const heater = expectOk('water heater service', await http('POST', `${app}/api/services`, { headers: biz.cookie, body: heaterBody })).service as { id: string; name: string; active: boolean }
  const heaterService = { ...heaterBody, suggestedFields: heaterBody.draftConfig?.suggestedFields ?? [] }
  const bare = await preview(biz, heaterService, {}, heater.id)
  const read = await preview(biz, heaterService, { [photoKey('tank_capacity')]: '50 gal', [photoKey('water_heater_fuel')]: 'Natural gas' }, heater.id)
  check('with nothing read from a label the preview has only the lines every job has', bare.status === 200 && (bare.price?.subtotal ?? 0) > 0 && (bare.price?.subtotal ?? 0) < (read.price?.subtotal ?? 0), { bare: bare.price?.lines, read: read.price?.lines })
  check('with "50 gal" and "Natural gas" tried, the tank’s own line is priced: $2,150 in all, the template’s figure', read.price?.subtotal === 2150, read.price?.lines)
  const electric = await preview(biz, heaterService, { [photoKey('tank_capacity')]: '50 gal', [photoKey('water_heater_fuel')]: 'Electric' }, heater.id)
  check('…and another fuel gives another price', electric.status === 200 && typeof electric.price?.subtotal === 'number' && electric.price.subtotal !== read.price?.subtotal, electric.price?.lines)

  // ---------------------------------------------------------------------------
  section('Pricing G. "Photos required" is respected by the customer’s form (item 7)')
  const needsTwo = expectOk('service needing photos', await http('POST', `${app}/api/services`, { headers: biz.cookie, body: { ...AC_BODY, name: 'AC Tune-Up with photos', mediaConfig: { minPhotos: 2, maxPhotos: 6, photoGuidance: null, requiredAngles: [] } } })).service as { id: string; media_config: { minPhotos: number } }
  const refused = await http('POST', `${app}/api/public/quotes`, {
    body: { tenantKey: key, serviceId: needsTwo.id, customer: { name: 'Quinn Adler', email: 'quinn.adler@example.com', phone: '(555) 201-3434' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: 'system_count', value: 1 }, { fieldId: 'system_operational', value: 'yes,_it_is_running_normally' }, { fieldId: 'indoor_location', value: 'basement' }, { fieldId: 'weekend_visit', value: false }] }, source: { type: 'widget' } },
  })
  check('a service that requires 2 photos refuses a request with none, and says how many', refused.status === 400 && /at least 2 photos/.test(JSON.stringify(refused.json)), { status: refused.status, body: refused.json })
  check('a service that requires 0 took its requests with no photo (section B)', one.pricing.subtotal === 129)
  const tooMany = await http('PATCH', `${app}/api/services/${needsTwo.id}`, { headers: biz.cookie, body: { mediaConfig: { minPhotos: 20, maxPhotos: 8, photoGuidance: null } } })
  check('"Photos required" is kept within 0 to 8 on save', tooMany.status === 200 && ((await rows('services', `id=eq.${needsTwo.id}&select=media_config`))[0]?.media_config as { minPhotos: number }).minPhotos === 8)
  const config = await http('GET', `${app}/api/public/widget/config?tenantKey=${key}`)
  const offered = ((config.json?.services ?? []) as Array<{ id: string; mediaConfig?: { minPhotos?: number } }>)
  check('the form is told each service’s own number (0 for the first, 8 for this one)', offered.find((s) => s.id === ac.id)?.mediaConfig?.minPhotos === 0 && offered.find((s) => s.id === needsTwo.id)?.mediaConfig?.minPhotos === 8, offered.map((s) => [s.id, s.mediaConfig?.minPhotos]))

  // ---------------------------------------------------------------------------
  section('Pricing E, F, H. In a browser: the flags, the test price, the links, the name warning, "Save and switch on"')
  const { browserDeps } = await import('../browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
    const origin = new URL(app).origin
    await ctx.addCookies(biz.cookie.Cookie.split('; ').map((pair: string) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
    const p = await ctx.newPage()
    const next = () => p.getByRole('button', { name: 'Next', exact: true }).click()
    const openService = async (name: string) => {
      await p.goto(`${app}/app/services`, { waitUntil: 'networkidle' })
      // by its whole name: "AC Tune-Up" is not "AC Tune-Up with photos"
      await p.locator('[data-testid=service-row]').filter({ has: p.getByText(name, { exact: true }) }).first().locator('[data-testid=service-edit]').click()
      await p.getByRole('button', { name: 'Next', exact: true }).waitFor({ timeout: 20_000 })
    }

    // H: the list
    await p.goto(`${app}/app/services`, { waitUntil: 'networkidle' })
    const offRow = p.locator('[data-testid=service-row]').filter({ has: p.getByText(heater.name, { exact: true }) }).first()
    const pill = offRow.locator('[data-testid=service-state]')
    check('a switched-off service reads "Inactive" in the warning colour', (await pill.innerText()).trim() === 'Inactive' && /text-tertiary/.test((await pill.getAttribute('class')) ?? ''), await pill.getAttribute('class'))

    // E: the AC service
    await openService('AC Tune-Up')
    await next() // scope & photos
    const required = p.locator('[data-testid=photos-required]')
    check('"Photos required" is on "Scope & Photos", with what 0 means', (await required.inputValue()) === '0' && (await p.locator('#photos-required-hint').innerText()).includes('Photos are optional'), await p.locator('#photos-required-hint').innerText().catch(() => null))
    await required.fill('3')
    check('…and says what a number means for the customer', (await p.locator('#photos-required-hint').innerText()).includes('at least 3 photos'))
    await required.fill('0')
    await next() // questions
    await next() // pricing
    await p.locator('[data-testid=step-header]', { hasText: 'Attic unit surcharge' }).first().waitFor({ timeout: 20_000 })
    const pricingText = await p.locator('[data-testid=service-form]').innerText()
    check('the line editor says what decides the attic line: "Only include when Indoor Unit Location = Attic"', pricingText.includes('Only include when Indoor Unit Location = Attic'), pricingText.slice(0, 600))
    check('…and that "Additional Systems" counts the answer minus 1 (it used to read "needs link")', pricingText.includes('"Number of AC Systems" minus 1') && !pricingText.includes('needs link'))
    await next() // test & publish
    await p.locator('[data-testid=pricing-test]').waitFor({ timeout: 20_000 })
    const flags = p.locator('[data-testid=pricing-flags]')
    const flagText = (await flags.count()) ? await flags.innerText() : ''
    check('"Test & Publish" flags the two questions no price line reads, in the ticket’s words', flagText.includes('Is your AC currently cooling?') && flagText.includes('When was the system last serviced?') && flagText.includes(QUESTION_UNUSED_MESSAGE), flagText)
    check('…flags none of the questions a line does read, and no line', !flagText.includes('weekend visit') && !flagText.includes('Number of AC Systems') && (await p.locator('[data-testid=flag-line_unlinked]').count()) === 0, flagText)
    check('…and saving is still allowed', await p.getByRole('button', { name: 'Save Changes' }).isEnabled())

    await p.locator('#test-system_count').fill('2')
    await p.locator('#test-indoor_location').selectOption('Attic')
    await p.locator('[data-testid=calculate-preview]').click()
    await p.locator('[data-testid=test-result]').waitFor({ timeout: 30_000 })
    const resultText = await p.locator('[data-testid=test-result]').innerText()
    check('2 systems with one in the attic shows $263.00', (await p.locator('[data-testid=sample-total]').innerText()).includes('$263.00'), resultText)
    const notCharged = (await p.locator('[data-testid=test-not-included]').count()) ? await p.locator('[data-testid=test-not-included]').innerText() : ''
    check('…and lists what was not charged, with the answer that decides each', notCharged.includes('Weekend visit surcharge') && notCharged.includes('Only include when Do you require a weekend visit? = Yes') && notCharged.includes('Refrigerant top-up'), notCharged)
    await p.locator('label', { hasText: 'Do you require a weekend visit?' }).locator('input[type=checkbox]').check()
    check('changing an answer clears the old price until it is worked out again', (await p.locator('[data-testid=test-result]').count()) === 0)
    await p.locator('[data-testid=calculate-preview]').click()
    await p.locator('[data-testid=test-result]').waitFor({ timeout: 30_000 })
    check('with the weekend box ticked it shows $323.00', (await p.locator('[data-testid=sample-total]').innerText()).includes('$323.00'), await p.locator('[data-testid=test-result]').innerText())
    await p.locator('[data-testid=service-modal-close]').click()

    // F and H: the water heater template's service (switched off)
    await openService(heater.name)
    await next()
    await next()
    await next()
    await next()
    await p.locator('[data-testid=pricing-test]').waitFor({ timeout: 20_000 })
    const heaterStep = await p.locator('[data-testid=service-form]').innerText()
    check(`"${heater.name}" has no warning about "Repair"`, !/Service name includes/.test(heaterStep), heaterStep.slice(-700))
    const fromPhotos = p.locator('[data-testid=test-from-photos]')
    check('the details read from a label are offered under "From the customer’s photos"', (await fromPhotos.count()) === 1 && (await fromPhotos.locator('[data-testid=photo-detail]').count()) >= 2, (await fromPhotos.count()) ? await fromPhotos.innerText() : null)
    await p.locator(`[id="${photoKey('tank_capacity')}"]`).selectOption('50 gal')
    await p.locator(`[id="${photoKey('water_heater_fuel')}"]`).selectOption('Natural gas')
    await p.locator('[data-testid=calculate-preview]').click()
    await p.locator('[data-testid=test-result]').waitFor({ timeout: 30_000 })
    check('trying "50 gal" and "Natural gas" shows $2,150.00', (await p.locator('[data-testid=sample-total]').innerText()).replace(/,/g, '').includes('$2150.00'), await p.locator('[data-testid=test-result]').innerText())
    check('a switched-off service says so beside the buttons, and offers "Save and switch on"', (await p.locator('[data-testid=save-off-note]').innerText()).includes('switched off') && (await p.locator('[data-testid=save-switch-on]').isVisible()) && (await p.locator('[data-testid=save-keep-off]').isVisible()))
    await p.locator('[data-testid=save-keep-off]').click()
    await p.locator('[data-testid=service-modal-close]').waitFor({ state: 'detached', timeout: 20_000 })
    check('"Save Changes" leaves it switched off', (await rows('services', `id=eq.${heater.id}&select=active`))[0]?.active === false)
    await openService(heater.name)
    await next()
    await next()
    await next()
    await next()
    await p.locator('[data-testid=save-switch-on]').click()
    await p.locator('[data-testid=service-modal-close]').waitFor({ state: 'detached', timeout: 20_000 })
    check('"Save and switch on" switches it on', (await rows('services', `id=eq.${heater.id}&select=active`))[0]?.active === true)
    check('…and its row reads "Active"', (await p.locator('[data-testid=service-row]').filter({ has: p.getByText(heater.name, { exact: true }) }).first().locator('[data-testid=service-state]').innerText()).trim() === 'Active')

    // -------------------------------------------------------------------------
    section('Pricing I. "Add to this quote" on "Customer also asked for" (item 4)')
    const shop = await h.business('add')
    const shopKey = await h.siteKey(shop)
    const main = await h.paintService(shop)
    const flat = expectOk('a fixed-price service', await http('POST', `${app}/api/services`, {
      headers: shop.cookie,
      body: { name: 'Gutter clearing', description: 'Clearing of gutters and downpipes.', mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: null }, workSteps: [{ id: 'clear', name: 'Clear the gutters', description: 'Clear the gutters', costType: 'fixed', defaultCost: 90, optional: false }], expectedSignals: [], suggestedFields: [], pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [{ id: 'clear', name: 'Clear the gutters', description: 'Clear the gutters', costType: 'fixed', defaultCost: 90, optional: false }] } },
    })).service as { id: string }
    const counted = expectOk('a service that needs an answer', await http('POST', `${app}/api/services`, {
      headers: shop.cookie,
      body: { name: 'Window washing', description: 'Washing of windows, inside and out.', mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: null }, workSteps: [{ id: 'wash', name: 'Wash windows', description: 'Wash windows', costType: 'per_unit', defaultCost: 12, unitLabel: 'windows', optional: false, quantitySource: { type: 'form_field', fieldId: 'window_count' } }], expectedSignals: [], suggestedFields: [{ fieldId: 'window_count', label: 'How many windows?', type: 'number', required: true, criticalForPricing: true }], pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [{ id: 'wash', name: 'Wash windows', description: 'Wash windows', costType: 'per_unit', defaultCost: 12, unitLabel: 'windows', optional: false, quantitySource: { type: 'form_field', fieldId: 'window_count' } }] } },
    })).service as { id: string }
    const quoteRow = async (id: string) => (await rows('quotes', `id=eq.${id}&select=*`))[0] ?? {}
    const asked = (serviceId: string, serviceName: string, words: string) => ({ id: `also_${serviceId}`, words, serviceId, serviceName, state: 'offered' })
    /** What the worker's first pass leaves when a customer's note asks for another service too */
    const withAlsoAsked = async (id: string, items: unknown[]) => {
      const row = await quoteRow(id)
      expectOk('also asked', await patch('quotes', `id=eq.${id}`, { content_json: { ...((row.content_json as Row | null) ?? {}), alsoAsked: items } }))
    }
    const usedBy = async () => (await rows('usage_counters', `tenant_id=eq.${shop.tenantId}&select=estimates_created`)).reduce((sum, r) => sum + Number(r.estimates_created), 0)

    // a held quote (the service's default: shown, then confirmed)
    const held = await h.submit(shopKey, main, 'Rhea Calder')
    const heldRow = await h.waitForQuote(held.id, done)
    const heldTotal = Number((heldRow.pricing_json as { total?: number } | null)?.total)
    check('a request is priced and waits for the business', heldRow.status === 'pending_review' && heldTotal > 0, { status: heldRow.status, total: heldTotal })
    await withAlsoAsked(held.id, [asked(flat.id, 'Gutter clearing', 'clear the gutters while you are here'), asked(counted.id, 'Window washing', 'and wash the windows')])
    const usedBefore = await usedBy()

    const shopCtx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
    await shopCtx.addCookies(shop.cookie.Cookie.split('; ').map((pair: string) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
    const q = await shopCtx.newPage()
    await q.goto(`${app}/app/quotes/${held.id}`, { waitUntil: 'networkidle' })
    const panel = q.locator('[data-testid=customer-also-asked]')
    await panel.waitFor({ timeout: 30_000 })
    const gutters = panel.locator('[data-testid=also-asked-item]', { hasText: 'Gutter clearing' })
    check('each of the business’s services the customer also asked for has "Add to this quote"', (await panel.locator('[data-testid=add-to-quote-button]').count()) === 2 && (await gutters.locator('[data-testid=add-to-quote-button]').innerText()).trim() === 'Add to this quote')
    await gutters.locator('[data-testid=add-to-quote-button]').click()
    await q.locator('[data-testid=also-asked-item][data-state=added]', { hasText: 'Gutter clearing' }).waitFor({ timeout: 30_000 })
    const afterFlat = await quoteRow(held.id)
    const flatPricing = afterFlat.pricing_json as { total: number; subtotal: number; sections?: Array<{ serviceId: string; subtotal: number; addedBy: string }> }
    check('on a held quote it is added at once, as a section priced from that service’s own list ($90)', flatPricing.sections?.length === 1 && flatPricing.sections[0]!.serviceId === flat.id && flatPricing.sections[0]!.subtotal === 90 && flatPricing.sections[0]!.addedBy === 'business', flatPricing.sections)
    check('…one total: the quote’s own price plus $90', Math.abs(flatPricing.total - (heldTotal + 90)) < 0.005, { was: heldTotal, now: flatPricing.total })
    check('…the quote still waits for approval, and the panel says "Added by you"', afterFlat.status === 'pending_review' && (await q.locator('[data-testid=also-asked-item]', { hasText: 'Gutter clearing' }).locator('[data-testid=also-asked-state]').innerText()).trim() === 'Added by you', afterFlat.status)

    const windows = q.locator('[data-testid=also-asked-item]', { hasText: 'Window washing' })
    await windows.locator('[data-testid=add-to-quote-button]').click()
    await windows.locator('[data-testid=add-to-quote-questions]').waitFor({ timeout: 30_000 })
    check('a service that needs an answer asks for it first', (await windows.locator('[data-testid=add-to-quote-questions]').innerText()).includes('How many windows?') && (await windows.locator('[data-testid=add-to-quote-button]').isDisabled()))
    await windows.locator('[data-testid=add-to-quote-questions] input').fill('6')
    await windows.locator('[data-testid=add-to-quote-button]').click()
    await q.locator('[data-testid=also-asked-item][data-state=added]', { hasText: 'Window washing' }).waitFor({ timeout: 30_000 })
    const afterBoth = (await quoteRow(held.id)).pricing_json as { total: number; sections?: Array<{ serviceId: string; subtotal: number }> }
    check('…and is then added at its own price: 6 windows × $12 = $72', afterBoth.sections?.length === 2 && afterBoth.sections.find((s) => s.serviceId === counted.id)?.subtotal === 72 && Math.abs(afterBoth.total - (heldTotal + 90 + 72)) < 0.005, afterBoth)
    check('it is still one quote and nothing more was counted on the plan', (await rows('quotes', `tenant_id=eq.${shop.tenantId}&select=id`)).length === 1 && (await usedBy()) === usedBefore, { used: await usedBy(), usedBefore })

    // a quote the customer already has
    const sentQuote = await h.submit(shopKey, main, 'Silas Brandt')
    const sentRow = await h.waitForQuote(sentQuote.id, done)
    const approve = await http('POST', `${app}/api/quotes/${sentQuote.id}/approve`, { headers: shop.cookie, body: {} })
    const sentTotal = Number((sentRow.pricing_json as { total?: number } | null)?.total)
    const approved = await quoteRow(sentQuote.id)
    check('a second request is approved and sent', approve.status === 200 && approved.status === 'sent', { status: approve.status, quote: approved.status })
    await withAlsoAsked(sentQuote.id, [asked(flat.id, 'Gutter clearing', 'please also clear the gutters')])
    await q.goto(`${app}/app/quotes/${sentQuote.id}`, { waitUntil: 'networkidle' })
    await q.locator('[data-testid=add-to-quote-button]').click()
    await q.locator('[data-testid=add-to-quote-confirm]').waitFor({ timeout: 30_000 })
    const stillSent = await quoteRow(sentQuote.id)
    check('on a sent quote the business is asked first, and told the customer will be emailed the update', (await q.locator('[data-testid=add-to-quote-confirm]').innerText()).includes('emails Silas the updated quote') && stillSent.status === 'sent' && !(stillSent.pricing_json as { sections?: unknown[] }).sections?.length)
    await q.locator('[data-testid=add-to-quote-send]').click()
    await q.locator('[data-testid=also-asked-item][data-state=added]').waitFor({ timeout: 30_000 })
    const revised = await quoteRow(sentQuote.id)
    const revisedPricing = revised.pricing_json as { total: number; sections?: Array<{ subtotal: number }> }
    check('…then it is a revision of the same quote: status "revised", a new version, total up by $90', revised.status === 'revised' && Number(revised.version) === Number(approved.version) + 1 && revisedPricing.sections?.[0]?.subtotal === 90 && Math.abs(revisedPricing.total - (sentTotal + 90)) < 0.005, { status: revised.status, version: revised.version, total: revisedPricing.total })
    check('…recorded as one change in the quote’s history', (await rows('quote_amendments', `quote_id=eq.${sentQuote.id}&select=id`)).length === 1)
    check('an accepted quote offers no "Add to this quote"', await (async () => {
      expectOk('accept by hand', await patch('quotes', `id=eq.${sentQuote.id}`, { status: 'accepted', accepted_at: new Date().toISOString() }))
      await withAlsoAsked(sentQuote.id, [asked(counted.id, 'Window washing', 'and the windows')])
      await q.goto(`${app}/app/quotes/${sentQuote.id}`, { waitUntil: 'networkidle' })
      await q.locator('[data-testid=customer-also-asked]').waitFor({ timeout: 30_000 })
      return (await q.locator('[data-testid=add-to-quote-button]').count()) === 0
    })())

    // -------------------------------------------------------------------------
    section('Pricing J. "Photos could not be read" on a held quote (item 29)')
    const unread = { steps: [{ step: 'photos', why: 'timeout' }], at: new Date().toISOString() }
    const third = await h.submit(shopKey, main, 'Tessa Wynn')
    const thirdRow = await h.waitForQuote(third.id, done)
    // what the worker saves when a photo reading failed: held as a check, with the record on the quote
    expectOk('held with the record', await patch('quotes', `id=eq.${third.id}`, { status: 'pending_review', review_hold: 'check', content_json: { ...((thirdRow.content_json as Row | null) ?? {}), photosUnread: unread } }))
    await q.goto(`${app}/app/quotes/${third.id}`, { waitUntil: 'networkidle' })
    const note = q.locator('[data-testid=photos-unread]')
    await note.waitFor({ timeout: 30_000 })
    const noteText = await note.innerText()
    check('the dashboard’s quote page says "Photos could not be read", and what to do', noteText.toUpperCase().includes(PHOTOS_UNREAD_NOTE.toUpperCase()) && noteText.includes(photosUnreadSentence(unread as never)), noteText)
    const view = await http('GET', `${app}/api/public/quotes/${third.id}?token=${third.token}`)
    // a held quote's price is withheld as nothing at all: no total, no lines (T-201, AD-090)
    const shown = (view.json?.pricing ?? {}) as { total?: number; subtotal?: number; breakdown?: unknown[] }
    check('the customer is given no figure for it, and nothing about the failed reading', view.status === 200 && !(Number(shown.total) > 0) && !(Number(shown.subtotal) > 0) && (shown.breakdown ?? []).length === 0 && !JSON.stringify(view.json).includes('could not be read'), { status: view.status, pricing: view.json?.pricing })
    expectOk('back to an ordinary hold', await patch('quotes', `id=eq.${third.id}`, { content_json: { ...((thirdRow.content_json as Row | null) ?? {}) } }))
    await q.goto(`${app}/app/quotes/${third.id}`, { waitUntil: 'networkidle' })
    await q.locator('h1').first().waitFor({ timeout: 30_000 })
    check('a quote with no such record shows no such note', (await q.locator('[data-testid=photos-unread]').count()) === 0)
  } finally {
    await browser.close()
  }
}
