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

Try it as a customer (T-153, /demo): every "Try the live demo" button and the footer "Widget demo" link now read
"Try it as a customer" and open /demo. The page (marketing layout, phone first): heading, one line, a note that
Example Home Services is an example business with example prices, then the real widget (`EstimateWidget` with its
`demo` option — no second widget):
- contact pre-filled with fake details (Sam Sample, sam.sample@example.com, (555) 010-0199) and "These are example
  details. No email or text will be sent to anyone.";
- "Use a sample photo" on the photo step (the drawn label in `public/demo/`, through the normal upload);
- when priced, the estimate on the same page, then "What the business sees" (a static new-lead card with Approve &
  send) and "Try it free: 10 quotes, no card";
- over the demo's limits, a recorded example estimate with the same signup button.
/demo?tenantKey=… keeps the old developer view (the Share page links there).

Free offer (T-152): every "Start free" now reads "Try it free: 10 quotes, no card" (`freeOfferLabel()` from
`packages/shared/src/plans.ts`). The free allowance is 10 priced quotes **in total** (it never resets); the pricing
FAQ ("Can I try it for free?") and the billing page say the same.

### 2) Dashboard (authenticated)
Menu (T-152), desktop and phone: **Home, Quotes, Prices, Share, Settings**.
Routes:
- /app (Home)
- /app/onboarding (T-150: where a new business with no services lands)
- /app/quotes
- /app/prices (was /app/services, which redirects here)
- /app/share (T-149; /app/widget redirects here)
- /app/settings (one area with tabs: Business · Branding · Billing · Notifications)
  - /app/settings/branding (was /app/branding, which redirects here)
  - /app/settings/billing (was /app/billing, which redirects here)
  - /app/settings/notifications
- /app/analytics (no menu item; "See all numbers" on Home)
- /app/whatsapp, /app/sms (no menu item; reachable by URL, behaviour unchanged; WhatsApp is reached from Share)

Home, top to bottom (T-152):
1. "Waiting for you": quotes awaiting approval (priced, not a test, not a held lead), newest first, each with
   customer, service, price and Approve & send. Hidden when empty.
2. "Started, didn't finish": the 7-day count (T-151). Hidden when zero.
3. Plan usage banner at 80% / at the limit (the free allowance says "free quotes", not "monthly").
4. Setup checklist until complete: Add a service · Check your prices · Share your quote link · First real request
   received. Each ticks only on a real action (`lib/setup-checklist.ts`). Branding is not a step; the Branding tab
   shows a tick when a logo or a non-default colour is really set.
5. Four numbers for the last 30 days: requests, estimates sent, accepted, value accepted. "See all numbers" → Analytics.

Share (T-149 + T-152): quote link · QR code · where to put it · **Use it on WhatsApp** ("Send on WhatsApp" via
wa.me with the link; greeting, away and quick-reply texts for the WhatsApp Business app with where to paste them;
"Connect your WhatsApp number for full in-chat quoting (advanced)" → /app/whatsapp) · embed code · Advanced.

Key screens:
- Home setup checklist (T-152) and the guided test in setup (T-150)
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
4. Basics (currency, tax, service area, and an optional logo, T-152: the same upload as Settings → Branding),
   then the services are created.
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
- T-151 order (form and chat, quote link and embed): service → contact ("Where should we send your estimate?",
  name + email/phone per the business's setting, region phone example and hint, one privacy line) → the service's
  own questions → photos → last step (ZIP or postcode, and a description that is optional when the service has
  questions) → submit. The request is saved as soon as the contact step is done ("Started, didn't finish" on the
  quotes list until submitted). The full address is asked on accept.
- Quote page: Accept asks "When suits you?" (as soon as possible / within two weeks / flexible + note), the job
  address and a phone number, then accepts. Ask a question and the quiet Decline link stay; no "Send for review";
  errors are shown in the page (no browser alerts).
- Minimal steps, 3 to 8 questions typical
- Photo and document upload
- Progress indicator
- Basic client side validation
- Submit shows queued status and confirms quote delivery

## Globalization
- Currency and tax label displayed based on tenant settings.
- Avoid UK specific language in UI. Use generic tax label field.