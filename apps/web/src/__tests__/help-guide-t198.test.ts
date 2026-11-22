/**
 * T-198: the help guide (Docs/help) is complete and true to the product.
 *
 * "Ask Qolumns" answers only from the guide, so these fail the build when:
 *   - a dashboard page or a Settings section has no entry;
 *   - an entry links to a route that does not exist;
 *   - an entry states a plan fact that differs from plans.ts;
 *   - an entry describes as live something the flags say is not;
 *   - the copy inside the web app is not what Docs/help says.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ASK_SUGGESTIONS,
  FREE_ALLOWANCE,
  HELP_FLAGS,
  HELP_FLAG_WORDS,
  HelpGuideError,
  PLANS,
  PRODUCT_NAME,
  SORT_HELP_MAX,
  buildHelpGuide,
  entryText,
  guideText,
  isOpenablePage,
  offeredPlans,
  parseHelpPage,
  renderHelpText,
  routeOf,
  selectEntries,
  suggestedQuestions,
  EMPTY_HELP_STATE,
  HELP_GUIDE_BUDGET_CHARS,
  type HelpFacts,
  type HelpFlag,
  type HelpPageSource,
} from '@qolumns/shared'
import { COMING_SOON, isLive } from '@/lib/marketing/plan-claims'
import { HELP_PAGES } from '@/lib/help/guide-pages.generated'
import { HELP_PAGE_NAMES, HELP_PLACE_NAMES, NOT_IN_GUIDE, helpExcerpt, helpFacts, helpGuide, pageNamesFor, planKey, planMoney, planSentence } from '@/lib/help/guide'

const ROOT = join(__dirname, '..', '..', '..', '..')
const DOCS = join(ROOT, 'Docs', 'help')
const APP = join(__dirname, '..', 'app', '(dashboard)', 'app')

const pagesOnDisk: HelpPageSource[] = readdirSync(DOCS)
  .filter((name) => /^\d{2}-[a-z0-9-]+\.md$/.test(name))
  .sort()
  .map((file) => ({ file, markdown: readFileSync(join(DOCS, file), 'utf8').replace(/\r\n/g, '\n') }))
const source = pagesOnDisk.flatMap((page) => parseHelpPage(page).entries.map((entry) => ({ ...entry, file: page.file })))
const guide = helpGuide()

/** Every dashboard page, as a route: "/app/quotes/[quoteId]" */
function dashboardRoutes(dir = APP, route = '/app'): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...dashboardRoutes(path, `${route}/${name}`))
    else if (name === 'page.tsx') out.push(route)
  }
  return out.sort()
}

const allLive = (live: boolean): HelpFacts => ({ ...helpFacts(), live: Object.fromEntries(HELP_FLAGS.map((flag) => [flag, live])) as Record<HelpFlag, boolean> })

describe('the guide as it is written (Docs/help)', () => {
  it('has a page for every area the ticket names', () => {
    expect(pagesOnDisk.map((p) => p.file)).toEqual([
      '01-getting-started.md',
      '02-services-questions-prices.md',
      '03-templates.md',
      '04-quote-link-form-qr.md',
      '05-estimates-approval.md',
      '06-reminders-follow-up.md',
      '07-whatsapp.md',
      '08-mobile-app-room-scan.md',
      '09-won-panel-analytics.md',
      '10-plans-limits-billing.md',
      '11-account-branding-notifications.md',
      '12-reporting-and-requests.md',
      '13-data-privacy.md',
      '14-common-problems.md',
    ])
  })

  it('every page builds: each entry has an id, a page and an answer, and every fact it uses exists', () => {
    expect(() => buildHelpGuide(pagesOnDisk, helpFacts())).not.toThrow()
    expect(guide.entries.length).toBeGreaterThan(100)
    expect(new Set(guide.entries.map((e) => e.id)).size).toBe(guide.entries.length)
    for (const entry of guide.entries) {
      expect(entry.question.endsWith('?'), `${entry.id}: the heading is a question`).toBe(true)
      expect(entry.body).not.toMatch(/\{\{|\}\}/)
    }
  })

  it('the copy inside the web app is what Docs/help says (pnpm help:build)', () => {
    expect(HELP_PAGES).toEqual(pagesOnDisk)
  })

  it('no page types the product name, a customer, or a date something will ship', () => {
    for (const page of pagesOnDisk) {
      expect(page.markdown.includes(PRODUCT_NAME), `${page.file} types the product's name; write {{product}}`).toBe(false)
      expect(page.markdown, `${page.file} types "${COMING_SOON}"; write {{soon}}`).not.toContain(COMING_SOON)
      expect(page.markdown, `${page.file} names a month and year`).not.toMatch(/\b(?:January|February|March|April|June|July|August|September|October|November|December) 20\d\d\b/)
    }
  })
})

