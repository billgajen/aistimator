/**
 * T-176: words about WhatsApp that are said in more than one place — pure.
 * Kept here so the page, the help text and the checks read the same sentence.
 */
import { PRODUCT_NAME } from '@qolumns/shared'

/** Which app a business's number is on today: asked before Meta's window opens */
export type NumberApp = 'business_app' | 'personal' | 'new'

export const NUMBER_APP_QUESTION = 'Which app is this number on today?'

export const NUMBER_APP_CHOICES: ReadonlyArray<{ value: NumberApp; label: string; hint: string }> = [
  {
    value: 'business_app',
    label: 'The WhatsApp Business app',
    hint: 'The free app for businesses, with a “B” on its icon. The number keeps working in the app and your chats stay.',
  },
  {
    value: 'personal',
    label: 'Ordinary WhatsApp',
    hint: 'The app most people use with family and friends.',
  },
  {
    value: 'new',
    label: 'Neither: it is a new number',
    hint: 'A number that is not on WhatsApp yet, or one that Meta gives you in its window.',
  },
]

/** Only these may go on to Meta's window */
export function mayConnect(app: NumberApp | null): boolean {
  return app === 'business_app' || app === 'new'
}

/**
 * The warning, said in the question and in the help text. Meta's rule (its
 * phone numbers page, read 2026-11-17): a number in use on WhatsApp cannot be
 * registered unless its WhatsApp account is deleted first, and a registered
 * number can no longer be used in the WhatsApp app.
 */
export const PERSONAL_NUMBER_WARNING =
  'Do not connect a number that is on ordinary WhatsApp. Meta only connects it once its WhatsApp account is deleted, which loses its chats, and afterwards the number no longer works in WhatsApp on your phone.'
export const PERSONAL_NUMBER_WAY_ROUND =
  'Move the number to the free WhatsApp Business app first. That keeps your chats, and the number can then be connected here and still be used in the app.'

/** How to move a number from ordinary WhatsApp to the WhatsApp Business app (WhatsApp's own steps, in short) */
export const MOVE_TO_BUSINESS_APP_STEPS: readonly string[] = [
  'In ordinary WhatsApp, back up your chats first: Settings → Chats → Chat backup → Back up.',
  'Install the free WhatsApp Business app on the same phone, from the App Store or Google Play.',
  'Open it and tap “Agree and continue”. It finds the number you use in ordinary WhatsApp: tap that number.',
  'Tap Continue, then Allow, so it can bring your chats and media across. Enter the six-digit code it sends by SMS.',
  'Add your business name and tap Next. The number is now on the WhatsApp Business app, with your chats.',
  'Use the app as usual, then come back to this page and choose “The WhatsApp Business app”. Meta sometimes asks for the app to have been used for a while before it will connect the number.',
]
export const MOVE_TO_BUSINESS_APP_NOTE = 'Chats moved to the WhatsApp Business app cannot be moved back to ordinary WhatsApp.'

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
