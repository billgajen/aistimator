/**
 * T-178: a quote that could not be priced is marked failed AND the business
 * is told, once. Before this a failed quote changed its status and nothing
 * else: no email, so the request sat unseen until someone opened the
 * dashboard.
 *
 * The customer's page already stops saying "Preparing" on `failed` and says
 * the business has the request. This sends the business one email with who
 * asked and a link to the request (their details, answers and photos are in
 * the dashboard). The reason it failed is stored on the quote for us; it is
 * not put in the email or shown to anyone.
 *
 * Never throws: it runs at the very end of a job that has already gone wrong.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { failedRequestEmail } from '@qolumns/shared'
import { loadBusinessEmail } from './business-email'
import { sendEmail } from './email/postmark'

export interface FailedQuoteEnv {
  POSTMARK_API_TOKEN?: string
  POSTMARK_FROM_EMAIL?: string
  APP_URL?: string
}

type Send = typeof sendEmail

interface FailedQuoteRow {
  tenant_id: string
  customer_json: { name?: string; email?: string; phone?: string } | null
  content_json: Record<string, unknown> | null
  is_test?: boolean | null
  is_demo?: boolean | null
  tenant: { name?: string; notification_email?: string | null; is_demo?: boolean | null } | null
  service: { name?: string } | null
}

export async function markQuoteFailed(
  supabase: SupabaseClient,
  env: FailedQuoteEnv,
  quoteId: string,
  error: string | undefined,
  send: Send = sendEmail
): Promise<{ marked: boolean; emailed: boolean }> {
  let emailed = false
  try {
    const { data } = await supabase
      .from('quotes')
      .select('tenant_id, customer_json, content_json, is_test, is_demo, tenant:tenants(name, notification_email, is_demo), service:services(name)')
      .eq('id', quoteId)
      .single()
    const quote = data as unknown as FailedQuoteRow | null
    const content = quote?.content_json ?? {}

    // One email per request: a retry that fails again does not send a second
    const alreadyTold = typeof content.failedNotifiedAt === 'string'
    const demo = quote?.is_demo === true || quote?.tenant?.is_demo === true
    if (quote && !alreadyTold && !demo && env.POSTMARK_API_TOKEN && env.POSTMARK_FROM_EMAIL) {
      try {
        const to = await loadBusinessEmail(supabase, quote.tenant_id, quote.tenant)
        if (to) {
          const { subject, html } = failedRequestEmail({
            customerName: quote.customer_json?.name ?? '',
            customerEmail: quote.customer_json?.email,
            customerPhone: quote.customer_json?.phone,
            serviceName: quote.service?.name ?? 'your service',
            quoteUrl: `${env.APP_URL || 'http://localhost:3000'}/app/quotes/${quoteId}`,
            isTest: quote.is_test === true,
          })
          const result = await send(
            { apiToken: env.POSTMARK_API_TOKEN, fromEmail: env.POSTMARK_FROM_EMAIL },
            { from: { kind: 'business' }, to, subject, htmlBody: html, tag: 'quote-failed' }
          )
          emailed = result.success
          // No customer details in logs: the quote id is enough to find it
          console.log(`[Email] Failed-request email ${result.success ? 'sent' : 'not sent'} for ${quoteId}`)
        }
      } catch (emailError) {
        console.error(`[Worker] Failed-request email error for ${quoteId}: ${emailError instanceof Error ? emailError.name : 'unknown error'}`)
      }
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'failed',
        content_json: {
          ...content,
          ...(error && { error }),
          failedAt: now,
          ...(emailed && { failedNotifiedAt: now }),
        },
      })
      .eq('id', quoteId)
    if (updateError) {
      console.error(`[Worker] Could not mark quote ${quoteId} failed: ${updateError.message}`)
      return { marked: false, emailed }
    }
    return { marked: true, emailed }
  } catch (unexpected) {
    console.error(`[Worker] markQuoteFailed error for ${quoteId}: ${unexpected instanceof Error ? unexpected.name : 'unknown error'}`)
    return { marked: false, emailed }
  }
}
