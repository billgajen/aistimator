/**
 * T-198: the help guide, built for the web app.
 *
 * The pages are Docs/help (copied in by `pnpm help:build`). Every plan fact
 * and every "is it live" in them is filled in HERE, each time, from the plan
 * definitions (packages/shared/src/plans.ts) and the site's flags
 * (lib/marketing/plan-claims.ts). Nothing about a plan is typed in a page,
 * so the guide cannot disagree with the Billing page or the public site.
 */
import {
  ASK_DAILY_LIMIT,
  ASK_KEEP_DAYS,
  FREE_ALLOWANCE,
  PRODUCT_NAME,
  QUOTE_TURN_COPY,
  SUPPORT_DAILY_LIMIT,
  SUPPORT_EMAIL,
  SORT_HELP_MAX,
  buildHelpGuide,
  guideText,
  selectEntries,
  formatMoney,
  offeredPlans,
  planNamesFor,
  freeStartPlan,
  freeOfferLabel,
  APP_DOMAIN,
  ADDRESS_HOLD_DAYS,
  routeOf,
  type HelpFacts,
  type HelpFlag,
  type HelpGuide,
  type HelpPageSource,
  type PlanDefinition,
} from '@qolumns/shared'
import { COMING_SOON, PLUS_TAX, isLive, planLines, type NotLiveYet } from '@/lib/marketing/plan-claims'
import { HELP_PAGES } from './guide-pages.generated'

/** The guide speaks to a new business: the launch market's currency and free offer */
const GUIDE_CURRENCY = 'USD'
const GUIDE_REGION = 'US'

/** "$49": whole units when there are no cents */
export function planMoney(minor: number, currency = GUIDE_CURRENCY): string {
  return formatMoney(minor / 100, currency, 'en-US', { decimals: minor % 100 === 0 ? 0 : 2 })
}

/** "starter" for plan_us_starter: the name a page uses in {{plan.starter.monthly}} */
export const planKey = (plan: PlanDefinition): string => plan.id.replace(/^plan_(?:us_)?/, '')

/** One plan in a sentence or two: its prices, its quotes a month, what it includes today and what is coming soon */
export function planSentence(plan: PlanDefinition): string {
  const monthly = plan.monthlyPrice[GUIDE_CURRENCY] ?? 0
  const yearly = plan.annualPrice?.[GUIDE_CURRENCY]
  const lines = planLines(plan)
  const live = lines.filter((line) => line.live).map((line) => line.label)
  const soon = lines.filter((line) => !line.live).map((line) => line.label)
  const price = `${planMoney(monthly)} a month${typeof yearly === 'number' ? `, or ${planMoney(yearly)} a year` : ''}, ${PLUS_TAX}`
  const quotes = plan.quoteLimit > 0 ? `${plan.quoteLimit.toLocaleString('en-US')} quotes a month` : 'No limit on quotes'
  return `- ${plan.name}: ${price}. ${quotes}.${live.length ? ` Includes today: ${live.join('; ')}.` : ''}${soon.length ? ` ${COMING_SOON}: ${soon.join('; ')}.` : ''}`
}

