/**
 * T-201, item 4: the reminder to the customer, on or off.
 *
 * The daily job asks one question of the database: which quotes are due a reminder. These tests read
 * that question as it is put (a client that records what it is asked), for a business with the
 * reminder on and one with it off. The same question against the real database is in
 * scripts/hardcore-test/t201/reminder.mts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUSTOMER_REMINDER_COPY, CUSTOMER_REMINDER_DAYS, customerReminderOn } from '@qolumns/shared'
import { dueReminders, REMINDER_BATCH_SIZE, REMINDER_STATUSES } from '@/lib/quote-reminders'

interface Quote {
  id: string
  status: string
  is_demo: boolean
  reminder_sent_at: string | null
  accepted_at: string | null
  declined_at: string | null
  sent_at: string | null
  token_expires_at: string
  tenant_id: string
  tenants: { id: string; customer_reminder_enabled: boolean }
}

/**
 * A stand-in for the database that applies each filter it is given to rows held in memory, and keeps
 * what it was asked. Only what the question uses is here.
 */
function database(quotes: Quote[]) {
  const asked: { select?: string; filters: string[]; limit?: number } = { filters: [] }
  let rows = quotes
  const value = (row: Quote, column: string): unknown => column.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], row)
  const query = {
    select(columns: string) {
      asked.select = columns
      return query
    },
    in(column: string, values: unknown[]) {
      asked.filters.push(`${column} in ${values.join(',')}`)
      rows = rows.filter((row) => values.includes(value(row, column)))
      return query
    },
    eq(column: string, wanted: unknown) {
      asked.filters.push(`${column} = ${String(wanted)}`)
      rows = rows.filter((row) => value(row, column) === wanted)
      return query
    },
    is(column: string, wanted: null) {
      asked.filters.push(`${column} is ${String(wanted)}`)
      rows = rows.filter((row) => value(row, column) === wanted)
      return query
    },
    not(column: string, _op: string, wanted: null) {
      asked.filters.push(`${column} is not ${String(wanted)}`)
      rows = rows.filter((row) => value(row, column) !== wanted)
      return query
    },
    lt(column: string, wanted: string) {
      asked.filters.push(`${column} < x`)
      rows = rows.filter((row) => String(value(row, column)) < wanted)
      return query
    },
    gt(column: string, wanted: string) {
      asked.filters.push(`${column} > x`)
      rows = rows.filter((row) => String(value(row, column)) > wanted)
      return query
    },
    limit(count: number) {
      asked.limit = count
      rows = rows.slice(0, count)
      return query
    },
    then(resolve: (result: { data: Quote[]; error: null }) => void) {
      resolve({ data: rows, error: null })
    },
  }
  return { client: { from: (_table: string) => query } as never, asked }
}

const DAY = 86_400_000
const now = Date.parse('2026-11-24T09:00:00Z')
const window = { nowIso: new Date(now).toISOString(), cutoffIso: new Date(now - CUSTOMER_REMINDER_DAYS * DAY).toISOString() }
const waiting = (id: string, tenant: { id: string; customer_reminder_enabled: boolean }, change: Partial<Quote> = {}): Quote => ({
  id,
  status: 'sent',
  is_demo: false,
  reminder_sent_at: null,
  accepted_at: null,
  declined_at: null,
  sent_at: new Date(now - 4 * DAY).toISOString(),
  token_expires_at: new Date(now + 20 * DAY).toISOString(),
  tenant_id: tenant.id,
  tenants: tenant,
  ...change,
})
const ON = { id: 'tnt_on', customer_reminder_enabled: true }
const OFF = { id: 'tnt_off', customer_reminder_enabled: false }
const ids = async (quotes: Quote[]) => ((await dueReminders(database(quotes).client, window)).data ?? []).map((row) => row.id)

