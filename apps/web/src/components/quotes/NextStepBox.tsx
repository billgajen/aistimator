'use client'

import { QUOTE_TURN_COPY } from '@estimator/shared'
import type { QuoteTurn } from '@estimator/shared'

const PRIMARY =
  'inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50'
const SECONDARY =
  'inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-surface'

/**
 * T-158: the top of the quote page. One sentence saying whose turn it is and
 * one main button, both from `quoteTurn` in @estimator/shared. The buttons run
 * the page's existing actions; nothing here decides what is allowed.
 */
export function NextStepBox({
  turn,
  firstName,
  email,
  phone,
  approving,
  onApprove,
  onEdit,
  pricing,
  priceResult,
  onPrice,
  resending,
  onSendAgain,
}: {
  turn: QuoteTurn
  firstName: string | null
  email: string | null
  phone: string | null
  approving: boolean
  onApprove: () => void
  onEdit: () => void
  pricing: boolean
  priceResult: string | null
  onPrice: () => void
  resending: boolean
  onSendAgain: () => void
}) {
  const B = QUOTE_TURN_COPY.pageButtons
  const contact = turn.action === 'contact' || turn.action === 'answer_question'

  return (
    <section
      className={`mb-6 rounded-warm-xl border bg-white p-5 shadow-warm-md ${turn.action ? 'border-primary/25' : 'border-border'}`}
      data-testid="next-step"
      data-action={turn.action ?? 'none'}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{QUOTE_TURN_COPY.nextStepTitle}</p>
      <p className="mt-2 text-base text-text-primary" data-testid="next-step-sentence">
        {turn.sentence}
      </p>

      {turn.action && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {turn.action === 'approve' && (
            <button type="button" onClick={onApprove} disabled={approving} className={PRIMARY}>
              {approving ? B.approving : B.approve}
            </button>
          )}
          {turn.action === 'add_price' && (
            <button type="button" onClick={onEdit} className={PRIMARY}>
              {B.editQuote}
            </button>
          )}
          {turn.action === 'price_request' && (
            <>
              <button type="button" onClick={onPrice} disabled={pricing} className={PRIMARY}>
                {pricing ? B.pricingRequest : B.priceRequest}
              </button>
              <a href="/app/settings/billing" className={SECONDARY}>
                {B.upgradePlan}
              </a>
              {priceResult && <span className="text-xs text-text-muted">{priceResult}</span>}
            </>
          )}
          {turn.action === 'send_again' && (
            <button type="button" onClick={onSendAgain} disabled={resending} className={PRIMARY} data-testid="send-again">
              {resending ? B.sendingAgain : B.sendAgain}
            </button>
          )}
          {contact && email && (
            <a href={`mailto:${email}`} className={PRIMARY} data-testid="next-step-email">
              {B.email(firstName)}
            </a>
          )}
          {contact && phone && (
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={email ? SECONDARY : PRIMARY} data-testid="next-step-call">
              {B.call(firstName)}
            </a>
          )}
        </div>
      )}
    </section>
  )
}
