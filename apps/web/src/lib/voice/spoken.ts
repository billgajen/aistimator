/**
 * T-210: the amounts she SAID, read back out of the transcript, and held against the engine's.
 *
 * The price is the engine's (AD-001). On a call there is one more place it can go wrong: between
 * the tool's answer and her mouth. This reads the amounts out of what she said ("four hundred and
 * fifty dollars", "$450", "450 pounds", "four fifty") and compares them with what the engine
 * returned. An amount of money she said that the engine did not give is a mismatch.
 *
 * Pure. English only, as the product is.
 */

const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, grand: 1000, million: 1_000_000 }

/** What a unit of money is called, and the currency it means */
const MONEY_WORDS: Record<string, string> = { dollar: 'USD', dollars: 'USD', bucks: 'USD', usd: 'USD', pound: 'GBP', pounds: 'GBP', quid: 'GBP', gbp: 'GBP', euro: 'EUR', euros: 'EUR', eur: 'EUR' }
const MONEY_SIGNS: Record<string, string> = { $: 'USD', '£': 'GBP', '€': 'EUR' }
const SMALL_WORDS = new Set(['cent', 'cents', 'pence', 'penny', 'pennies', 'p'])

export interface SpokenAmount {
  amount: number
  /** The words or figures as she said them */
  text: string
  /** Said as money (a sign or "dollars" with it); a bare number is not */
  money: boolean
  /** The currency its sign or word means, when it had one */
  currency: string | null
}

interface Token {
  text: string
  start: number
  end: number
}

const isNumberWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w in SCALES
const digits = (t: string) => /^\d/.test(t)
const toNumber = (t: string) => Number(t.replace(/,/g, ''))

/** A run of number words as a number: "four hundred and fifty", "twelve hundred", "four fifty" */
export function wordsToNumber(words: readonly string[]): number | null {
  const run = words.filter((w) => w !== 'and' && w !== 'a')
  if (run.length === 0 || !run.every(isNumberWord)) return null
  const lead = words[0] === 'a' ? 1 : 0

  // Said the short way, with no "hundred": "four fifty" is 450, "twelve fifty" 1,250, "nine ninety nine" 999
  if (!run.some((w) => w in SCALES) && words[0] !== 'a') {
    const groups: number[] = []
    for (let i = 0; i < run.length; i++) {
      const w = run[i]!
      if (w in TENS) {
        const next = run[i + 1]
        if (next !== undefined && next in UNITS && UNITS[next]! > 0) {
          groups.push(TENS[w]! + UNITS[next]!)
          i += 1
        } else groups.push(TENS[w]!)
      } else groups.push(w in TEENS ? TEENS[w]! : UNITS[w]!)
    }
    if (groups.length === 1) return groups[0]!
    if (groups.length === 2 && groups[0]! > 0 && groups[1]! >= 10) return groups[0]! * 100 + groups[1]!
    return null
  }

  let total = 0
  let current = lead
  for (const w of run) {
    if (w in UNITS) current += UNITS[w]!
    else if (w in TEENS) current += TEENS[w]!
    else if (w in TENS) current += TENS[w]!
    else if (w === 'hundred') current = (current || 1) * 100
    else {
      total += (current || 1) * SCALES[w]!
      current = 0
    }
  }
  return total + current
}

