# tickets/T-023-whatsapp-guided-intake-v2.md

## Goal
Implement WhatsApp chat intake flow and send hosted quote link.

## In scope
- Basic keyword trigger and guided Q&A
- Receive media uploads and attach as assets
- Create quote request internally
- Send message with quote summary + hosted quote link

## Out of scope
- Complex branching and language support

## Acceptance criteria
- [x] Customer can complete intake in WhatsApp
- [x] Quote generated and link delivered back in WhatsApp

## Implementation Summary

**Files Created:**
- `apps/web/src/lib/whatsapp-intake.ts` - Complete intake state machine and flow handler

**Files Modified:**
- `packages/shared/src/database.types.ts` - Added `WhatsAppIntakeState` enum and `WhatsAppIntakeData` interface, extended `WhatsAppConversation` with `intake_state` and `intake_data` fields
- `apps/web/src/app/api/whatsapp/webhook/route.ts` - Integrated intake handler into webhook processing

**Conversation Flow:**
1. Customer sends trigger keyword ("quote", "estimate", "price", etc.)
2. Bot presents service selection (if multiple services) or skips to step 3
3. Bot collects customer name
4. Bot collects email address
5. Bot collects phone number (or uses WhatsApp number)
6. Bot collects job address/postcode
7. Bot prompts for photos (customer can send multiple, then "done")
8. Bot shows summary and asks for confirmation
9. On confirmation, creates quote_request + quote, triggers processing queue
10. Bot sends back quote view URL

**State Machine States:**
- `idle` - Waiting for trigger keyword
- `awaiting_service` - Selecting service (multiple services)
- `awaiting_name` - Collecting customer name
- `awaiting_email` - Collecting email
- `awaiting_phone` - Collecting phone
- `awaiting_address` - Collecting address/postcode
- `awaiting_photos` - Receiving photos
- `awaiting_confirmation` - Confirming before submission
- `processing` - Quote is being generated
- `completed` - Quote sent

**Database Schema Changes Required:**
```sql
-- Add intake columns to whatsapp_conversations
ALTER TABLE whatsapp_conversations
ADD COLUMN intake_state TEXT DEFAULT 'idle',
ADD COLUMN intake_data JSONB DEFAULT '{}';
```