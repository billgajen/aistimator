/**
 * T-191: the App Store reviewer's test business (scripts/create-review-account.mts). Pure, so it is tested.
 * Every name is invented; the customers' addresses are on example.com, which never receives mail.
 */
export const REVIEW_ACCOUNT = {
  /** the sign-in is <this>@<APP_DOMAIN> */
  emailLocalPart: 'app-review',
  businessName: 'Harbor Lane Painting',
  /** a free test plan (no Stripe customer), so the reviewer is never stopped by the free allowance */
  planId: 'plan_us_pro',
} as const

export interface ReviewSampleQuote {
  /** which of the script's two services (0 = interior painting, 1 = garage door springs) */
  service: 0 | 1
  customer: { name: string; email: string; address: string }
  status: 'pending_review' | 'sent' | 'accepted'
  createdAt: string
  sentAt: string | null
  viewedAt: string | null
  acceptedAt: string | null
}

const daysAgo = (now: Date, days: number, hours = 0) => new Date(now.getTime() - (days * 24 + hours) * 3_600_000).toISOString()

/** One quote waiting for the business, one sent and opened, one accepted */
export function reviewAccountQuotes(now: Date): ReviewSampleQuote[] {
  return [
    {
      service: 0,
      customer: { name: 'Megan Grant', email: 'megan.grant@example.com', address: '14 Birch Street, Springfield' },
      status: 'pending_review',
      createdAt: daysAgo(now, 0, 2),
      sentAt: null,
      viewedAt: null,
      acceptedAt: null,
    },
    {
      service: 1,
      customer: { name: 'Jordan Reyes', email: 'jordan.reyes@example.com', address: '220 Oak Avenue, Springfield' },
      status: 'sent',
      createdAt: daysAgo(now, 2),
      sentAt: daysAgo(now, 2, -1),
      viewedAt: daysAgo(now, 1),
      acceptedAt: null,
    },
    {
      service: 0,
      customer: { name: 'Sam Carter', email: 'sam.carter@example.com', address: '9 Maple Court, Springfield' },
      status: 'accepted',
      createdAt: daysAgo(now, 6),
      sentAt: daysAgo(now, 6, -1),
      viewedAt: daysAgo(now, 5),
      acceptedAt: daysAgo(now, 4),
    },
  ]
}

/**
 * A sample line's label as the engine writes a priced line: the line's name, two spaces, then "$2 × 90 sq ft"
 * (T-185). A fixed line is its name alone.
 */
export function reviewLabel(name: string, calculation: string): string {
  const measured = /^([\d,.]+)\s+(.+?)\s+×\s+(\S+)\s+=/.exec(calculation)
  return measured ? `${name}  ${measured[3]} × ${measured[1]} ${measured[2]}` : name
}
