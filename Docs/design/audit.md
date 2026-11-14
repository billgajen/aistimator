# Design audit (T-161)

What the three design skills say about the site, the dashboard and the customer pages as they are on
14 Nov 2026 (commit `898b81f`). **Nothing here has been changed.** Every finding is advice for a later ticket.
Our colours, fonts and tokens stay; where a skill wants to change them, that is listed separately, not applied.

How it was done:
- **Where:** the local stack (web, worker and Supabase with migration 39).
- **Test data:** made by `scripts/hardcore-test/verify-t160.mts` (57/57). That is a garage-door business,
  "Ridgeway Doors", with quotes in every state. On top of that, one real customer request ("Marlo Finch",
  a made-up name) was sent through its quote link, approved as the business, then taken to the Accept form.
- **taste (`design-taste-frontend`):** its review checklist (SKILL.md §5 and house rules), plus its own browser
  checker `consistency.mjs` run against the five marketing pages at 1440, 1024, 768 and 390. Our pages are its
  **software** kind.
- **design-motion-principles:** audit mode, terminal output. Weighting from its own table: the dashboard is a
  SaaS dashboard (Emil primary, Jakub secondary, Jhey only for empty states); the marketing and customer pages
  are marketing (Jakub primary, Jhey secondary, Emil for forms and nav).
- **ui-ux-pro-max:** its 120 UX rules (`references/quick-reference.md`) and its pre-delivery checklist
  (`references/pro-rules.md`), plus contrast ratios worked out from our tokens and a DOM sweep (tap sizes,
  unnamed controls, tiny text) of each screen at 390 and 1440.

Screenshots are in `Docs/design/screens/`: `mkt-*` for marketing, `dash-*` for the dashboard and `cust-flow-*`
for the customer. `-fold` is the first screen only. The widths are in the file names.

---

## 1. Marketing site: the ten most important findings

The taste checker (`consistency.mjs`, four widths) gave these totals:

| Page | FAIL | WARN |
|---|---|---|
| Home | 191 | 61 |
| Features | 149 | 29 |
| Pricing | 142 | 47 |
| Trade (painting) | 131 | 29 |
| Login | 24 | 9 |

Most of those come from its own house rules for layout: one section per screen (`section-height`, `one-section`),
and every block on one container line (`container-edges`, which counts the narrower FAQ and closing bands). Those
are taste's opinions about page rhythm, folded into finding 3 below rather than counted one by one. Its full
output was kept in the scratchpad, not the repo.

1. **The product is barely shown; most sections are words in boxes.**
   - This is the "boring" the owner feels.
   - On Home, the only picture is the three small drawn frames in the hero. The checker marks "How it works" and
     "Add it anywhere" as having no visual (`no-visual`), and "Your prices. You stay in control.", "What
     homeowners want" and the closing band as text only (`text-only`).
   - Features has five feature sections and not one screen or photograph.
   - taste, software kind: the page leads with the product's own UI at true size, in an app frame, plus real
     people.
   - `screens/mkt-home-1440.webp`, `screens/mkt-features-1440.webp`
2. **Every section is the same row of equal cards.**
   - Home is cards of three, three, three, four and three in a row. Features is text on the left with four boxes
     on the right, five times. The trade page is two rows of three cards.
   - Nothing changes shape from one section to the next, so nothing stands out.
   - Rules: taste "neighbours never share a layout"; ui-ux `visual-hierarchy`.
   - `screens/mkt-home-1440.webp`, `screens/mkt-features-1440.webp`, `screens/mkt-trade-painting-1440.webp`
3. **Sections are short and run into each other.**
   - The trades row is 174 px tall (0.2 of a screen).
   - Several screens show two or three sections at once.
   - On Features and the trade page the next section starts on the first screen (`hero-fill`).
   - taste's rule (each section one or two screens, the hero alone on the first) is stricter than we need, but the
     point stands: fewer, fuller sections with one idea each.
   - `screens/mkt-home-1440-fold.webp`, `screens/mkt-features-1440-fold.webp`
