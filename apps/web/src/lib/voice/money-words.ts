/**
 * T-211: an amount of money the way a person says it: "eight hundred and twenty-five dollars",
 * never "825 USD".
 *
 * Her tools give her every price in these words as well as in figures, so that what she says is
 * the engine's amount, word for word, and the page's price check (spoken.ts reads the words back
 * into a number) can hold her to it.
 *
 * Pure. The names of a currency's units are the currency's own, not any business's.
 */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** [one of it, several of it, a hundredth of it, several hundredths] */
const UNITS: Record<string, [string, string, string, string]> = {
  USD: ['dollar', 'dollars', 'cent', 'cents'],
  CAD: ['dollar', 'dollars', 'cent', 'cents'],
  AUD: ['dollar', 'dollars', 'cent', 'cents'],
  NZD: ['dollar', 'dollars', 'cent', 'cents'],
  GBP: ['pound', 'pounds', 'pence', 'pence'],
  EUR: ['euro', 'euros', 'cent', 'cents'],
}

const below100 = (n: number): string => (n < 20 ? ONES[n]! : n % 10 === 0 ? TENS[Math.floor(n / 10)]! : `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}`)

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds === 0) return below100(rest)
  return rest === 0 ? `${ONES[hundreds]} hundred` : `${ONES[hundreds]} hundred and ${below100(rest)}`
}

/** A whole number from 0 to 999,999,999 in words */
export function numberWords(n: number): string {
  const whole = Math.floor(Math.abs(n))
  if (whole === 0) return 'zero'
  const millions = Math.floor(whole / 1_000_000)
  const thousands = Math.floor((whole % 1_000_000) / 1000)
  const rest = whole % 1000
  const parts: string[] = []
  if (millions > 0) parts.push(`${below1000(millions)} million`)
  if (thousands > 0) parts.push(`${below1000(thousands)} thousand`)
  if (rest > 0) parts.push(rest < 100 && parts.length > 0 ? `and ${below100(rest)}` : below1000(rest))
  return parts.join(' ')
}

/** "eight hundred and twenty-five dollars", "four hundred and fifty pounds and fifty pence". Null for a currency whose units are not known here. */
export function moneyWords(amount: number, currency: string): string | null {
  const units = UNITS[currency.toUpperCase()]
  if (!units || !Number.isFinite(amount) || Math.abs(amount) >= 1_000_000_000) return null
  const cents = Math.round(Math.abs(amount) * 100)
  const whole = Math.floor(cents / 100)
  const small = cents % 100
  const main = `${numberWords(whole)} ${whole === 1 ? units[0] : units[1]}`
  if (small === 0) return main
  const tail = `${numberWords(small)} ${small === 1 ? units[2] : units[3]}`
  return whole === 0 ? tail : `${main} and ${tail}`
}

/** The everyday name of a currency's unit ("dollars"), for her instructions. Null when not known here. */
export const currencyWord = (currency: string): string | null => UNITS[currency.toUpperCase()]?.[1] ?? null
