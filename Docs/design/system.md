# The design system

**This file decides. The skills advise.** The three design skills in `.claude/skills/` (see `skills.md`) are
consulted for the area each leads; where a skill and this file differ, this file wins. A change to anything here
is a ticket of its own, and changes this file first.

Read this before any UI work. The tokens live in `apps/web/src/app/globals.css` and
`apps/web/tailwind.config.ts`; the page at `/design` shows all of it as it renders. A unit test
(`apps/web/src/__tests__/design-tokens.test.ts`) holds the numbers below.

**What we are making:** premium, attractive and a little fun, while clearly professional. Some images and a few
animations. Never a PDF look, never overdone.

---

## Colour

Paper, juniper and one accent: yellow.

| Role | Token (Tailwind name) | Value | Used for |
|---|---|---|---|
| Paper | `background` | `#FAF9F6` | the ground of every page |
| | `surface` | `#F2F0EA` | grey cards and wells |
| | white (`bg-white`) | `#FFFFFF` | cards on paper |
| | `mist`, `mint` | `#EAEFF5`, `#DFEDE5` | quiet pastel surfaces |
| Juniper | `primary` | `#205E56` | the brand, links, the standard button |
| | `primary-hover`, `primary-light` | `#174741`, `#DFEDE5` | |
| Accent | `accent` | yellow `#FFC53D` | the main button of a marketing screen, one highlighted word, "needs you" |
| | `on-accent` | `#1B2823` (ink) | text on the yellow, and its thin edge; 9.7:1 |
| Ink | `ink` / `text-primary` | `#1B2823` | text; never pure black |
| | `text-secondary` | `#4F5D57` | supporting text |
| | `text-muted` | `#626C66` | small notes, times; 4.5:1 on paper, grey cards and white |
| Lines | `border`, `border-strong` | `#E5E2D8`, `#CFCBBD` | decoration: cards, dividers |
| | `field` | `#808781` | the edge of a field or an outlined control; 3:1 on paper |
| Meaning | `secondary` (+ `-light`, `-line`) | `#326B49` | done, accepted |
| | `tertiary` (+ `-light`, `-line`) | `#7F5710` | a warning, a notice |
| | `danger` (+ `-light`, `-line`) | `#A23D2F` | a failure, a destructive action |
| Measurement | `butter`, `tape` | `#F7E9C6`, `#DCAF3E` | **measurement only** |
| Focus | `focus` | ink; light on juniper | the keyboard focus ring |

Rules:

1. **The accent is about a tenth of a screen:** the one main button of a marketing screen, one highlighted word
   in a headline, and "needs you" markers. If a screen has more yellow than that, something is wrong.
2. **The accent is never text on paper** (yellow on paper is 1.5:1). A highlighted word is the yellow *behind* the
   word, with `on-accent` text.
3. **The yellow always carries dark text** (`on-accent`), never white (1.6:1). **A yellow button has a thin dark
   edge** (`border border-on-accent`), because yellow alone barely stands off paper. On a marketing page the one
   main call to action of a screen is yellow (`MAIN_CTA` in `lib/marketing/cta.ts`); every other button keeps its
   quieter style. **Dashboard buttons are never yellow.**
   **There is no pale yellow tint.** A pale yellow reads as butter.
4. **Butter and tape are for measurement only:** the takeoff, grades, ranges, the tape rule. A warning is
   `tertiary`. "Needs you" is the strong yellow with its small dark marker (Status colours).
5. **No dark panels, no glass, no gradients.** The dark code block on the Quote link page is the one dark surface.
   The one gradient allowed is a scene photograph fading into the ground its band already has, where words sit
   beside it: paper, or juniper on the closing band (Imagery, T-168, T-170).
6. **Never choose a colour from a skill's catalogue,** and never write a raw Tailwind palette colour
   (`text-red-500`, `bg-zinc-50`). Every colour is one of the tokens above. A unit test fails on a raw one.
7. **An opacity on a colour token works since T-172** (`bg-ink/40`, `border-danger/30`), and has rules: never on
   a focus ring, never on the accent or on text, never on the edge of a control, and butter and tape only in
   measurement. See "Opacity on a colour token" below. For the soft edge of a tinted box the `-line` tokens
   are still the first choice.
