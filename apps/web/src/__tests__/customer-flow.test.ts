/**
 * T-151: customer flow — the contact setting, the unfinished-lead lifecycle,
 * the accept details, and the quote page / widget wording rules.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { listRegions, customerDecisionWords } from '@estimator/shared'
import { checkContact, contactRequirementOf, descriptionRequired, isPlausiblePhone, usableContact } from '@/lib/contact-rules'
import { laterProgress, cleanAnswers, cleanAssetIds, completeLeads, hashLeadToken, isLeadProgress, PROGRESS_WORDS } from '@/lib/request-leads'
import { checkAcceptance, timingLabel, TIMING_CHOICES } from '@/lib/acceptance'
import { generateQuoteAcceptedEmailHtml } from '@/lib/email-templates'

const ROOT = join(__dirname, '..', '..', '..', '..')
const code = (file: string) =>
  readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('T-151: the contact setting', () => {
  const someone = { name: 'Sam Carter' }

  it('defaults to "email required, phone optional"', () => {
    expect(contactRequirementOf(undefined)).toBe('email')
    expect(contactRequirementOf('nonsense')).toBe('email')
    expect(checkContact({ ...someone, email: 'sam@example.com' }, 'email').ok).toBe(true)
    expect(checkContact({ ...someone, phone: '(555) 123-4567' }, 'email').errors.email).toBeTruthy()
  })

  it('phone only: phone required, email optional', () => {
    expect(checkContact({ ...someone, phone: '07700 900123' }, 'phone').ok).toBe(true)
    expect(checkContact({ ...someone, email: 'sam@example.com' }, 'phone').errors.phone).toBeTruthy()
    expect(checkContact({ ...someone, phone: '07700 900123' }, 'phone').clean.email).toBeNull()
  })

  it('both: email and phone required', () => {
    expect(checkContact({ ...someone, email: 'sam@example.com', phone: '+1 555 123 4567' }, 'both').ok).toBe(true)
    const missing = checkContact({ ...someone, email: 'sam@example.com' }, 'both')
    expect(missing.ok).toBe(false)
    expect(missing.errors.phone).toBeTruthy()
  })

  it('a name is always required, and an optional field must still be valid if given', () => {
    expect(checkContact({ email: 'sam@example.com' }, 'email').errors.name).toBeTruthy()
    expect(checkContact({ ...someone, email: 'sam@example.com', phone: 'call me' }, 'email').errors.phone).toBeTruthy()
    expect(checkContact({ ...someone, phone: '07700 900123', email: 'not-an-email' }, 'phone').errors.email).toBeTruthy()
  })

  it('stores what the customer typed (trimmed), not a reformatted number', () => {
    expect(checkContact({ name: '  Sam ', email: ' sam@example.com ', phone: ' (555) 123-4567 ' }, 'email').clean).toEqual({
      name: 'Sam',
      email: 'sam@example.com',
      phone: '(555) 123-4567',
    })
  })

  it('accepts real phone shapes and rejects junk', () => {
    for (const p of ['(555) 123-4567', '07700 900123', '+44 7700 900123', '555.123.4567']) expect(isPlausiblePhone(p)).toBe(true)
    for (const p of ['123', 'phone me', '1'.repeat(20), '555-CALL-NOW']) expect(isPlausiblePhone(p)).toBe(false)
  })

  it('chat-extracted filler in an optional field is dropped, not fatal', () => {
    const c = usableContact({ name: 'Chris', email: 'chris@example.com', phone: 'not provided' }, 'email')
    expect(c).toEqual({ name: 'Chris', email: 'chris@example.com', phone: '' })
    expect(checkContact(c, 'email').ok).toBe(true)
    // a required field is kept, so the check still fails
    expect(checkContact(usableContact({ name: 'Chris', email: 'chris@example.com', phone: 'N/A' }, 'phone'), 'phone').ok).toBe(false)
  })

  it('the description is required only when the service asks nothing of its own', () => {
    expect(descriptionRequired(0)).toBe(true)
    expect(descriptionRequired(1)).toBe(false)
  })

  it('every region has a phone example and hint; the widget hardcodes none', () => {
    for (const r of listRegions()) {
      expect(r.copy.phoneExample).toBeTruthy()
      expect(r.copy.phoneHint).toBeTruthy()
    }
    const widget = code('apps/web/src/components/embed/EstimateWidget.tsx') + code('apps/web/src/components/embed/steps/ContactStep.tsx')
    expect(widget).not.toMatch(/7700 900000|\+44 7700/)
  })
})

describe('T-151: the unfinished-lead lifecycle', () => {
  it('progress only moves forward', () => {
    expect(laterProgress('contact', 'questions')).toBe('questions')
    expect(laterProgress('photos', 'questions')).toBe('photos')
    expect(laterProgress('details', 'contact')).toBe('details')
    expect(isLeadProgress('questions')).toBe(true)
    expect(isLeadProgress('submitted')).toBe(false)
    expect(Object.keys(PROGRESS_WORDS)).toEqual(['contact', 'questions', 'photos', 'details'])
  })

  it('keeps only plain, bounded answers the customer could have typed', () => {
    const cleaned = cleanAnswers([
      { fieldId: 'door_size', value: 'Single' },
      { fieldId: 'count', value: 3 },
      { fieldId: 'opener', value: true },
      { fieldId: 'extras', value: ['a', 'b'] },
      { fieldId: 'bad id!', value: 'x' },
      { fieldId: 'obj', value: { nested: true } },
      { fieldId: 'long', value: 'x'.repeat(5000) },
      'junk',
    ])
    expect(cleaned.map((a) => a.fieldId)).toEqual(['door_size', 'count', 'opener', 'extras', 'long'])
    expect((cleaned[4]!.value as string).length).toBe(2000)
    expect(cleanAnswers('nope')).toEqual([])
    expect(cleanAnswers(Array.from({ length: 100 }, (_, i) => ({ fieldId: `f${i}`, value: 'v' })))).toHaveLength(60)
  })

  it('keeps only asset-id-shaped values', () => {
    expect(cleanAssetIds(['ast_abc123def', 'drop table', 42, 'ast_x'])).toEqual(['ast_abc123def'])
  })

  /** A fake Supabase that records the filters of every update */
  function recorder() {
    const calls: Array<{ table: string; update: unknown; filters: Array<[string, string, unknown]> }> = []
    const builder = (call: (typeof calls)[number]) => {
      const chain = {
        eq: (c: string, v: unknown) => (call.filters.push(['eq', c, v]), chain),
        is: (c: string, v: unknown) => (call.filters.push(['is', c, v]), chain),
        gte: (c: string, v: unknown) => (call.filters.push(['gte', c, v]), chain),
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      }
      return chain
    }
    const supabase = {
      from: (table: string) => ({
        update: (update: unknown) => {
          const call = { table, update, filters: [] as Array<[string, string, unknown]> }
          calls.push(call)
          return builder(call)
        },
      }),
    }
    return { supabase: supabase as never, calls }
  }

  it('submitting closes the lead this browser holds — own tenant, matching token, still open', async () => {
    const { supabase, calls } = recorder()
    await completeLeads(supabase, { tenantId: 'tnt_a', quoteId: 'qte_1', serviceId: 'svc_1', leadId: 'lead_1', leadToken: 'secret', email: null, phone: null })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.update).toMatchObject({ quote_id: 'qte_1' })
    expect(calls[0]!.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'lead_1'],
        ['eq', 'tenant_id', 'tnt_a'],
        ['eq', 'lead_token_hash', hashLeadToken('secret')],
        ['is', 'completed_at', null],
      ])
    )
  })

  it('…and any other open lead for the same customer and service from the last day (no duplicates)', async () => {
    const { supabase, calls } = recorder()
    await completeLeads(supabase, { tenantId: 'tnt_a', quoteId: 'qte_1', serviceId: 'svc_1', email: 'sam@example.com', phone: '07700 900123' })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.filters).toEqual(expect.arrayContaining([['eq', 'tenant_id', 'tnt_a'], ['eq', 'service_id', 'svc_1'], ['is', 'completed_at', null]]))
      expect(call.filters.some(([op, col]) => op === 'gte' && col === 'created_at')).toBe(true)
    }
    expect(calls[0]!.filters).toContainEqual(['eq', 'customer_email', 'sam@example.com'])
    expect(calls[1]!.filters).toContainEqual(['eq', 'customer_phone', '07700 900123'])
  })

  it('never touches another tenant or a lead without a token match', async () => {
    const { supabase, calls } = recorder()
    await completeLeads(supabase, { tenantId: 'tnt_b', quoteId: 'qte_2', serviceId: 'svc_2', leadId: 'lead_1', leadToken: null })
    expect(calls).toHaveLength(0)
  })
})

