/**
 * The From header on every email (T-159). One builder for the web app and the
 * worker, so no sender puts a header together by hand.
 *
 * - To a customer: "<business name> via <PRODUCT_NAME>".
 * - To the business: PRODUCT_NAME.
 * - The address is always the configured sending address. The name is
 *   display text only: it is cleaned, capped and quoted, so a business name
 *   can never change the address or add a header.
 *
 * Pure. The business name comes from the tenant record; callers pass it in.
 */

import { PRODUCT_NAME } from './brand'

/** Who an email is for decides the name it is sent under */
export type EmailSender = { kind: 'customer'; businessName: string | null | undefined } | { kind: 'business' }

/** The longest business name shown; longer names are cut (mail apps truncate long sender names anyway) */
export const EMAIL_BUSINESS_NAME_MAX = 60

/**
 * A business name made safe to show as a sender name: no line breaks or other
 * control characters, no angle brackets, single spaces, capped in length.
 */
export function cleanSenderName(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    // line breaks, tabs and every other control character, plus the Unicode
    // line and paragraph separators
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    // text-direction overrides, which can make a name display as something else
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Cut by whole characters, never through the middle of one
  return Array.from(cleaned).slice(0, EMAIL_BUSINESS_NAME_MAX).join('').trim()
}

/** The sender name, before quoting */
export function emailSenderName(sender: EmailSender): string {
  if (sender.kind === 'business') return PRODUCT_NAME
  const business = cleanSenderName(sender.businessName)
  return business ? `${business} via ${PRODUCT_NAME}` : PRODUCT_NAME
}

/**
 * The bare sending address from the configured value. It is normally just an
 * address; if someone configured "Name <address>", the address is taken and
 * the name dropped, so the header is never doubled up.
 */
export function emailFromAddress(configured: string): string {
  const inBrackets = /<([^<>]*)>\s*$/.exec(configured)
  return (inBrackets?.[1] ?? configured).replace(/[\s<>"]/g, '')
}

/** The full From header: `"Name" <address>` */
export function emailFromHeader(sender: EmailSender, configuredAddress: string): string {
  const quoted = emailSenderName(sender).replace(/[\\"]/g, '\\$&')
  return `"${quoted}" <${emailFromAddress(configuredAddress)}>`
}