/** Every fact a page may use (Docs/help/README.md lists them) */
export function helpFacts(plans: PlanDefinition[] = offeredPlans()): HelpFacts {
  const tokens: Record<string, string> = {
    product: PRODUCT_NAME,
    'free.quotes': String(FREE_ALLOWANCE[GUIDE_REGION]!.quotes),
    plans: plans.map(planSentence).join('\n'),
    soon: COMING_SOON,
    'support.email': SUPPORT_EMAIL,
    'support.dailyReports': String(SUPPORT_DAILY_LIMIT),
    'ask.dailyQuestions': String(ASK_DAILY_LIMIT),
    'ask.keepDays': String(ASK_KEEP_DAYS),
    // T-199: which plans include a thing is asked of the one rule (`plansWith`), never worked out here
    'whatsapp.plans': planNamesFor('whatsapp', plans) || 'no plan',
    // the app itself is open to every business; starting a quote in it is a plan matter
    'onsite.plans': planNamesFor('onsite_quotes', plans) || 'no plan',
    'roomScan.plans': planNamesFor('room_scan', plans) || 'no plan',
    'badge.plans': planNamesFor('no_badge', plans) || 'no plan',
    'ownAddress.plans': planNamesFor('own_address', plans) || 'no plan',
    'ownAddress.example': `yourname.${APP_DOMAIN}`,
    'ownAddress.holdDays': String(ADDRESS_HOLD_DAYS),
    // the plan a new business works like while it has free quotes left, and the offer in the site's words
    'freeStart.plan': freeStartPlan()?.name ?? 'no plan',
    'free.offer': freeOfferLabel(),
  }
  for (const plan of plans) {
    const key = planKey(plan)
    tokens[`plan.${key}.name`] = plan.name
    tokens[`plan.${key}.monthly`] = planMoney(plan.monthlyPrice[GUIDE_CURRENCY] ?? 0)
    if (typeof plan.annualPrice?.[GUIDE_CURRENCY] === 'number') tokens[`plan.${key}.yearly`] = planMoney(plan.annualPrice[GUIDE_CURRENCY]!)
    tokens[`plan.${key}.quotes`] = plan.quoteLimit > 0 ? plan.quoteLimit.toLocaleString('en-US') : 'unlimited'
  }
  const live = Object.fromEntries((['whatsapp', 'app', 'roomScan', 'ownAddress'] satisfies NotLiveYet[]).map((flag) => [flag, isLive(flag)])) as Record<HelpFlag, boolean>
  return { tokens, live }
}

/**
 * Dashboard pages a button can open, by the name the menu or the page gives
 * them ("Open Services"). A page in the guide that is not here gets no
 * button; a unit test holds that every page the guide names is here.
 */
const M = QUOTE_TURN_COPY.menu
export const HELP_PAGE_NAMES: Record<string, string> = {
  '/app': M.home,
  '/app/quotes': M.quotes,
  '/app/analytics': M.analytics,
  '/app/services': M.services,
  '/app/quote-link': M.quoteLink,
  '/app/whatsapp': M.whatsapp,
  '/app/settings': M.settings,
  '/app/settings/billing': 'Billing',
  '/app/settings/branding': 'Branding',
  '/app/settings/notifications': 'Notifications',
  '/app/onboarding': 'Setup',
}

/** A quote's own pages have no button: there is no one page to open */
export const HELP_PLACE_NAMES: Record<string, string> = {
  '/app/quotes/[quoteId]': "a quote's own page",
  '/app/quotes/[quoteId]/trace': "a quote's page that shows how its price was worked out",
}

/** Names for the model's "Page:" lines, by route */
export function pageNamesFor(guide: HelpGuide): Record<string, string> {
  const names: Record<string, string> = {}
  for (const entry of guide.entries) {
    const route = routeOf(entry.page)
    const name = HELP_PAGE_NAMES[route] ?? HELP_PLACE_NAMES[route]
    if (name) names[route] = name
  }
  return names
}

/**
 * Dashboard pages the guide leaves out, each with its reason. The unit test
 * fails for any other dashboard page that has no entry.
 */
export const NOT_IN_GUIDE: Record<string, string> = {
  '/app/sms': 'Quoting by text message is not switched on and the page is not in the menu; the guide says plainly that it is not offered.',
}

/**
 * What the guide says near some words: the entries that share the most words
 * with them, as text, inside `max` characters. Sent with a report to the
 * sorter so that a draft reply can answer from the guide. No AI is asked.
 */
export function helpExcerpt(words: string | null | undefined, max: number = SORT_HELP_MAX): string {
  try {
    const guide = helpGuide()
    const text = guideText(selectEntries(guide, words ?? '', Math.min(max, GUIDE_EXCERPT_CHARS)), pageNamesFor(guide))
    return text.slice(0, max)
  } catch {
    return ''
  }
}
/** Room for half a dozen entries: enough to answer one question, small enough to travel with a job */
const GUIDE_EXCERPT_CHARS = 7000

let built: HelpGuide | null = null

/** The guide, built once for this server (the pages and the plan definitions do not change while it runs) */
export function helpGuide(pages: readonly HelpPageSource[] = HELP_PAGES): HelpGuide {
  if (pages !== HELP_PAGES) return buildHelpGuide(pages, helpFacts())
  built ??= buildHelpGuide(HELP_PAGES, helpFacts())
  return built
}
