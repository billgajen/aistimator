# The business's on-site app (Expo)

A trade on a site visit: open the app, new quote, pick the service, take the photos, answer the service's own
questions, add a note and the customer's name, see the price, approve it and send the customer their link from
the phone's share sheet (a text, WhatsApp, an email).

Built in T-137 (the app), T-138 (LiDAR room scan), T-182 (the on-site path, and matching the web) and T-184
(three tabs, the quote screen, Account, the look).

## What it is built with

- Expo SDK 58, React Native 0.88, React 19, expo-router. TypeScript, strict.
- Expo modules: secure-store (the sign-in, in the keychain), image-picker (camera and library),
  image-manipulator (photos are made smaller before upload), file-system (drafts and photos kept on the
  phone, uploads with progress), constants, linking, status-bar, font, haptics, clipboard, splash-screen.
- One native module of our own: `modules/room-scan` (Swift, Apple RoomPlan, LiDAR). Its native source
  (`modules/room-scan/ios`) must be in git, or the build service never receives it and the store build has no
  scanner (T-206). Two checks stop such a build: `scripts/check-room-scan.mjs` (the `eas-build-post-install`
  hook) and the Xcode step added by `plugins/with-room-scan-linked.js`.
- No UI kit. Colours, sizes and faces are in `src/theme.ts`; `Docs/design/system.md` decides them. The three
  brand faces come from `@expo-google-fonts/*`; the one icon set is Ionicons (`@expo/vector-icons`), always
  through the `Icon` component in `src/components/ui.tsx`. The QR code is drawn from plain views
  (`qrcode-generator`, the dashboard's encoder).

## The screens (T-184)

| Where | What |
|---|---|
| **Quotes** tab (`app/(tabs)/index.tsx`) | what needs me now: "Needs you" first with its count, then "Waiting for customer", "Accepted", the rest; quotes still on this phone above them; search by customer name; pull to refresh |
| **New quote** tab, in the centre (`app/(tabs)/new.tsx`) | the on-site path; the tab reads "Carry on" while a quote is unfinished |
| **Account** tab (`app/(tabs)/account.tsx`) | the business's name and logo, the plan's name and quotes used (no prices, no way to buy), the quote link and its QR code, help, the version, sign out |
| Quote (`app/quote/[id].tsx`) | everything for one job: the price, the photos (tap for full screen), anything to confirm, the lines and where each quantity came from, "Customer also asked for", the progress steps, call and message, the request, the link, "Edit in the dashboard" |
| `app/photo.tsx`, `app/link.tsx` | a photo full screen; the quote link's QR code full screen |

The tabs draw their own tops (`TopBar`), so nothing a screen shows can sit under a navigation header.

## Expo Go or a development build

**Everything except the LiDAR room scan runs in Expo Go.** No Apple Developer account and no Xcode are needed.
The room scan is native code, so it needs the full app (a development build or the store build). In Expo Go the
scan card is still shown, where a service has a quantity a scan can measure, but disabled, with "Room scan needs
the full app" (`roomScanAvailability()` in `modules/room-scan`); the sizes can be typed in instead.

The two ways to get the full app onto an iPhone (a free Apple ID with Xcode, or an Apple Developer account with
EAS) are written out step by step in `OWNER-TODO.md` under T-184. A trial build is made with `APP_VARIANT=dev`
(`app.config.js`): it gets its own identifier, `com.qolumns.app.dev`, so the real one stays free for the App
Store. `eas.json` holds the build settings. Neither way has been tried: there is no Xcode on the build machine.

## Notifications (T-196)

Three notifications, and nothing else: a customer's new request, an accepted estimate, a customer's question.
The server sends them (`packages/shared/src/push.ts`); the app registers the phone, shows the three switches on the
Account tab and opens the quote of a tapped notification.

**They belong to the App Store build only.** A free Personal Team cannot sign an app that asks for the push
entitlement, so `app.config.js` builds the two variants differently:

| | App Store build (no `APP_VARIANT`) | Dev build (`APP_VARIANT=dev`) |
|---|---|---|
| The `expo-notifications` plugin | with its defaults: adds the push entitlement | named with `enableRemoteNotifications: false`, and the entitlement is deleted from an existing `ios` folder |
| `extra.push` | `true` | `false` |
| In the app | asks once on the home tab, registers the phone, three switches | never loads the notifications module; Account says "Available in the App Store version" |

Leaving the plugin out of the dev build is not enough: Expo applies the plugin of an installed package by itself,
and that adds the entitlement. `src/lib/notifications.ts` is the only file that touches the module, and every
function in it returns first when `pushBuild` is false. The App Store build also needs the Expo project id
(`npx eas init` writes `extra.eas.projectId`); without it the app behaves as the dev build does.

## Android (T-200)

The same app, built for Google Play as `com.qolumns.app`. What differs from the iPhone:

- **No room scan.** `roomScanAvailability()` answers `not_ios`, and every scan control hangs on it: no scan card
  on a new quote, no "Scan again" or "Add an area". A quote scanned on an iPhone shows its sizes and floor plan,
  read-only. The scanner's native code is not in the Android build (`modules/room-scan/expo-module.config.json`
  names Apple only).
