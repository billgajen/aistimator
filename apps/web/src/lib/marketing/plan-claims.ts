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
import { ADDRESS_COPY, APP_DOMAIN, addressHostFrom, appPlanLines, offeredPlans } from '@qolumns/shared'
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

/**
 * T-187: the words on the mark beside anything that is not live yet (they were "Coming later").
 * Nothing on the site types them: a page asks `soonMark` below, so the mark goes away by itself
 * when the thing's line is marked live.
 */
export const COMING_SOON = 'Coming soon'

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
    label: 'Quotes inside WhatsApp, on your own business number',
    live: false,
    found: 'Built, and running for our own test business since 17 November 2026. Not open to other businesses: Meta has not reviewed the app, so nobody else can connect a number (OWNER-TODO, T-181). (Sharing your quote link in a WhatsApp chat works on every plan and is not this.)',
  },
  mobile_app: {
    // T-199: the app itself comes with every plan (PLAN_APP below); this channel is starting a quote in it
    label: 'On-site quotes in the app: price a job while you are there',
    live: false,
    found: 'Built, not released: the app is in no app store and no business has it. Since T-199 the app is open to every business; starting a quote in it is for plans with this channel, and for the free start.',
  },
}

/**
 * T-199 (the owner's decision): the mobile app comes with every plan: quotes, approve and send,
 * notifications, the account. Only starting a quote in it is a plan matter (`mobile_app` above).
 * One flag for both lines (the `live` of `mobile_app`): the app is released or it is not.
 */
export const PLAN_APP: PlanLine = {
  label: 'The mobile app: see, approve and send your quotes from your phone',
  // not a switch of its own: it reads the app's one flag, the `live` of the `mobile_app` line above
  get live(): boolean {
    return PLAN_CHANNEL_LINES.mobile_app.live
  },
  found: 'Built, not released (as above). Any business can sign in: no plan check stands in front of the app.',
}

/**
 * T-199: is a business's own address (yourname.<our domain>) switched on? ONE setting says so for the
 * whole product: `NEXT_PUBLIC_OWN_ADDRESS_HOST`, set once the Worker and its DNS record serve
 * (Docs/OWNER-TODO.md). Until then the dashboard offers nothing and the site says "Coming soon".
 */
