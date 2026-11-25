/**
 * T-190: the product's logo at the top of every email the product sends to a business (the row T-183 marked).
 * Emails to a customer carry the business's brand, not ours, so they never use this.
 *
 * The picture is the owner's dark wordmark (brand/qolumns-wordmark.png), made 420 px wide and served by the web
 * app at a fixed public address on the main domain. It is shown at 140 px (three pixels for each one shown, so
 * it is sharp on a phone). Since T-204 it sits on a small light panel that is part of the picture. Width and height are both set, so the email does not move when it loads; with
 * pictures blocked, the alt text is the name in the same dark colour and weight, so the row still reads.
 */
import { APP_DOMAIN, PRODUCT_NAME } from './brand'

export const PRODUCT_LOGO_EMAIL = {
  /**
   * Where the web app serves it (apps/web/public). T-204: the wordmark on its own light panel, inside
   * the picture. An email program in dark mode changes background colours and leaves pictures alone, so
   * the dark wordmark on a see-through background disappeared there; a panel that is part of the picture
   * cannot be darkened. The earlier file (`qolumns-wordmark-email.png`) stays where it is: emails already
   * sent point at it.
   */
  path: '/brand/qolumns-wordmark-email-panel.png',
  /** shown size in px; the file is three times this (the wordmark itself is 140 × 38 inside it) */
  width: 164,
  height: 58,
  /** ink, the wordmark's own colour */
  color: '#1B2823',
} as const

/** The picture's address: always the main domain, so an email opened years later still finds it */
export function productLogoUrl(): string {
  return `https://${APP_DOMAIN}${PRODUCT_LOGO_EMAIL.path}`
}

/** The logo, as an email-safe <img> */
export function productLogoImg(): string {
  const { width, height, color } = PRODUCT_LOGO_EMAIL
  return `<img src="${productLogoUrl()}" width="${width}" height="${height}" alt="${PRODUCT_NAME}" style="display: block; margin: 0 auto; width: ${width}px; height: ${height}px; border: 0; outline: none; text-decoration: none; color: ${color}; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: ${height}px;">`
}

/**
 * The row above an email's white card: the logo, centred over the card, at the card's width.
 * The cell behind the picture is white too, set as a colour and as a one-colour gradient (a program that
 * darkens colours leaves a gradient alone), so with pictures blocked the name still reads as dark on light.
 */
export function productLogoRow(): string {
  const { width, height } = PRODUCT_LOGO_EMAIL
  return `<table role="presentation" width="600" align="center" style="max-width: 600px; width: 100%; margin: 0 auto 16px; border-collapse: collapse;">
          <tr>
            <td data-role="product-logo" align="center" style="padding: 0 4px; text-align: center;">
              <table role="presentation" align="center" style="margin: 0 auto; border-collapse: separate;">
                <tr>
                  <td data-role="product-logo-panel" width="${width}" height="${height}" style="width: ${width}px; height: ${height}px; background-color: #FFFFFF; background-image: linear-gradient(#FFFFFF, #FFFFFF); border-radius: 8px; text-align: center;">${productLogoImg()}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`
}
