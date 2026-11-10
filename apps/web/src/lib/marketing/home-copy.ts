/**
 * T-154: the home page's words, in one place (approved copy, 2026-11-10).
 *
 * Every promise matches the live product: the customer sees an estimate from
 * the business's prices at once (or a range and one question), and by default
 * cannot accept until the business has confirmed it. No grades, no engine
 * words, no "exact", no confirmed-quote-in-seconds. Statistics are quoted as
 * their sources state them, each with its link.
 */
import { FREE_ALLOWANCE, PRODUCT_NAME, freeOfferLabel } from '@estimator/shared'

const FREE = FREE_ALLOWANCE.US!.quotes

export const HERO = {
  headline: 'Instant quotes on your website, in your prices.',
  subline:
    'Customers answer a few questions and send photos. They see an estimate from your prices straight away. You get the lead, and you confirm it.',
  smallLine: 'For contractors and home-service businesses. No website needed.',
  frames: ['Your customer asks', 'They see your price', 'You confirm it'] as const,
}

export const TRADES_HEADING = 'Ready-made templates for your trade'
export const OTHER_TRADES = 'Other trades: describe your prices in plain English'

export const HOW_IT_WORKS = [
  {
    title: 'Your customer asks.',
    text: 'From your quote link, your website or a QR code: a few questions about the job and a photo or two.',
  },
  {
    title: 'They see your price.',
    text: 'Worked out from the prices you set. When something needs checking, they see a range and one quick question.',
  },
  {
    title: 'You confirm it.',
    text: 'You get the lead with the price. One tap on Approve & send, and they can accept.',
  },
] as const

export const CONTROL = {
  heading: 'Your prices. You stay in control.',
  points: [
    {
      title: 'Only your prices',
      text: 'Every price comes from what you set. The AI reads the job details; it never picks a price.',
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
  heading: 'Add it in a minute',
  lead: 'No website needed. Share your quote link anywhere your customers already find you.',
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

export const PAGE_META = {
  title: `Instant quotes on your website, in your prices — ${PRODUCT_NAME}`,
  description: `Customers answer a few questions and send photos, and see your price straight away. You get the lead and confirm it. ${freeOfferLabel()}.`,
}
