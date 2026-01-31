# tickets/T-006-services-and-pricing-ui.md

## Goal
Build dashboard UI to create services and edit pricing rules JSON (minimal, usable).

## In scope
- Services CRUD UI: name, active, default document type
- Pricing rules UI for baseFee, minimumCharge, addons, multipliers
- Save to DB via Worker APIs
- Basic validation

## Out of scope
- Complex rule builder (keep minimal)
- Bulk import/export

## Acceptance criteria
- [x] Create/edit/disable a service
- [x] Update pricing rules for a service
- [x] Pricing rules persist and reload correctly

## Completed
**Date:** 2026-01-25

### Implementation Notes

**API Routes Created:**

1. `apps/web/src/app/api/services/route.ts`
   - `GET /api/services` - List all services for tenant
   - `POST /api/services` - Create new service (also creates default pricing rules)

2. `apps/web/src/app/api/services/[id]/route.ts`
   - `GET /api/services/[id]` - Get single service
   - `PATCH /api/services/[id]` - Update service (name, active, documentTypeDefault)
   - `DELETE /api/services/[id]` - Delete service (blocked if has quotes)

3. `apps/web/src/app/api/services/[id]/pricing/route.ts`
   - `GET /api/services/[id]/pricing` - Get pricing rules
   - `PUT /api/services/[id]/pricing` - Update/upsert pricing rules

**UI Pages Updated:**

1. `/app/services` - Full CRUD interface:
   - Services table with name, document type, status
   - Add/Edit service modal
   - Enable/Disable toggle
   - Delete with confirmation (blocked if service has quotes)

2. `/app/pricing` - Pricing rules editor:
   - Service selector sidebar
   - Base pricing (baseFee, minimumCharge)
   - Add-ons management (label + price)
   - Multipliers management (when fieldId = value, multiply by X)
   - Auto-save tracking with "Save Changes" button

**Features:**
- Services default to `instant_estimate` document type
- New services get default empty pricing rules
- RLS enforced via Supabase client
- Validation on both client and server side
- Error handling with dismissible error messages