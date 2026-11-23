/**
 * T-198: the help guide (Docs/help), as the product reads it (pure).
 *
 * The guide is written as plain pages of questions and answers. "Ask
 * {product}" answers only from it, so it has to be true: every plan fact and
 * every "is it live" is filled in here from the plan definitions and the
 * site's flags when the guide is built, never typed in a page. A page that
 * uses a fact we do not have fails to build (a unit test builds every page).
 *
 * Docs/help/README.md has the format.
 */

/** The things the site shows before they are live (`plan-claims.ts`); one flag each. T-199 added a business's own address. */
export const HELP_FLAGS = ['whatsapp', 'app', 'roomScan', 'ownAddress'] as const
export type HelpFlag = (typeof HELP_FLAGS)[number]

/** A page that names one of these is talking about something behind a flag, and must say so */
export const HELP_FLAG_WORDS: Record<HelpFlag, RegExp> = {
  whatsapp: /whatsapp/i,
  app: /(?:phone|iphone|mobile|on-site) app|app store|\bthe app\b/i,
  roomScan: /room scan|lidar|scan (?:a|the|each|your) room/i,
  ownAddress: /your own address|own address|choose (?:an|your) address/i,
}

export interface HelpPageSource {
  /** "02-services-questions-prices.md" */
  file: string
  markdown: string
}

export interface HelpEntry {
  id: string
  /** The page's file name without its number and ending: "services-questions-prices" */
  area: string
  areaTitle: string
  /** The question, as a business would ask it */
  question: string
  /** The dashboard page it happens on: "/app/services", "/app/quotes/[quoteId]", "/app/settings#tax" */
  page: string
  /** The Settings section it covers, by the section's own heading */
  section: string | null
  flags: HelpFlag[]
  body: string
}

export interface HelpFacts {
  /** "plan.starter.monthly" → "$49" */
  tokens: Record<string, string>
  live: Record<HelpFlag, boolean>
}

export class HelpGuideError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelpGuideError'
  }
}

const isFlag = (value: string): value is HelpFlag => (HELP_FLAGS as readonly string[]).includes(value)

/** The route of an entry's page, without a query or an anchor */
export function routeOf(page: string): string {
  return page.split('#')[0]!.split('?')[0]!.replace(/\/+$/, '') || '/'
}

/** Can a button open it? A page with a part that changes ("[quoteId]") cannot be opened from here. */
export function isOpenablePage(page: string): boolean {
  return page.startsWith('/app') && !page.includes('[')
}

/**
 * Read one page as it is written: its title and its entries, tokens still in
 * place. Throws a HelpGuideError that names the file and the entry when the
 * page does not follow the format.
 */
export function parseHelpPage(source: HelpPageSource): { title: string; area: string; entries: HelpEntry[] } {
  const area = source.file.replace(/\.md$/, '').replace(/^\d+-/, '')
  const lines = source.markdown.replace(/\r\n/g, '\n').split('\n')
  const titleLine = lines.find((line) => line.startsWith('# '))
  if (!titleLine) throw new HelpGuideError(`${source.file}: no "# Title" line`)
  const title = titleLine.slice(2).trim()

  const entries: HelpEntry[] = []
  let current: { question: string; meta: string | null; body: string[] } | null = null
  const close = () => {
    if (!current) return
    const where = `${source.file}: "${current.question}"`
    if (!current.meta) throw new HelpGuideError(`${where} has no <!-- id: …; page: … --> line under its heading`)
    const keys: Record<string, string> = {}
    for (const part of current.meta.split(';')) {
      const at = part.indexOf(':')
      if (at < 0) continue
      keys[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim()
    }
    const id = keys.id ?? ''
    const page = keys.page ?? ''
    if (!/^[a-z][a-z0-9-]{2,60}$/.test(id)) throw new HelpGuideError(`${where}: the id "${id}" must be lower case letters, digits and hyphens`)
    if (!page.startsWith('/app')) throw new HelpGuideError(`${where}: the page "${page}" must be a dashboard page (/app…)`)
    const flags = (keys.flags ?? keys.flag ?? '')
      .split(',')
      .map((flag) => flag.trim())
      .filter(Boolean)
    for (const flag of flags) if (!isFlag(flag)) throw new HelpGuideError(`${where}: "${flag}" is not a flag (${HELP_FLAGS.join(', ')})`)
    const body = current.body.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!body) throw new HelpGuideError(`${where} has no answer`)
    entries.push({ id, area, areaTitle: title, question: current.question, page, section: keys.section || null, flags: flags as HelpFlag[], body })
    current = null
  }
  for (const line of lines) {
    if (line.startsWith('## ')) {
      close()
      current = { question: line.slice(3).trim(), meta: null, body: [] }
      continue
    }
    if (!current) continue
    const meta = /^<!--(.*)-->\s*$/.exec(line.trim())
    if (meta && current.meta === null && current.body.every((b) => !b.trim())) {
      current.meta = meta[1]!.trim()
      continue
    }
    current.body.push(line)
  }
  close()
  if (entries.length === 0) throw new HelpGuideError(`${source.file} has no entries`)
  return { title, area, entries }
}

/**
 * Fill in a page's text: keep or drop the "soon" and "live" blocks by the
 * flags, then put each fact in its place. A fact we do not have is an error,
 * never a blank.
 */
