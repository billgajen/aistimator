/**
 * T-199: the app is open to every business; starting a quote on site needs a
 * plan that includes it (or the free start).
 *   - the gate: what "New quote" shows, and that it starts nothing when closed;
 *   - the App Store rule over every string the app holds: no price, no link to
 *     buy, no "Upgrade" or "Buy", no instruction to go and pay somewhere else.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADDRESS_COPY, onsiteNotInPlan } from '@qolumns/shared'
import { PAYMENT_NOTICE, accountNoticeLine, onsiteGate } from '../lib/onsite-gate'
import { ApiError } from '../lib/api'
import { plainError } from '../lib/errors'

const APP = join(__dirname, '../..')
const read = (file: string) => readFileSync(join(APP, file), 'utf8')
function files(dir: string): string[] {
  return readdirSync(join(APP, dir)).flatMap((name) => {
    const path = `${dir}/${name}`
    if (name === '__tests__' || name === 'node_modules') return []
    return statSync(join(APP, path)).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}
const WORDS = onsiteNotInPlan()

describe('T-199: "New quote" in the app', () => {
  it('open for a business that can start a quote on site, and for a server from before this rule', () => {
    expect(onsiteGate({ onsiteQuotes: true }, false)).toEqual({ state: 'open' })
    expect(onsiteGate({}, true)).toEqual({ state: 'open' })
  })

  it('closed for everyone else: the heading, the sentence and one button, in the server’s words', () => {
    const said = { heading: 'On-site quotes are part of Pro', text: 'Your plan includes everything else in the app. To add on-site quotes, change your plan in your Qolumns account.', button: 'OK' }
    expect(onsiteGate({ onsiteQuotes: false, onsiteNotInPlan: said }, true)).toEqual({ state: 'closed', words: said })
    // a server that sends no words (or half of them): the shared ones, which are the same
    expect(onsiteGate({ onsiteQuotes: false }, true)).toEqual({ state: 'closed', words: said })
    expect(onsiteGate({ onsiteQuotes: false, onsiteNotInPlan: { heading: '', text: '', button: '' } }, false)).toEqual({ state: 'closed', words: said })
    expect({ heading: WORDS.heading, text: WORDS.text, button: WORDS.button }).toEqual(said)
  })

  it('while the phone is still asking it waits; when it cannot ask at all, the form opens and the server decides', () => {
    expect(onsiteGate(null, false)).toEqual({ state: 'checking' })
    expect(onsiteGate(null, true)).toEqual({ state: 'open' })
    expect(onsiteGate(undefined, true)).toEqual({ state: 'open' })
  })

  it('the closed screen starts no quote: the form, which makes a draft when it opens, is never mounted', () => {
    const screen = read('app/(tabs)/new.tsx')
    const tab = screen.slice(screen.indexOf('export default function NewQuoteTab'), screen.indexOf('function NewQuote() {'))
    expect(tab.length).toBeGreaterThan(200)
    // the tab itself never touches the outbox (where a draft is started)
    expect(tab).not.toMatch(/outbox|useOutbox|\.start\(/)
    // closed and checking both return before the form
    expect(tab.indexOf("gate.state === 'closed'")).toBeLessThan(tab.indexOf('return <NewQuote />'))
    expect(tab.indexOf("gate.state === 'checking'")).toBeLessThan(tab.indexOf('return <NewQuote />'))
    // one button, "OK", that only leaves the screen
    const closed = tab.slice(tab.indexOf("gate.state === 'closed'"), tab.indexOf('return <NewQuote />'))
    expect(closed.match(/<Button /g)).toHaveLength(1)
    expect(closed).toContain('title={gate.words.button}')
    expect(closed).toContain("router.navigate('/')")
    expect(closed).not.toMatch(/Linking|openPage|openURL|href/)
    // and the form is the only place a draft is started
    expect(screen.slice(screen.indexOf('function NewQuote() {'))).toContain('outbox.start()')
  })

  it('the app is open to everyone: no other screen asks about the plan before it shows', () => {
    for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/account.tsx', 'app/quote/[id].tsx', 'app/link.tsx', 'app/login.tsx', 'app/_layout.tsx']) {
      expect(read(file), file).not.toMatch(/onsiteQuotes|onsiteGate|ONSITE_QUOTES/)
    }
  })

  it('an older build sees the server’s refusal as a plain sentence', () => {
    const refusal = new ApiError(403, WORDS.code, `${WORDS.heading}. ${WORDS.text}`)
    expect(plainError(refusal)).toBe('On-site quotes are part of Pro. Your plan includes everything else in the app. To add on-site quotes, change your plan in your Qolumns account.')
  })
})

describe('T-199: no price, link or upgrade wording anywhere in the app', () => {
  /** What a person reading the app could take as "go and buy": a price, a way to buy, or an instruction to pay somewhere else */
  const BANNED: Array<[string, RegExp]> = [
    ['a price', /[$£€]\s?\d|\d+\s?(?:USD|GBP|EUR)\b|\b(?:per|a|each|every) (?:month|year)\b|\/\s?(?:mo|month|yr|year)\b/i],
    ['upgrade or buy', /\bupgrad(?:e|ing)\b|\bbuy\b|\bpurchas(?:e|ing)\b|(?<![.\w])subscribe\b(?!\s*[(:,])|\bcheckout\b|pricing page|pick a plan|choose a plan|see plans|compare plans/i],
    ['paying somewhere else', /update your card|add a card|payment method|website to pay|pay (?:on|at|through) (?:the|our)|go to .{0,30}\b(?:pay|billing)\b/i],
    ['a link to billing or pricing', /\/settings\/billing|\/pricing(?![\w-])|billing\.stripe|buy\.stripe/i],
  ]

  /** A file's code without its comments (a comment may name the rule), and without the two lines that exist to enforce it */
  function shown(file: string): string {
    return read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .map((line) => line.replace(/\s\/\/ .*$/, ''))
      .filter((line) => !/const BUYING = /.test(line)) // the filter that removes such words names them
      .filter((line) => !line.includes("'/api/billing/notice'")) // an address the app reads the account line from, never shown
      .join('\n')
  }

  it('every screen and every module: none of it', () => {
    const all = [...files('app'), ...files('src'), ...files('modules')]
    expect(all.length).toBeGreaterThan(40)
    const found: string[] = []
    for (const file of all) {
      const code = shown(file)
      for (const [what, pattern] of BANNED) {
        const hit = pattern.exec(code)
        if (hit) found.push(`${file}: ${what}: "${hit[0]}"`)
      }
    }
    expect(found).toEqual([])
  })

  it('no web address is typed into the app: the only links are its own server, an email and the phone’s settings', () => {
    const typed: string[] = []
    for (const file of [...files('app'), ...files('src')]) {
      for (const hit of shown(file).matchAll(/https?:\/\/[^\s'"`)]+/g)) if (!/^https?:\/\/localhost\b/.test(hit[0])) typed.push(`${file}: ${hit[0]}`)
    }
    expect(typed).toEqual([])
  })

  it('the words the server sends for the app carry none of it either', () => {
    const fromServer = [WORDS.heading, WORDS.text, WORDS.button, ADDRESS_COPY.alsoWorks, PAYMENT_NOTICE].join(' ')
    for (const [what, pattern] of BANNED) expect(pattern.test(fromServer), what).toBe(false)
    expect(fromServer).not.toMatch(/https?:|www\.|\.com\b/)
  })

  it('a failed payment is said plainly on the home tab, with nothing to do about it in the app', () => {
    const fromDashboard = "Your payment didn't go through. Update your card to keep your quotes running."
    expect(accountNoticeLine({ kind: 'payment_failed', line: fromDashboard })).toBe(PAYMENT_NOTICE)
    expect(PAYMENT_NOTICE).not.toMatch(/card|update|\bpay\b|billing|website/i)
    // a paused account keeps the dashboard's own line (it names nothing to buy)
    expect(accountNoticeLine({ kind: 'suspended', line: 'Your account is paused.' })).toBe('Your account is paused.')
    expect(read('app/(tabs)/index.tsx')).toContain('accountNoticeLine(notice)')
    expect(read('app/(tabs)/index.tsx')).not.toMatch(/\{notice\.line\}/)
  })

  it('the Account tab names the plan and counts its use: no line about another plan, and nothing of the website’s "on Pro" line', () => {
    const account = read('app/(tabs)/account.tsx')
    expect(account).not.toMatch(/onPlan|planLine\(.*address|Get your own address/)
    expect(account).toContain('ADDRESS_COPY.alsoWorks')
  })
})
