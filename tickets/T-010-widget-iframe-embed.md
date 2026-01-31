# tickets/T-010-widget-iframe-embed.md

## Goal
Support iframe embedding as an alternative.

## In scope
- Hosted widget route: `/embed/[tenantKey]`
- Auto-resize via postMessage
- Basic origin restrictions and tenantKey validation

## Out of scope
- Deep CSP troubleshooting

## Acceptance criteria
- [x] iframe embed works on a sample page
- [x] iframe resizes to content height

## Completed
- 2026-01-25: Widget iframe embed implementation complete
  - Created `/embed/[tenantKey]` page (`apps/web/src/app/embed/[tenantKey]/page.tsx`):
    - Full widget functionality (service selection, details, contact, submission)
    - PostMessage-based height resizing with ResizeObserver
    - Sends `estimator-resize` message when content height changes
    - Sends `estimator-submitted` message when quote is submitted
    - TenantKey validation via existing widget config API
    - Clean, minimal styling optimized for embedding
  - Created `iframe-loader.js` (`apps/web/public/iframe-loader.js`):
    - Lightweight loader script (~1KB)
    - Auto-initializes from script tag data attributes
    - Exposes `EstimatorIframe.init()` API for manual initialization
    - Handles resize messages from iframe
    - Dispatches `estimator:submitted` custom event on quote submission
    - Origin validation for security
  - Updated demo page (`apps/web/src/app/demo/page.tsx`):
    - Added iframe mode as recommended (default) option
    - Preview all three modes: iframe, floating, inline
    - Shows correct embed code for each mode
    - Iframe mode works without building the widget package
  - Embed code example:
    ```html
    <div id="estimator-widget"></div>
    <script
      src="https://your-domain.com/iframe-loader.js"
      data-tenant-key="tkey_xxx"
      data-container="#estimator-widget"
      async
    ></script>
    ```