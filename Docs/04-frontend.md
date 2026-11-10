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
- /app/onboarding (T-150: where a new business with no services lands)
- /app/services
- /app/pricing
- /app/share (T-149; /app/widget redirects here)
- /app/branding
- /app/quotes
- /app/analytics
- /app/billing
- /app/settings

Key screens:
- Onboarding checklist with test mode
- Pricing rules editor
- Service area restrictions editor (postcode or zip, county or state)
- Share: quote link, QR code, ready-made share texts, embed code, form fields (Advanced)
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

### Setup (T-150, /app/onboarding)
Signup (`/signup?plan=<id>` from the pricing page keeps the plan) → email verification → `/app`, which sends a
business with no services to setup until it has one or presses "Skip". Steps:
1. "What kind of work do you do?" — the region's trade templates as large options, plus "Something else" (free text).
   A template goes to its services; "Something else" goes to "Read my website / I'll describe it".
2. Tick services; price any unpriced ones in plain English.
3. "Check your prices" (every path): each priced item, extras, adjustments ("Attic: +12%"), minimum charge and base
   fee, all editable in place; template rates carry "These are typical starting prices. Change them to yours.";
   "These are my prices" to continue; "Describe a change in plain English" per service. No engine terms.
4. Basics (currency, tax, service area), then the services are created.
5. Guided test: "Try it as your customer" opens /quote/[slug] in test mode; the estimate appears inline with
   "Approve & send"; then the quote link with Copy and "Go to dashboard". Test requests aren't counted.

### 4) Business quote page (public, no login, T-149)
Routes:
- /quote/[slug] (e.g. /quote/sunbelt-painting)

The main way to go live: a readable link and QR code a business shares on its Google profile, social bio,
email signature and text replies, with no website needed. Renders the same widget as /embed/[tenantKey]
(one implementation, `components/embed/EstimateWidget.tsx`), full screen, with the tenant's logo, name,
tagline, colour and the white-label "Powered by" rule. Unknown or inactive → plain 404; a former slug → 308.

## Embed modes
### A) JS snippet embed (second option since T-149)
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