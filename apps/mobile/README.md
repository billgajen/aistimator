# The business's on-site app (Expo)

A trade on a site visit: open the app, new quote, pick the service, take the photos, answer the service's own
questions, add a note and the customer's name, see the price, approve it and send the customer their link from
the phone's share sheet (a text, WhatsApp, an email).

Built in T-137 (the app), T-138 (LiDAR room scan) and T-182 (the on-site path, and matching the web).

## What it is built with

- Expo SDK 58, React Native 0.88, React 19, expo-router. TypeScript, strict.
- Expo modules: secure-store (the sign-in, in the keychain), image-picker (camera and library),
  image-manipulator (photos are made smaller before upload), file-system (drafts and photos kept on the
  phone, uploads with progress), constants, linking, status-bar.
- One native module of our own: `modules/room-scan` (Swift, Apple RoomPlan, LiDAR).
- No UI kit. Colours and sizes are in `src/theme.ts`; `Docs/design/system.md` decides them.

## Expo Go or a development build

**Everything except the LiDAR room scan runs in Expo Go.** No Apple Developer account and no Xcode are needed.
The room scan is native code, so it needs a development build; in Expo Go the app hides the scan card
(`isRoomScanSupported()` is false) and the rest works unchanged.

## Run it

```bash
cd apps/mobile
cp .env.example .env        # fill the three values; the file says where each comes from
npx expo start              # scan the QR code with the iPhone's camera; it opens in Expo Go
```

A missing value does not crash the app: it opens on one screen naming what is missing.

Step-by-step instructions for the owner's iPhone, against production, are in `OWNER-TODO.md` under T-182.

## How it signs in and talks to the API

- Sign-in is the business's email and password, against Supabase. The session is kept in the phone's keychain,
  in parts (`src/lib/chunked-store.ts`: a session is longer than the keychain likes).
- Every call to our API sends the signed-in person's access token as a bearer. The web app accepts it in place
  of the session cookie, under the same row-level security (AD-033). Contracts: `Docs/02-api-contracts.md`,
  "Business app APIs".
- The service's form and the photo uploads use the same public routes the website form uses, with the
  business's form key from `/api/app/bootstrap`. Those routes are rate limited; the app waits for as long as
  the server asks and tries again. It never works round a safeguard.

## The on-site path (T-182)

- One thing per screen, the main button at the bottom under the thumb, 56 px rows and buttons. A business with
  one service skips the service step; tapping a service moves straight on.
- A photo starts uploading the moment it is taken, in the background, with its progress shown on it.
- Everything typed and every photo is saved on the phone as it happens (`src/lib/outbox.ts`). Closing the app
  or losing the signal loses nothing; the unfinished quote is there when the app is opened again.
- "Price this job" works with no signal. The quote waits at the top of the quotes list and is sent by itself
  when the phone is back online.
- A quote is never made twice. Each draft has one id, sent with every attempt; the server answers the quote it
  already made (`clientRequestId`).
- A new quote can be started with no signal at all once the phone has seen the business's services (they are
  kept on the phone).
- Only the customer's name is needed. With an email address, the customer is also emailed their link.

## How it matches the web

Nothing is decided in the app. The words and the rules come from the shared package:

| What | Where it comes from |
|---|---|
| Status, the line under it, the next step | `packages/shared/src/quote-turn.ts` (the dashboard's wording) |
| What can be shared, and when | `quote-status.ts` (`canCopyQuoteLink`) |
| The minimum charge: a note, never a line | `minimum-charge.ts` (AD-048) |
| A combined quote: one total, sections | `quote-sections.ts` (T-179) |
| Saved, not priced (plan limit, paused account) | the server's `held` mark; `/api/quotes/:id/process` answers 402 or 403 |
| A request that could not be priced | the view carries the request and its photos (T-178) |
| The account line (paused, a failed payment) | `/api/billing/notice`, the line the dashboard shows |

A quote the business makes on site is hidden from the customer until the business approves it (T-146, T-147:
there is no customer waiting on a page). So the quote screen's main button is "Approve & send": it approves,
then opens the share sheet with the link.

## Checks

```bash
pnpm --filter @qolumns/mobile typecheck
pnpm --filter @qolumns/mobile lint
pnpm --filter @qolumns/mobile test                 # the pure modules in src/lib (no React Native runtime)
cd apps/mobile && npx expo export --platform ios   # the full JavaScript bundle
npx tsx scripts/hardcore-test/verify-t182.mts      # the app's own client and queue against the local stack
```

Not covered by any of these: the app running on a phone (camera, keychain, files, the share sheet). That is the
owner's test in OWNER-TODO.