- **"View in 3D" (T-201)** is there on Android too. The viewer is the web's page (`/room-model`); an iPhone shows
  it in Safari's in-app browser, Android opens it in the phone's own browser (`openPage` falls back to
  `Linking.openURL`). The button is given to the scan card only when `canOpenPage()` says the phone can open a web
  address, so a phone with no browser shows no button. Seen drawing a model in Chrome's engine with an Android
  phone profile; not seen on an Android phone.
- **Tablets, Chromebooks, headsets (T-201).** The app is portrait-only on a phone, and Google Play reads that as
  "needs a portrait screen" and hides the app from everything else. `plugins/with-optional-hardware.js` declares
  a portrait screen, a back camera and autofocus as `required="false"` in the manifest. Check the built bundle's
  manifest for the three `uses-feature` lines after any change to the plugin. A device with no camera goes to
  the gallery when "Take a photo" is pressed.
- **The keyboard.** Expo SDK 58 draws edge to edge on Android, and Android no longer makes such a window smaller
  when the keyboard opens. `KeyboardSpace` (`src/components/ui.tsx`) pads for the keyboard on both phones; use it
  on any screen with a text field at the bottom. Never `behavior={Platform.OS === 'ios' ? … : undefined}`.
- **The back button.** In "New quote" it is the form's own "Back" (the step before; from the first step, the
  Quotes tab) and never closes the app; elsewhere it is the navigation's own.
- **Notifications** need Firebase's file in the build (`google-services.json`, or the EAS file variable
  `GOOGLE_SERVICES_JSON`). `app.config.js` uses it when it is there and sets `extra.pushAndroid`; without it the
  app builds and runs, never asks for the permission, and Account says "Not in this version of the app yet".
- **Light only.** `userInterfaceStyle: "light"` does nothing on Android without `expo-system-ui`, which is why
  that package is installed.
- **Permissions:** camera, notifications, vibrate, internet, network state, what push delivery needs, and
  (Android 12 and older only) writing to storage, which Android 9 and older need before they will open the
  camera. Everything else Expo's packages add is taken out by name (`android.blockedPermissions` in `app.json`):
  microphone, reading storage, fingerprint, launcher badges, install referrer. Libraries add permissions when the
  build merges manifests, so the place to check is the built bundle, not the generated project.
- **Icon:** `assets/adaptive-icon.png` is the icon at 72%, so the mark sits inside the circle Android cuts;
  `assets/notification-icon.png` is the mark alone in white, which Android draws in the brand colour.

The store build: `npx eas-cli@latest build -p android --profile production` (an app bundle, signed with a key
Expo keeps; `eas.json`). The two server addresses are in `eas.json`; the Supabase anon key is an EAS environment
variable, so it is not in the repository. Nothing here has run on an Android phone or emulator: the build
machine has neither (OWNER-TODO, T-200, has the list to go through on a phone).

## Run it

```bash
cd apps/mobile
cp .env.example .env        # fill the three values; the file says where each comes from
npx expo start              # scan the QR code with the iPhone's camera; it opens in Expo Go
```

A missing value does not crash the app: it opens on one screen naming what is missing.

Step-by-step instructions for the owner's iPhone, against production, are in `OWNER-TODO.md` under T-182; what
to try since T-184 is under T-184.

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

Not covered by any of these: the app running on a phone (camera, keychain, files, the share sheet, fonts,
haptics, VoiceOver, the room scan). That is the owner's test in OWNER-TODO.

## Rules learned the hard way

- **A number from the phone goes through `toNumber` first** (`src/lib/numbers.ts`). iOS hands some values to
  JavaScript as BigInt whatever their declared type says (an upload's byte counts are 64-bit integers there),
  and a BigInt mixed with an ordinary number throws. That was the red "Cannot convert BigInt to number" of the
  first phone test.
- **Nothing a program wrote is shown to a person.** Every message on a screen goes through `plainError`
  (`src/lib/errors.ts`); a fault while a screen is drawn is caught by `ErrorBoundary`.
- **A custom face is named by its family, never with `fontWeight` beside it** (each weight is its own file).
- **An app may not point at a purchase outside it.** No price, no "upgrade", no link to billing, anywhere.
