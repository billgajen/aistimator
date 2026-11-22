/**
 * T-197: the support emails (pure). Each says one thing and has one button
 * that opens the business's own item in its dashboard. A business replies in
 * the dashboard, not by email, so the thread stays in one place.
 *
 *   - a reply from us on a report            → the user who reported it
 *   - "the problem you reported is fixed"    → every business attached to it
 *   - "what you asked for has shipped"       → every business that voted
 *   - the owner's daily summary              → the alert address
 *
 * The same branded page as the billing emails: the logo over a white card.
 */
import { PRODUCT_NAME } from './brand'
import { EMAIL_FONT, emailHeadStyle } from './email-style'
import { productLogoRow } from './product-logo'
import { SUPPORT_COPY, type SupportAiKind, type SupportSeverity } from './support'

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** Our own words as paragraphs: a blank line starts a new one, a single line break is kept */
const paragraphs = (text: string): string =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#1B2823;">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n      ')

interface PageInput {
  title: string
  label: string
  heading: string
  /** Already-escaped HTML */
  body: string
  note?: string
  buttonHref: string
  buttonLabel: string
  buttonRole: string
}

function page(input: PageInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(input.title)}</title>${emailHeadStyle()}
</head>
<body style="margin:0;padding:0;font-family:${EMAIL_FONT.body};background-color:#FAF9F6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:40px 20px;">
    ${productLogoRow()}
    <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#FFFFFF;border-radius:8px;"><tr><td style="padding:40px;">
      <p style="margin:0;font-size:14px;color:#626C66;">${escape(input.label)}</p>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#1B2823;" data-role="heading">${escape(input.heading)}</h1>
      ${input.body}
      <table role="presentation" style="width:100%;margin:24px 0 4px;"><tr><td style="text-align:center;"><a href="${escape(input.buttonHref)}" data-role="${input.buttonRole}" style="display:inline-block;padding:14px 28px;background-color:#205E56;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">${escape(input.buttonLabel)}</a></td></tr></table>
      ${input.note ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#626C66;" data-role="note">${escape(input.note)}</p>` : ''}
    </td></tr></table>
    <table role="presentation" style="max-width:600px;margin:20px auto 0;"><tr><td style="text-align:center;color:#626C66;font-size:12px;">${escape(PRODUCT_NAME)}</td></tr></table>
  </td></tr></table>
</body>
</html>`
}

const REPLY_IN_DASHBOARD = 'To reply, open it in your dashboard. Replies to this email are not read.'
const quoteOf = (words: string): string => {
  const text = words.replace(/\s+/g, ' ').trim()
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}
const yourWords = (words: string): string =>
  words.trim()
    ? `<div style="margin:20px 0 0;padding:14px 16px;background-color:#F2F0EA;border-radius:8px;"><p style="margin:0;font-size:13px;color:#626C66;">What you sent us</p><p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#4F5D57;" data-role="your-words">${escape(quoteOf(words))}</p></div>`
    : ''

export interface SupportEmail {
  subject: string
  html: string
}

/** Our reply on a report, to the user who reported it */
export function supportReplyEmail(input: { businessName: string; reply: string; yourWords: string; link: string }): SupportEmail {
  return {
    subject: `A reply from ${PRODUCT_NAME} about your report`,
    html: page({
      title: 'A reply about your report',
      label: input.businessName,
      heading: 'We replied to your report',
      body: `<div data-role="reply">${paragraphs(input.reply)}</div>${yourWords(input.yourWords)}`,
      note: REPLY_IN_DASHBOARD,
      buttonHref: input.link,
      buttonLabel: 'Open in your dashboard',
      buttonRole: 'open-report',
    }),
  }
}

/** The problem a business reported is fixed. `message` is the owner's own line, when there is one. */
export function supportFixedEmail(input: { businessName: string; message?: string | null; yourWords: string; link: string }): SupportEmail {
  const own = (input.message ?? '').trim()
  return {
    subject: 'The problem you reported is fixed',
    html: page({
      title: 'The problem you reported is fixed',
      label: input.businessName,
      heading: 'The problem you reported is fixed',
      body: `<div data-role="message">${own ? paragraphs(own) : paragraphs('Thank you for telling us. It is fixed now, and you do not need to do anything.')}</div>${yourWords(input.yourWords)}`,
      note: `If it still happens, tell us in your dashboard. ${REPLY_IN_DASHBOARD}`,
      buttonHref: input.link,
      buttonLabel: 'Open in your dashboard',
      buttonRole: 'open-report',
    }),
  }
}

/** A feature a business asked for has shipped */
export function featureShippedEmail(input: { businessName: string; title: string; summary?: string | null; link: string }): SupportEmail {
  const summary = (input.summary ?? '').trim()
  return {
    subject: 'Something you asked for is ready',
    html: page({
      title: 'Something you asked for is ready',
      label: input.businessName,
      heading: 'Something you asked for is ready',
      body: `<p style="margin:16px 0 0;font-size:17px;line-height:1.4;font-weight:600;color:#1B2823;" data-role="request-title">${escape(input.title)}</p>${
        summary ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#4F5D57;">${escape(summary)}</p>` : ''
      }<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#1B2823;">You asked for this, and it is now in ${escape(PRODUCT_NAME)}. Thank you for telling us what you needed.</p>`,
      buttonHref: input.link,
      buttonLabel: 'Open your dashboard',
      buttonRole: 'open-request',
    }),
  }
}

