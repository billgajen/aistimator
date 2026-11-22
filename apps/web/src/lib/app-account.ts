/**
 * T-184: what the on-site app's Account tab shows, shaped from rows (pure).
 *
 * The app must not point at a purchase outside it (the App Store's rule), so
 * nothing here is a price, an upgrade or a link to billing: only the plan's
 * name and how many quotes have been used. The limit is the plan's own
 * (packages/shared/src/plans.ts), read by the same function that enforces it.
 */
import { SUPPORT_EMAIL, type AppAccountResponse, type BusinessLinks } from '@qolumns/shared'

export function appAccount(input: {
  businessName: string
  logoUrl: string | null
  planName: string | null
  limit: { used: number; limit: number; unlimited: boolean; per: 'month' | 'total' }
  /** T-199: the business's links, main first (its own address when it has one and can use it); null when it has no quote link */
  links: BusinessLinks | null
}): AppAccountResponse {
  return {
    businessName: input.businessName,
    logoUrl: input.logoUrl,
    planName: input.planName,
    usage: {
      used: Math.max(0, Math.floor(input.limit.used) || 0),
      limit: input.limit.unlimited ? 0 : Math.max(0, Math.floor(input.limit.limit) || 0),
      unlimited: input.limit.unlimited,
      per: input.limit.per,
    },
    // the same link the dashboard's Quote link page shows first (T-149, T-199)
    quoteLink: input.links?.main ?? null,
    alsoLink: input.links?.also ?? null,
    supportEmail: SUPPORT_EMAIL,
  }
}
