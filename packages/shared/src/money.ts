/**
 * Money helpers shared by the pricing engine, the quote editor and the quote
 * pages (T-157).
 *
 * Amounts are plain numbers in the major unit (pounds, dollars). Floating
 * point leaves dust on them (18 x 34.6 = 622.8000000000001), so every amount
 * that is stored or shown goes through `roundMoney` where it is created.
 */

/**
 * Round to 2 decimals, half away from zero (1.005 → 1.01, -1.005 → -1.01).
 *
 * `Math.round(x * 100) / 100` gets 1.005 wrong (it is stored as 1.00499…, and
 * times 100 is 100.49999999999999). Shifting the decimal point through the
 * number's shortest text form rounds the figure a person would read.
 * Not a number, or infinite → 0, like `formatMoney`.
 */
export function roundMoney(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 0
  const abs = Math.abs(amount)
  // Below a millionth is zero (and prints in exponent form, which the shift can't read)
  if (abs < 1e-6) return 0
  // Past this a double has no room for pence; leave it alone
  if (abs >= 1e15) return amount
  const rounded = Number(`${Math.round(Number(`${abs}e2`))}e-2`)
  if (rounded === 0) return 0
  return amount < 0 ? -rounded : rounded
}

/**
 * Engine labels carry their maths ("Hourly service  £28 x 4(Hrs)"). Split it
 * out so the line stays clean and the working can sit beneath it.
 * Returns [the plain label, the maths for display or null].
 */
export function splitLabelMath(label: string): [string, string | null] {
  const m = label.match(/^(.*?)\s{2,}([£$€].+\sx\s.+)$/)
  if (!m) return [label, null]
  return [m[1] ?? label, (m[2] ?? '').replace(/\sx\s/, ' × ').replace(/\(/, ' ').replace(/\)/, '')]
}

export interface MoneyLine {
  label: string
  amount: number
}

/**
 * When the business changes a line's amount and leaves its generated label
 * alone, the maths in that label ("£18 x 34.6(Sqm)") no longer matches the
 * amount, so it is dropped: the customer never sees maths that doesn't add up.
 *
 * Only an untouched generated label is changed:
 * - the label must be exactly a label the quote had before the edit;
 * - it must carry generated maths (`splitLabelMath`);
 * - when the engine's own labels are known (`generatedLabels`, from the
 *   pricing trace), it must be one of them;
 * - and no line with that label may still have its old amount.
 * Text the business typed is never rewritten.
 */
export function dropStaleLabelMath<T extends MoneyLine>(
  before: readonly MoneyLine[],
  after: readonly T[],
  generatedLabels?: readonly string[] | null
): T[] {
  const previousAmounts = new Map<string, number[]>()
  for (const line of before) {
    const amounts = previousAmounts.get(line.label) ?? []
    amounts.push(roundMoney(line.amount))
    previousAmounts.set(line.label, amounts)
  }
  const generated = generatedLabels && generatedLabels.length > 0 ? new Set(generatedLabels) : null

  return after.map((line) => {
    const [plain, maths] = splitLabelMath(line.label)
    if (!maths) return line
    const previous = previousAmounts.get(line.label)
    if (!previous) return line // a new or retyped label: the business's own text
    if (generated && !generated.has(line.label)) return line
    if (previous.includes(roundMoney(line.amount))) return line // amount untouched
    return { ...line, label: plain }
  })
}
