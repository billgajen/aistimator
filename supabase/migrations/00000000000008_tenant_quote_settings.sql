-- Tenant Quote Settings and Notifications Migration
-- Adds notification email override and default terms text

-- Notification email override (for quote alerts, separate from account email)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_email TEXT;

-- Default terms text to include on quotes
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_terms_text TEXT;

-- Comments
COMMENT ON COLUMN tenants.notification_email IS 'Override email for quote notifications (if null, uses account email)';
COMMENT ON COLUMN tenants.default_terms_text IS 'Default terms and conditions text to include on quotes';
