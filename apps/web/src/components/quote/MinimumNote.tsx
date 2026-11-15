import { formatMoney, minimumChargeNote } from '@qolumns/shared'

/**
 * T-165: the minimum charge is a floor, not an item. Where a quote's lines are
 * shown, this is the one note that says the business's minimum charge was
 * applied: "Minimum charge of $400.00 applied", in the quote's own currency.
 * It renders nothing when no minimum applied, so a quote at or above the
 * minimum says nothing about one.
 *
 * The wording comes from shared/minimum-charge.ts (the PDF and the pricing
 * trace use the same sentence). `minimumCharge` comes from `splitMinimum`.
 */
export function MinimumNote({
  minimumCharge,
  currency,
  locale,
  className = 'text-sm text-text-secondary',
}: {
  minimumCharge: number | null | undefined
  currency: string
  locale?: string
  className?: string
}) {
  if (!minimumCharge || minimumCharge <= 0) return null
  return (
    <p className={className} data-testid="minimum-note">
      {minimumChargeNote(formatMoney(minimumCharge, currency, locale))}
    </p>
  )
}
