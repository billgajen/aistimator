# tickets/T-021-stripe-billing.md

## Goal
Stripe billing integration for subscription management.

## In scope
- Stripe client library
- Billing dashboard with current plan and usage
- Checkout session for subscription upgrades
- Customer portal for billing management
- Webhook handler for subscription events
- Plan comparison and selection

## Out of scope
- Usage-based billing (metered)
- Multiple currencies
- Proration handling in UI (handled by Stripe)
- Invoice history (available via portal)

## Acceptance criteria
- [x] Billing page shows current subscription and usage
- [x] Users can upgrade to a paid plan via Stripe Checkout
- [x] Paid users can manage billing via Stripe Customer Portal
- [x] Webhook handles subscription lifecycle events
- [x] Plan features displayed correctly

## Completed
**Date:** 2026-01-25

### Implementation Summary

**Library Created:**

`apps/web/src/lib/stripe.ts` - Stripe client wrapper:
- `getStripeClient()` - Get initialized Stripe client
- `isStripeConfigured()` - Check if Stripe env vars are set
- `getOrCreateStripeCustomer()` - Create/retrieve Stripe customer
- `createCheckoutSession()` - Create subscription checkout
- `createPortalSession()` - Create customer portal session
- `getSubscriptionDetails()` - Retrieve subscription from Stripe
- `formatPrice()` - Format price for display

**Types Added:**

`packages/shared/src/api.types.ts`:
- `PlanInfo` - Plan details with features
- `SubscriptionInfo` - Current subscription status
- `BillingUsage` - Monthly usage tracking
- `BillingResponse` - Combined billing API response
- `CreateCheckoutRequest/Response` - Checkout session types
- `CreatePortalResponse` - Portal session type

**API Routes Created:**

1. `apps/web/src/app/api/billing/route.ts`
   - `GET /api/billing` - Get billing info for current tenant
   - Returns subscription, usage, and available plans

2. `apps/web/src/app/api/billing/checkout/route.ts`
   - `POST /api/billing/checkout` - Create Stripe Checkout session
   - Validates plan, creates/gets customer, returns checkout URL

3. `apps/web/src/app/api/billing/portal/route.ts`
   - `POST /api/billing/portal` - Create Customer Portal session
   - Returns portal URL for existing customers

4. `apps/web/src/app/api/webhooks/stripe/route.ts`
   - `POST /api/webhooks/stripe` - Handle Stripe webhook events
   - Events handled:
     - `checkout.session.completed` - Activate subscription
     - `customer.subscription.created/updated` - Sync status
     - `customer.subscription.deleted` - Handle cancellation
     - `invoice.payment_succeeded` - Mark active
     - `invoice.payment_failed` - Mark past_due

**Dashboard Page Updated:**

`apps/web/src/app/(dashboard)/app/billing/page.tsx`:

**Features:**
- Current plan card with status badge
- Monthly usage with progress bar
- Renewal/trial end date display
- Monthly cost display
- Cancel warning if subscription ending
- "Manage Billing" button (opens Stripe portal)
- Available plans grid with feature comparison
- Plan selection with Stripe Checkout redirect
- Success/canceled toast notifications

**Plan Card Features:**
- Plan name and price
- Monthly estimate limit
- Feature checklist (PDF, email, branding, support, API)
- "Current Plan" badge for active plan
- Loading states for checkout

**Environment Variables Required:**
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

**Database Requirements:**
- `plans` table needs `stripe_price_id` column for linking to Stripe prices
- `subscriptions` table stores `stripe_customer_id` and `stripe_subscription_id`
