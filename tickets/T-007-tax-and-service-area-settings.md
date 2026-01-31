# tickets/T-007-tax-and-service-area-settings.md

## Goal
Add global tax settings and service area restriction settings to the dashboard.

## In scope
- Tenant settings UI:
  - currency
  - tax enabled, label, rate (generic: VAT/GST/Sales Tax)
  - service area mode: none, postcode/zip allowlist, county/state list
- Persist via `PUT /api/tenant`

## Out of scope
- Radius-based service area (not in v1)
- Geo autocomplete integrations (keep simple)
- Complex polygon boundaries

## Acceptance criteria
- [x] Tenant can set tax label/rate and currency
- [x] Tenant can select service area mode and values
- [x] Settings persist and are applied in quote generation later

## Completed
**Date:** 2026-01-25

### Implementation Notes

**API Routes Created:**

`apps/web/src/app/api/tenant/route.ts`
- `GET /api/tenant` - Fetch current tenant settings + user email
- `PUT /api/tenant` - Update tenant settings with validation
  - Validates: name (non-empty), currency (3-letter ISO), taxRate (0-1), serviceAreaMode (enum), serviceAreaValues (array)
  - Uppercase normalizes currency and service area values

**Settings Page Updated:**

`apps/web/src/app/(dashboard)/app/settings/page.tsx` - Full functional UI:

1. **Business Information Section:**
   - Business name (editable)
   - Contact email (read-only, from auth)
   - Currency selector (USD, GBP, EUR, CAD, AUD, NZD)

2. **Tax Settings Section:**
   - Enable/disable tax checkbox
   - Tax label field (e.g., VAT, GST, Sales Tax)
   - Tax rate field (displayed as %, stored as 0-1)

3. **Service Area Section:**
   - Radio buttons for mode selection:
     - `none` - No restrictions
     - `postcode_allowlist` - Postcode/ZIP allowlist
     - `county_state` - County/State list
   - Textarea for entering values (comma or newline separated)
   - Values auto-uppercased on save

4. **Account Information Section:**
   - Displays tenant ID (read-only)

5. **Danger Zone:**
   - Delete account button (disabled during beta)

**Features:**
- Section-based saving (save each section independently)
- Success/error toast messages
- Loading states
- Form validation on client and server