/** Every number in a piece of speech, each marked as money or not */
export function spokenAmounts(speech: string): SpokenAmount[] {
  const text = speech.toLowerCase().replace(/(?<=[a-z])-(?=[a-z])/g, ' ')
  const tokens: Token[] = []
  for (const m of text.matchAll(/[$£€]|\d[\d,]*(?:\.\d+)?|[a-z]+/g)) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  const found: SpokenAmount[] = []

  let i = 0
  while (i < tokens.length) {
    const first = tokens[i]!
    let value: number | null = null
    let end = i // index of the last token of the number itself
    let sign: string | null = null

    if (first.text in MONEY_SIGNS && tokens[i + 1] && digits(tokens[i + 1]!.text)) {
      sign = MONEY_SIGNS[first.text]!
      value = toNumber(tokens[i + 1]!.text)
      end = i + 1
    } else if (digits(first.text)) {
      value = toNumber(first.text)
    } else if (first.text in UNITS || first.text in TEENS || first.text in TENS || (first.text === 'a' && tokens[i + 1] !== undefined && tokens[i + 1]!.text in SCALES)) {
      // the longest run of number words; "and" joins only two number words
      let j = i
      while (j + 1 < tokens.length) {
        const next = tokens[j + 1]!.text
        if (isNumberWord(next)) j += 1
        else if (next === 'and' && tokens[j + 2] !== undefined && isNumberWord(tokens[j + 2]!.text) && !(tokens[j + 2]!.text in SCALES)) j += 2
        else break
      }
      // shorten the run until it reads as one number ("one two three" is not one)
      while (j >= i && value === null) {
        value = wordsToNumber(tokens.slice(i, j + 1).map((t) => t.text))
        if (value === null) j -= 1
      }
      if (value === null) {
        i += 1
        continue
      }
      end = j
    } else {
      i += 1
      continue
    }

    // "2 thousand", "four point five"
    while (tokens[end + 1] && digits(tokens[i + (sign ? 1 : 0)]!.text) && tokens[end + 1]!.text in SCALES) {
      value *= SCALES[tokens[end + 1]!.text]!
      end += 1
    }
    if (tokens[end + 1]?.text === 'point' && tokens[end + 2] && tokens[end + 2]!.text in UNITS) {
      let k = end + 2
      let fraction = ''
      while (tokens[k] && tokens[k]!.text in UNITS) {
        fraction += String(UNITS[tokens[k]!.text])
        k += 1
      }
      value += Number(`0.${fraction}`)
      end = k - 1
    }

    let money = sign !== null
    let currency = sign
    const word = tokens[end + 1]?.text
    if (word !== undefined && word in MONEY_WORDS) {
      money = true
      currency = currency ?? MONEY_WORDS[word]!
      end += 1
    }
    // "… and fifty cents", "… 50 pence"
    if (money) {
      let k = end + 1
      if (tokens[k]?.text === 'and') k += 1
      let small: number | null = null
      let last = k
      if (tokens[k] && digits(tokens[k]!.text)) small = toNumber(tokens[k]!.text)
      else if (tokens[k] && isNumberWord(tokens[k]!.text)) {
        while (tokens[last + 1] && isNumberWord(tokens[last + 1]!.text)) last += 1
        small = wordsToNumber(tokens.slice(k, last + 1).map((t) => t.text))
      }
      if (small !== null && small < 100 && tokens[last + 1] && SMALL_WORDS.has(tokens[last + 1]!.text)) {
        value += small / 100
        end = last + 1
      }
    }

    found.push({ amount: Math.round(value * 100) / 100, text: speech.slice(first.start, tokens[end]!.end), money, currency })
    i = end + 1
  }
  return found
}

/** What the engine returned for one estimate */
export interface EngineFigures {
  currency: string
  total: number
  subtotal?: number
  taxAmount?: number
  lines?: readonly number[]
}

export type SpokenIs = 'total' | 'subtotal' | 'tax' | 'line' | 'not_the_engines'

export interface PriceCheck {
  /** match: she said the total and no amount of money that is not the engine's. mismatch: she said one that is not. */
  verdict: 'match' | 'mismatch' | 'not_said'
  /** The amounts of money she said, and what each one is */
  said: Array<SpokenAmount & { is: SpokenIs; wrongCurrency: boolean }>
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005

/** Hold what she said after an estimate against that estimate */
export function checkSpokenPrice(engine: EngineFigures, speech: string): PriceCheck {
  const amounts = spokenAmounts(speech)
  const what = (amount: number): SpokenIs => {
    if (same(amount, engine.total)) return 'total'
    if (engine.subtotal !== undefined && same(amount, engine.subtotal)) return 'subtotal'
    if (engine.taxAmount !== undefined && engine.taxAmount > 0 && same(amount, engine.taxAmount)) return 'tax'
    if ((engine.lines ?? []).some((line) => same(Math.abs(line), amount))) return 'line'
    return 'not_the_engines'
  }
  const said = amounts.filter((a) => a.money).map((a) => ({ ...a, is: what(a.amount), wrongCurrency: a.currency !== null && a.currency !== engine.currency }))
  const wrong = said.some((a) => a.is === 'not_the_engines' || a.wrongCurrency)
  // The total counts as said when she said it at all, with "dollars" or without
  const saidTotal = amounts.some((a) => same(a.amount, engine.total))
  return { verdict: wrong ? 'mismatch' : saidTotal ? 'match' : 'not_said', said }
}
