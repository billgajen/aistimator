// T-201, the service editor (items 5 to 10 and 12). Local stack only; no model is asked.
//
// What it proves:
//   A. (10) a fixed line ticked "Only include when condition is met" with no question is refused by
//      both save routes, with the line named; nothing is written
//   B. (6) on a real service (a template's Interior Painting): a request is priced, both questions are
//      renamed the way the editor does it, the keys do not move, and the same request comes to the
//      same price, line for line
//   C. (5, 6, 7, 9, 10, 12) in the editor itself, in a browser, for a business that charges in pounds:
//      a service made by hand keeps its question; every amount box shows "£"; the ticked line with no
//      question stops the save and says why; renaming the question leaves the line attached;
//      a template's service is added switched off and the page says so; "Regenerate" asks first and
//      "Cancel" changes nothing
//
// Item 8 ("Describe your pricing" naming what it left out) needs the model, so it is unit tests only
// (apps/web/src/__tests__/services-t201.test.ts).
import type { Harness, Row } from './harness.mts'
import { syncQuestions, lineNeedsQuestion } from '../../../apps/web/src/lib/service-questions'
import { servicePayload } from '../../../apps/web/src/lib/onboarding-service'
import { paintingPackUS } from '../../../apps/web/src/lib/vertical-packs/painting-us'

type Field = { fieldId: string; label: string; mapsToSignal?: string; type: string }
type Step = { name: string; optional?: boolean; triggerSignal?: string }
type Priced = { total?: number; breakdown?: Array<{ label: string; amount: number }> }

