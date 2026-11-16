# /docs/04-frontend.md

## Design system (T-164, AD-046)
`Docs/design/system.md` decides colour, type, shape, imagery, layout and motion. Read it before any UI work; the three
design skills only advise. The tokens are in `apps/web/src/app/globals.css` and `apps/web/tailwind.config.ts`, and a
unit test (`design-tokens.test.ts`) holds their contrast ratios and the source rules.

- **/design** (not linked, noindex): the tokens and the real components as they render: the palette, the wordmark,
  the type, radius and shadow scales, the five status colours, a sample marketing band, a sample dashboard row and
  the motion tokens. T-165: the owner chose yellow and the text wordmark, so the accent switch and the second
  wordmark are gone.
- **Status colours** are by whose turn it is (`lib/status-tone.ts`): needs you = the strong yellow with a small dark
  marker (T-165; never a pale tint), waiting and working
  = neutral, accepted = green, closed = grey, failed = red. Butter is for measurement only.
- **Focus:** one ring colour (`--color-focus`): ink on light grounds, light inside a juniper or brand-coloured
  surface. Controls that draw their focus with Tailwind's `ring` use the same colour.
- **Fields and outlined controls** have an edge of 3:1 (`border-field`; a CSS rule lifts every field and outlined
  button still written with `border-border`).
- **Motion:** tokens `--motion-*` and `--ease-*`, classes `motion-press`, `motion-menu` and `animate-fade-in-up`. The
  dashboard has no entrance animation. One global rule stills everything under reduced motion. The customer quote page
  waits with the tape rule being drawn, not a pulse.
- **One radius scale** (`rounded-sm` 4 to `rounded-3xl` 20, `rounded-full`); there is no bare `rounded` and no
  `rounded-warm-*`.
- No raw Tailwind palette colour and no opacity modifier on a colour token (it writes no CSS); both are tested.

## Deployment
Next.js deployed on Vercel. All frontend surfaces and API routes are served from Vercel.

## Frontend surfaces
### 1) Marketing site
**The message (T-167):** "The AI works out the job. Your prices work out the cost." The site used to say only what
the AI does not do (set prices). It now says what it does, and shows it on real screens. Every such sentence is
written through `says(…)` (`lib/marketing/ai-claims.ts`) and rests on a row of `Docs/design/ai-capabilities.md`,
the list of what the AI really does today; a unit test fails on a claim with no matching row, and on a trade page
that claims what its template does not do. The words "AI" and what it does are typed only in the copy files
(`lib/marketing/home-copy.ts`, `features-copy.ts`, `trades.ts`, `site-copy.ts`), never in a component.

Home page (T-165, reordered in T-167; `Docs/design/system.md` decides the look), top to bottom, one idea per
section, and no two neighbours sharing a layout or a background:
1. **Hero** (paper): "Instant quotes on your website, in your prices.", then one line on what the AI does and where
   the price comes from, the one yellow button ("Try it free: 10 quotes, no card") and a quiet "Try it as a
   customer". Under it the **product demo** (`HeroDemo`, T-168): **three frames of the same height, side by
   side, one idea each**, built from the product's own parts in the example business's colour. 1 "Your customer
   asks": one question with its answer and "Get my estimate". 2 "They see your price": a short estimate (a line
   or two and the total) and the locked Accept. 3 "You confirm it": "Waiting for you" with one lead, its price and
   "Approve & send". It plays once on load (the answer, the tape rule and the price, the lead), about 3.4 seconds,
   then stands still on those three frames, with "Play again". Reduced motion shows the finished frames. On a
   phone the frames stack, still one height. The label-reading step T-167 added is no longer in the hero; "What
   it notices" shows it.
   **The hero photograph (T-168):** a painter on a porch checking a phone, a scene photograph made with an image
   model (`HeroPhoto`, `lib/marketing/hero-photo.ts`, `public/photos/hero-b-*.webp`, styles in `globals.css`;
   the record is `Docs/design/photos.md`). **At every width it is behind the band, never a block of its own
   above the headline (T-170).** From 768 px it is the band's full-width background, fading into paper on the
   left under the words, with the painter on the right and the three frames half on it; below 1280 px the words'
   column is narrower (24rem, then 30rem) and the headline one step smaller, so the fade behind them is
   stronger. Under 768 px it fills the top of the band (24rem) and fades down into paper; the headline starts
   over the faded part and is on the first screen at 390 x 844. It has fixed dimensions and loads with high
   priority.
