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
  /** T-173 (the owner's words): "for your customers" replaces "on your website"; a business needs no website to use it */
  headline: 'Instant quotes for your customers, in your prices.',
  /** T-167: what the AI does, in one plain sentence, then where the price comes from (T-168: the owner's wording) */
  subline: says(
    ['photo-notes', 'pricing-engine'],
    'The AI reads what your customer tells you and the photos they send, and works out the job. The price comes from your own price list, and you confirm it.'
  ),
  /** T-181 (the owner's instruction): any business, small to corporate; it used to name two kinds of business only */
  smallLine: 'For any business that quotes for its work, small to corporate. No website? Use your quote link.',
  frames: ['Your customer asks', 'They see your price', 'You confirm it'] as const,
}

/** T-167: the last pill of the trade links inside "Choose your trade" (the standalone trades row is gone) */
export const OTHER_TRADES = 'Other trades: describe your prices in plain English'

/**
 * The hero's product demo. T-168: three frames of the same height, one idea
 * each, for the example business's simplest job (the template's own question
 * and price, through lib/marketing/examples.ts: the default example).
 */
export const HERO_DEMO_FRAMES = {
  playAgain: 'Play again',
  /** Under the estimate: why Accept is locked (`{business}` is the example business) */
  acceptNote: (business: string) => `${business} confirms it, then you can accept.`,
  /** Each frame is a picture of the product: what a screen reader hears for it */
  screens: [
    'The request form on a business’s quote page: one question, answered, and the button “Get my estimate”.',
    'The customer’s estimate: the price of the job from the business’s prices and its total, with the Accept button locked until the business confirms it.',
    'The business’s dashboard, “Waiting for you”: the new request with its price and the button “Approve & send”.',
  ],
} as const

/**
 * The water-heater example the rest of Home is built on ("What it notices",
 * "Set up in minutes", "Add it anywhere"): the template's own question and
 * answer, and the sample label the live demo offers.
 */
export const HERO_DEMO = {
  trade: 'water-heaters',
  question: 'Where is the water heater?',
  answer: 'Garage',
  photoLabel: 'Tank rating label',
  /** The sample label the live demo offers (public/demo), drawn for it; no real product */
  photoSrc: '/demo/sample-water-heater-label.png',
  photoAlt: 'A sample photo of a water heater’s rating label',
  /**
   * T-167: what the product returned for this sample label at the template's
   * prices, on the local stack (Docs/design/ai-capabilities.md, section 6): it
   * read 50 gal and natural gas, and until the customer confirmed the reading
   * it showed this range. "What it notices" shows the reading and the range.
   */
  rangeBeforeConfirming: { low: 1890, high: 2410 },
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
 * beside the screen where the result appears. Every sentence rests on a row
 * of Docs/design/ai-capabilities.md (`says`). The figures in the screens are
 * the templates' own prices (lib/marketing/examples.ts).
 *
 * T-173 (the owner's order, general enough for any trade):
 *   1 words   what the customer wrote, beside what the product made of it
 *   2 photos  what the photos show; the walls and the label are its two examples
 *   3 extra   something extra they mention
 *   4 range   when it can't tell, it asks
 *
 * The first is worded for what the product does, checked live on 2026-11-17:
 * the customer picks the service and answers the size question; the product
 * reads their message AGAINST those, suggests the right service when the
 * words fit another, and asks when the words give a different size. It does
 * not work the service or the size out from a message alone, so nothing here
 * says it does.
 */
export const NOTICES = {
  heading: 'What it notices',
  examples: [
    {
      id: 'words',
      title: 'What your customer wrote',
      text: says(
        ['service-match', 'words-against-answers', 'extras-from-description'],
        'It reads their message against the service they picked and the answers they gave. When the words say something else, it asks.'
      ),
      /** The customer's message. It holds the size ("three bedrooms") and the painting example's own phrase for the extra. */
      wroteTitle: 'Your customer wrote',
      message: 'Hi, I need three bedrooms repainted, and the trim too. The walls are dark blue and I want them white.',
      understoodTitle: 'What it understood',
      understood: {
        service: { label: 'The service', text: says(['service-match'], 'It fits what they wrote.') },
        size: { label: 'The size of the job', value: 'Three rooms', text: says(['words-against-answers'], 'They answered one room, so it asks which is right.') },
        extra: { label: 'A detail', text: says(['extras-from-description'], 'They asked for it, so your line for it is added, at your price.') },
      },
      screen:
        'A customer’s message, and beside it what the product made of it: the service fits what they wrote, the size differs from their answer so it asks, and the extra they asked for is added.',
    },
    {
      id: 'photos',
      title: 'What the photos show',
      text: says(['photo-notes'], 'It reads the photos your customer sends for anything that affects the job. Two examples of what it can read:'),
      parts: [
        {
          id: 'walls',
          title: 'Walls, measured from photos',
          text: says(['photo-measurement'], 'For exterior painting it works out the wall area from your customer’s photos, using a door as its ruler.'),
          /**
           * T-174 (the owner's words). The customer is shown the wall reading to
           * check: as a question before the price settles in most runs, and on
           * the estimate in every run (Docs/design/ai-capabilities.md, section 1).
           */
          note: says(['photo-measurement', 'confirm-question'], 'It’s an estimate. Your customer checks it and you confirm the price.'),
          screen: 'Part of an estimate: the exterior walls priced by the square foot, with the area marked as worked out from the customer’s photos.',
        },
        {
          id: 'label',
          title: 'Model and size, read from a photo',
          text: says(
            ['label-reading', 'confirm-question'],
            'It reads the capacity and fuel off a tank label, the size off a rating plate, the rating off a panel. Then it checks the reading with your customer.'
          ),
          screen: 'The question a customer is asked after sending a photo of a tank label: the capacity that was read from it, with “Yes, 50 gal is right” chosen.',
        },
      ],
    },
    {
      id: 'extra',
      title: 'Something extra they mention',
      text: says(['extras-from-description'], 'When they mention something extra, it adds your line for it, at your price.'),
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
    /** T-170: the words on the van's side, beside the QR code (ours, drawn in code) */
    van: 'Scan for an estimate',
    /** What the QR code is, for a screen reader; the link follows it */
    sign: 'A QR code on the side of the van. It opens',
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
  title: `Instant quotes for your customers, in your prices — ${PRODUCT_NAME}`,
  description: `Customers answer a few questions and send photos, and see your price straight away. You get the lead and confirm it. ${freeOfferLabel()}.`,
}
