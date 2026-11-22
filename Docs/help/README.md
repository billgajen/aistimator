# The help guide

These pages are what "Ask Qolumns" (the assistant in the Help panel) is given to answer from. It answers only
from them, so a page that is wrong makes the assistant wrong, and a thing that is missing here is a thing it
cannot explain.

**The rule (CLAUDE.md, Quality gates): when a ticket changes what a business sees or can do, update Docs/help in
the same ticket.** Then run `pnpm help:build` (it copies these pages into the web app) and the unit tests.

## One page per area

`NN-area.md`, in the order a business meets them. A page starts with one `# Title` line. Everything after it is
entries. This README is not part of the guide.

## An entry

```markdown
## How do I add a service?
<!-- id: services-add; page: /app/services -->

One or two short sentences that answer the question.

1. A step, naming the button or field as the screen names it ("Add service").
2. The next step.
```

- **The heading is the question, as a business would ask it.** Not a feature's name.
- **The comment line under it is required.** `id` is unique in the whole guide: lower case, hyphens, starting
  with the area. `page` is the dashboard page it happens on: a real route under `/app` (a quote's own page is
  `/app/quotes/[quoteId]`). A query or `#anchor` may follow it.
- Optional keys, separated by `;`:
  - `section: Tax Settings` — the entry covers that section of the Settings page (the section's heading, as the
    page shows it).
  - `flags: whatsapp, app, roomScan` — the entry talks about something that has a "Coming soon" flag in
    `apps/web/src/lib/marketing/plan-claims.ts`. An entry that names WhatsApp, the phone app or the room scan
    must carry the flag, and must say what is true today with the blocks below.
- **A short answer first, then numbered steps where there are steps.** Plain words. No marketing. Say what the
  product does today; say plainly what it does not do.

## Facts that are never typed

Plan facts and "is it live" are filled in when the guide is built (`apps/web/src/lib/help/guide.ts`), from
`packages/shared/src/plans.ts` and `plan-claims.ts`. A page uses these and never a typed figure:

| Write | It becomes |
|---|---|
| `{{product}}` | the product's name |
| `{{free.quotes}}` | the number of free quotes a new business gets |
| `{{plans}}` | every plan a business can choose: its price by month and by year, its quotes a month, what it includes, and what is coming soon |
| `{{plan.starter.name}}` `{{plan.starter.monthly}}` `{{plan.starter.yearly}}` `{{plan.starter.quotes}}` | one plan's name, prices and quotes a month (also `pro`, `business`) |
| `{{whatsapp.plans}}` `{{app.plans}}` `{{roomScan.plans}}` `{{badge.plans}}` | the plans that include it ("Pro and Business") |
| `{{soon}}` | "Coming soon" |
| `{{support.email}}` | the support address |
| `{{support.dailyReports}}` `{{ask.dailyQuestions}}` | the daily limits of the Help panel |
| `{{ask.keepDays}}` | how many days a question to the assistant is kept |

What is live and what is not:

```markdown
{{#soon whatsapp}}This is coming soon. Today you can …{{/soon}}
{{#live whatsapp}}Open WhatsApp in the menu and …{{/live}}
```

`whatsapp`, `app` and `roomScan` are the three flags. A `soon` block is kept while the flag says "not live" and
dropped once it is live; a `live` block is the other way round.

## What the unit test holds (`apps/web/src/__tests__/help-guide-t198.test.ts`)

- every dashboard page and every Settings section has an entry;
- every entry's page is a real route;
- no dollar amount and no number of quotes is typed in a page, and every plan fact in the built guide is the one
  in `plans.ts`;
- an entry that names something behind a flag carries the flag, and says "Coming soon" while it is not live;
- the copy inside the web app is the same as these pages (run `pnpm help:build`).

## Never in the guide

A customer's name or details, another business, a date something "will" ship, a price that is not a plan's, or
anything the product does not do today written as if it does.
