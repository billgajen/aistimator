/**
 * T-154: the home page's words, in one place (approved copy, 2026-11-10).
 *
 * Every promise matches the live product: the customer sees an estimate from
 * the business's prices at once (or a range and one question), and by default
 * cannot accept until the business has confirmed it. No grades, no engine
 * words, no "exact", no confirmed-quote-in-seconds. Statistics are quoted as
 * their sources state them, each with its link.
 */
import { FREE_ALLOWANCE, PRODUCT_NAME, freeOfferLabel } from '@qolumns/shared'
import { says } from './ai-claims'

/**
 * T-167: the message. The site said what the AI does not do (set prices) and
 * never what it does. Both halves, in the owner's words.
 */
export const MESSAGE_LINE = says(['photo-notes', 'pricing-engine'], 'The AI works out the job. Your prices work out the cost.')

const FREE = FREE_ALLOWANCE.US!.quotes

export const HERO = {
  headline: 'Instant quotes on your website, in your prices.',
  /** T-167: what the AI does, in one plain sentence, then where the price comes from */
  subline: says(
    ['photo-notes', 'pricing-engine'],
    'The AI reads your customer’s answers and photos and works out the job. The price comes from your own price list, and you confirm it.'
  ),
  smallLine: 'For contractors and home-service businesses. No website? Use your quote link.',
  frames: ['Your customer asks', 'They see your price', 'You confirm it'] as const,
}

/** T-167: the last pill of the trade links inside "Choose your trade" (the standalone trades row is gone) */
export const OTHER_TRADES = 'Other trades: describe your prices in plain English'

/**
 * T-165: the hero's product demo. The question, its answer and the photo's
 * name are the water-heater template's own (lib/vertical-packs); the prices
 * come from the same template through lib/marketing/examples.ts.
 */
export const HERO_DEMO = {
  trade: 'water-heaters',
  question: 'Where is the water heater?',
  answer: 'Garage',
  photoLabel: 'Tank rating label',
  /** The sample label the live demo offers (public/demo), drawn for it; no real product */
  photoSrc: '/demo/sample-water-heater-label.png',
  photoAlt: 'A sample photo of a water heater’s rating label',
  playAgain: 'Play again',
  /**
   * T-167: what the product returned for this sample label at the template's
   * prices, on the local stack (Docs/design/ai-capabilities.md, section 6): it
   * read 50 gal and natural gas, and until the customer confirmed the reading
   * it showed this range. The demo shows the reading and the customer's "Yes".
   */
  rangeBeforeConfirming: { low: 1890, high: 2410 },
  /** Each screen is a picture of the product: what a screen reader hears for it */
  screens: [
    'The request form on a business’s quote page: the customer has answered where the water heater is and added a photo of its rating label. Under it, the question the customer is asked next: the capacity, 50 gallons, was read from the label, and the customer has answered that it is right.',
    'The customer’s estimate: a total worked out from the business’s prices, with each line of the price shown.',
    'The business’s dashboard: the new request with its price, approved and sent to the customer.',
  ],
  sent: 'Sent',
} as const

/** T-165: replaces "How it works", which repeated the hero in words */
export const SETUP = {
  /** What a screen reader hears for each step's screen */
  screens: [
    'The first setup screen: a list of trades to choose from, with Water heaters chosen.',
    'The second setup screen: the template’s starting prices, each one editable.',
    'The quote link screen: your link with a Copy button, and its QR code.',
  ],
  heading: 'Set up in minutes',
  lead: 'Three steps, and the last one is sharing a link.',
  steps: [
    {
      title: 'Choose your trade',
      text: 'Start from a ready-made template with the usual services and questions. Any other trade: describe what you do in plain English.',
    },
    {
      title: 'Check your prices',
      text: says(['pricing-engine'], 'Each template starts with typical prices. Change them to yours; every estimate is worked out from them.'),
    },
    {
      title: 'Share your link',
      text: 'You get your own quote page and a QR code. Put the link anywhere your customers already find you.',
    },
  ],
} as const

export const CONTROL = {
  heading: 'Your prices. You stay in control.',
  /**
   * T-165: a plain-English price sentence, and the price lines it becomes.
   * Two prices, two lines. A minimum charge is not among them: it is a floor,
   * not an item, so it is never shown as a line of a price list.
   */
  sentenceLead: 'Tell it your prices the way you’d tell a new hire:',
  sentence: [
    { words: '$375 per room,', line: { label: 'Per room', amount: '$375.00' } },
    { words: 'heavy prep adds $250.', line: { label: 'Heavy prep', amount: '+ $250.00' } },
  ],
  listTitle: 'Your price list',
  replay: 'Show it again',
  points: [
    {
      title: 'Only your prices',
      text: says(['photo-notes', 'pricing-engine'], 'Every price comes from what you set. The AI reads the job details; it never picks a price.'),
    },
    {
      title: 'You confirm first',
      text: 'By default your customer sees the estimate at once, and can accept it once you’ve confirmed it.',
    },
    {
      title: 'Three ways to send, per service',
      text: 'Show the estimate, then confirm (the default). Hold it until you approve. Or send automatically.',
    },
  ],
} as const

/**
 * T-167: "What it notices". Four things the product does with a request, each
 * beside the real screen where the result appears. Every sentence rests on a
 * row of Docs/design/ai-capabilities.md (`says`). The figures in the screens
 * are the templates' own prices (lib/marketing/examples.ts).
 */
