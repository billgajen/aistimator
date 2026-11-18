/**
 * T-170: what each plan line on the Pricing page is, and whether a business
 * on that plan can use it today. The plan definitions
 * (packages/shared/src/plans.ts) say what a plan includes; this file says
 * which of those things exist yet. The Pricing page marks a line that is not
 * live "Coming later" and lists it after the live ones. It never drops a
 * line the plan promises, and it never shows one as live that is not.
 *
 * `found` is what the code and the production setup showed on 2026-11-16
 * (Docs/design/ai-capabilities.md, section 7, has the same list). Changing a
 * line to live is one edit here, once the thing can be used.
 *
 * What a plan includes is the owner's decision and is not changed here.
 */
import { offeredPlans } from '@qolumns/shared'
import type { PlanChannel, PlanDefinition, PlanFeatureSet } from '@qolumns/shared'
import { PRICING_DEMO_LINKS } from './site-copy'

export interface PlanLine {
  /**
   * What the business gets, in plain words (T-181): a plan card is read by someone deciding whether to
   * buy, so a line says the result, not the feature's name. It still claims only what `found` supports.
   */
  label: string
  /** A business on a plan that includes it can use it today */
  live: boolean
  found: string
  /**
   * T-181 (the owner's decision): false keeps the line off every page. The plan still includes the
   * channel (packages/shared/src/plans.ts); the site says nothing about it until the owner says so.
   */
  shown?: boolean
}

export const COMING_LATER = 'Coming later'

/** T-181: under the plan cards on Pricing, with the tax note. The Terms say the same. */
export const BILLED_IN_ADVANCE = 'Billed in advance, monthly or yearly.'

/**
 * T-180: said, small and plain, beside every plan price (the Pricing page, Home's plan cards, the billing
 * page's plan cards). Stripe sells the plan and adds the sales tax or VAT at checkout, so the price a
 * business sees here is before tax.
 */
export const PLUS_TAX = 'plus tax'

export const PLAN_CHANNEL_LINES: Record<PlanChannel, PlanLine> = {
  widget: {
    label: 'Customers see your price straight away, on your website or from a link you share',
    live: true,
    found: 'Live: the embed code and the hosted quote link, on every plan.',
  },
  sms: {
    label: 'Quoting by text message',
    live: false,
    // T-181: not on the site at all, not even as "Coming later"
    shown: false,
    found: 'Built, not switched on: production runs text messages in test mode and no business has a number, so nobody can use it.',
  },
  whatsapp: {
    label: 'Quotes inside WhatsApp, on your own number',
    live: false,
    found: 'Built, and running for our own test business since 17 November 2026. Not open to other businesses: Meta has not reviewed the app, so nobody else can connect a number (OWNER-TODO, T-181). (Sharing your quote link in a WhatsApp chat works on every plan and is not this.)',
  },
  mobile_app: {
    label: 'An app for pricing a job while you are on site',
    live: false,
    found: 'Built, not released: the app is in no app store and no business has it.',
  },
}

export const PLAN_FEATURE_LINES: Partial<Record<keyof PlanFeatureSet, PlanLine>> = {
  custom_branding: {
    label: PRICING_DEMO_LINKS.branding,
    live: true,
    found: 'Live, and enforced by plan: the "Prepared with …" badge is left off the estimate. (The logo and colour are on every plan.)',
  },
  calibration_insights: {
    label: 'See how your estimates compare with your final invoices',
    live: true,
    found: 'Live: Analytics compares estimates with the final invoices a business records. It is not held back from other plans in the code.',
  },
  lidar_scanning: {
    label: 'Measure a room by scanning it with your phone',
    live: false,
    found: 'Built, not released: it needs the on-site app in a build that has never been shipped.',
  },
  multiple_users: {
    label: 'Logins for your whole team',
    live: false,
    found: 'Not built: there is no way to invite a second person to a business.',
  },
  priority_support: {
    label: 'Faster answers from us when you need help',
    live: false,
    found: 'Not offered yet. Since T-174 there is a support address (SUPPORT_EMAIL), but no promise of a faster answer for one plan; the owner decides when this is live.',
  },
}

/** The line every plan has */
export const PLAN_HOSTED_PAGES: PlanLine = {
  label: PRICING_DEMO_LINKS.hostedPages,
  live: true,
  found: 'Live: every estimate has its own page.',
}

/**
 * The lines of one plan, live ones first, in the plan's own order within each
 * group.
 */
export function planLines(plan: PlanDefinition): PlanLine[] {
  const lines: PlanLine[] = [...plan.channels.map((c) => PLAN_CHANNEL_LINES[c]), PLAN_HOSTED_PAGES]
  for (const key of ['custom_branding', 'calibration_insights', 'lidar_scanning', 'multiple_users', 'priority_support'] as const) {
    const line = PLAN_FEATURE_LINES[key]
    if (plan.features[key] && line) lines.push(line)
  }
  const shown = lines.filter((l) => l.shown !== false)
  return [...shown.filter((l) => l.live), ...shown.filter((l) => !l.live)]
}

/**
 * The plans the public site shows: the Pricing page and Home's plan cards
 * (the owner's decision, 2026-11-16). A plan is left off until at least one
 * line of its own is live: a line the plan below it does not have. Today that
 * leaves Business off (LiDAR, team members and priority support are all
 * still to come) and shows Starter and Pro. It comes back by itself when one
 * of its own lines is marked live above.
 *
 * Only the public pages read this. What a plan includes, its price, sign-up
 * with a plan and the billing page are unchanged (packages/shared/src/plans.ts).
 */
export function sitePlans(plans: PlanDefinition[] = offeredPlans()): PlanDefinition[] {
  return plans.filter((plan, i) => {
    const below = plans[i - 1]
    if (!below) return true
    const has = new Set(planLines(below).map((l) => l.label))
    return planLines(plan).some((l) => l.live && !has.has(l.label))
  })
}

/**
 * The line under a plan's name on the Pricing page. The plan definitions'
 * own taglines name channels and features that are not live ("text and
 * WhatsApp", "the on-site app", "LiDAR scanning"), so the Pricing page says
 * only what a business gets today. A plan that is not listed keeps its own
 * tagline.
 */
export const PRICING_TAGLINES: Record<string, string> = {
  // T-181: the plan's own tagline said "on your website"; a business needs no website to use it (T-173)
  plan_us_starter: 'Instant quotes for your customers, with or without a website',
  plan_us_pro: 'Everything in Starter, with more quotes and no badge of ours on your estimates',
  plan_us_business: 'Everything in Pro, with the most quotes a month',
}

/** The words under the Pricing headline, and the page's description: only what is live */
export const PRICING_LEAD = 'Instant estimates in your own prices, on your website or through your own quote link. Subscription only: no commission, no per-lead fees.'
export const PRICING_DESCRIPTION = 'Simple monthly plans for businesses of any size. Instant estimates on your website or through your own quote link, in your own prices.'
