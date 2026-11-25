/**
 * T-204: the one page every email is put in.
 *
 * Until now each email wrote out its own copy of the same page, and the white
 * card was `max-width: 600px` with no width of its own, so it shrank to fit
 * its longest line: two emails to the same customer came out at different
 * widths. Now every email to a customer and to a business, from the web app
 * and from the worker, is `emailShell(...)`:
 *
 *   - **One fixed content width.** The card is 600 px wide (`width="600"`,
 *     `width: 100%; max-width: 600px`), whatever is in it; on a narrow screen
 *     it is the screen's width. Outlook's desktop program ignores `max-width`,
 *     so it is given a 600 px table of its own (the `mso` comments).
 *   - **A phone uses its width.** Under 480 px the space around the card and
 *     inside it is reduced (the two classes below; the rule is in
 *     `emailHeadStyle`, which is in every head).
 *   - **Light, on purpose.** The emails are a light document: a business's
 *     own colour is checked against a white card (`textColourOnCardForEmail`).
 *     The page says so (`color-scheme: light only`), which Apple Mail and
 *     others honour. A program that darkens an email anyway (Gmail's and
 *     Outlook's apps) changes background colours and leaves pictures alone,
 *     so the product's logo carries its own light panel inside the picture
 *     (product-logo.ts) and reads on any background.
 *
 * What goes above the card (our logo, for an email to a business) and under
 * it ("Powered by", for an email to a customer) is the caller's; the page
 * around them is not.
 *
 * Pure.
 */
import { EMAIL_FONT, emailHeadStyle } from './email-style'

/** The card's width in px, in every email */
export const EMAIL_WIDTH = 600

/** The classes the phone rule in `emailHeadStyle` reduces the padding of */
export const EMAIL_OUTER_CLASS = 'email-outer'
export const EMAIL_CARD_CLASS = 'email-card'

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

export interface EmailShellInput {
  /** The page's title: plain text, escaped here */
  title: string
  /** The inside of the card: HTML its writer has already escaped */
  content: string
  /** Rows above the card (`productLogoRow()` on an email to a business) */
  above?: string
  /** Rows under the card (`poweredByRow(...)`, `emailFootnote(...)`) */
  below?: string
}

/** A whole email: the page, the card at its fixed width, and what the caller puts in, above and under it */
export function emailShell(input: EmailShellInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(input.title)}</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" width="100%" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td class="${EMAIL_OUTER_CLASS}" align="center" style="padding: 40px 20px;">
        <!--[if mso]><table role="presentation" width="${EMAIL_WIDTH}" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
        ${input.above ?? ''}
        <table role="presentation" data-role="email-card" width="${EMAIL_WIDTH}" align="center" style="width: 100%; max-width: ${EMAIL_WIDTH}px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: left;">
          <tr>
            <td class="${EMAIL_CARD_CLASS}" style="padding: 40px;">
              ${input.content}
            </td>
          </tr>
        </table>
        ${input.below ?? ''}
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** A small centred line under the card, at the card's width (the product's name under an account email) */
export function emailFootnote(text: string): string {
  return `<table role="presentation" width="${EMAIL_WIDTH}" align="center" style="width: 100%; max-width: ${EMAIL_WIDTH}px; margin: 20px auto 0;">
          <tr>
            <td data-role="footnote" style="text-align: center; color: #626C66; font-size: 12px;">${escapeHtml(text)}</td>
          </tr>
        </table>`
}
