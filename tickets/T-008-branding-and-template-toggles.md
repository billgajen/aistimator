# tickets/T-008-branding-and-template-toggles.md

## Goal
Create branding settings and quote template toggles in dashboard, with preview stub.

## In scope
- Branding fields: business name, logo upload, primary colour, footer notes
- Template toggles (v1):
  - show line items yes/no
  - include assumptions yes/no
  - include exclusions yes/no
  - validity days default
- Preview: render a sample quote page using mock data

## Out of scope
- Full proposal builder
- Multiple template themes

## Acceptance criteria
- [x] Branding saved and reflected in preview
- [x] Template toggles saved and reflected in preview

## Completed
**Date:** 2026-01-25

### Implementation Notes

**Database Migration:**

`supabase/migrations/00000000000003_branding.sql`
- Added `branding_json` JSONB column to tenants table with defaults:
  - `logoAssetId`: null
  - `primaryColor`: "#2563eb"
  - `footerNotes`: null
- Added `template_json` JSONB column to tenants table with defaults:
  - `showLineItems`: true
  - `includeAssumptions`: true
  - `includeExclusions`: true
  - `validityDays`: 30

**Shared Types:**

`packages/shared/src/database.types.ts`
- Added `TenantBranding` interface
- Added `TenantTemplate` interface
- Updated `Tenant` interface to include branding_json and template_json

**API Routes Created:**

`apps/web/src/app/api/tenant/branding/route.ts`
- `GET /api/tenant/branding` - Fetch current tenant's branding and template settings
  - Returns tenantId, tenantName, branding (merged with defaults), template (merged with defaults)
- `PUT /api/tenant/branding` - Update branding and/or template settings
  - Validates: primaryColor (hex format), validityDays (1-365)
  - Merges partial updates with existing values

**Branding Page:**

`apps/web/src/app/(dashboard)/app/branding/page.tsx` - Full functional UI:

1. **Logo Section:**
   - Placeholder for logo upload (displays current logo or upload prompt)
   - Note: Actual upload integration pending asset management

2. **Colors Section:**
   - Primary color picker (native HTML color input + text input)
   - Live preview of color changes

3. **Footer Notes Section:**
   - Textarea for custom footer text on quotes

4. **Template Options Section:**
   - Toggle: Show line items
   - Toggle: Include assumptions
   - Toggle: Include exclusions
   - Number input: Default validity days (1-365)

5. **Live Quote Preview Panel:**
   - Real-time preview of quote document using mock data
   - Reflects all branding and template settings instantly
   - Shows/hides sections based on template toggles
   - Applies primary color to headings

**Features:**
- Single save button for all settings
- Success/error toast messages
- Loading states during fetch and save
- Real-time preview updates without saving
- Form validation on client and server