8. **The customer's pages keep the business's own colour.** The request form and the quote page are coloured by
   the business's brand colour (`primary` is overridden there). Our accent never appears on them.
   **Text on the business's colour is the on-colour, chosen by contrast (T-171):** white where white reaches
   4.5:1, ink where the colour is light, and black for the narrow band of mid-tone colours on which neither does
   (`readableTextOn` in `lib/color.ts`). On the price panel every word is that colour at full strength: no faded
   white. A button on the panel is the panel's colours turned round (`bg-on-primary text-primary`), never a
   yellow of ours.

The owner chose yellow in T-165 (tomato and orange were the other candidates; they and the `data-accent` switch
are gone).

## Type

- **Bricolage Grotesque** for display (headings, the wordmark), **Instrument Sans** for text, **Spline Sans Mono**
  for every figure (class `figure`: money, counts, dates in a ledger). These three stay.
- **One scale.** Text uses Tailwind's steps: `text-xs` 12, `text-sm` 14, `text-base` 16, `text-lg` 18,
  `text-2xl` 24, `text-4xl` 36. Marketing headlines add four display sizes:

  | Token | Size | Use |
  |---|---|---|
  | `text-display-sm` | 40 px | a marketing headline on a phone |
  | `text-display-md` | 52 px | a marketing section headline |
  | `text-display-lg` | 64 px | the marketing hero |
  | `text-display-xl` | 80 px | the marketing hero on a wide screen |

- Display sizes are for marketing pages only. The dashboard stops at `text-4xl`.
- Body text is 16 px on a phone. 12 px is the smallest size, for notes only.
- Headings are bold or extra-bold. No thin weights.
- **Sentence case** for every heading, label and button, on every page, email and PDF: "Scope of work", "View
  your estimate". One capital at the start; names keep theirs. A small label may be set in capitals by its style
  (`uppercase`), but its words are still written in sentence case. (T-183.)

## Shape

