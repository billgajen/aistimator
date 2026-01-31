# tickets/T-022-whatsapp-webhook-and-connection-docs.md

## Goal
Add WhatsApp as an optional channel with clear setup guidance.

## In scope
- Docs page in dashboard explaining setup steps
- WhatsApp webhook endpoint `/api/whatsapp/webhook` receiving messages
- Store WhatsApp connection config fields (placeholders)
- “Connection status” UI (manual for v1)

## Out of scope
- Full automated onboarding with Meta verification flows

## Acceptance criteria
- [ ] Webhook endpoint receives and logs events safely
- [ ] Dashboard shows setup checklist and status