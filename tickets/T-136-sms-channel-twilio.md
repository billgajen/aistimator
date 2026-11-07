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
- [ ] A customer texts the business number, sends photos by MMS and receives a priced quote link by SMS
- [ ] STOP blocks all further sends to that number for that tenant; START re-enables
- [ ] The WhatsApp flow passes its existing tests unchanged
- [ ] The Twilio webhook rejects unsigned or invalid requests
