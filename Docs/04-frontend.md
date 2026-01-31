# /docs/04-frontend.md

## Deployment
Next.js deployed on Vercel. All frontend surfaces and API routes are served from Vercel.

## Frontend surfaces
### 1) Marketing site
Routes:
- /
- /pricing
- /how-it-works
- /industries (optional)
- /login
- /signup
- /legal/privacy
- /legal/terms
- /help (docs embedded here)

### 2) Dashboard (authenticated)
Routes:
- /app
- /app/onboarding
- /app/services
- /app/pricing
- /app/widget
- /app/branding
- /app/quotes
- /app/analytics
- /app/billing
- /app/settings

Key screens:
- Onboarding checklist with test mode
- Pricing rules editor
- Service area restrictions editor (postcode or zip, county or state)
- Widget config and embed code
- Quote template toggles and preview
- Quotes list with status and actions

### 3) Hosted quote page (public, no login)
Routes:
- /q/[quoteId]
- /q/[quoteId]/accept
- /q/[quoteId]/pay

Must be:
- Mobile first
- Fast
- Clear CTAs: accept, pay, contact
- Show optional sections based on tenant settings

## Embed modes
### A) JS snippet embed (default)
- Business pastes a script snippet.
- Script loads your widget bundle from CDN and mounts into:
  - floating button modal, or
  - inline container div

### B) iframe embed (supported)
- Business embeds an iframe pointing to a hosted widget URL:
  - /embed/[tenantKey]
- Useful for strict CSP or isolation.
- Communication via postMessage for resize and events.

## Widget UX requirements
- Minimal steps, 3 to 8 questions typical
- Photo and document upload
- Progress indicator
- Basic client side validation
- Submit shows queued status and confirms quote delivery

## Globalization
- Currency and tax label displayed based on tenant settings.
- Avoid UK specific language in UI. Use generic tax label field.