export interface DailySummaryInput {
  /** New problems by the AI's kind; `unsorted` are those the AI has not sorted */
  problems: Partial<Record<SupportAiKind | 'unsorted', number>>
  featureRequests: number
  /** The top three problems by priority */
  top: Array<{ title: string; severity: SupportSeverity | null; businesses: number }>
  inboxUrl: string
  environment?: string
  /** T-198: questions put to the Help assistant since the last summary, and how many it could not answer */
  questions?: { asked: number; unanswered: number }
}

/** T-198: the summary's one line about the assistant. Null when nobody asked anything. */
export function questionsLine(questions: { asked: number; unanswered: number } | undefined): string | null {
  const asked = Math.max(0, questions?.asked ?? 0)
  if (asked <= 0) return null
  const unanswered = Math.min(asked, Math.max(0, questions?.unanswered ?? 0))
  return `Questions asked: ${asked}. The assistant could not answer: ${unanswered}.`
}

/**
 * The owner's daily summary. Null when there is nothing new: then no email is
 * sent. T-198: a question the assistant could not answer is something new; a
 * day of answered questions alone is not.
 */
export function supportDailyEmail(input: DailySummaryInput): (SupportEmail & { text: string }) | null {
  const kinds = (Object.entries(input.problems) as Array<[SupportAiKind | 'unsorted', number]>).filter(([, n]) => n > 0)
  const problems = kinds.reduce((sum, [, n]) => sum + n, 0)
  const total = problems + Math.max(0, input.featureRequests)
  const asked = questionsLine(input.questions)
  if (total <= 0 && (input.questions?.unanswered ?? 0) <= 0) return null
  const where = input.environment && input.environment !== 'production' ? ` (${input.environment})` : ''
  const label = (kind: SupportAiKind | 'unsorted') => (kind === 'unsorted' ? 'Not sorted yet' : SUPPORT_COPY.aiKind[kind])
  const counts = [...kinds.map(([kind, n]) => `${label(kind)}: ${n}`), ...(input.featureRequests > 0 ? [`Feature requests: ${input.featureRequests}`] : []), ...(asked ? [asked] : [])]
  const top = input.top.slice(0, 3).map((item) => {
    const severity = item.severity ? SUPPORT_COPY.severity[item.severity] : 'Not sorted'
    return `${item.title} (${severity}; ${item.businesses} ${item.businesses === 1 ? 'business' : 'businesses'})`
  })
  const subject = `${PRODUCT_NAME} support${where}: ${total} new ${total === 1 ? 'item' : 'items'}`
  const html = page({
    title: 'New support items',
    label: 'Support, the last day',
    heading: `${total} new ${total === 1 ? 'item' : 'items'}`,
    body: `<ul style="margin:16px 0 0;padding-left:20px;font-size:15px;line-height:1.6;color:#1B2823;" data-role="counts">${counts.map((c) => `<li>${escape(c)}</li>`).join('')}</ul>${
      top.length
        ? `<p style="margin:20px 0 0;font-size:14px;font-weight:600;color:#4F5D57;">Top by priority</p><ol style="margin:8px 0 0;padding-left:20px;font-size:15px;line-height:1.6;color:#1B2823;" data-role="top">${top.map((t) => `<li>${escape(t)}</li>`).join('')}</ol>`
        : ''
    }`,
    note: 'Sent once a day, only when something is new, to the ALERT_EMAIL address.',
    buttonHref: input.inboxUrl,
    buttonLabel: 'Open the support inbox',
    buttonRole: 'open-inbox',
  })
  return { subject, html, text: [`${total} new support ${total === 1 ? 'item' : 'items'}`, ...counts, ...(top.length ? ['Top by priority:', ...top.map((t, i) => `${i + 1}. ${t}`)] : []), input.inboxUrl].join('\n') }
}