export const NOTICES = {
  heading: 'What it notices',
  examples: [
    {
      id: 'label',
      title: 'A label, read',
      text: says(
        ['label-reading', 'confirm-question'],
        'It reads the capacity and fuel off a tank label, the size off a rating plate, the rating off a panel. Then it checks the reading with your customer.'
      ),
      screen: 'The question a customer is asked after sending a photo of a tank label: the capacity that was read from it, with “Yes, 50 gal is right” chosen.',
    },
    {
      id: 'walls',
      title: 'Walls, measured from photos',
      text: says(['photo-measurement'], 'For exterior painting it works out the wall area from your customer’s photos, using a door as its ruler.'),
      screen: 'Part of an estimate: the exterior walls priced by the square foot, with the area marked as worked out from the customer’s photos.',
    },
    {
      id: 'extra',
      title: 'An extra your customer asked for',
      text: says(['extras-from-description'], 'When they write “and the trim too”, it adds your trim line, at your price.'),
      screen: 'The price breakdown of an estimate: the trim line carries a note that it was added from the customer’s description.',
    },
    {
      id: 'range',
      title: 'When it can’t tell, it asks',
      text: says(['range-and-question', 'pricing-engine'], 'Your customer sees a range and one quick question. Their answer sets the estimate, from your prices.'),
      screen: 'An estimate shown as a range, with a button to confirm one detail.',
    },
  ],
} as const

export interface Statistic {
  figure: string
  text: string
  source: string
  url: string
}

/** Quoted as sourced (checked against each page, 2026-11-10) */
export const STATISTICS: Statistic[] = [
  {
    figure: '70%',
    text: 'of homeowners said they were more likely to call an HVAC contractor who is transparent on pricing. Only 31% of HVAC contractors surveyed feature pricing on their websites.',
    source: 'ACHR NEWS / myCLEARopinion Insights Hub, December 2024',
    url: 'https://achrnews.com/articles/163836',
  },
  {
    figure: '78%',
    text: 'of homeowners said they’re more likely to call a roofing contractor that offers pricing on its website, up from 66% in 2023.',
    source: 'Roofing Contractor, 2025 Homeowner Roofing Survey',
    url: 'https://www.roofingcontractor.com/articles/100649-2025-homeowner-roofing-survey-tracking-the-journey',
  },
  {
    figure: '69%',
    text: 'search for pricing online, but only 15% find it clear enough to estimate costs.',
    source: 'Mantel, Homeowner Shopping Attitudes Report 2025 (422 homeowners, fall 2025)',
    url: 'https://www.usemantel.com/blog/homeowner-shopping-attitudes-report-2025',
  },
]

export const ADD_IT = {
  heading: 'Add it anywhere',
  lead: 'No website needed. Share your quote link anywhere your customers already find you: a text, a WhatsApp chat, your Google profile.',
  /** T-165: the three things shown, each as its real screen */
  screens: {
    page: 'A phone showing a business’s quote page, with its request form.',
    site: 'A business’s own website, with the same request form on the page.',
  },
  shown: {
    qr: { title: 'A QR code', text: 'For your van, cards and invoices.' },
    page: { title: 'Your own quote page', text: 'A link you can send anywhere.' },
    site: { title: 'On your website', text: 'The same form, on your own page.' },
  },
  ways: [
    { title: 'Quote link', text: 'Your own page, for example /quote/your-business.' },
    { title: 'QR code', text: 'Print it on your van, cards or invoices.' },
    { title: 'WhatsApp', text: 'Send the link in a chat, or set it as your WhatsApp Business greeting.' },
    { title: 'Your website', text: 'Paste a short piece of code, or ask your web person with one tap.' },
  ],
} as const

export const PRICING_HEADING = 'Simple plans. Try it free.'

export const FAQ = [
  {
    q: 'What if I have no website?',
    a: 'You don’t need one. Share your quote link or QR code; it’s your own page.',
  },
  {
    q: 'Can it quote the wrong price?',
    a: 'Every price comes from the prices you set. A photo or an answer can still be misread, so your customer sees an estimate, or a range and one quick question, and by default cannot accept until you have confirmed it.',
  },
  {
    q: 'Can I approve before the customer accepts?',
    a: 'Yes. That’s the default: they see the estimate at once, and can accept once you confirm. You can also hold it until you approve, or send automatically.',
  },
  {
    q: 'Does it work with WordPress, Wix or Squarespace?',
    a: 'Yes. Paste a short piece of code on any site that lets you add HTML, or just link a button to your quote page.',
  },
  {
    q: 'What does the customer see?',
    a: 'A page with your name and logo, the price for their job (or a range and a question), and buttons to accept or ask you something.',
  },
  {
    q: `What happens after ${FREE} free quotes?`,
    a: 'New requests are still saved as leads, so you never lose a customer. Pick a plan to price them.',
  },
  {
    q: 'Is my data private?',
    a: 'Your customers’ details and photos are visible to you and never to other businesses. Photos are stored privately and used only to prepare the estimate. Our privacy policy has the details.',
    link: { href: '/privacy', label: 'Read the privacy policy' },
  },
] as const

export const FINAL_CTA = 'Your next customer could have your price tonight.'
/** T-165: the closing band has one button and one quiet link */
export const FINAL_QUIET_LINK = 'Or try it as a customer first'

export const PAGE_META = {
  title: `Instant quotes on your website, in your prices — ${PRODUCT_NAME}`,
  description: `Customers answer a few questions and send photos, and see your price straight away. You get the lead and confirm it. ${freeOfferLabel()}.`,
}
