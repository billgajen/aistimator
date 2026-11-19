/**
 * The Features page's words.
 *
 * T-187 (the owner's review): one section per thing a business cares about,
 * each with a picture and two or three plain lines. It replaces T-167's five
 * numbered steps. The sections about things that are live are here; the
 * three that are not live yet (quotes inside WhatsApp, the on-site app, the
 * room scan) come from lib/marketing/plan-claims.ts, beside the one flag each
 * depends on, and follow these.
 *
 * Every sentence that says what the product reads, measures, notices or works
 * out is written through `says` and rests on a row of
 * Docs/design/ai-capabilities.md. Copy rules as before (T-154): plain words,
 * claims match the live product, no grades, no "exact".
 *
 * Asked for and not claimed:
 *   - "a quote page and PDF": the page is claimed, the PDF is not. Production
 *     makes a PDF only when the business asks for one, as a test document
 *     (OWNER-TODO, T-155).
 *   - "it flags what looks wrong" rests on three checks the inventory lists
 *     (a poor photo, a message that fits another service, words that differ
 *     from an answer). The AI quote checker's notes are on the inventory's
 *     do-not-claim list and are not mentioned.
 */
import { PRODUCT_NAME } from '@qolumns/shared'
import { says } from './ai-claims'
import { MESSAGE_LINE } from './home-copy'

export const FEATURES_META = {
  title: `Features — ${PRODUCT_NAME}`,
  description:
    'What it does for your business: it takes in your customer’s photos and notes, prices the job from your own price list, and gives them a quote page in your brand that you approve before they can accept.',
}

export const FEATURES_HERO = {
  headline: MESSAGE_LINE,
  lead: 'What it does for you, one thing at a time, each beside the screen where it happens.',
}

export type FeatureId = 'photos' | 'prices' | 'services' | 'approve' | 'page' | 'share' | 'flags'

export interface FeatureSection {
  id: FeatureId
  title: string
  /** Two or three plain lines */
  lines: readonly string[]
  /** The section's picture is a picture of the product: what a screen reader hears for it */
  screen: string
}

export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    id: 'photos',
    title: says(['photo-notes'], 'It reads the photos and notes your customer sends.'),
    lines: [
      says(['label-reading', 'confirm-question'], 'It reads the size off a tank label, a rating plate or a panel, then checks the reading with your customer.'),
      says(['photo-measurement'], 'For exterior painting it works out the wall area from their photos.'),
      says(['extras-from-description'], 'When their message asks for an extra you sell, it adds your line for it.'),
    ],
    screen: 'A customer’s photo of a water heater’s rating label, and under it the question they are asked: the capacity read from the label, 50 gallons, with “Yes, 50 gal is right” chosen.',
  },
  {
    id: 'prices',
    title: 'Your price list sets every price.',
    lines: [
      says(['price-sentence'], 'Type your prices the way you’d tell a new hire: “$375 per room, heavy prep adds $250.” It becomes your price list, shown back to you to check.'),
      says(['photo-notes', 'pricing-engine'], 'The AI works out the job. The cost only ever comes from the prices you set.'),
      'The same job always gets the same price.',
    ],
    screen: 'The price setup screen: a sentence of prices in plain English, and the price list it became, each price editable.',
  },
  {
    id: 'services',
    title: 'Several services in one quote.',
    lines: [
      says(['also-asked'], 'When a customer asks for a second service in the same request, it notices and offers it.'),
      says(['pricing-engine'], 'They add it with one tap. It is worked out from that service’s own prices, never guessed.'),
      'One quote, one total, one yes.',
    ],
    screen: 'An estimate’s price breakdown with two services, each with its own lines and subtotal, and one total for both.',
  },
  {
    id: 'approve',
    title: 'You approve before it counts.',
    lines: [
      'Your customer sees the price straight away.',
      'They can only accept after you approve it: one tap on “Approve & send”.',
      'You can change any line, the wording or the total first.',
    ],
    screen: 'The dashboard’s “Waiting for you”: a new request with its price, marked as needing approval, and the button “Approve & send”.',
  },
  {
    id: 'page',
    title: 'A quote page in your brand.',
    lines: [
      'Every customer gets their own page, with your name, logo and colour.',
      'They can accept, ask you a question or decline, and you see it straight away.',
      'On Pro, no badge of ours appears on it.',
    ],
    screen: 'A customer’s quote page in the business’s own colour: the total, each line of the price, and the words “Reviewed and confirmed by” the business.',
  },
  {
    id: 'share',
    title: 'Share it anywhere.',
    lines: [
      'Your own quote link and a QR code, ready when you finish setup.',
      'Send the link in an email or a WhatsApp chat, put it on your Google profile, or print the code on your van.',
      'Have a website? Paste one short piece of code and the same form sits on your page.',
    ],
    screen: 'The quote link screen: your link with a Copy button, and its QR code.',
  },
  {
    id: 'flags',
    title: 'It flags what doesn’t add up.',
    lines: [
      says(['photo-quality-check'], 'A blurry or dark photo is caught before your customer sends it.'),
      says(['service-match'], 'If their message fits another of your services better, it suggests that one.'),
      says(['words-against-answers'], 'If their words give a different size from the answer they gave, it asks which is right.'),
    ],
    screen: 'A customer’s message, and beside it what the product made of it: the service fits what they wrote, the size differs from their answer so it asks, and the extra they asked for is added.',
  },
]

/** The heading over the sections about things that are not live yet (their words: lib/marketing/plan-claims.ts) */
export const FEATURES_UPCOMING_HEADING = 'On the way'

/** The price sentence of "Your price list sets every price" and the list it becomes (the same example as Home) */
export const FEATURES_PRICE_EXAMPLE = {
  service: 'Interior painting',
  sentence: '$375 per room, heavy prep adds $250.',
  list: [
    { label: 'Per room', amount: '$375.00' },
    { label: 'Heavy prep', amount: '+ $250.00' },
  ],
} as const

export const FEATURES_CLOSING = {
  heading: 'See it price one of your jobs.',
  lead: 'The fastest way to judge it: set up your prices and send yourself a test quote.',
  quietLink: 'See pricing',
} as const
