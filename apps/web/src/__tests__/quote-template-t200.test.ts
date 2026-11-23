/**
 * T-200: saving "Quote Template" (Settings → Business) keeps whatever the
 * business set for "Allow customers to accept quotes directly" (Settings →
 * Branding). Before, that save rebuilt the stored template from its own four
 * fields; the dropped setting read as "on", and the accept button came back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { DEFAULT_TEMPLATE, mergeTemplate } from '@/lib/tenant-template'

const read = (path: string) => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')

// ---- a business's row, held in memory, behind the two calls the route makes ----
let stored: Record<string, unknown>
const updates: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user_1', email: 'owner@example.com' } }, error: null }) },
    from: (table: string) => {
      const one = (data: unknown) => ({ eq: () => ({ single: async () => ({ data, error: null }) }) })
      if (table === 'user_profiles') return { select: () => one({ tenant_id: 'tnt_1', display_name: 'Owner' }) }
      return {
        select: () => one(stored),
        update: (values: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                updates.push(values)
                stored = { ...stored, ...values }
                return { data: stored, error: null }
              },
            }),
          }),
        }),
      }
    },
  }),
}))

const save = async (body: unknown) => {
  const { PUT } = await import('@/app/api/tenant/route')
  return PUT(new NextRequest('http://localhost/api/tenant', { method: 'PUT', body: JSON.stringify(body) }))
}
/** What the "Save Quote Template" button sends: the page's own four fields and the terms */
const QUOTE_TEMPLATE_SAVE = { templateJson: { showLineItems: true, includeAssumptions: false, includeExclusions: true, validityDays: 45 }, defaultTermsText: 'Payment within 14 days.' }

beforeEach(() => {
  updates.length = 0
  stored = { id: 'tnt_1', name: 'Harlow Painting', region: 'US', currency: 'USD', template_json: null }
})

describe('T-200: saving Quote Template keeps customer acceptance as the business set it', () => {
  it('switched off on the Branding tab, it is still off after "Save Quote Template"', async () => {
    stored.template_json = { showLineItems: true, includeAssumptions: true, includeExclusions: true, validityDays: 30, acceptQuoteEnabled: false }
    const res = await save(QUOTE_TEMPLATE_SAVE)
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0]!.template_json).toEqual({ showLineItems: true, includeAssumptions: false, includeExclusions: true, validityDays: 45, acceptQuoteEnabled: false })
    // and the customer's page reads exactly this: off only when it is stored as false
    expect((stored.template_json as { acceptQuoteEnabled?: boolean }).acceptQuoteEnabled !== false).toBe(false)
    expect(read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')).toContain('tenant.template_json?.acceptQuoteEnabled !== false')
  })

  it('switched on, or never touched, it stays as it was', async () => {
    stored.template_json = { ...DEFAULT_TEMPLATE, acceptQuoteEnabled: true }
    await save(QUOTE_TEMPLATE_SAVE)
    expect((updates[0]!.template_json as { acceptQuoteEnabled?: boolean }).acceptQuoteEnabled).toBe(true)
    // never set: nothing is written for it, so it stays on by default
    stored.template_json = null
    await save(QUOTE_TEMPLATE_SAVE)
    expect(updates[1]!.template_json).toEqual({ showLineItems: true, includeAssumptions: false, includeExclusions: true, validityDays: 45 })
  })

  it('a save that sends one field changes that field only; the days are kept within 1 to 365', () => {
    const before = { showLineItems: false, includeAssumptions: false, includeExclusions: false, validityDays: 14, acceptQuoteEnabled: false }
    expect(mergeTemplate(before, { validityDays: 60 })).toEqual({ ...before, validityDays: 60 })
    expect(mergeTemplate(before, {})).toEqual(before)
    expect(mergeTemplate(before, { validityDays: 9999 }).validityDays).toBe(365)
    expect(mergeTemplate(before, { validityDays: 'no' }).validityDays).toBe(30)
    expect(mergeTemplate(before, { acceptQuoteEnabled: true }).acceptQuoteEnabled).toBe(true)
    // not a yes or a no: not an answer, so nothing changes
    expect(mergeTemplate(before, { acceptQuoteEnabled: null }).acceptQuoteEnabled).toBe(false)
    expect(mergeTemplate(before, { acceptQuoteEnabled: 'false' }).acceptQuoteEnabled).toBe(false)
    // a setting this file does not know about is kept too
    expect(mergeTemplate({ ...before, somethingLater: 'x' } as never, { showLineItems: true })).toMatchObject({ somethingLater: 'x', showLineItems: true, acceptQuoteEnabled: false })
    expect(mergeTemplate(null, null)).toEqual(DEFAULT_TEMPLATE)
  })

  it('the route merges through the one function, and the guide no longer warns of the bug', () => {
    const route = read('apps/web/src/app/api/tenant/route.ts')
    expect(route).toContain('mergeTemplate(currentTenant?.template_json')
    expect(route).not.toMatch(/const mergedTemplate: TenantTemplate = \{/)
    // the Branding tab's own save lays what it sends over what is stored, as it always did
    expect(read('apps/web/src/app/api/tenant/branding/route.ts')).toMatch(/updates\.template_json = \{\s*\.\.\.currentTemplate,\s*\.\.\.template,\s*\}/)
    expect(read('Docs/help/11-account-branding-notifications.md')).not.toMatch(/switches it back on/)
  })
})
