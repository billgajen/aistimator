# tickets/T-011-widget-form-builder-and-validation.md

## Goal
Build widget form rendering from `widget_configs` and validate client-side + server-side.

## In scope
- Field types: text, textarea, number, select, radio, checkbox
- Required field validation
- Simple progress indicator
- Submit creates quote request (placeholder until T-013)

## Out of scope
- Conditional branching logic (v2)
- Multi-step wizard customization (keep minimal)

## Acceptance criteria
- [x] Widget renders fields configured in dashboard
- [x] Required field validation blocks submission
- [x] Values are posted in expected API shape

## Completed
- 2026-01-25: Widget form builder and validation implementation complete

  **Field types supported:**
  - `text` - Single line text input
  - `textarea` - Multi-line text input
  - `number` - Numeric input
  - `select` - Dropdown selection
  - `radio` - Radio button group (single selection)
  - `checkbox` - Checkbox group (multi-select, stores array of values)
  - `boolean` - Single checkbox (true/false)

  **Client-side validation (iframe embed + JS widget):**
  - Required field validation with `*` indicator
  - Validation on blur (individual field)
  - Validation on Continue button (blocks navigation if errors)
  - Error messages displayed below each invalid field
  - Error styling (red border) on invalid inputs

  **Server-side validation (POST /api/public/quotes):**
  - Fetches widget_configs for tenant
  - Validates all required fields have values
  - Returns `VALIDATION_ERROR` with field names if missing

  **Progress indicator:**
  - Shows step progression (Service -> Details -> Contact)
  - Highlights current step with active styling
  - Shows checkmark for completed steps
  - Adapts to show 2 or 3 steps based on service count

  **Files modified:**
  - `apps/web/src/app/embed/[tenantKey]/page.tsx` - Added all field types, validation, progress indicator
  - `apps/web/src/app/api/public/quotes/route.ts` - Added server-side required field validation (step 5)
  - `packages/widget/src/Widget.tsx` - Same updates for standalone widget
  - `packages/widget/src/types.ts` - Added new field types (textarea, radio, checkbox)
  - `packages/widget/src/styles.ts` - Added styles for progress, errors, radio/checkbox groups

  **Widget bundle size:** 34.60 kB / 11.30 kB gzipped