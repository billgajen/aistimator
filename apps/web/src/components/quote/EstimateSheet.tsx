import { formatMoney, preparedForLine } from '@qolumns/shared'
import { brandStyleVars } from '@/lib/color'
import { Money, SectionLabel } from './document-parts'

/**
 * T-165: the estimate document as a customer gets it, for showing it outside
 * the quote page (the home page's demo, the sign-in page). It is built from
 * the quote page's own parts (document-parts) and the same classes as
 * app/q/[quoteId]: the letterhead, the price panel in the business's colour
 * with the tape rule, and the ledger with dotted leaders. True size: nothing
 * is scaled down. It takes data, fetches nothing and has no buttons that act.
 *
 * `slots` lets a caller wrap parts of it (the home page's demo animates the
 * tape and the total); without them it is a still document.
 */
export interface EstimateSheetData {
  businessName: string
  logoUrl?: string | null
  customerName: string
  reference: string
  lines: Array<{ label: string; amount: number }>
  total: number
  currency: string
  locale: string
  /** The business's brand colour: the document is in its colour, never ours */
  primaryColor: string
}

export function EstimateSheet({
  data,
  confirmed = false,
  className = '',
  panelClassName = '',
  tapeClassName = '',
  totalClassName = '',
  lineClassName,
  totalStyle,
  lineStyle,
  tapeCover,
  label,
  note,
  footer,
}: {
  data: EstimateSheetData
  /** false: "an estimate… will review and confirm it"; true: "Reviewed and confirmed by…" */
  confirmed?: boolean
  className?: string
  panelClassName?: string
  /** extra classes for the tape rule under the total */
  tapeClassName?: string
  /** extra classes for the total figure */
  totalClassName?: string
  /** extra classes for each ledger line, by index */
  lineClassName?: (index: number) => string
  totalStyle?: React.CSSProperties
  lineStyle?: (index: number) => React.CSSProperties
  /** drawn over the tape rule (the home demo's cover that slides off it) */
  tapeCover?: React.ReactNode
  /** replaces the words above the total ("Your estimate" / "Your quote") */
  label?: React.ReactNode
  /** replaces the line under the total (the home demo swaps it when the business confirms) */
  note?: React.ReactNode
  /** what sits under the ledger: the accept button, on the quote page */
  footer?: React.ReactNode
}) {
  const money = (n: number) => formatMoney(n, data.currency, data.locale)
  return (
    <div className={`overflow-hidden rounded-3xl bg-background text-left shadow-document ${className}`} style={brandStyleVars(data.primaryColor)} data-testid="estimate-sheet">
      {/* Letterhead */}
      <div className="px-6 pb-5 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {data.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a small SVG shipped in public/
              <img src={data.logoUrl} alt={data.businessName} className="h-9 object-contain" />
            ) : (
              <p className="truncate font-display text-xl font-bold tracking-tight text-text-primary">{data.businessName}</p>
            )}
            <p className="mt-1 text-xs text-text-muted">{preparedForLine(confirmed === true, data.customerName)}</p>
          </div>
        </div>
        <p className="figure mt-4 text-xs text-text-secondary">{data.reference}</p>
      </div>

      {/* The price instrument */}
      <div className={`bg-primary px-6 py-7 text-on-primary ${panelClassName}`}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-on-primary/60">{label ?? (confirmed ? 'Your quote' : 'Your estimate')}</p>
        <p className={`figure text-5xl font-medium leading-none tracking-tight ${totalClassName}`} style={totalStyle} data-testid="estimate-total">
          <Money amount={data.total} currency={data.currency} locale={data.locale} emphasize />
        </p>
        {note ?? (
          <p className="mt-4 max-w-sm text-[13px] leading-snug text-on-primary/75">
            {confirmed
              ? `Reviewed and confirmed by ${data.businessName}.`
              : `This is an estimate based on your photos and details. ${data.businessName} will review and confirm it.`}
          </p>
        )}
        <div className="relative mt-7 overflow-hidden">
          <div className={`tape-rule-light ${tapeClassName}`} aria-hidden="true" />
          {tapeCover}
        </div>
      </div>

      {/* The ledger */}
      <div className="px-6 py-6">
        <SectionLabel as="p">Price breakdown</SectionLabel>
        <div className="mb-4 space-y-2.5">
          {data.lines.map((line, index) => (
            <div key={line.label} className={`flex items-baseline gap-2 text-sm ${lineClassName?.(index) ?? ''}`} style={lineStyle?.(index)}>
              <span className="text-text-primary">{line.label}</span>
              <span className="flex-1 translate-y-[-3px] border-b border-dotted border-border-strong" />
              <span className="figure whitespace-nowrap text-text-primary">{money(line.amount)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold text-text-primary">Total</span>
          <span className="figure text-lg font-medium text-text-primary">{money(data.total)}</span>
        </div>
        {footer ? <div className="mt-5">{footer}</div> : null}
      </div>
    </div>
  )
}