export async function run(h: Harness): Promise<void> {
  const { app, http, check, section, rows, expectOk } = h
  const serviceRow = async (id: string) => (await rows('services', `id=eq.${id}&select=*`))[0] ?? {}
  const formFields = async (serviceId: string) => (((await rows('widget_configs', `service_id=eq.${serviceId}&select=config_json`))[0]?.config_json as { fields?: Field[] } | undefined)?.fields ?? []) as Field[]

  // ---------------------------------------------------------------------------
  section('Services A. A fixed line with "Only include when…" and no question is not saved (item 10)')
  const biz = await h.business('svc')
  const dead = { id: 'step_dead', name: 'Disposal fee', description: '', costType: 'fixed', defaultCost: 45, optional: true }
  const callout = { id: 'step_callout', name: 'Callout', description: '', costType: 'fixed', defaultCost: 80, optional: false }
  const body = (steps: unknown[]) => ({ name: 'Gutter clearing', description: null, workSteps: steps, pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: steps } })

  const refused = await http('POST', `${app}/api/services`, { headers: biz.cookie, body: body([callout, dead]) })
  check('creating a service with such a line is refused', refused.status === 400 && refused.json?.error?.code === 'INVALID_INPUT', [refused.status, refused.json?.error])
  check('…and the answer names the line and what is missing', refused.json?.error?.message === lineNeedsQuestion(dead), refused.json?.error?.message)
  check('…and no service was created', (await rows('services', `tenant_id=eq.${biz.tenantId}&select=id`)).length === 0)

  const made = expectOk('a service', await http('POST', `${app}/api/services`, { headers: biz.cookie, body: body([callout]) })) as { service: { id: string } }
  const patched = await http('PATCH', `${app}/api/services/${made.service.id}`, { headers: biz.cookie, body: { workSteps: [callout, dead], pricingRules: body([callout, dead]).pricingRules } })
  check('saving one onto an existing service is refused the same way', patched.status === 400 && patched.json?.error?.message === lineNeedsQuestion(dead), [patched.status, patched.json?.error])
  const kept = ((await rows('service_pricing_rules', `service_id=eq.${made.service.id}&select=rules_json`))[0]?.rules_json as { workSteps?: Step[] } | undefined)?.workSteps ?? []
  check('…and the service keeps the lines it had', kept.length === 1 && kept[0]?.name === 'Callout' && ((await serviceRow(made.service.id)).work_steps as Step[]).length === 1, kept)
  const withQuestion = { ...dead, triggerSignal: 'has_old_unit', triggerCondition: { operator: 'exists' } }
  const allowed = await http('PATCH', `${app}/api/services/${made.service.id}`, { headers: biz.cookie, body: { workSteps: [callout, withQuestion], pricingRules: body([callout, withQuestion]).pricingRules } })
  check('with its question chosen, the same line saves', allowed.ok, [allowed.status, allowed.json?.error])
  const offOn = await http('PATCH', `${app}/api/services/${made.service.id}`, { headers: biz.cookie, body: { active: false } })
  check('switching a service off or on is never stopped by this rule', offOn.ok && offOn.json?.service?.active === false, [offOn.status, offOn.json?.error])

  // ---------------------------------------------------------------------------
  section('Services B. A real service: its questions renamed, the same request, the same price (item 6)')
  const paint = await h.business('paint')
  const tenantKey = await h.siteKey(paint)
  const pack = paintingPackUS.services.find((s) => s.name === 'Interior Painting')!
  const payload = servicePayload({ name: pack.name, description: pack.description, draft: pack.draft, addons: pack.addons ?? [], multipliers: pack.multipliers ?? [] } as Parameters<typeof servicePayload>[0]) as ReturnType<typeof servicePayload> & { mediaConfig: { minPhotos: number } }
  payload.mediaConfig = { ...payload.mediaConfig, minPhotos: 0 }
  const interior = (expectOk('Interior Painting', await http('POST', `${app}/api/services`, { headers: paint.cookie, body: { ...payload, autoSend: true } })) as { service: { id: string } }).service.id
  const answers = [
    { fieldId: '_project_description', value: 'Three bedrooms, walls and ceilings, high ceilings throughout' },
    { fieldId: 'room_count', value: 3 },
    { fieldId: 'ceiling_height_answer', value: 'High (9 ft or more)' },
  ]
  const priceOf = async (who: string): Promise<Priced> => {
    const sent = await h.submit(tenantKey, interior, who, answers)
    const row = await h.waitForQuote(sent.id, (q) => Boolean((q.pricing_json as Priced | null)?.total) || q.status === 'failed', 150)
    return (row.pricing_json ?? {}) as Priced
  }
  const first = await priceOf('Dana Whitlock')
  check('the request is priced before the change', typeof first.total === 'number' && first.total > 0 && (first.breakdown?.length ?? 0) > 0, first)

  // the change, made the way the editor makes it: the editor hands back new labels, the page gives the keys
  const before = (await serviceRow(interior)) as { draft_config: { suggestedFields: Field[] } & Row; expected_signals: Array<{ signalKey: string } & Row> }
  const wasFields = before.draft_config.suggestedFields
  const renamed = syncQuestions({
    fields: wasFields.map((f, i) => ({ ...f, label: i === 0 ? 'Rooms to paint (count hallways too)' : 'Are your ceilings higher than usual?' })) as never,
    previousFields: wasFields as never,
    previousSignals: before.expected_signals as never,
    savedFieldIds: wasFields.map((f) => f.fieldId),
    workSteps: pack.draft.pricing.workSteps,
    multipliers: pack.multipliers ?? [],
  })
  expectOk('save the renamed questions', await http('PATCH', `${app}/api/services/${interior}`, {
    headers: paint.cookie,
    body: { expectedSignals: renamed.signals, draftConfig: { ...before.draft_config, suggestedFields: renamed.fields } },
  }))
  const after = (await serviceRow(interior)) as typeof before
  const nowFields = after.draft_config.suggestedFields
  check('both questions carry their new labels', nowFields[0]?.label === 'Rooms to paint (count hallways too)' && nowFields[1]?.label === 'Are your ceilings higher than usual?', nowFields.map((f) => f.label))
  check('…and exactly the keys they had', JSON.stringify(nowFields.map((f) => [f.fieldId, f.mapsToSignal])) === JSON.stringify(wasFields.map((f) => [f.fieldId, f.mapsToSignal])), nowFields.map((f) => [f.fieldId, f.mapsToSignal]))
  check('the facts the template set are untouched (what a room scan fills, the choices)', JSON.stringify(after.expected_signals) === JSON.stringify(before.expected_signals), after.expected_signals)
  const onForm = await formFields(interior)
  check('the customer’s form asks under the same keys, in the new words', onForm.length === 2 && onForm[0]?.fieldId === 'room_count' && onForm[0]?.label === 'Rooms to paint (count hallways too)' && onForm[1]?.fieldId === 'ceiling_height_answer', onForm)

  const second = await priceOf('Ines Marlow')
  check('the same request comes to the same total', second.total === first.total, { before: first.total, after: second.total })
  check('…line for line', JSON.stringify((second.breakdown ?? []).map((l) => l.amount)) === JSON.stringify((first.breakdown ?? []).map((l) => l.amount)), { before: first.breakdown, after: second.breakdown })
  check('…and the price still counts three rooms and the high ceilings', (second.breakdown ?? []).some((l) => /3/.test(l.label)) && (second.breakdown ?? []).length === (first.breakdown ?? []).length && (second.breakdown ?? []).length >= 2, second.breakdown)

  // ---------------------------------------------------------------------------
  section('Services C. The editor, in a browser, for a business that charges in pounds (items 5, 6, 7, 9, 10, 12)')
  const uk = await h.business('uk', { region: 'GB', currency: 'GBP' })
  const { browserDeps } = await import('../browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const origin = new URL(app).origin
    await ctx.addCookies(
      uk.cookie.Cookie.split('; ').map((pair: string) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      })
    )
    const p = await ctx.newPage()
    const drafts: string[] = []
    p.on('request', (r) => {
      if (r.url().includes('/api/services/ai-draft')) drafts.push(r.url())
    })
    const next = () => p.getByRole('button', { name: 'Next', exact: true }).click()
    const form = p.locator('[data-testid=service-form]')
    const mine = async (name: string) => ((await rows('services', `tenant_id=eq.${uk.tenantId}&name=eq.${encodeURIComponent(name)}&select=*`))[0] ?? {}) as Row & { id?: string; active?: boolean; draft_config?: { source?: string; suggestedFields?: Field[] }; work_steps?: Step[] }

    await p.goto(`${app}/app/services`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'Add your first service' }).click()
    await p.getByPlaceholder('e.g., Kitchen Renovation').fill('Gate repair')
    await next() // no description, so no draft is written
    await p.getByText("What's Typically Included").first().waitFor({ timeout: 20_000 })
    await next()
    await p.getByRole('button', { name: 'Add your first question' }).click()
    await p.getByPlaceholder('e.g., Number of Rooms').fill('Is the gate electric?')
    await p.locator('select').filter({ hasText: 'Yes/No Toggle' }).selectOption('boolean')
    await next()

    // item 9: every amount box in the business's currency
    await p.getByRole('button', { name: 'Add your first line item' }).click()
    await p.getByPlaceholder('e.g., Bedroom Cleaning').fill('Motor check')
    const symbols = await p.locator('[data-testid=amount-symbol]').allInnerTexts()
    check('every amount box shows "£" (base fee, minimum charge, the line)', symbols.length === 3 && symbols.every((s) => s.trim() === '£'), symbols)
    check('…and the line’s own summary is in pounds, with no "$" on the step', /£25\.00/.test(await form.innerText()) && !/\$/.test(await form.innerText()), (await form.innerText()).slice(0, 300))

    // item 10: ticked, no question
    await p.getByLabel('Only include when condition is met').check()
    check('ticking "Only include when…" with no question says so on the line', await p.locator('[data-testid=step-needs-question]').isVisible())
    await next()
    const blocked = await form.innerText()
    check('"Test & Publish" lists it under "Fix Before Publishing"', blocked.includes('Fix Before Publishing') && blocked.includes('"Motor check" is set to "Only include when condition is met", but no question is chosen.'), blocked.slice(-600))
    check('…and "Create Service" cannot be pressed', await p.getByRole('button', { name: 'Create Service' }).isDisabled())
    await p.getByRole('button', { name: 'Back', exact: true }).click()
    await p.locator('[data-testid=step-header]', { hasText: 'Motor check' }).click()
    const choice = p.locator('[data-testid=step-condition-question]')
    const signalKey = await choice.locator('option', { hasText: 'Is the gate electric?' }).getAttribute('value')
    await choice.selectOption(signalKey ?? '')
    await next()
    check('with the question chosen it is "Ready to Publish"', (await form.innerText()).includes('Ready to Publish'))
    await p.getByRole('button', { name: 'Create Service' }).click()
    await p.locator('[data-testid=service-row]').first().waitFor({ timeout: 20_000 })

    // item 5: made by hand (no description, no draft), and its question is saved
    const gate = await mine('Gate repair')
    const asked = gate.draft_config?.suggestedFields ?? []
    check('the service made by hand is saved with its question', asked.length === 1 && asked[0]?.label === 'Is the gate electric?' && Boolean(asked[0]?.fieldId), gate.draft_config)
    check('…in a draft marked as made by hand, with no "AI Draft" mark on its row', gate.draft_config?.source === 'manual' && !(await p.locator('[data-testid=service-row]').first().innerText()).includes('AI Draft'), gate.draft_config?.source)
    check('…and the customer’s form asks it', (await formFields(gate.id ?? '')).map((f) => f.label).join() === 'Is the gate electric?', await formFields(gate.id ?? ''))
    check('no draft was asked for along the way', drafts.length === 0, drafts)
    const keys = { fieldId: asked[0]?.fieldId, signal: asked[0]?.mapsToSignal }
    check('the line is tied to the question by its key', gate.work_steps?.[0]?.triggerSignal === keys.signal && Boolean(keys.signal), gate.work_steps)

    // item 6, in the editor: rename the question; the line stays attached
    await p.locator('[data-testid=service-edit]').first().click()
    await next()
    await next()
    await p.getByText('Is the gate electric?').first().click()
    await p.getByPlaceholder('e.g., Number of Rooms').fill('Does the gate have a motor?')
    await next()
    await p.locator('[data-testid=step-header]', { hasText: 'Motor check' }).click()
    const still = p.locator('[data-testid=step-condition-question]')
    check('after renaming the question, the line still names it, in the new words', (await still.inputValue()) === keys.signal && (await still.locator('option:checked').innerText()) === 'Does the gate have a motor?', [await still.inputValue(), await still.locator('option:checked').innerText()])
    await next()
    const ready = await form.innerText()
    check('…and the service is still "Ready to Publish", with nothing cut loose', ready.includes('Ready to Publish') && !ready.includes('no longer has') && !ready.includes('doesn’t exist') && !ready.includes("doesn't exist"), ready.slice(-500))
    await p.getByRole('button', { name: 'Save Changes' }).click()
    await p.locator('[data-testid=service-modal-close]').waitFor({ state: 'detached', timeout: 20_000 })
    const renamedGate = await mine('Gate repair')
    const now = renamedGate.draft_config?.suggestedFields?.[0]
    check('saved: the new label under the same two keys', now?.label === 'Does the gate have a motor?' && now?.fieldId === keys.fieldId && now?.mapsToSignal === keys.signal, now)
    check('…the line unchanged, and the form in the new words under the same key', renamedGate.work_steps?.[0]?.triggerSignal === keys.signal && JSON.stringify((await formFields(gate.id ?? '')).map((f) => [f.fieldId, f.label])) === JSON.stringify([[keys.fieldId, 'Does the gate have a motor?']]), await formFields(gate.id ?? ''))

    // item 12: a template's service is added switched off
    await p.locator('[data-testid=add-from-template]').click()
    const offered = p.locator('[data-testid=template-service]').first()
    const templateName = (await offered.locator('p').first().innerText()).trim()
    check('the picker says a service you add starts switched off', (await p.getByRole('dialog').innerText()).includes('A service you add starts switched off.'))
    await offered.getByRole('button', { name: `Add ${templateName}` }).click()
    await p.locator('[data-testid=template-prices-note]').waitFor({ timeout: 20_000 })
    check('it opens at its prices with a note that they are examples and the service is off', (await p.locator('[data-testid=template-prices-note]').innerText()).includes('example prices'))
    const added = await mine(templateName)
    check('the service was created switched off', added.active === false, { name: templateName, active: added.active })
    check('…and nothing else was switched off', (await mine('Gate repair')).active === true)

    // item 7: "Regenerate" asks first; "Cancel" changes nothing and asks no model
    await p.getByRole('button', { name: 'Back', exact: true }).click()
    await p.getByRole('button', { name: 'Back', exact: true }).click()
    const includedBefore = await form.innerText()
    await p.locator('[data-testid=regenerate]').click()
    const asking = await p.locator('[data-testid=regenerate-confirm]').innerText()
    const questions = added.draft_config?.suggestedFields?.length ?? -1
    const lines = added.work_steps?.length ?? -1
    check('"Regenerate" asks before doing anything', asking.includes('Replace this service’s setup with a new draft?') || asking.includes("Replace this service's setup with a new draft?"), asking)
    check('…and names what it would replace, with how much of each there is', asking.includes(`Your questions (${questions} question${questions === 1 ? '' : 's'} now)`) && asking.includes(`Your price lines (${lines} line${lines === 1 ? '' : 's'} now)`) && asking.includes('Your add-ons (') && asking.includes('The photo settings'), asking)
    await p.locator('[data-testid=regenerate-cancel]').click()
    check('"Cancel" closes the question', (await p.locator('[data-testid=regenerate-confirm]').count()) === 0)
    check('…leaves the step exactly as it was', (await form.innerText()) === includedBefore)
    await next()
    const questionsStep = await form.innerText()
    check('…the questions too', (added.draft_config?.suggestedFields ?? []).every((f) => questionsStep.includes(f.label)) && !questionsStep.includes('No questions defined yet'), questionsStep.slice(0, 400))
    check('…and no draft was asked for', drafts.length === 0, drafts)
    await p.locator('[data-testid=service-modal-close]').click()

    // the page keeps saying it until the service is switched on
    const note = p.locator('[data-testid=template-added-note]')
    await note.waitFor({ timeout: 10_000 })
    check('back on Services, a note says it is switched off and its prices are examples', (await note.innerText()).includes(`"${templateName}" was added and is switched off.`) && (await note.innerText()).includes('Its prices are examples, not yours.'), await note.innerText())
    const row = p.locator('[data-testid=service-row]', { hasText: templateName })
    check('…and its row reads "Inactive"', (await row.getAttribute('data-active')) === 'false' && (await row.innerText()).includes('Inactive'))
    await row.locator('[data-testid=service-toggle]').click()
    await p.waitForFunction((name) => [...document.querySelectorAll('[data-testid=service-row]')].find((li) => (li as HTMLElement).innerText.includes(name))?.getAttribute('data-active') === 'true', templateName, { timeout: 15_000 })
    check('pressing "Enable" switches it on and the note goes', (await note.count()) === 0 && (await mine(templateName)).active === true)
    await ctx.close()
  } finally {
    await browser.close()
  }
}