describe('T-201: the reminder to the customer, on or off', () => {
  it('on: a customer whose estimate has waited four days is due the reminder', async () => {
    expect(await ids([waiting('q_on', ON)])).toEqual(['q_on'])
  })

  it('off: no reminder for that business, including an estimate that was already sent', async () => {
    expect(await ids([waiting('q_off', OFF)])).toEqual([])
  })

  it('one business switching it off changes nothing for another', async () => {
    expect(await ids([waiting('q_off', OFF), waiting('q_on', ON), waiting('q_off_2', OFF, { status: 'viewed' })])).toEqual(['q_on'])
  })

  it('the switch is part of the question to the database, so quotes that will never be sent cannot fill the batch', async () => {
    const { client, asked } = database([])
    await dueReminders(client, window)
    // the business is joined so that the filter leaves the quote out, not only its business
    expect(asked.select).toContain('tenants!tenant_id!inner')
    expect(asked.filters).toContain('tenants.customer_reminder_enabled = true')
    expect(asked.limit).toBe(REMINDER_BATCH_SIZE)
    // sixty quotes of a business with it off, then one that is due: the one is still found
    const many = [...Array.from({ length: 60 }, (_, i) => waiting(`q_off_${i}`, OFF)), waiting('q_on', ON)]
    expect(await ids(many)).toEqual(['q_on'])
  })

  it('everything that decided a reminder before still does', async () => {
    expect([...REMINDER_STATUSES]).toEqual(['sent', 'viewed'])
    expect(
      await ids([
        waiting('opened', ON, { status: 'viewed' }),
        waiting('too_new', ON, { sent_at: new Date(now - 2 * DAY).toISOString() }),
        waiting('reminded', ON, { reminder_sent_at: new Date(now - DAY).toISOString() }),
        waiting('accepted', ON, { status: 'accepted', accepted_at: new Date(now - DAY).toISOString() }),
        waiting('declined', ON, { status: 'declined', declined_at: new Date(now - DAY).toISOString() }),
        waiting('asked_a_question', ON, { status: 'feedback_received' }),
        waiting('expired_link', ON, { token_expires_at: new Date(now - DAY).toISOString() }),
        waiting('demo', ON, { is_demo: true }),
        waiting('never_sent', ON, { sent_at: null }),
      ])
    ).toEqual(['opened'])
  })

  it('a check may ask about its own businesses only; the daily job never narrows the question', async () => {
    const { client, asked } = database([waiting('a', ON), waiting('b', { id: 'tnt_other', customer_reminder_enabled: true })])
    const { data } = await dueReminders(client, window, { tenantIds: ['tnt_on'] })
    expect(data?.map((row) => row.id)).toEqual(['a'])
    expect(asked.filters).toContain('tenant_id in tnt_on')
    const route = readFileSync(path.resolve(__dirname, '../app/api/cron/lifecycle/route.ts'), 'utf8')
    expect(route).toContain('await dueReminders(supabase, { nowIso, cutoffIso: cutoff.toISOString() })')
    expect(route).not.toContain("from('quotes')\n      .select(`\n        id, customer_json, pricing_json, sent_at")
  })

  it('a business with nothing stored has the reminder on, as before there was a switch', () => {
    expect(customerReminderOn(undefined)).toBe(true)
    expect(customerReminderOn(null)).toBe(true)
    expect(customerReminderOn(true)).toBe(true)
    expect(customerReminderOn(false)).toBe(false)
  })

  it('the switch says what the reminder does: three days, and "answered", not "opened"', () => {
    expect(CUSTOMER_REMINDER_DAYS).toBe(3)
    expect(CUSTOMER_REMINDER_COPY.label).toBe('Send one reminder to the customer if they haven’t answered the estimate after 3 days')
    // a customer who opened the estimate and said nothing is reminded too, so "opened" would be wrong
    expect(CUSTOMER_REMINDER_COPY.label).not.toMatch(/opened/)
  })

  it('Settings shows the switch, and the settings route takes only on or off', () => {
    const page = readFileSync(path.resolve(__dirname, '../app/(dashboard)/app/settings/page.tsx'), 'utf8')
    expect(page).toContain('<CustomerReminderSetting initial=')
    const api = readFileSync(path.resolve(__dirname, '../app/api/tenant/route.ts'), 'utf8')
    expect(api).toContain("if (typeof customerReminder !== 'boolean') {")
    expect(api).toContain('updates.customer_reminder_enabled = customerReminder')
    expect(api.match(/customerReminder: customerReminderOn\(tenant\.customer_reminder_enabled\)/g)).toHaveLength(2)
  })
})