4. **Keyboard focus disappears on the green band.**
   - The focus outline is `--color-primary`, so on the juniper closing band (every page) and the Pro plan card the
     ring is 1:1 against its ground; 3:1 is needed.
   - A keyboard user cannot see where they are on the page's main buttons.
   - Rule: taste `focus-visible`; ui-ux `focus-states`.
   - `screens/taste-check-home-focus-ring-1440.webp`, `screens/mkt-pricing-1440.webp`
5. **Grey text fails contrast.**
   - The line under the hero buttons ("For contractors and home-service businesses…"), the footer headings and
     the source lines are 2.97:1 against 4.5:1 needed.
   - taste also wants body text at 7:1: our `text-secondary` is 6.57:1 on paper and 6.92:1 on white.
   - `screens/mkt-home-1440-fold.webp`
6. **Two free offers, and priced cards with no button.**
   - Every button says "Try it free: 10 quotes, no card".
   - Pricing also offers "14-day free trial on Pro", its FAQ says the trial needs a card, and its closing button
     is "Start your 14-day trial". A reader cannot tell which free offer they get.
   - On Home the three plan cards have no button of their own (taste `cta`); only "Compare plans" below them.
   - `screens/mkt-pricing-1440.webp`, `screens/mkt-home-1440.webp`
7. **On a phone the hero frames are a sideways strip.**
   - At 390 the three frames scroll sideways, with the second one peeking at the edge, and "Example Home
     Ser…" is cut.
   - taste allows no carousels; ui-ux `gesture-conflicts` (no horizontal swipe on main content).
   - The frames could stack, or play as one sequence (section 4).
   - `screens/mkt-home-390-fold.webp`, `screens/mkt-trade-painting-390-fold.webp`
8. **Trade pages are the home page with other words.**
   - At 1440 and 1024 the trade hero's right half is empty.
   - "How the price is set" is three grey cards.
   - Nothing on `/trades/painting` looks like painting. A real photograph of the trade's work is what taste asks
     for on a service or trade page.
   - `screens/mkt-trade-painting-1440.webp`
9. **No motion at all.**
   - The hero does not enter: there is no animation in `app/page.tsx`. The checker passed its `hero-enter` check
     anyway, so that detector looks lenient.
   - There is no "moment" (`moment-none` on all five pages), and hover is a colour change only.
   - taste requires a hero entrance (about 1.1 s, once), one moment per page and a hover layer (card lift 2 px,
     button step 1 px). The motion skill (Jakub lens for marketing) agrees on a short, once-only entrance and
     subtle hover.
   - It passed `reduced-motion`, `hover-spill` and `collide`.
   - `screens/mkt-home-1440-fold.webp`
10. **Login is a form on empty paper.**
    - Most of the screen at 1440 is blank (`no-visual`).
    - The email field has no `autocomplete="email"`, so phones show the wrong keyboard and do not autofill it
      (`form-fields`).
    - `screens/mkt-login-1440.webp`, `screens/mkt-login-390.webp`

Also seen:
- Three button styles on one screen in the closing band: filled juniper, white fill, white outline (`button-styles`).
- The FAQ and the closing band sit on a narrower container than the rest of the page (`container-edges`).
- No skip link (`skip-link`).
- No share image tags on login (`share-meta`).
- The footer links are under 44 px tall (`tap-size`).

---

## 2. Dashboard: the ten most important findings

1. **Services breaks on a phone.**
   - At 390 the "Upload Services" and "Add Service" buttons push the page to 472 px wide, so it scrolls sideways.
   - Below the `md` width the table hides its Status and Actions columns, so **Edit, Disable and Delete cannot be
     reached on a phone at all.**
   - At 1440 those three actions are bare words under 24 px tall, with Delete next to Disable.
   - Rules: ui-ux `horizontal-scroll`, `content-priority`, `web-target-size`, `destructive-nav-separation`.
   - `screens/dash-services-390.webp`, `screens/dash-services-1440.webp`
