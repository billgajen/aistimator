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
- [ ] Trial → paid → upgrade → downgrade all work in Stripe test mode, and the webhook keeps the tenant plan in sync — code ready; needs the owner's Stripe test products (setup script) and a webhook run (OWNER-TODO.md)
- [x] Quote #51 on Starter is captured as a lead, not priced; the business is notified; no overage is charged (unit-tested; business email needs Postmark live)
- [x] The 80% usage banner and the 100% paywall both show
- [x] Plan limits and features are read from one config source (unit-tested)

## Plan
1. One plan definition source `packages/shared/src/plans.ts`: names, USD monthly/annual prices
   (annual = 10× monthly), quote limits, channels, features, `overageEnabled`, trial days, offered flag.
   Legacy plans kept for existing subscribers. Stripe price ids from env (`STRIPE_PRICE_<PLAN>_<INTERVAL>_<CUR>`).
2. Limit enforcement, plan features (white-label), billing API, pricing page and homepage teaser read it.
3. Over the limit with overage off: capture the request as an unpriced lead (`pending_review` +
   `limitHold`), tell the customer the estimate is coming, email the business, never run AI; a
   "Price this lead" action after upgrading (`POST /api/quotes/[id]/process`). Same for WhatsApp/SMS.
4. Stripe: checkout with interval + card-required trial (one per business), Customer Portal for
   upgrades/downgrades, webhook maps prices → plans via env and upserts the subscription.
5. Migration 28 adds US plan rows (FK targets only); legacy rows deactivated. Setup script creates the
   Stripe products/prices from the config. Unit tests (no gauntlet — billing).

## Implementation Summary
- `packages/shared/src/plans.ts` is the single plan source (US Starter $49/50, Pro $99/200 with a 14-day
  card-required trial, Business $199/600; annual = two months free; overage off). Prices are the
  ticket's indicative numbers, marked TODO-OWNER.
- Found and fixed two latent billing bugs: checkout and the webhook looked up a `plans.stripe_price_id`
  column that never existed (checkout could never start), and the webhook only *updated* subscription
  rows that signup never creates (a paid checkout would not be recorded). Now env price ids + upsert.
- Over-limit requests become held leads on every channel (widget, WhatsApp, SMS) — never lost, never
  priced, business emailed, one-click "Price this lead" after upgrading.
- Billing page: monthly/annual toggle, trial badge, plan changes via the Stripe portal; pricing page and
  homepage teaser generated from the config.
- Migration 28; `apps/web/scripts/stripe-setup-plans.mts`; 12 new unit tests (web 60 total).
