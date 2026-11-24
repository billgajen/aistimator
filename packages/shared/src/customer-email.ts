/**
 * T-201: what every email to a CUSTOMER carries of the business and of us.
 * One place, read by the web app's emails and the worker's, so the two cannot
 * drift.
 *
 *   - The business's logo, when it has one, at the top of the card (above its
 *     name). Until T-201 no email carried it. The picture is the business's
 *     own upload, kept private; an email needs an address that still works
 *     when it is opened weeks later, so it points at the web app
 *     (`/api/public/logo/<asset id>`), which sends the reader on to the
 *     picture. That address serves only a picture that is some business's
 *     logo today.
 *   - "Powered by <product>" under the card: shown or not by THE SAME RULE as
 *     the "Prepared with" line on the estimate page: `canUse(access,
 *     'no_badge')` (access.ts). Each app asks that rule through its own small
 *     loader and passes the answer here as `showPoweredBy`; nothing in this
 *     file decides it. Until T-201 every customer email said "Powered by",
 *     whatever the plan.
 *
 * Emails to a business are the product's own (productLogoRow) and never use
 * this.
 *
 * Pure.
 */
import { PRODUCT_NAME } from './brand'
import { EMAIL_COLOR } from './email-style'

/** Where the web app serves a business's logo for its emails */
export const BUSINESS_LOGO_PATH = '/api/public/logo'

/** The shown height in px. The width follows the picture's own shape. */
export const BUSINESS_LOGO_EMAIL_HEIGHT = 48

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** The logo's address for an email, or null when the business has no logo (or the web app's address is not known) */
export function businessLogoUrl(appUrl: string | null | undefined, logoAssetId: unknown): string | null {
  const base = (appUrl ?? '').trim().replace(/\/+$/, '')
  if (!base || typeof logoAssetId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(logoAssetId)) return null
  return `${base}${BUSINESS_LOGO_PATH}/${logoAssetId}`
}

/**
 * The logo, for the top of the card. Empty when there is none, so the card
 * starts with the business's name as it always has. With pictures blocked the
 * alt text is the business's name.
 */
export function businessLogoBlock(logoUrl: string | null | undefined, businessName: string): string {
  if (!logoUrl) return ''
  const height = BUSINESS_LOGO_EMAIL_HEIGHT
  return `<div data-role="business-logo" style="margin: 0 0 20px;"><img src="${escapeHtml(logoUrl)}" height="${height}" alt="${escapeHtml(businessName)}" style="display: block; height: ${height}px; width: auto; max-width: 100%; border: 0; outline: none; text-decoration: none; color: ${EMAIL_COLOR.ink}; font-size: 16px; font-weight: 700;"></div>`
}

/** The line under the card. `show` is the access rule's answer (true unless the plan removes the badge). */
export function poweredByRow(show: boolean | null | undefined): string {
  if (show === false) return ''
  return `<table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td data-role="powered-by" style="text-align: center; color: ${EMAIL_COLOR.muted}; font-size: 12px;">
              Powered by ${PRODUCT_NAME}
            </td>
          </tr>
        </table>`
}

/** What a customer email is given about the business and the badge */
export interface CustomerEmailBrand {
  /** the logo's address (`businessLogoUrl`), or null */
  logoUrl?: string | null
  /** false when the business's plan removes the badge; anything else shows it */
  showPoweredBy?: boolean
}
