# tickets/T-134-subscription-only-usd-plans.md

## Goal
Subscription-only pricing in USD (AD-026). Simple tiers, hard limits, clear upgrade path.

## In scope
- **Plans as config, not code:** one plan definition source (name, monthly price per
  currency, quote limit, channels, features). The UI and limit enforcement read from it.
- **Indicative USD tiers** (owner to confirm final numbers before go-live):
  - Starter $49/mo — 50 quotes, widget, hosted quote page, PDF
  - Pro $99/mo — 200 quotes, + SMS and WhatsApp, + mobile app, + calibration insights
  - Business $199/mo — 600 quotes, + LiDAR scanning, multiple users (seat model later), priority support
  - Annual billing at 2 months free
  - 14-day free trial on Pro, card required
- **Overage off by default:** keep the metered code path behind a per-plan flag
  (`overageEnabled: false`). At 100% usage the quote is still captured as a lead, but the
  customer gets a "the business will send your estimate shortly" message and the business
  gets an upgrade prompt. Never lose a customer's submission.
- Stripe: USD products and prices (test mode first), Customer Portal for upgrades and
  downgrades, proration on.
- Remove the "Free" tier from the US signup path (trial replaces it). Keep it for existing tenants.
- Update the pricing page and the dashboard billing page.

## Out of scope
- Per-seat billing. Coupons beyond what Stripe Checkout gives for free.

## Acceptance criteria
- [ ] Trial → paid → upgrade → downgrade all work in Stripe test mode, and the webhook keeps the tenant plan in sync
- [ ] Quote #51 on Starter is captured as a lead, not priced; the business is notified; no overage is charged
- [ ] The 80% usage banner and the 100% paywall both show
- [ ] Plan limits and features are read from one config source (unit-tested)
