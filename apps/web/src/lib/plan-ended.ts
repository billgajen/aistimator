/**
 * T-202: what the billing page says once a plan has ended (pure).
 *
 * It used to say "New requests are saved for you but not priced until you
 * pick a plan" for every business. That is only true when the business has
 * nothing left without a plan. Since T-201 the free quotes a business never
 * used are still its own after a plan (a quote priced on a plan is not one of
 * them), so its new requests are priced from those first. The payment-failed
 * email says the same ahead of time (`afterPlanEndsLine`, lib/billing-emails.ts).
 *
 * `usage` is what the billing page already shows for a business with no plan:
 * the allowance without a plan, and how much of it is used.
 */
export function planEndedNote(planName: string, usage: { used: number; limit: number; per: 'month' | 'total' }): string {
  const ended = `Your ${planName} plan has ended.`
  const saved = 'saved for you but not priced until you pick a plan'
  const left = Math.max(0, usage.limit - usage.used)
  if (usage.per === 'month') {
    return left > 0
      ? `${ended} Without a plan, up to ${usage.limit} new requests a month are still priced (${usage.used} so far this month). Past that, they are ${saved}.`
      : `${ended} This month’s ${usage.limit} requests without a plan are used, so new requests are ${saved}.`
  }
  if (left > 0) {
    return `${ended} You still have ${left} of your ${usage.limit} free quotes, so ${left === 1 ? 'the next new request is' : `the next ${left} new requests are`} still priced. After ${left === 1 ? 'that one' : 'those'}, new requests are ${saved}.`
  }
  return `${ended} Your ${usage.limit} free quotes are used, so new requests are ${saved}.`
}