export function ownAddressLive(): boolean {
  return addressHostFrom(process.env.NEXT_PUBLIC_OWN_ADDRESS_HOST) !== null
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
  own_address: {
    label: ADDRESS_COPY.planLine(APP_DOMAIN),
    live: ownAddressLive(),
    found: 'Built in T-199. Live once the Worker that serves the addresses is deployed and NEXT_PUBLIC_OWN_ADDRESS_HOST is set; until then nothing in the dashboard offers it.',
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

// ---------------------------------------------------------------------------
// T-187: the three things the site shows before they are live
// ---------------------------------------------------------------------------

/**
 * Quotes inside a WhatsApp chat, the on-site app, and measuring a room by
 * scanning it. Each has ONE flag: the `live` of its plan line above. Every
 * page that shows one of them (Home's setup step, "Add it anywhere", the app
 * section, the plan cards, the questions, Pricing's table, Features) asks
 * `soonMark`, so marking the line live removes "Coming soon" everywhere at
 * once. The words about each live here too, beside the flag: they describe
 * something a business cannot use yet, so they are not claims about the live
 * product and are never written through `says`.
 */
export type NotLiveYet = 'whatsapp' | 'app' | 'roomScan' | 'ownAddress'

const FLAG_LINE: Record<NotLiveYet, PlanLine> = {
  whatsapp: PLAN_CHANNEL_LINES.whatsapp,
  app: PLAN_CHANNEL_LINES.mobile_app,
  roomScan: PLAN_FEATURE_LINES.lidar_scanning!,
  // T-199: a fourth thing shown before it is live
  ownAddress: PLAN_FEATURE_LINES.own_address!,
}

/** Can a business use it today? */
export function isLive(key: NotLiveYet): boolean {
  return FLAG_LINE[key].live
}

/** "Coming soon" while it is not live; null once it is */
export function soonMark(key: NotLiveYet): string | null {
  return isLive(key) ? null : COMING_SOON
}

/** The mark for any plan line: "Coming soon" unless a business can use it today */
export function lineMark(line: PlanLine): string | null {
  return line.live ? null : COMING_SOON
}

export const UPCOMING = {
  whatsapp: {
    /** Its name wherever it is one of a list */
    name: 'WhatsApp, on your own business number',
    /** Home, "Set up in minutes", step 3 */
    where: 'In your WhatsApp chat',
    heading: 'Quotes inside WhatsApp, on the number you already use.',
    lines: [
      'A customer asks for a price in your WhatsApp chat.',
      'It asks only what the job needs, then sends them your estimate, priced from your price list.',
      'It stays quiet for every other message, and whenever you reply yourself.',
    ],
    /** What a screen reader hears for the picture */
    screen: 'A WhatsApp chat on a phone: a customer asks for a price, and the reply gives them the link to their estimate.',
    /** The customer's message in the picture */
    customerMessage: 'Hi, how much to repaint three bedrooms?',
  },
  app: {
    name: 'The on-site app',
    where: 'On site, with the app',
    heading: 'Price a job while you are standing in it.',
    lines: [
      'Take the photos and answer the job’s questions on your phone.',
      'The price comes from your own price list, while you are still there.',
      'Approve it and hand your customer the link before you leave.',
    ],
    screens: {
      list: 'The app’s list of quotes on a phone: the ones that need you first, then the ones waiting for a customer.',
      quote: 'One quote in the app: the customer, the price, where it stands, and the button “Approve & send”.',
    },
    /** The only platform named. Android is not built: nothing on the site says it is coming. */
    platform: 'iPhone',
  },
  roomScan: {
    name: 'Room scan',
    where: 'A room scan, in the app',
    heading: 'Scan a room, and its sizes fill themselves in.',
    lines: [
      'Walk the room with your phone’s camera, in the app.',
      'The room’s sizes go into the quote for you, and you and your customer see them with a floor plan and a 3D model.',
      'It needs an iPhone that has a LiDAR scanner.',
    ],
    screen: 'The app’s room scan card: “Walk the space with the camera”, and the button “Scan an area”.',
  },
} as const

/**
 * T-193: which plan the room scan comes with, from the plan definitions: the first plan the site shows
 * that includes it ("Included in Pro."). Null when no shown plan does.
 */
export function roomScanPlanLine(plans: PlanDefinition[] = sitePlans()): string | null {
  const plan = plans.find((p) => p.features.lidar_scanning)
  return plan ? `Included in ${plan.name}.` : null
}

/** T-199: "Mobile app: every plan. On-site quotes in the app: Pro." The plans named are the ones the site shows. */
export function appPlanSentence(plans: PlanDefinition[] = sitePlans()): string {
  const lines = appPlanLines(plans)
  return `${lines.everyPlan}. ${lines.onsite}.`
}

/** "Coming soon to iPhone", or "On iPhone" once the app is live */
export function appAvailability(): string {
  return isLive('app') ? `On ${UPCOMING.app.platform}` : `${COMING_SOON} to ${UPCOMING.app.platform}`
}

/**
 * The questions about things that are not live yet (Home's questions). Each answer says what works
 * today first; the second sentence depends on the flag.
 */
export function upcomingFaq(): Array<{ q: string; a: string }> {
  return [
    {
      q: 'Can my customers get a quote in WhatsApp?',
      a: `Yes, today, by link: send your quote link in any WhatsApp chat and it opens your quote page. ${
        isLive('whatsapp')
          ? 'They can also ask for a price in the chat itself, on your own business number.'
          : 'Asking for a price in the chat itself, on your own business number, is coming soon.'
      }`,
    },
    {
      q: 'Is there an app?',
      // T-199: who gets the app and who can start a quote in it, in the words of `appPlanLines`
      a: `${
        isLive('app')
          ? `Yes. The ${UPCOMING.app.platform} app shows your quotes and lets you approve and send them, and your dashboard works in any phone’s browser.`
          : `An ${UPCOMING.app.platform} app is coming soon. Today your dashboard works in your phone’s browser.`
      } ${appPlanSentence()}`,
    },
  ]
}

// ---------------------------------------------------------------------------
// T-187: what a plan card says
// ---------------------------------------------------------------------------

export interface PlanCard {
  id: string
  name: string
  recommended: boolean
  /** Monthly and yearly price, in minor units (cents) */
  monthly: number
  yearly: number | null
  /** "50 quotes a month" */
  quotes: string
  /** "Everything in Starter, plus": set when the plan below it is shown too */
  buildsOn: string | null
  /** What you get, live lines first. With `buildsOn`, only what the plan below does not have. */
  lines: PlanLine[]
}

/** "50 quotes a month" */
export function quotesLine(plan: PlanDefinition): string {
  return plan.quoteLimit > 0 ? `${plan.quoteLimit.toLocaleString('en-US')} quotes a month` : 'No limit on quotes'
}

/**
 * The plan cards of the public site (Home and Pricing draw the same ones).
 * Everything on a card comes from the plan definitions and the lines above:
 * a plan's own lines, live ones first, with the plan below it summed up as
 * "Everything in <that plan>, plus".
 */
export function planCards(currency = 'USD', plans: PlanDefinition[] = sitePlans()): PlanCard[] {
  return plans.map((plan, i) => {
    const below = plans[i - 1]
    const had = new Set(below ? planLines(below).map((l) => l.label) : [])
    return {
      id: plan.id,
      name: plan.name,
      recommended: Boolean(plan.recommended),
      monthly: plan.monthlyPrice[currency] ?? 0,
      yearly: plan.annualPrice?.[currency] ?? null,
      quotes: quotesLine(plan),
      buildsOn: below ? `Everything in ${below.name}, plus` : null,
      lines: planLines(plan).filter((l) => !had.has(l.label)),
    }
  })
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
  // T-199: the app is on every plan (PLAN_APP); starting a quote in it is the `mobile_app` channel's own line
  const onsite = plan.channels.includes('mobile_app') ? [PLAN_CHANNEL_LINES.mobile_app] : []
  const lines: PlanLine[] = [...plan.channels.filter((c) => c !== 'mobile_app').map((c) => PLAN_CHANNEL_LINES[c]), PLAN_HOSTED_PAGES, PLAN_APP, ...onsite]
  for (const key of ['custom_branding', 'calibration_insights', 'lidar_scanning', 'own_address', 'multiple_users', 'priority_support'] as const) {
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
 * leaves Business off (team members and priority support are still to come;
 * since T-193 the room scan is on Pro as well) and shows Starter and Pro. It comes back by itself when one
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

/** The words under the Pricing headline, and the page's description: only what is live */
export const PRICING_LEAD = 'Instant estimates in your own prices, on your website or through your own quote link. Subscription only: no commission, no per-lead fees.'
export const PRICING_DESCRIPTION = 'Simple monthly plans for businesses of any size. Instant estimates on your website or through your own quote link, in your own prices.'
