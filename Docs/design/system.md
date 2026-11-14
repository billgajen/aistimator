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

Paper, juniper and one accent.

| Role | Token (Tailwind name) | Value | Used for |
|---|---|---|---|
| Paper | `background` | `#FAF9F6` | the ground of every page |
| | `surface` | `#F2F0EA` | grey cards and wells |
| | white (`bg-white`) | `#FFFFFF` | cards on paper |
| | `mist`, `mint` | `#EAEFF5`, `#DFEDE5` | quiet pastel surfaces |
| Juniper | `primary` | `#205E56` | the brand, links, the standard button |
| | `primary-hover`, `primary-light` | `#174741`, `#DFEDE5` | |
| Accent | `accent` | orange `#F26B2A` (default) | the fill: the main button, one highlighted word |
| | `accent-tint` | `#FDE7DD` | the "needs you" tint |
| | `accent-line` | `#F7C7AF` | the edge of a box in the tint |
| | `accent-ink` | `#91431B` | text on the tint |
| | `on-accent` | `#1B2823` | text on the fill |
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

1. **The accent is about a tenth of a screen:** the one main button, one highlighted word in a headline, and
   "needs you" markers. If a screen has more accent than that, something is wrong.
2. **The accent is never text on paper.** Orange on paper is 2.9:1 and yellow 1.5:1. A highlighted word is the
   accent *behind* the word, with `on-accent` text. Text on the tint is `accent-ink`.
3. **White is never button text on an accent** (3.0:1 on orange, 4.0:1 on tomato, 1.6:1 on yellow). Use
   `on-accent`.
4. **Butter and tape are for measurement only:** the takeoff, grades, ranges, the tape rule. A warning is
   `tertiary`. "Needs you" is the accent tint.
5. **No dark panels, no glass, no gradients.** The dark code block on the Quote link page is the one dark surface.
6. **Never choose a colour from a skill's catalogue,** and never write a raw Tailwind palette colour
   (`text-red-500`, `bg-zinc-50`). Every colour is one of the tokens above. A unit test fails on a raw one.
7. **Do not write an opacity modifier on a colour token** (`border-danger/30`, `ring-primary/20`). The tokens are
   plain `var()` values, so Tailwind writes no CSS for it and the class does nothing. Use the `-line` and
   `-light` tokens. (228 such classes already exist and do nothing; see "Known gaps".) `on-primary` is the one
   token that takes an alpha.
8. **The customer's pages keep the business's own colour.** The request form and the quote page are coloured by
   the business's brand colour (`primary` is overridden there). Our accent never appears on them.

**Accent candidates** (the owner chooses on `/design`; orange until then). Set `data-accent` on an element to
switch it and everything inside it.

| | Fill | Tint | Text on tint | Text on fill | Note |
|---|---|---|---|---|---|
| tomato | `#E8412C` | `#FBE1DD` | `#8C2C1C` | `#140806` | button text must be near-black: white is 4.0:1 and ink 3.8:1 |
| orange | `#F26B2A` | `#FDE7DD` | `#91431B` | `#1B2823` (ink) | ink on the fill is 5.0:1 |
| yellow | `#FFC53D` | `#FFEFC2` | `#765A1D` | `#1B2823` (ink) | its tint is close to butter, which is reserved for measurement |

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
  screenshot with unreadable text) **and real photographs only.**
- No stock photograph passed off as a customer, a customer's job or the team. A stand-in photograph, if ever
  used, is listed in the ticket's report as one.
- No drawn look-alike of a real logo, product or person.
- **No visible caption** under a picture. Every meaningful image has real alt text; decorative ones are hidden
  from screen readers.
- Photographs of a job on a customer's page come from that customer or that business, never from us.

## Layout

- **One idea per section.** A section says one thing and shows it.
- **Neighbouring sections never share a layout.** Three cards in a row is not followed by three cards in a row.
- A marketing page has fewer, fuller sections rather than many short ones. (taste's rule of exactly one or two
  screens per section is not ours; see the rulings.)
- One main action per screen. A second action is visibly quieter.
- Phone first. Nothing scrolls sideways at 390 px; content does not swipe sideways as its only way to be read.
- Tap targets are 44 px on a phone. Controls are never closer than 8 px.

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