export function renderHelpText(text: string, facts: HelpFacts, where = 'the guide'): string {
  const blocks = text.replace(/\{\{#(soon|live) ([A-Za-z]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_all, kind: string, flag: string, inner: string) => {
    if (!isFlag(flag)) throw new HelpGuideError(`${where}: "${flag}" is not a flag`)
    const live = facts.live[flag] === true
    return (kind === 'live') === live ? inner : ''
  })
  if (/\{\{[#/]/.test(blocks)) throw new HelpGuideError(`${where}: a {{#soon}} or {{#live}} block is not closed`)
  const filled = blocks.replace(/\{\{([A-Za-z][A-Za-z.]*)\}\}/g, (_all, name: string) => {
    const value = facts.tokens[name]
    if (typeof value !== 'string' || !value) throw new HelpGuideError(`${where}: there is no fact called {{${name}}}`)
    return value
  })
  return filled
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface HelpGuide {
  entries: HelpEntry[]
}

/** The whole guide, built: every page read, every fact filled in. Throws when two entries share an id. */
export function buildHelpGuide(pages: readonly HelpPageSource[], facts: HelpFacts): HelpGuide {
  const entries: HelpEntry[] = []
  const seen = new Set<string>()
  for (const page of [...pages].sort((a, b) => a.file.localeCompare(b.file))) {
    const parsed = parseHelpPage(page)
    const areaTitle = renderHelpText(parsed.title, facts, page.file)
    for (const entry of parsed.entries) {
      if (seen.has(entry.id)) throw new HelpGuideError(`${page.file}: the id "${entry.id}" is used twice`)
      seen.add(entry.id)
      const where = `${page.file}: "${entry.question}"`
      entries.push({ ...entry, areaTitle, question: renderHelpText(entry.question, facts, where), body: renderHelpText(entry.body, facts, where) })
    }
  }
  return { entries }
}

/** One entry as the assistant reads it */
export function entryText(entry: HelpEntry, pageName?: string | null): string {
  const page = isOpenablePage(entry.page) ? `Page: ${routeOf(entry.page)}${pageName ? ` (${pageName})` : ''}` : `Where: ${pageName ?? "a quote's own page"} (no page to open)`
  return `[${entry.id}] ${entry.question}\n${page}\n${entry.body}`
}

/** Entries as the assistant reads them, grouped under their page's title */
export function guideText(entries: readonly HelpEntry[], pageNames: Readonly<Record<string, string>> = {}): string {
  const out: string[] = []
  let area = ''
  for (const entry of entries) {
    if (entry.area !== area) {
      area = entry.area
      out.push(`## ${entry.areaTitle}`)
    }
    out.push(entryText(entry, pageNames[routeOf(entry.page)] ?? null))
  }
  return out.join('\n\n')
}

/** About 40,000 tokens: the whole guide fits well inside it today */
export const HELP_GUIDE_BUDGET_CHARS = 160_000

const SMALL_WORDS = new Set(
  'the and for you your how what why when where can does did not are was with this that have has from into out get got one all any its our use using about there here will would should could them they then than but too very just also more most much many some such only own same over under after before again once each both few other which who whom whose been being were had having doing done make made need want'.split(
    ' '
  )
)

const wordsOf = (text: string): string[] => (text.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) ?? []).map((w) => w.replace(/['’]s$/, '').replace(/s$/, '')).filter((w) => !SMALL_WORDS.has(w))

/**
 * What the assistant is given for one question: the whole guide while it fits
 * the budget, otherwise the entries whose words match the question best, in
 * the guide's own order. No index and no outside service: shared words are
 * counted, a word in an entry's question is worth three in its answer, and a
 * word that few entries use ("logo") is worth more than one that most use
 * ("customer").
 */
/** How well each entry's words match a question (0 = not at all), in the guide's own order */
function scoreEntries(guide: HelpGuide, question: string): Array<{ entry: HelpEntry; index: number; score: number }> {
  const wanted = new Set(wordsOf(question))
  const words = guide.entries.map((entry) => ({ question: new Set(wordsOf(entry.question)), body: new Set(wordsOf(entry.body)) }))
  // in how many entries each word appears
  const used = new Map<string, number>()
  for (const entry of words) for (const word of new Set([...entry.question, ...entry.body])) used.set(word, (used.get(word) ?? 0) + 1)
  const weight = (word: string) => Math.log(1 + guide.entries.length / (used.get(word) ?? 1))
  return guide.entries.map((entry, index) => {
    let score = 0
    for (const word of words[index]!.question) if (wanted.has(word)) score += 3 * weight(word)
    for (const word of words[index]!.body) if (wanted.has(word)) score += weight(word)
    return { entry, index, score }
  })
}

export function selectEntries(guide: HelpGuide, question: string, budgetChars: number = HELP_GUIDE_BUDGET_CHARS): HelpEntry[] {
  const size = (entry: HelpEntry) => entryText(entry).length + 2
  const total = guide.entries.reduce((sum, entry) => sum + size(entry), 0)
  if (total <= budgetChars) return [...guide.entries]
  const scored = scoreEntries(guide, question)
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  const chosen: typeof scored = []
  let spent = 0
  for (const item of scored) {
    const cost = size(item.entry)
    if (spent + cost > budgetChars) continue
    chosen.push(item)
    spent += cost
  }
  return chosen.sort((a, b) => a.index - b.index).map((item) => item.entry)
}

/**
 * T-200: the entries a short or unclear question most likely means, best
 * first: the same count of shared words as `selectEntries`, and only entries
 * that share a word with it at all. Used to ask "which of these do you
 * mean?", so each one is a question the guide answers.
 */
export function likelyEntries(guide: HelpGuide, question: string, max = 3): HelpEntry[] {
  return scoreEntries(guide, question)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, max))
    .map((item) => item.entry)
}
