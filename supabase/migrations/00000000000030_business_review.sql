-- T-146: business review by default.
--
-- services.auto_send: off by default, so new quotes wait for the business to
-- approve them ("Awaiting business approval"). On = quotes go straight to the
-- customer, as before T-146. Existing services also default to off (owner
-- decision 2026-11-09: review is the default for everyone).
--
-- quotes.approved_at / approved_by: when the business approved (or edited and
-- sent) the quote. The customer page shows "Quote — reviewed and confirmed by
-- {business}" only when this is set; otherwise it is an "Estimate".
--
-- quotes.previous_token_hash: approving issues a fresh link for the email; the
-- link the customer already holds (from the widget) stays valid through this
-- column instead of breaking.
--
-- Additive and re-runnable.

ALTER TABLE services ADD COLUMN IF NOT EXISTS auto_send BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN services.auto_send IS 'T-146: send quotes to the customer without business review (default off)';

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS previous_token_hash TEXT;
COMMENT ON COLUMN quotes.approved_at IS 'T-146: business approved / confirmed this quote (customer sees "Quote" instead of "Estimate")';
COMMENT ON COLUMN quotes.previous_token_hash IS 'T-146: the customer link issued before approval, still accepted';

CREATE INDEX IF NOT EXISTS idx_quotes_previous_token_hash
  ON quotes (previous_token_hash) WHERE previous_token_hash IS NOT NULL;