- **One radius scale** (it replaces Tailwind's, so no other step exists):

  | Class | Size | Use |
  |---|---|---|
  | `rounded-sm` | 4 px | tags, small marks |
  | `rounded-md` | 6 px | small controls |
  | `rounded-lg` | 8 px | buttons, fields |
  | `rounded-xl` | 12 px | cards |
  | `rounded-2xl` | 16 px | panels, large cards |
  | `rounded-3xl` | 20 px | the document sheet, the request form |
  | `rounded-full` | | pills, dots |

  `rounded-xs` (2 px) exists for the tucked corner of a chat bubble. There is no bare `rounded` and no arbitrary
  value.
- **One shadow scale:** `shadow-warm` (a hairline), `shadow-warm-md` (a card), `shadow-warm-lg` (a raised card),
  `shadow-warm-hover` (a card under the pointer), `shadow-document` (the estimate sheet). All are soft and
  ink-tinted.
- **One container width:** `max-w-container` (72 rem, the same as `max-w-6xl`) with a 16 px gutter on a phone
  and 24 px above. Every section of a marketing page sits on it. The dashboard's content area is its own width
  beside the menu.
- A box is at most two deep: a card on the page, and one inset inside it.

## Imagery

- **Real product screens at true size** (our own UI, drawn from the real components, never a scaled-down
  screenshot with unreadable text), **real photographs, and scene photographs made with an image model under the
  rules below.** A screen on a marketing page says the real
  screen's own words (`lib/marketing/screen-words.ts`) and shows the trade template's own question, label and
  prices (`lib/marketing/examples.ts`); it is built in `components/marketing/screens/`.
- **No icon stands in for a screen.** Where the page says the product does something, it shows the screen where
  the result appears.
- **A photo we do not have is named, not drawn.** The photographs we ship are the sample tank label and the scene
  photographs listed in `photos.md`: Home's hero (T-168), and from T-170 one per trade page's hero, Home's
  closing band, the van in "Add it anywhere" and the demo's two sample photos. A form
  that asks for another label shows "1 photo added" beside the label's name, with no picture (T-167). A label or
  a rating plate is never made with an image model: it has to be readable, and the model must draw no text.
- No stock photograph passed off as a customer, a customer's job or the team. A stand-in photograph, if ever
  used, is listed in the ticket's report as one.
- No drawn look-alike of a real logo, product or person.
- **No visible caption** under a picture. Every meaningful image has real alt text; decorative ones are hidden
  from screen readers.
- Photographs of a job on a customer's page come from that customer or that business, never from us.
- **A customer's photos on the dashboard** (T-169) are small pictures that open larger in a modal dialog with no
  animation. They are served only to the signed-in business that owns the quote, by a signed address that lasts
  minutes.
- **A small line under a figure** (Home's "Last 30 days", T-169): one line, the earlier period in `field` grey and
  the current one in juniper, starting at zero, with no axis and no animation. It is hidden from screen readers,
  who get the numbers as a sentence. A direction ("up", "down", "same") is always words plus a shape, never a
  colour alone.

### Scene photographs made with an image model (T-168)

Allowed on marketing pages, under these rules. Each one is recorded in `Docs/design/photos.md` (the model, the
prompt, what was kept and what was rejected).

- **They show situations, never a named or implied customer.** A contractor by a van is a scene; it is never "one
  of our customers", a member of the team, or a job we priced.
- **Never beside a review, a quote or a figure about real users.** Nothing near the picture may make it read as
  evidence.
- **No visible brand names or logos**, on a vehicle, clothing, a tool or a device.
- **No text and no phone or tablet screen drawn by the image model.** Where a screen is needed, our real screens
  go on top, in code.
- **Real alt text** that says what the picture shows. **No caption.**
- **Rejected on sight:** a malformed hand or face, readable text, a logo, a likeness to a recognisable person.
- **One art direction, for every one of them:** documentary style, natural daylight, American homes and streets,
  calm and warm, our paper and juniper tones, with at most one small yellow object (a tape measure or a hi-vis
  detail). No studio look. No posed smile at the camera. **One exception (T-170):** the closing band's picture is
  an evening one (dusk in the window, one lamp).
- **Behind words (T-170, replacing T-168's rule for small screens):** the photograph is the band's background
  and fades into the band's own ground, so the words sit on that ground: dark words on paper, or light words on
  juniper (the closing band). From 768 px the words are on the left and the picture's subject on the right; the
  line under a headline sits on solid ground, and the narrower the screen, the further the solid ground reaches.
  Under 768 px the photograph fills the top of the band and fades downwards, and the words start over the faded
  part. **It is never a block of its own above the headline.** Every line of text over a photograph reaches
  4.5:1 at its worst point, measured from the painted pixels, not judged by eye (`verify-t170`).
- **A product screen may sit partly on a photograph** (Home's three frames, a trade page's form): the screen is
  ours, drawn in code, on its own white ground.
- **Anything a person could read in a photograph is ours, placed in code:** the QR code and the business's name
  on the van in "Add it anywhere". The image model drew a plain van.
- **The demo's sample photos** stand in for a customer's own photo on `/demo` only: no people, no faces, one per
  demo service, following that service's own photo instruction.
- The image has fixed dimensions, so nothing moves when it arrives. Only a hero's image loads with priority; every
  other photograph loads when it is near the screen.
- **A phone frame** is the one device frame on the site ("Add it anywhere"): an ink edge and a phone's corners,
  which are not a step of the radius scale.

## Layout

- **One idea per section.** A section says one thing and shows it.
- **Neighbouring sections never share a layout or a background.** Three cards in a row is not followed by three
  cards in a row, and paper is not followed by paper (paper, grey, mint and juniper take turns). (Home, T-168:
  the hero's three framed screens on paper are followed by three open columns of figures on grey, divided by
  rules. Both are in threes by the owner's choice; they differ in what a column is and in background.)
- A marketing page has fewer, fuller sections rather than many short ones. (taste's rule of exactly one or two
  screens per section is not ours; see the rulings.)
- One main action per screen. A second action is visibly quieter.
- Phone first. Nothing scrolls sideways at 390 px; content does not swipe sideways as its only way to be read.
- **A name or a link is never cut and never broken inside a word.** A link is shown short (no "https://") and may
  wrap only after a slash (`ShortLink`). Where a name does not fit, the layout gives way, not the name.
- **Pictures in a row are one size, and start on one line** ("Add it anywhere": three columns of one height from
  1024 px, each a row of words and picture from 640 px, stacked on a phone).
- Tap targets are 44 px on a phone. Controls are never closer than 8 px. Nothing a person can press is under
  24 px at any width. A destructive action sits apart from the others (a rule and a wider gap), never beside them.
- **Customer pages (T-171):**
  - *The request form on a phone runs edge to edge* on white, with no card and no empty paper under it; from
    640 px it is a card on paper. On the quote link page the business's name is the page's `h1` and a step's
    title an `h2`; inside a business's own page they are `h2` and `h3`.
  - *Where the customer is:* "Step 3 of 5" with the step's name over a bar, under 640 px; from 640 px the steps'
    labels sit under their numbers. A label is never cut.
  - *A question with two to five choices is rows to tap* (48 px), in the business's colour; a longer list keeps
    the picker. The accept form's "When suits you?" is the same pattern.
  - *A required field says "(required)" in words*, never a red asterisk alone. An optional one says "(optional)".
  - *A field has an edge that can be seen* (`border-field`, 3:1) on white.
  - *Nothing opens a new tab.* The quote link page moves the customer straight into the estimate (or the one
    question); a form inside a business's page shows the estimate itself and its link replaces the page.
  - *No status words.* The customer never sees "Viewed" or "Under review"; the line under the price says where
    the estimate stands.
  - *A fact is shown once.* The price lines are in the breakdown; what was read or measured is in its own block
    with no amounts.
  - *"Powered by" and "Prepared with"* are 12 px in `text-muted`.
- **The dashboard quote page reads in one order** (T-169): the next step, what the AI understood (with the
  customer's photos), the price, then the rest in one card divided by rules. The total is the mono figure at
  `text-4xl`. A new block on that page goes into one of those four, not into a box of its own.

## Motion

Tokens (CSS variables; Tailwind `duration-*` and `ease-*` names in brackets):

| Token | Value | For |
|---|---|---|
| `--motion-hover-in` (`duration-hover-in`) | 150 ms | the pointer arrives |
| `--motion-hover-out` (`duration-hover-out`) | 120 ms | the pointer leaves |
| `--motion-press` (`duration-press`) | 90 ms | a click or a tap |
| `--motion-menu` (`duration-menu`) | 200 ms | a menu or small panel opens |
| `--motion-enter` (`duration-enter`) | 250 ms (200 to 300) | something arrives |
| `--ease-move` (`ease-move`) | `cubic-bezier(0.2, 0.8, 0.2, 1)` | anything that moves or changes |
| `--ease-enter` (`ease-enter`) | `cubic-bezier(0.22, 1, 0.36, 1)` | an entrance settling |

| `--motion-draw` | 800 ms | the tape rule drawn out: the hero demo's one flourish, nowhere else |

Ready-made classes: `motion-press` (a control that answers the pointer), `motion-menu` (a menu; set
`data-open="true"`), `animate-fade-in-up` (an entrance: opacity and a 6 px rise, once), and for the hero demo and
the moment `demo-in`, `demo-pop`, `demo-out`, `demo-press` and `demo-tape-cover`, each waiting for its turn in
`--at`.

Rules:

1. **Transform and opacity only.** A colour may change with them. No blur, no bounce, no overshoot, no animated
   width, height, top, left, margin or padding.
2. **Dashboard: no entrance animations.** Feedback only, under 200 ms: a hover, a press, a menu, a row leaving a
   list. Nothing on an action taken hundreds of times a day, nothing started from the keyboard.
3. **Marketing: one hero entrance** (once, on load) **and at most one moment per page.** Nothing appears because
   the page was scrolled.
   - **The hero demo** (Home) is the hero entrance: the product shown working, in **three frames of the same
     height, side by side, one idea each** (T-168, the owner's choice): the customer's question with its answer and
     "Get my estimate"; a short estimate (a line or two, the total, the locked Accept); "Waiting for you" with one
     lead, its price and "Approve & send". The frames are built from the product's own parts and words at readable
     sizes (nothing under 12 px); they are short pictures of a screen, not whole screens, and they keep one height
     at every width (stacked on a phone). It plays once on load, each step a token-length entrance in its turn, the
     whole run under six seconds, then it stands still on its last state with a small "Play again". The demo does
     not show a reading from a photo: that step is shown, in the product's order, in "What it notices" (T-167's
     reading beat left the hero in T-168). It is a picture: a screen reader
     gets one sentence instead. Under reduced motion it shows the finished frames with no movement.
   - **The one moment** sits in its own section and plays once when that section comes into view. Its content is
     on the page from the first paint; it waits only when script has seen that the section is still below the
     screen and motion is allowed. It can be played again by a button.
4. **Customer pages:** a short entrance on the estimate arriving, and feedback. The wait is the tape rule being
   drawn (`tape-measuring`), never a pulse. **Accepting gets one short confirmation (T-171):** the accepted
   block's entrance, `animate-fade-in-up` (250 ms), once, only when it has just happened; nothing under reduced
   motion. When the accept form opens it is scrolled into view (at once under reduced motion) and its first
   field takes the focus.
5. **An exit is quicker than its entrance.**
6. **Reduced motion:** one global rule stills every transition and animation, ours and Tailwind's. Nothing is
   left hidden and nothing loops.
7. **CSS first.** No motion library is installed. One is added only by a ticket that says what CSS could not do.

## Status colours

By whose turn it is (`packages/shared/src/quote-turn.ts`); the map is `apps/web/src/lib/status-tone.ts`.

| Whose turn | Colour | Classes |
|---|---|---|
| Needs you | the strong yellow, dark text, and a small dark marker (`<NeedsYouDot />`) | `bg-accent text-on-accent` |
| Waiting for the customer; working out the price | neutral, cool | `bg-mist text-text-secondary` |
| Accepted, paid | green | `bg-secondary-light text-secondary` |
| Closed (declined, expired) | grey | `border border-border bg-surface text-text-muted` |
| Failed (could not be priced) | red | `bg-danger-light text-danger` |

Each reads at 4.5:1 or more. Colour is never the only signal: the label says it in words.

"Needs you" is always the strong yellow with the marker, never a pale tint (it would be taken for butter, a
measurement note). A pill or a small tag is filled yellow. A larger surface that needs the owner (Home's "Needs
you" tile, the unfinished-requests banner) stays white and carries the yellow behind its count, with the marker:
the yellow stays within a tenth of the screen.

## What the site may say the AI does

`Docs/design/ai-capabilities.md` is the list of what the AI really does today: each capability, where it lives,
which trades it applies to, what the customer and the business see, and the evidence that it runs. **A claim on
the site maps to a row of that list or it does not go on the site** (T-167). The message is "The AI works out the
job. Your prices work out the cost." No "AI-powered" slogans, no promise of accuracy, none of the words customers
never see (exact, firm, guaranteed, grades, confidence), and never that the AI sets a price. A trade page claims
only what the AI does for that trade.

## The name

The name is `PRODUCT_NAME` (`packages/shared/src/brand.ts`). The wordmark is that name as text in the display
font, extra-bold (the owner's choice, T-165). One component draws it everywhere: `components/brand/Wordmark.tsx`.

## Which skill leads where

| Area | Skill | How |
|---|---|---|
| Marketing pages: structure and imagery | taste (`design-taste-frontend`) | its references and its checker against localhost, from a scratch folder. Never its build pipeline, palettes or fonts. |
| Dashboard and customer pages: UX | ui-ux-pro-max | its web rules (`references/quick-reference.md`) and checklist. Never its generated palette or fonts. |
| Motion, everywhere | design-motion-principles | the Emil lens on the dashboard, Jakub on marketing and customer pages, Jhey for empty states and the hero demo only |

Never run taste's `gate.mjs --start` or `start.mjs deal` in this repo (`skills.md`).

## Where the skills disagree: our rulings

The numbers are those of `audit.md`, section 6.

1. **Should the page move on load?** Marketing: yes, one hero entrance, once, and at most one moment. Dashboard:
   no. Customer pages: only the estimate arriving.
2. **Hover on cards.** A linked card or a button answers the pointer with `motion-press` (1 px, not taste's lift
   on everything). No hover scale on images. A card that is not a link does not move.
3. **Durations.** Ours: 150, 120, 90, 200 and 250 ms, and 800 ms for the tape rule being drawn. taste's 700 ms
   heading lines and 600 ms image settle are not used. A hero demo is a run of 250 ms steps, under six seconds in
   all.
4. **Springs and bounce.** None. Both curves end without passing their mark.
5. **Blur on enter.** None. Transform and opacity only.
6. **Stagger.** Allowed only inside the hero demo and the one moment. No list staggers in, and nothing else
   appears on scroll.
7. **Look and palette.** Ours, as written above. No skill's palette, font pairing or style (glass, gradients).
8. **Page length.** One idea per section and fuller sections, but not taste's fixed one-or-two-screens rule.
9. **Dark surfaces.** None.
10. **Words under pictures.** No visible captions; real alt text; a chart has a text summary for screen readers.
11. **Which checklist.** Dashboard and customer pages: ui-ux-pro-max's web rules. Marketing: taste's checklist,
    minus what this file overrules. Its app checklist (safe areas, Dynamic Type) is for the mobile app.

## Opacity on a colour token (T-172)

A class may put an opacity on one of our colours (`bg-ink/40`, `border-danger/30`). Every colour token is defined
as an RGB triple with a slot for that opacity: the hex in `globals.css` (`--color-ink: #1B2823`) has its triple
beside it (`--color-ink-rgb: 27 40 35`), and `tailwind.config.ts` reads the triple. Until T-172 the tokens were
plain `var()` strings, such a class wrote no CSS, and 208 of them sat in the code doing nothing. A unit test
holds each triple to its hex. A business's own colour is set in both forms (`lib/color.ts`).

Rules for using one:

1. **Never on a focus ring.** `focus:ring-primary/30` is a faint ring (1.4:1 to 1.6:1 on paper) and it would beat
   the rule that makes a ring the focus colour. A control that draws its focus with `focus:ring-2` writes no ring
   colour of its own. (T-172 removed 129 of them.)
2. **Butter and tape only in measurement,** as for the colours at full strength: the takeoff block and the range
   bar of the customer quote page. Not on a notice, not on a step marker.
3. **Never on the accent,** and never to thin text: text is a text token at full strength. (One place is allowed:
   the admin bar's light text on ink, 9:1 at 80%.)
4. **Never on the edge of a control.** A field's edge, an error edge and an outlined button's edge are the full
   colour (3:1). A soft edge is for a box that is not a control: `border-danger/30` on a tinted panel, or the
   `-line` tokens.
5. Fine at part strength: the dimming layer behind a window or the phone menu (`bg-ink/40`), a tint made paler
   (`bg-mint/40`), a divider made lighter (`border-border/50`), the soft edge of a tinted box.

## Known gaps (not fixed by T-164; each needs its own ticket)


- **Features' hero and the closing bands are words only** (taste's `text-only`), and a trade page's three feature
  cards and its "Tell it your prices" band have no screen. (Features and the trade pages were redrawn in T-167:
  real screens, the yellow call to action.)
- **Butter outside measurement.** Notice banners (the demo note, the test-request note, the plan-usage banner),
  the "Test" tag and the "Most popular" pill still use butter or tape. They move to `tertiary` when their page is
  redesigned.
- **Shadows outside the scale.** 21 uses of Tailwind's own `shadow`, `shadow-sm` and `shadow-2xl`.
- **Containers.** Trade pages use `max-w-5xl` for some sections; the FAQ and closing bands are narrower.
- **The product frames** (`ProductStrip`, two corner sizes of their own) are on no marketing page since T-167;
  only `/design` still shows them. It can go when `/design` shows a current screen.
- **Field focus.** Fields remove the outline and rely on a border colour change plus a ring, which is the focus
  colour (ink) since T-164. (The one decorative ring, the current step of the service set-up window, is juniper
  since T-172: it had a tape colour written for it, and tape is for measurement only.)
