# tickets/T-021-stripe-billing-and-payments.md

## Goal
Implement Stripe subscriptions (plans) and optional customer payment for deposits.

## In scope
- Stripe checkout for subscription
- Billing page (manage plan)
- Webhook `/api/stripe/webhook` verifying signature
- Payment init endpoint: `/api/public/quotes/:quoteId/pay/init`
- Update subscription status and quote paidAt where relevant

## Out of scope
- Complex invoicing
- Multiple payment providers

## Acceptance criteria
- [ ] Tenant can subscribe and see active plan
- [ ] Webhooks update DB correctly
- [ ] Customer can pay deposit (if enabled) and quote marked paid