describe('every dashboard page and Settings section has an entry', () => {
  const routes = dashboardRoutes()
  const covered = new Set(guide.entries.map((e) => routeOf(e.page)))

  it('finds the dashboard pages', () => {
    expect(routes).toContain('/app')
    expect(routes).toContain('/app/services')
    expect(routes).toContain('/app/quotes/[quoteId]')
    expect(routes.length).toBeGreaterThanOrEqual(12)
  })

  it('each page has an entry, or is left out by name with a reason', () => {
    const missing = routes.filter((route) => !covered.has(route) && !NOT_IN_GUIDE[route])
    expect(missing, `no help entry for: ${missing.join(', ')}`).toEqual([])
    // a page that is left out by name must still exist, and must really have no entry
    for (const route of Object.keys(NOT_IN_GUIDE)) {
      expect(routes, `${route} is in NOT_IN_GUIDE but is not a page`).toContain(route)
      expect(covered.has(route), `${route} has an entry; take it out of NOT_IN_GUIDE`).toBe(false)
    }
  })

  it('each section of the Settings page has an entry that names it', () => {
    const page = readFileSync(join(APP, 'settings', 'page.tsx'), 'utf8')
    const headings = [...page.matchAll(/<h2[^>]*>\s*([^<{]+?)\s*<\/h2>/g)].map((m) => m[1]!.trim())
    expect(headings).toEqual(expect.arrayContaining(['Business Information', 'Tax Settings', 'Service Area', 'Quote Template', 'Account Information', 'Danger Zone']))
    const named = new Set(guide.entries.filter((e) => routeOf(e.page) === '/app/settings').map((e) => e.section))
    const missing = headings.filter((heading) => !named.has(heading))
    expect(missing, `no help entry with "section: …" for: ${missing.join(', ')}`).toEqual([])
  })
})

describe('every entry links to a route that exists', () => {
  const routes = new Set(dashboardRoutes())
  it('the page of each entry is a dashboard page', () => {
    const wrong = guide.entries.filter((e) => !routes.has(routeOf(e.page))).map((e) => `${e.id} → ${e.page}`)
    expect(wrong).toEqual([])
  })

  it('a page a button can open has a name; a quote’s own page has words instead', () => {
    for (const entry of guide.entries) {
      const route = routeOf(entry.page)
      if (isOpenablePage(entry.page)) expect(HELP_PAGE_NAMES[route], `${route} (in ${entry.id}) has no name in HELP_PAGE_NAMES`).toBeTruthy()
      else expect(HELP_PLACE_NAMES[route], `${route} (in ${entry.id}) has no words in HELP_PLACE_NAMES`).toBeTruthy()
    }
    // and no button can be offered for a page that does not exist
    for (const route of Object.keys(HELP_PAGE_NAMES)) expect(routes.has(route), `${route} is named but is not a page`).toBe(true)
    expect(Object.keys(pageNamesFor(guide)).length).toBeGreaterThan(8)
  })
})

describe('plan facts come from plans.ts, never from a page', () => {
  const offered = offeredPlans()
  const money = (minor: number) => `$${(minor / 100).toLocaleString('en-US')}`

  it('no page types a dollar amount or a number of quotes', () => {
    for (const page of pagesOnDisk) {
      expect(page.markdown, `${page.file} types a dollar amount`).not.toMatch(/\$\s?\d/)
      expect(page.markdown, `${page.file} types a number of quotes`).not.toMatch(/\b\d[\d,]*\s+(?:free |priced |more )?quotes?\b/i)
      expect(page.markdown, `${page.file} types a plan's name; write {{plan.….name}} or {{….plans}}`).not.toMatch(new RegExp(`\\b(?:${offered.map((p) => p.name).join('|')}) plan\\b`))
    }
  })

  it('the facts a page can use are the plan definitions’ own', () => {
    const { tokens } = helpFacts()
    expect(tokens['free.quotes']).toBe(String(FREE_ALLOWANCE.US!.quotes))
    for (const plan of offered) {
      const key = planKey(plan)
      expect(tokens[`plan.${key}.name`]).toBe(plan.name)
      expect(tokens[`plan.${key}.monthly`]).toBe(money(plan.monthlyPrice.USD!))
      expect(tokens[`plan.${key}.yearly`]).toBe(money(plan.annualPrice!.USD!))
      expect(tokens[`plan.${key}.quotes`]).toBe(plan.quoteLimit.toLocaleString('en-US'))
      expect(planSentence(plan)).toContain(`${money(plan.monthlyPrice.USD!)} a month`)
      expect(planSentence(plan)).toContain(`${plan.quoteLimit.toLocaleString('en-US')} quotes a month`)
    }
    expect(planMoney(4900)).toBe('$49')
    expect(planMoney(4950)).toBe('$49.50')
    const withScan = offered.filter((p) => p.features.lidar_scanning).map((p) => p.name)
    for (const name of withScan) expect(tokens['roomScan.plans']).toContain(name)
    for (const plan of offered.filter((p) => !p.features.lidar_scanning)) expect(tokens['roomScan.plans']).not.toContain(plan.name)
  })

  it('every price and every number of quotes in the built guide is one from plans.ts', () => {
    const prices = new Set(offered.flatMap((p) => [money(p.monthlyPrice.USD!), money(p.annualPrice!.USD!)]))
    const quotes = new Set([...offered.map((p) => p.quoteLimit.toLocaleString('en-US')), String(FREE_ALLOWANCE.US!.quotes)])
    const text = guideText(guide.entries)
    for (const found of text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? []) expect(prices.has(found.replace(/\s/g, '')), `${found} is not a plan price`).toBe(true)
    for (const found of text.matchAll(/\b(\d[\d,]*)\s+(?:free |priced )?quotes\b/gi)) expect(quotes.has(found[1]!), `"${found[0]}" is not a plan's allowance`).toBe(true)
    // and the plans entry really carries them
    for (const plan of offered) expect(text).toContain(planSentence(plan))
  })

  it('a plan that is changed in plans.ts changes the guide with it', () => {
    const changed = offered.map((p) => (p.id === 'plan_us_starter' ? { ...p, monthlyPrice: { USD: 5900 }, quoteLimit: 75 } : p))
    const rebuilt = guideText(buildHelpGuide(pagesOnDisk, helpFacts(changed)).entries)
    expect(rebuilt).toContain('$59 a month')
    expect(rebuilt).toContain('75 quotes a month')
    expect(rebuilt).not.toContain('$49 a month')
    expect(PLANS.find((p) => p.id === 'plan_us_starter')!.monthlyPrice.USD).toBe(4900)
  })
})

describe('nothing is described as live that the flags say is not', () => {
  it('an entry that names WhatsApp, the phone app or the room scan carries that flag', () => {
    const missing: string[] = []
    for (const entry of source) {
      const words = `${entry.question}\n${entry.body}`
      for (const flag of HELP_FLAGS) if (HELP_FLAG_WORDS[flag].test(words) && !entry.flags.includes(flag)) missing.push(`${entry.file} ${entry.id}: names ${flag} without "flags: ${flag}"`)
    }
    expect(missing).toEqual([])
  })

  it('while a flag is not live, every entry that carries it says "Coming soon"', () => {
    const soon = buildHelpGuide(pagesOnDisk, allLive(false))
    const silent = soon.entries.filter((e) => e.flags.length > 0 && !e.body.includes(COMING_SOON)).map((e) => e.id)
    expect(silent, `flagged entries that do not say "${COMING_SOON}"`).toEqual([])
  })

  it('"Coming soon" is only ever said through a flag, so it goes away by itself when the thing is live', () => {
    for (const entry of source) {
      // outside its {{#soon}} blocks and without the plans list, an entry never says it
      const outside = entry.body.replace(/\{\{#soon [A-Za-z]+\}\}[\s\S]*?\{\{\/soon\}\}/g, '').replace(/\{\{plans\}\}/g, '')
      expect(outside.includes('{{soon}}'), `${entry.id} says {{soon}} outside a {{#soon …}} block`).toBe(false)
    }
    const live = buildHelpGuide(pagesOnDisk, allLive(true))
    const flagged = new Set(source.filter((e) => e.flags.length > 0 && !e.body.includes('{{plans}}')).map((e) => e.id))
    const still = live.entries.filter((e) => flagged.has(e.id) && e.body.includes(COMING_SOON)).map((e) => e.id)
    expect(still).toEqual([])
  })

  it('today’s guide follows today’s flags', () => {
    for (const flag of ['whatsapp', 'app', 'roomScan'] as const) expect(helpFacts().live[flag]).toBe(isLive(flag))
    // a soon block is kept while the flag is off and dropped when it is on
    const facts = allLive(false)
    expect(renderHelpText('A {{#soon app}}later{{/soon}}{{#live app}}now{{/live}}.', facts)).toBe('A later.')
    expect(renderHelpText('A {{#soon app}}later{{/soon}}{{#live app}}now{{/live}}.', allLive(true))).toBe('A now.')
  })
})

describe('a page that is not written to the format does not build', () => {
  const facts = helpFacts()
  const page = (markdown: string): HelpPageSource => ({ file: '99-test.md', markdown })
  it('says what is wrong, with the file and the entry', () => {
    expect(() => parseHelpPage(page('no title'))).toThrow(HelpGuideError)
    expect(() => parseHelpPage(page('# T\n\n## Q?\nno meta line'))).toThrow(/no <!-- id/)
    expect(() => parseHelpPage(page('# T\n\n## Q?\n<!-- id: Bad Id; page: /app -->\nA.'))).toThrow(/id/)
    expect(() => parseHelpPage(page('# T\n\n## Q?\n<!-- id: test-one; page: /pricing -->\nA.'))).toThrow(/dashboard page/)
    expect(() => parseHelpPage(page('# T\n\n## Q?\n<!-- id: test-one; page: /app; flags: sms -->\nA.'))).toThrow(/not a flag/)
    expect(() => parseHelpPage(page('# T\n\n## Q?\n<!-- id: test-one; page: /app -->\n'))).toThrow(/no answer/)
    expect(() => renderHelpText('{{plan.gold.monthly}}', facts)).toThrow(/no fact called/)
    expect(() => renderHelpText('{{#soon app}}never closed', facts)).toThrow(/not closed/)
    const twice = page('# T\n\n## Q?\n<!-- id: test-one; page: /app -->\nA.\n\n## R?\n<!-- id: test-one; page: /app -->\nB.')
    expect(() => buildHelpGuide([twice], facts)).toThrow(/used twice/)
  })

  it('reads an entry’s keys', () => {
    const parsed = parseHelpPage(page('# The title\n\n## How?\n<!-- id: test-how; page: /app/settings#tax; section: Tax Settings; flags: app, roomScan -->\n\nShort.\n\n1. One\n2. Two\n'))
    expect(parsed.entries).toEqual([{ id: 'test-how', area: 'test', areaTitle: 'The title', question: 'How?', page: '/app/settings#tax', section: 'Tax Settings', flags: ['app', 'roomScan'], body: 'Short.\n\n1. One\n2. Two' }])
    expect(routeOf('/app/settings#tax')).toBe('/app/settings')
    expect(routeOf('/app/quotes?filter=unfinished')).toBe('/app/quotes')
    expect(isOpenablePage('/app/quotes/[quoteId]')).toBe(false)
    expect(entryText(parsed.entries[0]!, 'Settings')).toBe('[test-how] How?\nPage: /app/settings (Settings)\nShort.\n\n1. One\n2. Two')
  })
})

describe('what the assistant is given', () => {
  it('the whole guide while it fits the budget', () => {
    const size = guideText(guide.entries).length
    expect(size).toBeLessThan(HELP_GUIDE_BUDGET_CHARS)
    expect(selectEntries(guide, 'anything at all')).toHaveLength(guide.entries.length)
  })

  it('otherwise the entries that match the question, in the guide’s order, inside the budget', () => {
    const chosen = selectEntries(guide, 'How do I put the form on my website?', 6000)
    expect(chosen.length).toBeGreaterThan(0)
    expect(chosen.length).toBeLessThan(guide.entries.length)
    expect(chosen.reduce((sum, e) => sum + entryText(e).length + 2, 0)).toBeLessThanOrEqual(6000)
    expect(chosen.some((e) => e.id.startsWith('link-'))).toBe(true)
    const order = chosen.map((e) => guide.entries.indexOf(e))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('a report’s words pick the entries a draft reply can answer from, small enough to travel with the job', () => {
    const excerpt = helpExcerpt('How do I change the logo that shows at the top of the estimate my customers see? I cannot find where to upload it.')
    expect(excerpt).toContain('[account-branding-logo] How do I add my logo?')
    expect(excerpt.length).toBeLessThanOrEqual(SORT_HELP_MAX)
    expect(excerpt.length).toBeGreaterThan(500)
    expect(helpExcerpt(null).length).toBeLessThanOrEqual(SORT_HELP_MAX)
  })

  it('each suggested question is an entry of the guide, so the assistant can answer it', () => {
    const ids = new Set(guide.entries.map((e) => e.id))
    const unknown = ASK_SUGGESTIONS.map((s) => s.entry).filter((id) => !ids.has(id))
    expect(unknown, `suggestions that are not guide entries: ${unknown.join(', ')}`).toEqual([])
    const fresh = suggestedQuestions({ ...EMPTY_HELP_STATE, services: [], linkShared: false, pricesChecked: false, brandingSet: false }, guide.entries)
    expect(fresh).toHaveLength(3)
    expect(fresh[0]!.entry).toBe('services-add')
    for (const suggestion of fresh) expect(guide.entries.find((e) => e.id === suggestion.entry)!.question).toBe(suggestion.question)
    // nothing known about the business: still three, from the general ones
    expect(suggestedQuestions(EMPTY_HELP_STATE, guide.entries)).toHaveLength(3)
    // on a quote's page the first is about that estimate's price
    expect(suggestedQuestions({ ...EMPTY_HELP_STATE, page: '/app/quotes/q_1' }, guide.entries)[0]!.entry).toBe('estimates-how-priced')
  })
})
