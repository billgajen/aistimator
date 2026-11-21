/**
 * T-197: how the support inbox's emails leave the web app (Postmark, the
 * product as the sender). Apart from support-admin.ts so that the rules there
 * can be tested with a mailer that only records.
 */
import { isPostmarkConfigured, sendEmail } from '@/lib/postmark'
import type { SupportMailer } from '@/lib/support-admin'

export function supportMailer(env: Record<string, string | undefined> = process.env): SupportMailer {
  return {
    appUrl: env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    send: async (to, email, tag) => {
      if (!isPostmarkConfigured()) return false
      const result = await sendEmail({ from: { kind: 'business' }, to, subject: email.subject, htmlBody: email.html, tag })
      return result.success
    },
  }
}
