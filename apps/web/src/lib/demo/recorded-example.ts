/**
 * T-153: shown on /demo when the demo is over its limits (DEMO_DAILY_CAP or
 * the per-IP limit). Recorded from a real demo run: Example Home Services,
 * Garage Door Spring Replacement, priced from the demo tenant's own rates.
 * Recorded 2026-11-10 (two springs). A unit test checks it still matches the
 * pack's price for the pair, so it can't drift from what the demo would charge.
 */
export interface DemoEstimate {
  businessName: string
  serviceName: string | null
  currency: string
  locale: string
  lines: Array<{ label: string; amount: number }>
  taxLabel: string | null
  taxAmount: number
  total: number
  range: { low: number; high: number } | null
  needsAnswer: boolean
  quoteViewUrl: string | null
}

export const RECORDED_EXAMPLE: DemoEstimate = {
  businessName: 'Example Home Services',
  serviceName: 'Garage Door Spring Replacement',
  currency: 'USD',
  locale: 'en-US',
  lines: [{ label: 'Torsion spring replacement (pair)', amount: 375 }],
  taxLabel: null,
  taxAmount: 0,
  total: 375,
  range: null,
  needsAnswer: false,
  quoteViewUrl: null,
}
