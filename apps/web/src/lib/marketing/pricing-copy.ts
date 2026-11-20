/**
 * T-187: the Pricing page's words: the compare table, the billing notes and
 * the questions.
 *
 * The table is built, not typed. A row's cells come from the plan definitions
 * (packages/shared/src/plans.ts) and from lib/marketing/plan-claims.ts, which
 * says whether a business can use a thing today. A line that is not live sits
 * in the last group, "Coming soon", and moves up by itself when its flag is
 * set. A row about what the product reads or works out is written through
 * `says`, like every claim on the site.
 */
import { FREE_ALLOWANCE } from '@qolumns/shared'
import type { PlanDefinition } from '@qolumns/shared'
import { says } from './ai-claims'
import { BILLED_IN_ADVANCE, COMING_SOON, PLAN_CHANNEL_LINES, PLAN_FEATURE_LINES, PLAN_HOSTED_PAGES, sitePlans, type PlanLine } from './plan-claims'
import { PRICING_AI_FAQ } from './site-copy'

const FREE_QUOTES = FREE_ALLOWANCE.US!.quotes

export const PRICING_HERO = {
  headline: 'One missed job pays for the year.',
  /** After the number of free quotes */
  free: 'priced quotes free in total, with no card. Then pick a plan.',
} as const

/** A cell: included, not included, or words (a number, "Coming soon") */
export type CompareCell = boolean | string

export interface CompareRow {
  label: string
  /** One cell per plan shown, in the plans' order */
  cells: CompareCell[]
}

export interface CompareGroup {
  id: 'quotes' | 'reach' | 'ai' | 'brand' | 'soon'
  title: string
  rows: CompareRow[]
}

export const COMPARE = {
  heading: 'Compare the plans',
  /** The first column's heading, for a screen reader */
  whatYouGet: 'What you get',
  included: 'Included',
  notIncluded: 'Not included',
  groups: {
    quotes: 'Quotes',
    reach: 'Where customers reach you',
    ai: 'What the AI does',
    brand: 'Your brand',
    soon: COMING_SOON,
  },
} as const

/** What the product does on every plan: nothing here is held back from a smaller plan */
const AI_ROWS: readonly string[] = [
  says(['photo-notes'], 'Reads the photos and notes your customer sends'),
  says(['pricing-engine'], 'Works out every price from your own price list'),
  says(['range-and-question'], 'Asks your customer one quick question when a detail is unclear'),
  says(['also-asked'], 'Notices when they ask for a second service, and offers it on the same quote'),
]

const has = (plan: PlanDefinition, line: PlanLine): boolean => {
  if (line === PLAN_HOSTED_PAGES) return true
  for (const channel of plan.channels) if (PLAN_CHANNEL_LINES[channel] === line) return true
  for (const [key, value] of Object.entries(PLAN_FEATURE_LINES)) if (value === line && plan.features[key as keyof PlanDefinition['features']]) return true
  return false
}

/**
 * The compare table for the plans the site shows. A plan line appears once: in
 * its own group while it is live, in "Coming soon" while it is not. A line no
 * shown plan includes is left out. (Since T-193 the room scan is on Pro, so
 * it is a "Coming soon" row.)
 */
export function compareGroups(plans: PlanDefinition[] = sitePlans()): CompareGroup[] {
  const every = plans.map(() => true as CompareCell)
  const row = (line: PlanLine): CompareRow => ({ label: line.label, cells: plans.map((plan) => (has(plan, line) ? (line.live ? true : COMING_SOON) : false)) })
  const channelLines = Object.values(PLAN_CHANNEL_LINES).filter((line) => line.shown !== false)
  const featureLines = Object.values(PLAN_FEATURE_LINES).filter((line): line is PlanLine => Boolean(line) && line.shown !== false)
  const offered = (line: PlanLine) => plans.some((plan) => has(plan, line))
  const branding = PLAN_FEATURE_LINES.custom_branding!
  const insights = PLAN_FEATURE_LINES.calibration_insights!

  const groups: CompareGroup[] = [
    {
      id: 'quotes',
      title: COMPARE.groups.quotes,
      rows: [
        { label: 'Quotes a month', cells: plans.map((plan) => (plan.quoteLimit > 0 ? plan.quoteLimit.toLocaleString('en-US') : 'No limit')) },
        { label: 'Over the limit, new requests are saved as leads', cells: every },
        ...(insights.live && offered(insights) ? [row(insights)] : []),
      ],
    },
    {
      id: 'reach',
      title: COMPARE.groups.reach,
      rows: [
        { label: 'Your own quote page, with a link and a QR code', cells: plans.map((plan) => plan.channels.includes('widget')) },
        { label: 'The same form on your website', cells: plans.map((plan) => plan.channels.includes('widget')) },
        row(PLAN_HOSTED_PAGES),
        ...channelLines.filter((line) => line.live && line !== PLAN_CHANNEL_LINES.widget && offered(line)).map(row),
      ],
    },
    { id: 'ai', title: COMPARE.groups.ai, rows: AI_ROWS.map((label) => ({ label, cells: every })) },
    {
      id: 'brand',
      title: COMPARE.groups.brand,
      rows: [{ label: 'Your name, logo and colour on every estimate', cells: every }, ...(branding.live && offered(branding) ? [row(branding)] : [])],
    },
    {
      id: 'soon',
      title: COMPARE.groups.soon,
      rows: [...channelLines, ...featureLines].filter((line) => !line.live && offered(line)).map(row),
    },
  ]
  return groups.filter((group) => group.rows.length > 0)
}

/** Under the table: how the money works, one plain line each */
export const BILLING_NOTES: ReadonlyArray<{ title: string; text: string }> = [
  { title: 'Billed in advance', text: `${BILLED_IN_ADVANCE} Pay yearly and two months are free.` },
  { title: 'Plus tax', text: 'Prices are in US dollars, before tax. Sales tax or VAT is added at checkout.' },
  { title: 'Cancel any time', text: 'There is no contract. If you cancel, you keep your plan until the end of the period you paid for.' },
  { title: 'Moving to a smaller plan', text: 'You can, at any time. The change starts at the end of the period you paid for.' },
  {
    title: 'Over your limit',
    text: 'You never lose a customer. New requests are saved as leads, and your customer is told you will send their estimate shortly. Nothing extra is charged; move up a plan to price them.',
  },
]

export const PRICING_FAQ_HEADING = 'Questions about pricing'

export const PRICING_FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'Can I try it for free?',
    a: `Yes. Every new business gets ${FREE_QUOTES} priced quotes free, with no card. They don’t reset each month: it’s ${FREE_QUOTES} in total, so you can try it with real customers. Test quotes from setup and requests a customer didn’t finish don’t count.`,
  },
  {
    q: 'What counts as a quote?',
    a: 'One customer request that gets a price, however many photos, questions or changes it takes. Failed or spam requests don’t count.',
  },
  PRICING_AI_FAQ,
  {
    q: 'When do I start paying?',
    a: `When you pick a plan. Your ${FREE_QUOTES} free quotes need no card, and your setup and quote history carry straight over.`,
  },
  {
    q: 'Do I need a website?',
    a: 'No. Every plan gives you your own quote page, with a link and a QR code to share.',
  },
]

export const PRICING_CLOSING = {
  heading: 'Try it on your own prices.',
  lead: 'Describe your rates in plain English and send yourself a test quote. It takes about five minutes.',
} as const
