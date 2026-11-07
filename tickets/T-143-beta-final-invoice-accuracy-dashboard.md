# tickets/T-143-beta-final-invoice-accuracy-dashboard.md

## Goal
Measure real accuracy with beta customers: the quote compared with what the job finally
cost. This turns the calibration loop (T-110, T-123) from amendments-only into
outcome-based, and produces the proof we'll use in sales and ads.

## In scope
- **Final invoice capture:** on any accepted quote, the business records the final
  invoiced amount (web dashboard and mobile app), with optional line-level changes and a
  reason picker (scope changed / measurement off / price changed / other).
- Prompt the business to record it N days after acceptance (email + push), tenant-configurable.
- **Accuracy metrics (per tenant, per service, per grade, per channel):** median absolute
  % error, % within ±10%, bias (under/over), trend over time.
- **Accuracy dashboard page** for the business; an **admin view across tenants per pack**
  to drive the "add a trade" rule (≥80% within ±10%).
- Feed final-invoice deltas into the existing calibration suggestions ("your water heater
  quotes run 8% under final — raise labour?"). Business approves; nothing auto-changes (AD-001).
- **Beta onboarding helpers:** admin can create a tenant, apply a pack, impersonate for
  setup (audited), and mark tenants as beta.

## Out of scope
- Accounting integrations (QuickBooks import) — later.

## Acceptance criteria
- [ ] The final invoice can be entered from web and mobile; metrics update
- [ ] The admin per-pack accuracy view shows the add-a-trade threshold status
- [ ] Calibration suggestions use final-invoice data when present
- [ ] Impersonation is audited in the admin activity log
