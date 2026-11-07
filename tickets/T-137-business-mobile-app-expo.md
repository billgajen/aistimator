# tickets/T-137-business-mobile-app-expo.md

## Goal
The business's own app for quoting on site (AD-027): stand in the customer's home, take
photos or a voice note, and send a professional estimate before leaving.

## Decisions
- **Expo (React Native, TypeScript)** in `apps/mobile`, sharing types from `@estimator/shared`.
  One codebase for iOS and Android; native modules (T-138) via Expo config plugins and
  development builds (no Expo Go dependency for scanning).
- The app is a client of the existing API. No duplicate pricing or AI logic on the device.

## In scope
- **Auth:** Supabase email/password + magic link; tenant resolved via the existing `/api/me`.
- **New authenticated endpoint** for business-created quotes (the public endpoint is
  customer-facing and rate-limited differently): `POST /api/quotes/onsite` with
  service, customer details, assets, answers and an optional transcript. Same pipeline as
  public quotes; `source: 'onsite'`.
- **Screens:**
  1. Quotes list (status, total, grade)
  2. New quote: pick service → customer name/phone/email/address → photos (camera, guided
     angles from the service's capture config) → voice note
  3. Processing → result: line items, takeoff, grade, range
  4. Quick edit (reuse the quote-editor rules: quantities and line items, never AI-set prices)
  5. Send via SMS / email / WhatsApp / share sheet
- **Voice note → transcript** server-side (provider via the T-135 registry), fed in as the
  job description. The business sees and can edit the transcript.
- **Offline-tolerant capture:** photos and the draft stay queued on device and upload when
  back online.
- Push notifications for "customer viewed" and "customer accepted" (Expo notifications).
- Upload via the existing signed-URL flow (`/api/uploads/init`).

## Out of scope
- LiDAR scanning (T-138). Scheduling/CRM. Payments in app. App Store submission (do it
  after T-138, so the first review includes scanning).

## Acceptance criteria
- [ ] On a real iPhone and a real Android phone: log in → create an on-site quote with photos and a voice note → see the priced result → send it by SMS → customer opens the hosted quote page
- [ ] Captured while offline, the quote completes once connectivity returns
- [ ] On-site quotes appear in the web dashboard with `source: onsite`
- [ ] No pricing or AI logic exists in `apps/mobile` (review check)
