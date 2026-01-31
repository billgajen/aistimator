# tickets/T-009-widget-embed-js-snippet.md

## Goal
Implement JS snippet embed for the widget (default embed mode).

## In scope
- Generate embed snippet in dashboard using tenantKey
- Widget loader script hosted from your domain
- Mount modes:
  - inline in a div
  - floating button that opens modal
- Local dev demo page within marketing site

## Out of scope
- iframe mode (T-010)
- Complex styling customization

## Acceptance criteria
- [x] Copy-paste snippet renders widget on a page
- [x] Widget can open and close reliably
- [x] TenantKey is required and validated server-side

## Completed
- 2026-01-25: Widget embed JS snippet implementation complete
  - Created `packages/widget` - standalone Preact-based widget (29KB / 10KB gzipped)
  - Widget loader (`src/loader.tsx`):
    - Auto-initializes from script tag data attributes
    - Exposes `window.EstimatorWidget.init()`, `.open()`, `.close()` API
    - Injects scoped CSS to avoid conflicts with host page
  - Mount modes:
    - **Floating**: Shows button (configurable position), opens modal on click
    - **Inline**: Renders directly in a specified container
  - Widget component (`src/Widget.tsx`):
    - Multi-step form: Service selection -> Job details -> Contact info -> Success
    - Responsive design (mobile-friendly modal slides up from bottom)
    - Loading, error, and success states
    - Form validation
  - API endpoint `GET /api/public/widget/config`:
    - Validates tenantKey against tenant_sites
    - Returns tenant name, active services, form fields
  - Demo page at `/demo`:
    - Test widget with any tenant key
    - Preview embed code for copy-paste
    - Supports both floating and inline modes
  - Embed code example:
    ```html
    <script
      src="https://your-domain.com/widget.js"
      data-tenant-key="tkey_xxx"
      data-mode="floating"
      async
    ></script>
    ```