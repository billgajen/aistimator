/**
 * T-176: words about WhatsApp that are said in more than one place — pure.
 * Kept here so the page, the help text and the checks read the same sentence.
 */
import { PRODUCT_NAME } from '@qolumns/shared'

/**
 * T-177: the personal number warning. One short line, said once on the page,
 * in the text that introduces Meta's window. (T-176 asked a three-answer
 * question before the window; the owner replaced it with this line.)
 */
export const PERSONAL_NUMBER_LINE = 'Use your business WhatsApp number. Don’t connect a personal number, it can stop working in the normal WhatsApp app.'

/** T-177: said before the test-message button, so nobody presses it expecting a message WhatsApp will not deliver */
export const TEST_MESSAGE_LINE = 'Send “Hi” to your business number from your phone first. WhatsApp only lets businesses reply within 24 hours of a customer’s last message.'

/**
 * Payment: a note, not a step (T-176). Meta's pricing page (read 2026-11-17):
 * 1,000 free service messages a month per number, delivered without a payment
 * method; nothing past that, and no template, without one.
 */
export const PAYMENT_NOTE_TITLE = 'You don’t need a card to start'
export const PAYMENT_NOTE = `Meta delivers your first 1,000 replies to customers each month without a card. It asks for one only when you go past that, or for messages your business starts, such as the message template below. Meta bills you directly for WhatsApp; a card is never shared with ${PRODUCT_NAME}.`

/** Meta's review of the name shown on the number */
export const NAME_REVIEW_DAYS = 'up to five working days'

/**
 * Is this one of Meta's own "555" numbers (a US number with the 555 area
 * code, given out inside Meta's window)? Meta does not let one send any
 * message until its display name is approved (its error 131037); an ordinary
 * number can send while its name is in review.
 */
export function isMetaIssuedNumber(displayPhoneNumber: string): boolean {
  return /^1555\d{7}$/.test(displayPhoneNumber.replace(/\D/g, ''))
}
