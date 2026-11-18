/**
 * T-167: marketing words shared across pages (the footer, the trade pages'
 * small line, one Pricing answer, the demo's note). They were typed inside
 * components; the words "AI" and what it does now live only in the copy
 * files, where each claim names its row of Docs/design/ai-capabilities.md.
 */
import { says } from './ai-claims'
import { MESSAGE_LINE } from './home-copy'

export const FOOTER = {
  /** Under the wordmark */
  // T-181: any business, small to corporate (it used to name one kind of business)
  tagline: says(['photo-notes', 'pricing-engine'], 'Instant, professional quotes for any business, small or large. The AI works out the job. Your prices work out the cost.'),
  /** After the copyright line */
  closing: MESSAGE_LINE,
} as const

/** Under the buttons of a trade page's hero */
export const TRADE_SMALL_LINE = says(['photo-notes', 'pricing-engine'], 'The AI works out the job. Your prices work out the cost. No website needed.')

/** Each trade page: the band about telling it your prices */
export const TRADE_PRICING_BAND = {
  heading: 'Tell it your prices the way you’d tell a new hire.',
  /** `{example}` is the trade's own price sentence */
  before: 'Type',
  after: says(
    ['price-sentence', 'pricing-engine', 'range-and-question'],
    'and it becomes your pricing, shown back to you in plain English. Every estimate comes from those prices. When a detail isn’t clear, the customer is asked, and by default they can accept only once you’ve confirmed it.'
  ),
} as const

export const TRADE_HOW_HEADING = 'How the price is set'

/** Pricing page: the question about who sets the price */
export const PRICING_AI_FAQ = {
  q: 'Does the AI decide my prices?',
  a: says(
    ['photo-notes', 'pricing-engine'],
    'No. This is the one rule we never break. The AI works out the job; the price is calculated from the prices you set. You can review every quote before it sends if you want to.'
  ),
} as const

/**
 * T-181: the page that says how to have data deleted. Its address is also what goes in the Meta app's
 * "Data deletion instructions URL" (OWNER-TODO, T-181). The footer links to it.
 */
export const DATA_DELETION = { href: '/data-deletion', label: 'Delete your data' } as const

/** Pricing page: the two plan lines that are shown, not only told (they link to the live demo) */
export const PRICING_DEMO_LINKS = {
  href: '/demo',
  // T-181: said as what the business gets, not as the feature's name
  hostedPages: 'Every customer gets their own estimate page to open, accept and come back to',
  branding: 'Estimates under your brand alone, with no badge of ours',
} as const

/** /demo: under the estimate */
export const DEMO_NOTE = says(['pricing-engine'], 'An example business with example prices. Every price comes from the business’s own rates, never from the AI.')
/** /demo: when the estimate is a range (T-167: "to firm this up" used a word customers never see) */
export const DEMO_QUESTION_NOTE = 'The business would ask you one quick question to settle it.'
