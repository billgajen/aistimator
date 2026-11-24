// T-201, item 4: the reminder to the customer, on or off.
//
// The reminder is sent by the web app's daily job (/api/cron/lifecycle). Without an email provider
// the job skips its reminder step (there is none on this machine), so this section asks the job's own
// question, "which quotes are due a reminder?" (apps/web/src/lib/quote-reminders.ts), of the real
// database, for two businesses with a quote each: one with the switch on, one with it off.
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT } from '../lib.mjs'
import { dueReminders } from '../../../apps/web/src/lib/quote-reminders'
import { CUSTOMER_REMINDER_COPY } from '../../../packages/shared/src/customer-reminder'
import type { Harness } from './harness.mts'

const DAY = 86_400_000

export async function run(h: Harness): Promise<void> {
  h.section('Item 4. The reminder to the customer, on or off')
  const requireWeb = createRequire(path.join(ROOT, 'apps/web/package.json'))
  const { createClient } = requireWeb('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  const admin = createClient(h.cfg.supabaseUrl, h.cfg.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  /** A business with one estimate sent four days ago, not opened, not answered, not reminded */
  async function withWaitingQuote(label: string) {
    const biz = await h.business(label)
    const key = await h.siteKey(biz)
    const serviceId = await h.paintService(biz)
    const quote = await h.submit(key, serviceId, `Dev Raman ${label}`)
    const priced = await h.waitForQuote(quote.id, (row) => row.pricing_json != null && !['queued', 'processing', 'pending'].includes(String(row.status)))
    await h.patch('quotes', `id=eq.${quote.id}`, {
      status: 'sent',
      sent_at: new Date(Date.now() - 4 * DAY).toISOString(),
      token_expires_at: new Date(Date.now() + 20 * DAY).toISOString(),
      reminder_sent_at: null,
      viewed_at: null,
      accepted_at: null,
      declined_at: null,
    })
    return { biz, quoteId: quote.id, priced: priced.pricing_json != null }
  }
  const settings = async (cookie: { Cookie: string }) => (h.expectOk('settings', await h.http('GET', `${h.app}/api/tenant`, { headers: cookie })) as { tenant: { customerReminder?: boolean } }).tenant
  const save = (cookie: { Cookie: string }, customerReminder: unknown) => h.http('PUT', `${h.app}/api/tenant`, { headers: cookie, body: { customerReminder } })
  const stored = async (tenantId: string) => (await h.rows('tenants', `id=eq.${tenantId}&select=customer_reminder_enabled`))[0]?.customer_reminder_enabled

  const on = await withWaitingQuote('remind-on')
  const off = await withWaitingQuote('remind-off')
  h.check('both businesses have a priced estimate sent four days ago', on.priced && off.priced, { on: on.priced, off: off.priced })

  /** The daily job's own question, for these two businesses only */
  const due = async () => {
    const now = Date.now()
    const { data, error } = await dueReminders(admin, { nowIso: new Date(now).toISOString(), cutoffIso: new Date(now - 3 * DAY).toISOString() }, { limit: 100, tenantIds: [on.biz.tenantId, off.biz.tenantId] })
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => row.id)
  }

  // on by default: what happened before there was a switch
  h.check('a new business has the reminder on', (await settings(on.biz.cookie)).customerReminder === true && (await stored(on.biz.tenantId)) === true)
  const before = await due()
  h.check('with nothing changed, both customers are due a reminder', before.includes(on.quoteId) && before.includes(off.quoteId), before)

  // off: no reminder for that business, including the estimate already sent
  const switchedOff = await save(off.biz.cookie, false)
  h.check('the switch saves', switchedOff.ok && (await settings(off.biz.cookie)).customerReminder === false && (await stored(off.biz.tenantId)) === false, switchedOff.status)
  const after = await due()
  h.check('switched off: its customer is not due a reminder, for an estimate that was already sent', !after.includes(off.quoteId), after)
  h.check('…and the other business’s customer still is', after.includes(on.quoteId), after)

  // the page itself
  const page = await h.http('GET', `${h.app}/app/settings`, { headers: off.biz.cookie })
  h.check('Settings answers for a signed-in business', page.ok, page.status)
  h.check('the wording of the switch is one piece of text (shared), and says three days', /after 3 days/.test(CUSTOMER_REMINDER_COPY.label))

  // only a plain yes or no is taken
  const wrong = await save(off.biz.cookie, 'no')
  h.check('anything but on or off is refused (400), and nothing changes', wrong.status === 400 && (await stored(off.biz.tenantId)) === false, wrong.status)

  // back on: the estimate still waiting is due again
  const backOn = await save(off.biz.cookie, true)
  const again = await due()
  h.check('switched back on: the estimate still waiting is due at the next daily run', backOn.ok && again.includes(off.quoteId), again)

  // a reminder already sent is never due again, switch or no switch
  await h.patch('quotes', `id=eq.${on.quoteId}`, { reminder_sent_at: new Date().toISOString() })
  h.check('a quote already reminded is not due again', !(await due()).includes(on.quoteId))

  // the daily job still answers (it skips the emails here: no email provider on this machine)
  const cron = await h.http('GET', `${h.app}/api/cron/lifecycle`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET || 'local-cron-t153'}` } })
  h.check('the daily job runs to its end', cron.ok && typeof cron.json?.remindersSent === 'number', { status: cron.status, body: cron.json })
}
