import { currencySymbol } from '@qolumns/shared'

/**
 * The small parts of the estimate document, shared by the customer's quote
 * page (app/q/[quoteId]) and by the places that show that document elsewhere
 * (T-165: the home page, the sign-in page). Moved here unchanged from the
 * quote page, so what a marketing page shows is the same thing a customer
 * gets.
 */

export function SectionLabel({ children, tone, as: Tag = 'h3' }: { children: React.ReactNode; tone?: 'brand' | 'tape'; /** a heading on the quote page; plain text where the document is shown as a picture */ as?: 'h3' | 'p' }) {
  const color = tone === 'brand' ? 'text-primary' : tone === 'tape' ? 'text-tertiary' : 'text-text-muted'
  return (
    <Tag className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${color} mb-3`}>
      {children}
    </Tag>
  )
}

/** Money with lighter pence — how fine documents set figures. */
export function Money({
  amount,
  currency,
  locale,
  emphasize,
}: {
  amount: number
  currency: string
  locale: string
  emphasize?: boolean
}) {
  const symbol = currencySymbol(currency, locale)
  const [whole, pence] = amount.toFixed(2).split('.')
  const wholeFormatted = Number(whole).toLocaleString(locale)
  return (
    <span className="whitespace-nowrap">
      <span className={emphasize ? 'text-on-primary/60' : ''}>{symbol}</span>
      {wholeFormatted}
      <span className={emphasize ? 'text-[0.55em] align-super text-on-primary/60' : 'text-[0.7em]'}>.{pence}</span>
    </span>
  )
}