Ready-made classes: `motion-press` (a control that answers the pointer), `motion-menu` (a menu; set
`data-open="true"`), `animate-fade-in-up` (an entrance: opacity and a 6 px rise, once).

Rules:

1. **Transform and opacity only.** A colour may change with them. No blur, no bounce, no overshoot, no animated
   width, height, top, left, margin or padding.
2. **Dashboard: no entrance animations.** Feedback only, under 200 ms: a hover, a press, a menu, a row leaving a
   list. Nothing on an action taken hundreds of times a day, nothing started from the keyboard.
3. **Marketing: one hero entrance** (once, on load) **and at most one moment per page.** Nothing appears because
   the page was scrolled.
4. **Customer pages:** a short entrance on the estimate arriving, and feedback. The wait is the tape rule being
   drawn (`tape-measuring`), never a pulse.
5. **An exit is quicker than its entrance.**
6. **Reduced motion:** one global rule stills every transition and animation, ours and Tailwind's. Nothing is
   left hidden and nothing loops.
7. **CSS first.** No motion library is installed. One is added only by a ticket that says what CSS could not do.

## Status colours

By whose turn it is (`packages/shared/src/quote-turn.ts`); the map is `apps/web/src/lib/status-tone.ts`.

| Whose turn | Colour | Classes |
|---|---|---|
| Needs you | the accent tint | `bg-accent-tint text-accent-ink` |
| Waiting for the customer; working out the price | neutral, cool | `bg-mist text-text-secondary` |
| Accepted, paid | green | `bg-secondary-light text-secondary` |
| Closed (declined, expired) | grey | `border border-border bg-surface text-text-muted` |
| Failed (could not be priced) | red | `bg-danger-light text-danger` |

Each reads at 4.5:1 or more. Colour is never the only signal: the label says it in words.

## The name

The name is `PRODUCT_NAME` (`packages/shared/src/brand.ts`). Two wordmarks are drawn on `/design`, "Qolumns" and
"qolumns", in the display font, for the owner to choose. Until then real pages keep the text logo they have.

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
3. **Durations.** Ours: 150, 120, 90, 200 and 250 ms. taste's 700 ms heading lines and 600 ms image settle are
   not used; a hero entrance is built from 250 ms steps and finishes within a second.
4. **Springs and bounce.** None. Both curves end without passing their mark.
5. **Blur on enter.** None. Transform and opacity only.
6. **Stagger.** Allowed only inside the hero entrance. No list staggers in, and nothing appears on scroll.
7. **Look and palette.** Ours, as written above. No skill's palette, font pairing or style (glass, gradients).
8. **Page length.** One idea per section and fuller sections, but not taste's fixed one-or-two-screens rule.
9. **Dark surfaces.** None.
10. **Words under pictures.** No visible captions; real alt text; a chart has a text summary for screen readers.
11. **Which checklist.** Dashboard and customer pages: ui-ux-pro-max's web rules. Marketing: taste's checklist,
    minus what this file overrules. Its app checklist (safe areas, Dynamic Type) is for the mobile app.

## Known gaps (not fixed by T-164; each needs its own ticket)

- **Opacity modifiers on tokens do nothing.** 228 classes such as `ring-primary/30`, `border-danger/30` and
  `bg-ink/40` write no CSS. Fields therefore show Tailwind's default blue focus halo, tinted borders fall back to
  the default hairline, and the phone menu's dimming layer has no colour. Making the tokens take an alpha would
  switch all 228 on at once and change how many pages look, customer pages included. A unit test stops the number
  growing.
- **Butter outside measurement.** Notice banners (the demo note, the test-request note, the plan-usage banner),
  the "Test" tag and the "Most popular" pill still use butter or tape. They move to `tertiary` when their page is
  redesigned.
- **Shadows outside the scale.** 21 uses of Tailwind's own `shadow`, `shadow-sm` and `shadow-2xl`.
- **Containers.** Trade pages use `max-w-5xl` for some sections; the FAQ and closing bands are narrower.
- **The product frames** on marketing pages use two corner sizes of their own (`ProductStrip`).
- **Field focus.** Fields remove the outline and rely on a border colour change plus the (default blue) halo.
