-- Quote lifecycle completion: decline, expiry job, reminders
-- Adds the 'declined' status plus tracking columns. The lifecycle cron
-- (apps/web /api/cron/lifecycle) flips expired quotes and sends one
-- reminder per quote; reminder_sent_at prevents repeats.

ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'declined' AFTER 'accepted';

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS decline_reason TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
