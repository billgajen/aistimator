/**
 * T-167: the Features page's words. Five steps from a customer's request to
 * an accepted quote, each beside the real screen where it happens.
 *
 * Every sentence that says what the product reads, measures or works out is
 * written through `says` and rests on a row of Docs/design/ai-capabilities.md.
 * Copy rules as before (T-154): plain words, claims match the live product, no
 * grades, no "exact", nothing that is not live for a new business.
 */
import { PRODUCT_NAME } from '@qolumns/shared'
import { says } from './ai-claims'
import { MESSAGE_LINE } from './home-copy'

export const FEATURES_META = {
  title: `Features — ${PRODUCT_NAME}`,
  description:
    'How customers get an estimate from your prices at once: your quote link, guided questions and photos, your own price list, and an estimate page you confirm before they accept.',
}

export const FEATURES_HERO = {
  headline: MESSAGE_LINE,
  lead: 'Five steps from a customer’s question to a yes, each shown on the screen where it happens.',
}

export interface FeatureStep {
  id: 'ask' | 'read' | 'price' | 'confirm' | 'track'
  number: string
  name: string
  headline: string
  body: string
  /** The step's screen is a picture of the product: what a screen reader hears for it */
  screen: string
}

export const FEATURE_STEPS: FeatureStep[] = [
  {
    id: 'ask',
    number: '01',
    name: 'Ask',
    headline: 'Meet the customer where they already are.',
    body: says(
      ['photo-quality-check'],
      'Share your quote link or QR code, send it in WhatsApp, or put the same form on your website. Each service asks only the questions that set its price, and for the photos it needs. A blurry or dark photo is caught before it is sent.'
    ),
    screen: 'A phone showing a business’s quote page: its request form, with a question answered and a photo of a tank label added.',
  },
  {
    id: 'read',
    number: '02',
    name: 'Read the job',
    headline: says(['label-reading', 'photo-measurement', 'photo-notes'], 'It reads the details that set your price.'),
    body: says(
      ['label-reading', 'photo-measurement', 'photo-notes', 'confirm-question', 'range-and-question'],
      'From the answers and photos the AI reads what the job is: the capacity on a tank label, the size on a rating plate, the rating on a panel, the wall area of a house. A reading that changes the price goes back to your customer to confirm. When it can’t tell, they see a range and one quick question.'
    ),
    screen: 'A customer’s photo of a water heater’s rating label, and under it the question they are asked: the capacity read from the label, 50 gallons, with “Yes, 50 gal is right” chosen.',
  },
  {
    id: 'price',
    number: '03',
    name: 'Price',
    headline: 'Plain English in. Your prices out.',
    body: says(
      ['price-sentence', 'photo-notes', 'pricing-engine'],
      'Describe your pricing the way you’d tell a new hire: “$375 per room, heavy prep adds $250.” It becomes your price list, shown back to you to check. The AI works out the job; the cost only ever comes from the prices you set.'
    ),
    screen: 'The price setup screen: a sentence of prices in plain English, and the price list it became, each price editable.',
  },
  {
    id: 'confirm',
    number: '04',
    name: 'Confirm',
    headline: 'An estimate page, and you have the last word.',
    body: 'Your customer gets a page in your branding with the estimate for their job, straight away. By default they can accept once you’ve confirmed it: one tap on Approve & send. You choose per service: show the estimate and confirm, hold it until you approve, or send automatically. They can accept, ask a question or decline, and it shows in your dashboard straight away.',
    screen: 'A customer’s quote page in the business’s own colour: the total, each line of the price, and the words “Reviewed and confirmed by” the business.',
  },
  {
    id: 'track',
    number: '05',
    name: 'Track',
    headline: 'See what’s winning work.',
    body: 'Home shows what’s waiting for you, where every quote stands, and the last 30 days: requests, estimates sent, accepted and their value.',
    screen: 'The dashboard’s numbers for the last 30 days: requests, estimates sent, accepted and the value accepted, each compared with the 30 days before.',
  },
]

/** The price sentence of step 03 and the list it becomes (the same example as Home) */
export const FEATURES_PRICE_EXAMPLE = {
  service: 'Interior painting',
  sentence: '$375 per room, heavy prep adds $250.',
  list: [
    { label: 'Per room', amount: '$375.00' },
    { label: 'Heavy prep', amount: '+ $250.00' },
  ],
} as const

/** Step 05's screen: example figures in the dashboard's own cards (its real titles come from QUOTE_TURN_COPY) */
export const FEATURES_NUMBERS_EXAMPLE = {
  requests: { value: '42', up: '6' },
  sent: { value: '38', up: '5' },
  accepted: { value: '17', up: '3' },
  valueAccepted: { value: '$41,300', up: '$7,850' },
} as const

export const FEATURES_CLOSING = {
  heading: 'See it price one of your jobs.',
  lead: 'The fastest way to judge it: set up your prices and send yourself a test quote.',
  quietLink: 'See pricing',
} as const
