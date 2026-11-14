# /docs/04-frontend.md

## Deployment
Next.js deployed on Vercel. All frontend surfaces and API routes are served from Vercel.

## Frontend surfaces
### 1) Marketing site
Home page (T-154), top to bottom: hero ("Instant quotes on your website, in your prices.", sub-line, "Try it free: 10
quotes, no card" + "Try it as a customer", and a three-frame strip drawn from our own UI with the demo business's
branding) · trades row from the pack registry + "Other trades" · How it works (3 steps) · "Your prices. You stay in
control." · What homeowners want (three statistics in their sources' words, each linked) · Add it anywhere · plans
from `plans.ts` · FAQ · "Who is behind this" (only when `lib/marketing/founder.ts` is filled in) · final call to action.
The line under the hero buttons: "For contractors and home-service businesses. No website? Use your quote link." (trade
pages keep their own line). Copy lives in `lib/marketing/home-copy.ts`. Trade pages use the same hero with a
trade-specific strip priced from the pack (`lib/marketing/examples.ts`); the three frames are one height, with each
button just under its content. Marketing copy rules: no grades, no engine words, no "exact", no time promises ("60
seconds", "in a minute"), no confirmed-quote-in-seconds, nothing not live for a new business (a unit test scans every
page).

Header and phone menu (T-155): below `md` the header button reads "Try it free" on one line; from `md` up, and on every
in-page button, "Try it free: 10 quotes, no card". The phone menu (`MobileMenu`) opens full screen over the page (a
modal dialog, the page behind locked from scrolling), with Features, Pricing, Trades, Try it as a customer, Log in and
one "Try it free: 10 quotes, no card" button. It closes on a link, the X or Escape, and focus goes back to the menu
button (on the next page's button after a link).

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
Menu (T-160, AD-044), in three sections, the same on desktop and in the phone menu:
- **Work:** Home · Quotes · Unfinished requests (with a count of new ones) · Analytics
- **Set up:** Services · Quote link · WhatsApp
- **Account:** Settings

Routes:
- /app (Home)
- /app/onboarding (T-150: where a new business with no services lands)
- /app/quotes (`?tab=needs_you|waiting|accepted|closed|all` opens a tab; `?filter=unfinished` opens the Unfinished
  tab, which is where the menu's "Unfinished requests" goes. The address follows the tab.)
- /app/services (T-160: "Services"; it was "Prices" at /app/prices, which redirects here)
- /app/quote-link (T-160: "Quote link", "Give customers this link, or put the form on your website."; it was
  "Share" at /app/share, and before that /app/widget; both redirect here)
- /app/settings (one area with tabs: Business · Branding · Billing · Notifications)
  - /app/settings/branding (was /app/branding, which redirects here)
  - /app/settings/billing (was /app/billing, which redirects here)
  - /app/settings/notifications (the field is "Send notifications to")
- /app/analytics, /app/whatsapp (in the menu since T-160)
- /app/sms (no menu item; reachable by URL, behaviour unchanged)

Unfinished requests (T-151, T-160): people who gave their details and did not finish. The list (the Unfinished tab)
shows everyone from the last 30 days who is not marked done. Opening it marks them seen: the Home banner and the
menu badge count only people not seen yet, so both clear and come back only for a new person, who is tagged "New".
"Done" on a person removes them for good.

Home, top to bottom (T-152, T-160):
1. "Waiting for you": what waits for the owner, newest first (not a test, not a held lead). Quotes awaiting approval
   (priced) show customer, service, price and Approve & send. T-158: customer questions ("Customer asked a question",
   button "Answer question") and requests that could not be priced ("Could not be priced", button "Contact customer")
   are listed too, with the labels the quotes list uses; their button opens the quote. The count reads "3 need you".
   Hidden when empty.
2. New unfinished requests: "2 new people started a request but didn't finish. A quick call often wins the job."
   with "See who". Only people the business has not seen; hidden when there are none.
3. Plan usage banner at 80% / at the limit (the free allowance says "free quotes", not "monthly").
4. Setup checklist until complete: Add a service · Check your prices · Share your quote link · First real request
   received. Each ticks only on a real action (`lib/setup-checklist.ts`). Branding is not a step; the Branding tab
   shows a tick when a logo or a non-default colour is really set.
5. "Where your quotes stand": three counts, each opening its tab: Needs you · Waiting for customer · Accepted
   ("in the last 30 days"). The groups and names are the T-158 ones.
6. "Latest activity": the last six events, newest first, each linking to its quote, for example "Sarah opened the
   quote, 2 hours ago". Six kinds: sent a request, you approved, opened, asked a question, accepted, declined. Read
   from the quotes' own timestamps; last 30 days.
7. "Your quote link": the link with Copy and Open, and "QR code and website form" to the Quote link page. Beside
   Latest activity on a wide screen, under it on a phone.
8. "Last 30 days": requests, estimates sent, accepted, value accepted, each with "up 3", "down 1" or "same" against
   the 30 days before. "See all numbers" → Analytics.

A business with no quotes yet sees one line in 5 ("No quotes yet. When a customer sends a request, you will see here
whose turn it is.") and in 6 ("Nothing has happened yet. New requests, opens and answers will show here."), and the
four numbers without a change line. Setup tests are in none of the counts. On a phone everything is one column in
this order; the three counts stack and the four numbers sit two by two.

Sign-in and sign-up (T-160) show the home page's headline under the product name (`HERO.headline` in
`lib/marketing/home-copy.ts`), so they always match the home page.

Quote link page (T-149 + T-152; "Share" until T-160): quote link · QR code · where to put it · **Use it on WhatsApp** ("Send on WhatsApp" via
wa.me with the link; greeting, away and quick-reply texts for the WhatsApp Business app with where to paste them;
"Connect your WhatsApp number for full in-chat quoting (advanced)" → /app/whatsapp) · embed code · Advanced.

Whose turn it is (T-158, AD-043). The dashboard never shows a raw status. `quoteTurn` in
`packages/shared/src/quote-turn.ts` turns a quote into a group, a label, a detail line and one next step; the quotes
list, the quote page and Home all use it, and every word of it lives in that file.

| Group | Statuses | Label | Detail line | Next step |
|---|---|---|---|---|
| Needs you | pending_review, priced | Needs your approval | Received 2 days ago | Check and approve |
| Needs you | pending_review, no price | Needs your approval | No price yet | Add the price |
| Needs you | pending_review, held by the plan limit | Saved, not priced yet | Your plan limit was reached | Price this request |
| Needs you | feedback_received | Customer asked a question | Waiting for your answer | Answer question |
| Needs you | failed | Could not be priced | Received 2 days ago | Contact customer |
| Waiting for customer | sent | Waiting for customer | Sent 2 days ago, not opened yet (or "not opened since" when it was opened before the last send) | none; after 3 days unopened: Send again (Contact customer when there is no email) |
| Waiting for customer | viewed | Waiting for customer | Opened yesterday | none |
| Waiting for customer | revised | Waiting for customer | Updated quote sent yesterday | none |
| Waiting for customer | awaiting_clarification | Waiting for customer | Waiting for their answers | none |
| Accepted | accepted | Customer accepted | Accepted on 12 Nov | Contact customer |
| Accepted | paid | Paid | Paid on 14 Nov | none |
| Closed | declined | Customer declined | Declined on 12 Nov | none |
| Closed | expired | Expired | Expired on 12 Nov | Send again (Contact customer when there is no email) |
| Working | queued, generating | Working out the price | Received today | none |

Time words: today, yesterday, "2 days ago" up to 6, then "on 12 Nov", by calendar day in the viewer's time zone.

Quotes list (/app/quotes, T-158):
- Tabs with counts instead of a status dropdown: Needs you · Waiting for customer · Accepted · Closed · Unfinished ·
  All. Opens on Needs you when it has any, otherwise All. Unfinished is the T-151 list ("Working" has no tab; it shows
  under All). The tab row scrolls sideways on a phone. One request (`GET /api/quotes?group=…`) returns the rows and
  every count; the counts follow the search box.
- Each row: customer (with the "Test" tag), service, total, the label with its detail line, and one worded Next step
  button. "Send again" sends in place; every other button opens the quote.
- "More" on each row, with words: Open quote, Send again, Copy link, Download PDF, Pricing trace, each shown by the
  T-157 rule its route applies. No icon-only actions.
- A grid from the `xl` breakpoint; below it each row stacks.

Quote page (/app/quotes/[quoteId], T-158):
- Header: the label, then Edit, Send again, Copy link and Text link by the T-157 rules.
- "Next step" box: one sentence and one main button from the shared map. Approve & send (awaiting approval), Edit
  quote (no price yet), Price this request + Upgrade plan (held by the plan limit; this replaced the "Lead saved"
  box), Send again (unopened for 3 days, or expired), Email and Call links (accepted, a customer question, could not
  be priced; each only when the detail exists), or no button with "Nothing for you to do. Waiting for …". A button
  that is the next step is in the box and not in the header as well.
- An open customer question, with "Mark as answered", sits directly under the box.
- "Progress": four steps replacing the timeline. Request received · You approved (or "Sent automatically" for a
  service that sends without review) · Customer opened · Customer accepted. Done steps show their date; "Customer
  declined" or "Expired" is the final step instead; "Paid <date>" is a second line under step four. Steps stack on a
  phone.

Key screens:
- Home setup checklist (T-152) and the guided test in setup (T-150)
- Pricing rules editor
- Service area restrictions editor (postcode or zip, county or state)
- Quote link: quote link, QR code, ready-made share texts, embed code, form fields (Advanced)
- Quote template toggles and preview
- Quotes list with tabs, the whose-turn label and one next step per row (T-158, above)

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
- Quote page wording (T-158): once the business has reviewed it, the page already says "Your quote", and now the
  decision does too: "Accept this quote — …", "Quote accepted", "Quote declined", "No longer need this? Decline this
  quote", "Decline this quote" / "Keep the quote" / "Decline quote". A quote sent automatically (not reviewed) keeps
  "estimate" in every one of them. The words come from `customerDecisionWords` in the shared map.
- Minimal steps, 3 to 8 questions typical
- Photo and document upload
- Progress indicator
- Basic client side validation
- Submit shows queued status and confirms quote delivery

## Globalization
- Currency and tax label displayed based on tenant settings.
- Avoid UK specific language in UI. Use generic tax label field.