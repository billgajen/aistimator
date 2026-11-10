-- T-156: approve a quote from the "Review and approve" email in one tap,
-- without logging in.
--
-- quote_approval_tokens: one row per link the worker puts in that email.
--   Bound to one quote and one tenant. Only the sha256 of the token is stored.
--   Expires 72 hours after it is issued; single use (used_at); attempts counts
--   presses for the per-link limit (counted here, so it holds without Redis).
--   Row-level security on with no policies: only the service role (worker and
--   the web app's server) can read or write it. A link can approve its quote
--   and nothing else; it is never a login session.
-- invalidate trigger: when a quote's status, version, price or wording changes
--   (approved, edited, declined, expired, repriced — by any route), every
--   unused link for it stops working. SECURITY DEFINER so an edit made with a
--   business user's token (no access to this table) still invalidates.
-- quotes.approved_via: how it was approved (dashboard, app or email_link);
--   approved_at already records when.
--
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS quote_approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidated_reason TEXT CHECK (invalidated_reason IN ('replaced', 'quote_changed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE quote_approval_tokens IS 'T-156: single-use links in the review email that approve one quote (hash only; service role only)';

CREATE INDEX IF NOT EXISTS idx_quote_approval_tokens_quote ON quote_approval_tokens (quote_id) WHERE used_at IS NULL AND invalidated_at IS NULL;

ALTER TABLE quote_approval_tokens ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon and authenticated users can do nothing here.
REVOKE ALL ON quote_approval_tokens FROM anon, authenticated;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_via TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_approved_via_check') THEN
    ALTER TABLE quotes ADD CONSTRAINT quotes_approved_via_check CHECK (approved_via IN ('dashboard', 'app', 'email_link'));
  END IF;
END;
$$;
COMMENT ON COLUMN quotes.approved_via IS 'T-156: how the business approved it (dashboard, app, email_link); approved_at is when';

-- ---------- a change to the quote ends its open links ----------
CREATE OR REPLACE FUNCTION public.quotes_invalidate_approval_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.pricing_json IS DISTINCT FROM OLD.pricing_json
     OR NEW.content_json IS DISTINCT FROM OLD.content_json THEN
    UPDATE quote_approval_tokens
       SET invalidated_at = now(), invalidated_reason = 'quote_changed'
     WHERE quote_id = NEW.id
       AND used_at IS NULL
       AND invalidated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.quotes_invalidate_approval_links() FROM PUBLIC;

DROP TRIGGER IF EXISTS quotes_invalidate_approval_links ON quotes;
CREATE TRIGGER quotes_invalidate_approval_links
  AFTER UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION quotes_invalidate_approval_links();
