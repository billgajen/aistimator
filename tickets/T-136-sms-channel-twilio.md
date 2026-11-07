# tickets/T-136-sms-channel-twilio.md

## Goal
SMS intake and quote delivery for US businesses (AD-027), reusing the WhatsApp
conversation engine. SMS/MMS is the default messaging channel in the US.

## In scope
- **Channel abstraction:** refactor `whatsapp-intake.ts` so the intake state machine and
  conversational logic are channel-agnostic, with thin adapters (`whatsapp`, `sms`) for
  send, receive, media download and message length limits. WhatsApp behaviour must not change.
- **Twilio adapter:** inbound webhook (signature verified), outbound send, MMS photo
  ingestion to R2 (same path WhatsApp media uses), per-tenant phone number.
- **Compliance basics:** STOP/START/HELP keywords handled automatically, opt-out stored per
  phone number per tenant and respected on every send, consent line in the first message.
- **Tenant setup UI:** connect a Twilio number. Show a clear checklist for US A2P 10DLC
  registration (brand + campaign), which the business or we must complete before
  sending at volume. Link out; don't automate registration in this ticket.
- **Outbound quote delivery:** the business can send a quote link by SMS from the
  dashboard (and later from the mobile app).
- Usage: count SMS segments per tenant for cost visibility (no billing change).

## Out of scope
- Automated 10DLC registration via a provider (later). Voice calls. Group MMS.

## Acceptance criteria
- [ ] A customer texts the business number, sends photos by MMS and receives a priced quote link by SMS — verified end to end in TEST MODE (signed webhooks, simulated MMS host); a live Twilio round trip needs the owner's account (OWNER-TODO.md)
- [x] STOP blocks all further sends to that number for that tenant; START re-enables
- [x] The WhatsApp flow passes its existing tests unchanged (characterisation tests written against the old code first)
- [x] The Twilio webhook rejects unsigned or invalid requests

## Plan
1. **Pin WhatsApp first:** characterization tests for the current WhatsApp intake (replies,
   transitions, quote creation) before touching it.
2. **Channel abstraction:** move the state machine to `lib/messaging/intake-engine.ts`, driven by a
   `ChannelAdapter` (send, media download, emphasis, sender-number wording, conversation table).
   `whatsapp-intake.ts` becomes a thin adapter; the pinned tests must pass unchanged.
3. **Twilio library** `lib/sms.ts` (no SDK): webhook signature verification (HMAC-SHA1), sending,
   MMS download, GSM-7/UCS-2 segment counting, STOP/START/HELP keywords, opt-out store checked on
   every send, test mode (`SMS_TEST_MODE`, or no credentials) that records but never sends.
4. **Migration 27:** `sms_configs`, `sms_conversations`, `sms_messages` (with segments), `sms_opt_outs`,
   all with RLS (tenant-scoped reads; only the customer's START can clear an opt-out).
5. **Webhook** `/api/sms/webhook`: fail closed on missing/invalid signatures; compliance keywords first;
   MMS items → photos; one reply per inbound (saves segments); consent line on the first reply.
6. **Dashboard:** `/app/sms` (number, Messaging Service SID, A2P 10DLC checklist with links, monthly
   segments), nav link, "Text link" on the quote detail page via `/api/sms/send-quote`.
7. **Phone normalisation** uses a new region `callingCode` (no US-only assumptions).
8. **Verify** with `verify-t136.mjs` in test mode (signed webhooks, MMS, priced link, STOP/START);
   gates; CHANGELOG; OWNER-TODO for the Twilio account, number and 10DLC registration.

## Implementation Summary
- Shared intake engine (`lib/messaging/`) with WhatsApp and SMS adapters; WhatsApp behaviour pinned by tests.
- Twilio client without an SDK: signature verification, send, MMS download, segments, STOP/START/HELP,
  opt-out enforced on every send, consent line, test mode.
- Migration 27 (four SMS tables, RLS), webhook, `/app/sms` setup page with 10DLC checklist,
  "Text link" from the quote page, region calling codes for phone normalisation.
- Verified 18/18 in test mode (`verify-t136.mjs`); live Twilio steps are owner items.
