# tickets/T-022-whatsapp-webhook.md

## Goal
WhatsApp Business Cloud API integration for receiving customer messages.

## In scope
- WhatsApp webhook endpoint for receiving messages
- WhatsApp Cloud API client for sending messages
- Tenant WhatsApp configuration (phone number ID, access token)
- Dashboard settings page for WhatsApp setup
- Store WhatsApp conversations in database
- Send quote link via WhatsApp when ready

## Out of scope
- Full guided intake flow (T-023)
- WhatsApp template message approval workflow
- Multi-number support per tenant
- WhatsApp payment integration

## Acceptance criteria
- [x] Webhook receives and verifies WhatsApp messages
- [x] Tenant can configure WhatsApp credentials in dashboard
- [x] System can send messages via WhatsApp Cloud API
- [x] Conversations stored for reference

## Implementation Summary

**Files created:**
- `apps/web/src/lib/whatsapp.ts` - WhatsApp Cloud API client with message sending, webhook parsing, token encryption
- `apps/web/src/app/api/whatsapp/webhook/route.ts` - Webhook verification (GET) and message receiving (POST)
- `apps/web/src/app/api/whatsapp/send/route.ts` - Send WhatsApp messages API
- `apps/web/src/app/api/whatsapp/config/route.ts` - CRUD for tenant WhatsApp configuration
- `apps/web/src/app/(dashboard)/app/whatsapp/page.tsx` - Dashboard settings page for WhatsApp setup

**Database types added to `packages/shared/src/database.types.ts`:**
- `WhatsAppConfig` - Tenant WhatsApp credentials
- `WhatsAppConversation` - Customer conversation tracking
- `WhatsAppMessage` - Message history

**Environment variables:**
- `WHATSAPP_VERIFY_TOKEN` - Webhook verification token
- `WHATSAPP_APP_SECRET` - Meta app secret for signature verification
- `WHATSAPP_ENCRYPTION_KEY` - Key for encrypting stored access tokens

## Technical Notes

**WhatsApp Cloud API Setup:**
- Requires Meta Business account
- Requires WhatsApp Business API access
- Webhook verification uses verify_token
- Messages signed with app secret

**Environment Variables:**
```
WHATSAPP_VERIFY_TOKEN=your-verify-token
WHATSAPP_APP_SECRET=your-app-secret
```

**Per-tenant config (stored in DB):**
- phone_number_id: WhatsApp phone number ID
- access_token: Encrypted access token
- is_active: Whether WhatsApp is enabled
