/**
 * T-201: the business's own currency symbol inside an amount box of the
 * service editor (it used to be a typed "$" whatever the currency). The
 * symbol comes from the shared currency helper, by way of the page.
 */
export function AmountSymbol({ symbol }: { symbol: string }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-muted" data-testid="amount-symbol">
      {symbol}
    </span>
  )
}

/** The left padding an amount box needs so its number clears the symbol ("$", "kr", "CHF") */
export function amountBoxPadding(symbol: string): string {
  if (symbol.length <= 1) return 'pl-7'
  if (symbol.length === 2) return 'pl-9'
  return 'pl-12'
}