describe('T-151: accept asks for the next step', () => {
  const good = { timing: 'asap', timingNote: ' mornings best ', address: '12 Oak Lane, Springfield', phone: '(555) 123-4567' }

  it('a complete answer is kept as typed (trimmed)', () => {
    const r = checkAcceptance(good, new Date('2026-11-10T12:00:00Z'))
    expect(r).toEqual({ ok: true, value: { timing: 'asap', timingNote: 'mornings best', address: '12 Oak Lane, Springfield', phone: '(555) 123-4567', submittedAt: '2026-11-10T12:00:00.000Z' } })
  })

  it('needs a timing choice, an address and a phone number', () => {
    const r = checkAcceptance({ timing: 'tomorrow', address: '', phone: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['address', 'phone', 'timing'])
  })

  it('three plain timing choices', () => {
    expect(TIMING_CHOICES.map((c) => c.value)).toEqual(['asap', 'two_weeks', 'flexible'])
    expect(timingLabel('two_weeks')).toBe('Within the next two weeks')
  })

  it('the business’s acceptance email carries them', () => {
    const html = generateQuoteAcceptedEmailHtml({
      businessName: 'Gateway Doors',
      customerName: 'Sam',
      serviceName: 'Garage door',
      totalFormatted: '$1,400.00',
      dashboardUrl: 'https://example.test/app/quotes/qte_1',
      nextStep: { timing: 'As soon as possible', timingNote: 'Mornings', address: '12 Oak Lane', phone: '(555) 123-4567' },
    })
    for (const text of ['As soon as possible', 'Mornings', '12 Oak Lane', '(555) 123-4567']) expect(html).toContain(text)
  })
})

describe('T-151: quote page and widget', () => {
  const quotePage = code('apps/web/src/app/q/[quoteId]/page.tsx')

  it('no alert() and no "Send for review" on the quote page', () => {
    expect(quotePage).not.toMatch(/\balert\(/)
    expect(quotePage).not.toMatch(/Send for review|approval_request/)
  })

  it('keeps Accept, Ask a question and the quiet Decline link', () => {
    expect(quotePage).toContain('Ask a question')
    // T-158: the decline link's words come from the shared map ("quote" once
    // the business reviewed it, "estimate" before)
    expect(quotePage).toContain('{words.declineLink}')
    expect(customerDecisionWords(false).declineLink).toMatch(/Decline this estimate/)
    expect(customerDecisionWords(true).declineLink).toMatch(/Decline this quote/)
    expect(quotePage).toContain('AcceptDetailsForm')
  })

  it('the widget asks for contact details straight after the service', () => {
    // raw source: the comment stripper would read accept="image/*" as a comment opener
    const widget = readFileSync(join(ROOT, 'apps/web/src/components/embed/EstimateWidget.tsx'), 'utf8')
    const flow = /const flow: Step\[\] = \[([\s\S]*?)\n {2}\]/.exec(widget)?.[1] ?? ''
    const order = ['service', 'contact', 'questions', 'files', 'job'].map((s) => flow.indexOf(`'${s}'`))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