2. **What homeowners want** (grey): three large figures in three columns side by side (the figure, the short line
   under it, then its linked source), one column on a phone (T-168; T-167 had them one to a row).
3. **What it notices** (paper): the message line and four examples, each beside the real screen where the result
   appears (`WhatItNotices`): a label read and confirmed, walls measured from photos, an extra added from the
   customer's own words, a range and one question. No icons. Nothing moves.
4. **Your prices. You stay in control.** (mint): a plain-English price sentence and the price list it becomes (the
   page's one moment, `PriceSentence`), then the three control points in one column. Two prices, two lines. A
   minimum charge is never one of the lines: it is a floor, not an item.
5. **Set up in minutes** (paper): choose your trade, check your prices, share your link, each beside its screen,
   alternating sides. **The links to the trade pages are pills under step 1**, on a line that wraps, ending with
   "Other trades: describe your prices in plain English". (They were a row of their own under the hero.)
6. **Add it anywhere** (grey; redrawn in T-170, `AddItAnywhere`): three columns of one height, aligned at the
   top, each with a 5:8 picture of the same size (from 1024 px; from 640 px each is a row of words and picture;
   stacked on a phone). The pictures: **the real QR code on the side of a van** (the van is a scene photograph;
   the code, the business's name and "Scan for an estimate" are ours, placed on the van's panel in code); the
   quote page **in a phone-shaped frame**, with the business's name on one line and the link, short, in its
   address bar; and the same form on a business's website. A link is shown through `ShortLink`: no "https://",
   wrapping only after a slash.
7. **Plans** (paper) from `plans.ts` through `sitePlans()` (T-170: two today), each card with its own
   "Choose <plan>" button.
8. **Questions** (grey), a narrow column.
9. **Who is behind this** (only when `lib/marketing/founder.ts` is filled in).
10. **The closing band** (juniper): the heading, the one yellow button and the quiet link, on the left. T-170: an
    evening photograph is the band's right-hand side, fading into juniper (`ScenePhoto`, `CLOSING_PHOTO`); under
    768 px it fills the top of the band and the words start over its faded part. The words are light, on solid
    juniper. It loads without priority.
10. **The closing band** (juniper): one yellow button and one quiet link.

Features (T-167): leads with the message line and follows the product's five steps, each with its real screen in
place of four text boxes, no two neighbours laid out alike: 01 Ask (the form on a phone), 02 Read the job (a photo
and what was read from it), 03 Price (a price sentence and the list it becomes), 04 Confirm (the customer's quote
page), 05 Track (Home's numbers for the last 30 days; it was "Learn", which claimed more than is live). One yellow
button in the hero and one in the closing band.

Trade pages (`TradeLanding`, T-167): the hero's right half is that trade's own request form (its template's own
question) and, where the template reads a label or measures from photos, what is read for it. "How the price is
set" is three steps, each on its real screen, alternating sides (it was three grey cards). A page claims only what
the AI does for its trade: label reading on water heaters, HVAC and electrical; wall area from photos on painting;
neither on plumbing or garage doors. The one photograph of a label is the sample tank label we ship; any other
label is named in the form ("Rating plate · 1 photo added"), not drawn. The main button is yellow.
**T-170:** each trade page's hero has a scene photograph of that trade's work behind it (`TRADE_PHOTOS` in
`lib/marketing/photos.ts`: a painted house front, an outdoor unit, a tank in a garage, a plumber at a sink, an
electrician at a panel, a garage door), treated as Home's hero is. Under 768 px it fills the top and the words
start over its faded part; from 768 px it is behind the words and ends 8rem below them, with the trade's screen
5.5rem on it; from 1024 px it is the right-hand 60% of the band's top (so the whole scene shows), the screen sits
under it and 6rem on it, beside the words, and the words are centred against the two.

Product screens on marketing pages are built in `components/marketing/screens/ProductScreens.tsx` from the real
screens' markup, with the real screens' words (`lib/marketing/screen-words.ts`, checked against the product's
source by a unit test) and the trade templates' own questions, labels and prices (`lib/marketing/examples.ts`).
The old three-frame strip (`ProductStrip`) is no longer on any marketing page; only `/design` still shows it.

Pricing (T-167): "Hosted estimate pages" and "Your branding on every estimate" link to the live demo. The plan
line "Website widget & AI chat" is "Website widget" (the chat form is not offered to businesses).
**T-170:** which of a plan's lines a business can use today is in `lib/marketing/plan-claims.ts` (the list, with
what was found for each, is `Docs/design/ai-capabilities.md` section 7). A line that is not live yet is shown
after the live ones with a hollow mark and "Coming later": text messages, WhatsApp quoting, the on-site app,
LiDAR, team members, priority support. The page's own taglines and lead say only what is live, and "Most
popular" is "Recommended". **The public pages show a plan only once one of its own lines is live** (`sitePlans()`,
the owner's decision): today Starter and Pro, as a centred pair, on Pricing and in Home's plan cards. Business is
defined and sold as before; it is only not shown.

**Customer pages (T-171).**
- *The request form* (`components/embed/EstimateWidget.tsx`, steps in `components/embed/steps/`): edge to edge
  on a phone; the business's name is an `h1` on the quote link page (`StepTitle`, `StepHeadingLevel`); the step
  bar is "Step 3 of 5" under 640 px; a question with two to five choices is rows to tap (`usesTapRows`); a
  required field says "(required)" (`RequiredMark`). On the photo step an item of "Photos that help" is ticked
  only when the customer taps that item and adds a photo for it; the general "Add a photo" opens the same picker
  with no item, so its photo counts toward the total only.
- *The finished screen* opens no new tab. On the quote link page the customer is moved straight into the
  question or the estimate (`window.location.assign`). Inside a business's page it shows the estimate itself
  (total and lines, from the poll that watches for it) and "View your estimate" replaces the page
  (`target="_top"`). On `/demo` the page shows the estimate under the form.
- *The question page* (`app/q/[quoteId]/clarify`): a label reading is asked as one sentence, "We read 50 gal
  from your tank's rating label. Is that right?" (`readingQuestion` in `lib/customer-read.ts`); the words read
  off the label are not shown. It says "estimate".
- *The quote page* (`app/q/[quoteId]`): no status pill; the price panel's words are the on-colour at full
  strength; "Measurement & takeoff" shows only what was read or measured, as sentences from the API's `read`
  field, with no amounts (the takeoff's rows are no longer drawn); the accept form is scrolled to and focused;
  the accepted block arrives once (250 ms) with "What happens next" in three steps. A business has no setting
  for those three steps yet, so the words are ours, with its name and what the customer just told it.

**The form's step count (T-172).** The Questions step exists only for a service that asks something. Before a
service is chosen the form counts it only when every service has one (`components/embed/step-count.ts`,
`questionsSpread`): every service has questions, or none has, and the first step shows the true total ("Step 1 of
5", or the numbered row with Questions in it). When some services have questions and some do not, the first step
shows only its name ("Service"): no "Step 1 of", no bar parts, no numbered row, also after the customer comes
back to it with a service chosen. The count starts on the second step. A form with one service has no such step.

**Small photo copies (T-172).** When a customer adds a photo, the browser makes a copy at most 480 px on its
longest side (a canvas, WebP or JPEG, no library: `lib/small-photo-client.ts`) and uploads it beside the original.
Small pictures ask for `?size=small`: the quote page's photo grid, the dashboard's photo strip and the 48 px photo
on a list row. The larger view and the photo's own link are the original. The server checks the copy in storage
before serving it and falls back to the original (`lib/small-photo-server.ts`). A failed copy never fails the
upload, and the upload waits at most 15 seconds for it.

**Billing (T-171):** a plan's lines on `/app/settings/billing` are `planLines()` from
`lib/marketing/plan-claims.ts`, the list the public Pricing page reads, so a line that is not live says "Coming
later" on both. Every plan on offer can be chosen there, Business included.

**Login, sign-up, header and footer (T-171):** fields are 44 px tall with a visible edge; "Sign up" and "Log in"
are underlined semibold links 24 px tall; header and footer links are at least 24 px tall on a computer.

`/demo` (T-170): "Use a sample photo" adds the photo that matches the chosen service (`lib/demo/sample-photos.ts`,
by service name): the rating label drawn for T-153, the springs above a garage door, a room from its doorway. A
service with no sample has no button.

Copy lives in the files above; the buttons in `lib/marketing/cta.ts` (`MAIN_CTA` is the yellow one: one per
screen). Still screens are pictures to a screen reader (`role="img"` with a description). Marketing copy rules: no
grades, no engine words, no "exact", "firm" or "guaranteed", no slogan ("AI-powered"), no promise of accuracy, no
time promises ("60 seconds", "in a minute"), no confirmed-quote-in-seconds, nothing not live for a new business,
and never that the AI sets a price (unit tests and `verify-t167` scan every page).

**One free offer (T-165):** 10 priced quotes free, no card. No plan has a trial; a plan is paid from the day it is
chosen. No page says "trial".

Every marketing page starts with a "Skip to content" link, and footer links are 44 px tall on a phone. The wordmark
is the name in the display font, drawn by one component (`components/brand/Wordmark.tsx`).

Header and phone menu (T-155, T-165): the header button reads "Try it free" on one line at every width (T-165; from
`md` up it used to carry the full offer). Every in-page button reads "Try it free: 10 quotes, no card". The phone menu (`MobileMenu`) opens full screen over the page (a
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
   (priced) show customer, service, price and Approve & send. T-169: a row shows one small photo (48 px) when the
   customer sent any. T-158: customer questions ("Customer asked a question",
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
   the 30 days before. "See all numbers" → Analytics. T-169: the words carry a mark that is a shape (a triangle
   pointing up or down, a short bar for "same"), so the direction never rests on colour, and a figure with anything
   in either period has a small line under it (`components/home/Sparkline.tsx`): the last 60 days in 5-day steps,
   the 30 days before in grey and the last 30 in juniper, starting at zero. It is hidden from screen readers, who
   get the twelve numbers as a sentence. Nothing moves.

A business with no quotes yet sees one line in 5 ("No quotes yet. When a customer sends a request, you will see here
whose turn it is.") and in 6 ("Nothing has happened yet. New requests, opens and answers will show here."), and the
four numbers without a change line. Setup tests are in none of the counts. On a phone everything is one column in
this order; the three counts stack and the four numbers sit two by two.

Sign-in and sign-up (T-160) show the home page's headline under the product name (`HERO.headline` in
`lib/marketing/home-copy.ts`), so they always match the home page. T-165: at desktop width the login page shows a real estimate
document (`EstimateSheet`) beside the form; sign-up keeps one column. The email field has `autocomplete="email"`.

Services (T-169): each service is a row that stacks on a phone, so Edit, Disable and Delete are always on screen
(the table cut its last columns off at 390 px, and the page scrolled sideways). Delete sits apart from the other
two, behind a rule, and is the only red one. Each of the three names its service for a screen reader. The page
header's actions wrap under the title on a narrow screen (`components/ui/PageHeader.tsx`, every dashboard page).

Tap targets (T-169, `system.md` Layout): on a phone the controls of Home, Quotes, the quote page, Services and
Quote link are 44 px tall or more, and no control anywhere on them is under 24 px. Icon-only buttons have names
(the back arrow, the form builder's move, remove and dismiss buttons).

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

Quote page (/app/quotes/[quoteId], T-158; one order since T-169). Top to bottom: **the next step** (white, the
one main button), **what Qolumns understood** (on mist, with the customer's photos), **the price** (white; the
total first, in the mono figure at 36 px, then the lines, the grade), then **the rest** in one quiet card divided
by rules (progress, scope, assumptions, exclusions, notes, business notes, customer, versions) and the final
invoice. It was eight grey boxes of the same weight.
- **"What Qolumns understood"** (T-169, `components/quotes/UnderstoodPanel.tsx`; the lines are built on the server
  by `lib/quote-understanding.ts` from what the pipeline stored for that quote). It lists only what the AI
  produced: a label it read with the words it read ("From the tank's rating label: 50 gal", "It read “CAPACITY 50
  U.S. GAL” in photo 1."), a quantity measured from the photos, a note about what the photos show; an extra picked
  up from the customer's words ("Added at your price."); work the customer may also need, with no price; the
  question the customer was asked and their answer. The quote checker's findings can show under "Worth checking",
  with "An automatic check noted these. It changed nothing on the quote." (AD-049), but **that group is switched
  off** (`SHOW_WORTH_CHECKING` in `lib/quote-understanding.ts`) until the checker is told the business's minimum
  charge, base fee, tax and currency. No line carries an amount of the AI's (AD-001). **When the AI produced nothing there is no panel**, no heading and no empty state.
- **The customer's photos** (T-169, `components/quotes/CustomerPhotos.tsx`) sit at the top of the panel (on their
  own when there is no panel): small pictures, each a named button, that open larger in the browser's modal dialog
  (focus held inside, Escape closes, focus returns, arrow keys and two buttons move between photos). A photo's
  address is `/api/quotes/:quoteId/photos/:assetId`, which needs the business's sign-in and redirects to a signed
  address that lasts five minutes. The quotes list and Home's "Waiting for you" show the first photo at 48 px.
- Header: a named back arrow (44 px), the label, then Edit, Send again, Copy link and Text link by the T-157 rules.
- "Next step" box: one sentence and one main button from the shared map. Approve & send (awaiting approval), Edit
  quote (no price yet), Price this request + Upgrade plan (held by the plan limit; this replaced the "Lead saved"
  box), Send again (unopened for 3 days, or expired), Email and Call links (accepted, a customer question, could not
  be priced; each only when the detail exists), or no button with "Nothing for you to do. Waiting for …". A button
  that is the next step is in the box and not in the header as well.
- An open customer question, with "Mark as answered", sits directly under the box. What the customer sees while
  the quote waits for approval is a second line inside the box.
- "Progress": four steps replacing the timeline (the first part of "the rest" since T-169). Request received · You approved (or "Sent automatically" for a
  service that sends without review) · Customer opened · Customer accepted. Done steps show their date; "Customer
  declined" or "Expired" is the final step instead; "Paid <date>" is a second line under step four. Steps stack on a
  phone.

The minimum charge on a quote (T-165, AD-048). It is a floor, not an item. Every screen that lists a quote's price
lines reads the breakdown through `splitMinimum` and shows the job's real lines, then one note above the total,
"Minimum charge of $400.00 applied" (`components/quote/MinimumNote.tsx`; the business's own amount and currency).
Nothing shows when the job is at or above the minimum.
- Shown that way on: the customer quote page (/q/[quoteId]), the PDF, the dashboard quote page, the pricing trace
  (the step and the summary), the demo's estimate, setup's test quote, and the price preview in the service
  editor's "Test & Publish" step. Emails show the total only.
- Quote editor: the minimum is not an editable line. Under the lines: "Lines $375.00", the note with what it adds
  ("+ $25.00") and a "Remove" button, then Subtotal and Total. The figures update as lines are edited: below the
  minimum the subtotal stays at the minimum; at or above it the note goes and the subtotal follows the lines.
  "Remove" takes the minimum off that quote ("Undo" until saved); it stays removed afterwards, whatever is edited.
  A quote that carries no minimum shows none of this and never gains a minimum from an edit.

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
Public names of the embed code (T-162; `EMBED_NAMES` in `packages/shared/src/brand.ts`, mirrored by the two static
loaders): container id `qolumns-widget` · globals `QolumnsWidget` (widget.js) and `QolumnsIframe` (iframe-loader.js) ·
messages from the embedded page `qolumns-resize` and `qolumns-submitted` · the `qolumns:submitted` event on `document` ·
floating button `qolumns-floating-launcher` and overlay `qolumns-floating-overlay` · console prefix `[qolumns]`. The file
names `widget.js` and `iframe-loader.js` are unchanged.

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