2. **The owner never sees the customer's photos.**
   - The product's promise is "customers answer a few questions and send photos".
   - The dashboard quote page has no picture anywhere: no `<img>` in `app/(dashboard)/app/quotes/[quoteId]/` or
     its trace page.
   - The customer's own quote page does show them (`app/q/[quoteId]/page.tsx:724`).
   - Every dashboard screen measured has zero images.
   - Rules: taste "show the real thing"; ui-ux `content-priority`.
   - `screens/dash-quote-needs-approval-1440.webp`
3. **Grey small text fails contrast everywhere.**
   - `text-muted` (#8A948E) is 2.97:1 on the page, 2.75:1 on the grey cards and 3.13:1 on white, against 4.5:1
     needed.
   - It carries:
     - every time stamp ("Received today", "2 minutes ago");
     - every "up 2" or "down $2,600" under the 30-day numbers;
     - the field hints and the "in the last 30 days" note.
   - The amber "Needs your approval" pill is 3.44:1.
   - Rule: ui-ux `color-contrast`, priority 1.
   - `screens/dash-home-1440.webp`, `screens/dash-quotes-1440.webp`
4. **The quote page is eight look-alike grey boxes.**
   - Next step, progress, a note, scope, grade, pricing, assumptions, exclusions, notes and customer all have the
     same weight.
   - The total sits in the sixth box, in body type, not in the mono figure style the customer page uses.
   - Nothing says "this is the price" at a glance.
   - Rules: ui-ux `visual-hierarchy`, `number-tabular`; taste "one system".
   - `screens/dash-quote-needs-approval-1440.webp`
5. **Numbers with no shape.**
   - "Last 30 days" is four numbers with "up 2" or "down 1" in 11 px grey. No direction mark, no line.
   - ui-ux `chart` says a trend over time is a line, and fewer than four points is a stat card. A small 30-day
     sparkline under each figure, with an up or down mark that is not colour alone, says it faster.
   - Analytics uses raw `bg-blue-500` for a bar (`app/(dashboard)/app/analytics/page.tsx:430`), outside our tokens.
   - Rules: ui-ux `trend-emphasis`, `color-not-only`, `color-semantic`.
   - `screens/dash-home-1440.webp`
6. **Tap targets on a phone.**
   - At 390, controls under 44 px tall: 21 of 34 on Home, 29 of 30 on Quotes and 32 of 34 on Quote link.
   - Under the WCAG 2.2 minimum of 24 px: "QR code and website form", "See all numbers", "Change the end of the
     link", and the customer-name links on the quotes list.
   - Rules: ui-ux `touch-target-size`, `web-target-size`.
   - `screens/dash-home-390.webp`, `screens/dash-quotes-390.webp`
7. **Controls with no name.**
   - The back arrow on the quote page is an icon-only link with no label.
   - Two buttons on Quote link have no accessible name.
   - Rule: ui-ux `aria-labels`, priority 1.
   - `screens/dash-quote-needs-approval-1440.webp`, `screens/dash-quote-link-1440.webp`
8. **Home's three counts do not line up, and butter has leaked out of "measurement".**
   - "Accepted" carries an extra line, so its figure sits lower than the other two.
   - "Needs you" and the "Needs your approval" pills use butter. Our own system keeps butter and tape for
     measurement only.
   - Rules: ui-ux `consistency`; taste "one system".
   - `screens/dash-home-1440.webp`
9. **Quote link is a 2,600 px wall.**
   - Seven copy blocks of the same weight each repeat the full link.
   - The embed code is a dark slab.
   - Nothing shows what the customer will see when they open the link.
   - Rules: ui-ux `progressive-disclosure`; taste "show the real thing".
   - `screens/dash-quote-link-1440.webp`
10. **Motion is either missing or not reduced.**
    - Approve & send, Done, the tab switch and the More menu all snap.
    - The whole `main` fades up on load (`app/(dashboard)/layout.tsx:110`).
    - The phone drawer slides (`transition-transform duration-200`), and the 109 `transition-colors` and the
      `transition-all` progress bars are not turned off under reduced motion. `globals.css` only stops our own
      keyframes.
    - Motion skill, Emil lens: frequent actions get no animation or under 200 ms; reduced motion is mandatory.
      The snapping is right for tabs; it is a missed cue for "this quote left your list".
    - `screens/dash-home-1440.webp`

Also seen:
- At 1440 the quotes list cuts "Garage Door Replace…" with room to spare (ui-ux `truncation-strategy`).
- The 30-day comparison line reads "Compared with the 30 days before." in 11 px grey.

---

## 3. Customer pages: the ten most important findings

The customer flow is the quote link → contact → questions → photos → last step → "Your estimate is ready" →
the quote page → Accept.

1. **The customer sees status words.**
   - The quote page shows a "Viewed" pill (and "Under review" before approval). That is the database-state
     language T-158 took out of the dashboard.
   - "Viewed" tells the customer nothing; "Reviewed and confirmed by Ridgeway Doors" just below already says it
     better.
   - `screens/cust-flow-11-quote-page-approved-390.webp`, `screens/cust-flow-10-quote-page-before-approval-390.webp`
2. **The price is shown twice.**
   - "Price breakdown" and "Measurement & takeoff" list the same two lines with the same amounts.
   - The second adds "Fixed quantity", which is engine language.
   - Rules: taste "no fact twice"; ui-ux `content-priority`.
   - `screens/cust-flow-11-quote-page-approved-390.webp`
3. **"View Your Estimate" opens a new tab.**
   - On a phone the customer finishes the form, then lands in a second tab, and Back no longer leads anywhere
     (`EstimateWidget.tsx:1602`, `:1648`).
   - The finished screen also shows no price, only a tick, a line and a button, on a mostly empty page.
   - Rules: ui-ux `back-behavior`, `continuity`.
   - `screens/cust-flow-04-after-submit-390.webp`
4. **The step indicator is cut off on a phone.**
   - At 390 the stepper shows "Contact, Questions, Photo…"; "Photos" is clipped and "Details" is off screen.
   - Rule: ui-ux `multi-step-progress`.
   - `screens/cust-flow-02-step-390.webp`
5. **The form floats in a card on an empty page.**
   - On a phone the card keeps its frame and margins inside a full-screen page, and half the screen below it is
     blank paper.
   - Edge to edge on a phone would give the questions more room.
   - `screens/cust-flow-02-step-390.webp`, `screens/cust-flow-01-contact-390.webp`
6. **Job questions are native dropdowns.**
   - "Door size" and "Door style" are `<select>` boxes reading "Select...", two taps each on a small native picker.
   - The Accept form already uses large tap-sized option rows for "When suits you?". The same pattern for
     two-to-five options is faster and is one system.
   - Rules: ui-ux `touch-friendly-input`, `consistency`.
   - `screens/cust-flow-02-step-390.webp`
7. **Accept form fields barely show.**
   - Filled grey inputs whose edge is 1.23:1 against the paper; 3:1 is needed for a field boundary.
   - Placeholder-only hint on the timing note.
   - Rules: ui-ux `color-contrast` (non-text), `input-labels`.
   - `screens/cust-flow-12-accept-form-390.webp`
8. **The big moments have no motion, and one loop pulses.**
   - Widget steps swap with no direction (`EstimateWidget.tsx:796–874`, plain conditional renders).
   - The Accept form appears mid-page instantly, not scrolled to or focused.
   - Accepting is a once-a-year moment for a homeowner: the motion skill (Jakub lens) welcomes a 200–300 ms enter
     there.
   - The quote page's loading rule uses `animate-pulse` (`app/q/[quoteId]/page.tsx:242`). The motion skill flags
     any pulsing indicator, and it is not covered by the reduced-motion block. Our `tape-measuring` (the tape
     drawn past a point) is the right signature and should replace it.
   - `screens/cust-flow-12-accept-form-390.webp`
9. **No picture of the job or the business.**
   - The quote page shows the customer's photos only when they sent some. This tenant has no logo, so the page is
     all text and one blue panel.
   - The photo step says "A photo of the door from outside, and one from inside showing the springs and tracks"
     in words. An example photo (from the service's own configuration, never hard-coded) would show it.
   - `screens/cust-flow-03-step-390.webp`, `screens/cust-flow-11-quote-page-approved-390.webp`
10. **Small accessibility gaps.**
    - The quote link page has no `h1`, only an "INSTANT ESTIMATE" label and the business name in smaller type.
    - "Powered by Aistimator" and "Prepared with Aistimator" are 11 px mono in grey.
    - The red asterisk is the only required-field mark.
    - Rules: ui-ux `heading-hierarchy`, `readable-font-size`, `required-indicators`.
    - `screens/cust-flow-01-contact-390.webp`

Working well, kept:
- The quote page's price panel (big mono total, tape rule, "Reviewed and confirmed by…").
- The one main button, "Accept this quote — $1,400.00", with "Nothing is charged today".
- The inline accept form.
- The quiet Decline link.
- Contact first, so a half-finished request is still a lead.

---

## 4. Where a picture or a short animation would explain the product better than text

Pictures are the business's own product UI (real screens) or real photographs. Never stock passed off as a
customer, and never a drawn look-alike (taste house rules). Animations are short, play once, and stop under
reduced motion.

**Marketing**
1. **Home hero:** the three frames (ask → price → confirm) could play as one short sequence. The answer is typed,
   the price lands, then "Approve & send" is pressed. It runs once on load (taste: hero entrance, about 1.1 s),
   then stands as it is now.
2. **Home, "Your prices. You stay in control.":** the product's real difference is plain-English pricing. A
   sentence ("$375 per room, heavy prep adds $250") turning into ledger lines is a 3-second type moment worth
   more than the three text cards.
3. **Home, "How it works":** these three cards repeat the hero frames in words. Replace them with one real phone
   screen per step, or drop them.
4. **Home, "Add it anywhere":** four text cards. Each wants its picture: the QR code on a van or flyer, the link in
   a Google Business Profile, a WhatsApp chat with the greeting text, a website with the form inline.
5. **Home, "What homeowners want":** a photograph of a real homeowner on a phone (taste: on software, a
   photograph is a real person or the real product).
6. **Trade pages:** the hero's right half is empty at 1440. A real photograph of the trade's work (a painted
   exterior on `/trades/painting`) belongs there. The "How the price is set" steps want the trade's own screen
   (rooms count, the takeoff from a wall photo).
7. **Features:** five steps, each with four text boxes and no picture. Each step has a real screen:
   - 01 the form on a phone;
   - 02 a customer photo with the measured wall marked (the takeoff);
   - 03 the plain-English price editor;
   - 04 the quote page;
   - 05 Home's numbers.
8. **Login:** half the screen is empty paper. The estimate document beside the form shows what you are signing
   in to.
9. **Pricing:** no picture needed. "Hosted estimate pages" and "Your branding on every estimate" could link to the
   live demo instead of being words.

**Dashboard**
10. **Quote page:** the customer's photos at the top, tap to enlarge. This is the one picture the owner needs
    before pressing Approve & send.
11. **Quote link:** a phone preview of what the customer sees when they open the link, and the QR code shown on
    a sample flyer.
12. **Services:** a preview of the questions a customer will be asked for this service.
13. **Home, new business:** the empty "Where your quotes stand" and "Latest activity" could show a short
    looping example of a request arriving (Jhey lens: empty states only).
14. **Home, 30-day numbers:** a sparkline each (see Dashboard finding 5).
15. **Motion cues** (Emil: under 200 ms, nothing decorative):
    - an approved quote leaving "Waiting for you";
    - a checklist step ticking;
    - "Copy" becoming "Copied";
    - the unfinished-requests badge going down.

**Customer**
16. **Photo step:** an example of a good photo, from the service's own configuration (not hard-coded, per our
    anti-hardcoding rule).
17. **Widget steps:** a short forward and back slide between steps (about 200 ms), so the customer feels the
    progress.
18. **"Your estimate is ready":** show the estimate there, or move into it in the same tab. No new tab.
19. **After accepting:** a short once-only confirmation and a three-step "what happens next" picture (the
    business calls, the visit, the job). This is a rare moment, so the motion skill allows more delight here
    than anywhere in the dashboard.

---

## 5. Where a skill wants to change our colours, fonts or tokens (listed, not applied)

| # | Skill | What it wants | Ours today | Note |
|---|---|---|---|---|
| 1 | ui-ux-pro-max (`--design-system`, marketing query) | Primary `#2563EB` blue, secondary `#3B82F6`, accent/CTA orange `#EA580C`, background `#F8FAFC`, foreground `#1E293B`, border `#E2E8F0` | Juniper `#205E56`, porcelain `#FAF9F6`, ink `#1B2823`, border `#E5E2D8` | Generic "trust blue + orange CTA". Reject: it would erase the brand. |
| 2 | ui-ux-pro-max (same) | Fonts Poppins (headings) + Open Sans (body), loaded by `@import` | Bricolage Grotesque, Instrument Sans, Spline Sans Mono (next/font) | Reject. |
| 3 | ui-ux-pro-max (dashboard query, density 7) | Plus Jakarta Sans for both; the same blue/orange palette | as above | Reject. |
| 4 | ui-ux-pro-max (both queries) | Style "Glassmorphism": backdrop blur 10–20 px, translucent white borders | Flat paper surfaces, soft shadows | Reject. The owner wants pastel and gov.uk clarity. |
| 5 | ui-ux-pro-max (`color-contrast`) | Normal text at least 4.5:1 | `--color-text-muted` #8A948E is 2.75–3.13:1 | **Real issue.** A darker muted grey of about #66706A reaches 4.5:1 on paper, grey cards and white (4.88 / 4.50 / 5.13). Decide in a token ticket. |
| 6 | ui-ux-pro-max (`color-contrast`) | Status text at least 4.5:1 | `--color-tertiary` #A5731B on butter #F7E9C6 is 3.44:1 | Real issue for the amber pills. |
| 7 | ui-ux-pro-max (non-text contrast 3:1) | Field and control boundaries at least 3:1 | `--color-border` #E5E2D8 is 1.23:1 on paper | Affects inputs on the accept form, login and widget. |
| 8 | ui-ux-pro-max (`color-semantic`) | No raw palette colours in components | 18 files use raw Tailwind colours (`text-red-400`, `bg-red-50`, `border-blue-600`, `text-amber-600`, `bg-blue-500` on Analytics…) | Tokens exist (`danger`, `tertiary`); the components should use them. |
| 9 | ui-ux-pro-max (`readable-font-size`) | Body at least 16 px on phones | Much dashboard text is `text-sm` (14 px); labels 11 px | Advice only. |
| 10 | taste | Its own palette and font pairing, dealt by `start.mjs deal` / `css` per trade, and its `system.css` tokens (radius scale, button looks, `.wrap` grid) | Our tokens | Reject; never run its deal in this repo (see `skills.md`). |
| 11 | taste | Dark bands, dark footer or dark hero allowed on software pages (`dark-band`, `footer-dark`) | No dark panels | The owner rejected dark panels. |
| 12 | taste | Motion tokens: hover in 150 ms / out 120 ms, press 90 ms, menu 200 ms, curve `cubic-bezier(.2,.8,.2,1)`, entrance curve `cubic-bezier(.22,1,.36,1)`, card lift 2 px, photo zoom 1.02–1.03, press scale .985 | No motion tokens; Tailwind defaults; one `fade-in-up` (250–300 ms ease-out, 6 px) | Worth adopting as tokens in a motion ticket, under our names. |
| 13 | design-motion-principles | Custom easing instead of `ease`/`ease-out`; enter = opacity + translateY **+ blur**; exits about 60–70% of enter | `fade-in-up` is opacity + 6 px, `ease-out`, no blur | Blur conflicts with taste (row 12 moves transform and opacity only). Decide once. |
| 14 | taste | One radius scale | `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-warm-lg/xl/2xl` mixed | Advice; tidy in a token ticket. |
| 15 | taste (`text-contrast`) | Body text at 7:1, grey only for captions and labels | `--color-text-secondary` #4F5D57 is 6.57:1 on paper, 6.92:1 on white | Stricter than WCAG AA (4.5:1). Advice. |
| 16 | ui-ux-pro-max | A z-index scale (0/10/20/40/100/1000) | Ad-hoc `z-40`, `z-50` | Low priority. |

---

## 6. Where the skills disagree

1. **Should the page move on load?**
   - taste: every page must have a hero entrance (about 1.1 s, the heading rising line by line) and one or two
     "dealt moments". A page without them fails its gate.
   - motion (Emil): "the best animation is that which goes unnoticed"; on a dashboard, no entrance at all.
   - ui-ux-pro-max: animate one or two key elements per view.
   - For us: taste on marketing, Emil on the dashboard.
2. **Hover on cards.**
   - taste requires every linked card to lift 2 px and every linked photo to zoom 1.03 ("never strip it").
   - The motion skill's anti-checklist flags hover-scale on three or more components as AI slop.
   - ui-ux-pro-max wants press feedback (scale 0.95–1.05) instead.
3. **Durations.**
   - taste: 700 ms heading lines, 600 ms image settle.
   - Emil: under 300 ms, 180 ms ideal.
   - ui-ux-pro-max: no fixed range.
   - They agree only on hover, about 150 ms.
4. **Springs and bounce.** ui-ux-pro-max: "prefer spring physics". taste: "no bounce, no overshoot". The motion
   skill allows springs on interactive elements but flags bouncy springs on utility actions.
5. **Blur on enter.** The motion checklist says enters combine opacity, translateY and blur. taste animates
   transform and opacity only (blur only inside a dealt moment).
6. **Stagger.** ui-ux-pro-max recommends a 30–50 ms stagger on lists. The motion anti-checklist flags stagger on
   two or more lists in a view. taste forbids anything appearing as you scroll.
7. **Look and palette.**
   - ui-ux-pro-max proposes glassmorphism, blue and orange, Poppins.
   - taste says never choose a palette by taste: deal one for the trade, flat grounds, no gradient or glass
     outside tech.
   - Both disagree with each other and with us. Ours stays.
8. **Page length.**
   - taste: one section per screen, the hero alone on the first screen. Our home would get longer and sparser,
     with each section one or two screens tall.
   - ui-ux-pro-max cares about content priority and density, and has no such rule.
9. **Dark surfaces.** taste allows dark bands and a dark footer on software pages. ui-ux-pro-max says avoid dark
   by default for this product. The owner rejected dark panels, which settles it.
10. **Words under pictures.** taste: no caption under any image, ever. ui-ux-pro-max: charts need a text summary,
    and meaningful images need alt text. These fit together: no visible captions, real alt text.
11. **Which checklist is canonical.** ui-ux-pro-max's pre-delivery checklist is written for native and mobile apps
    (safe areas, Dynamic Type, 44 pt). Its own note says to use `quick-reference.md` for web. taste's checklist is
    for static marketing pages built with its kit. For our dashboard, the ui-ux web rules apply; for marketing,
    taste's §5.
