-- T-147: show, then confirm (the new default for customer-facing estimates).
--
-- services.hold_until_approved: off by default. Off (and auto_send off) = the
-- customer sees the estimate at once, marked as an estimate the business will
-- confirm; Accept stays locked until the business approves. On = the T-146
-- behaviour: the customer sees "being prepared" and no price until approval.
-- services.auto_send (migration 30) is unchanged and wins if both are set.
-- Existing services get the new default.
--
-- quotes.review_hold: why a pending_review quote is waiting for the business.
--   'shown' = review by default, the customer already sees the estimate
--   'held'  = review by default, hidden until approved
--   'check' = a check held it (validation, quality gate, send-guard); hidden
-- NULL on older rows and on leads held at the plan limit: hidden, as before.
--
-- Additive and re-runnable.

ALTER TABLE services ADD COLUMN IF NOT EXISTS hold_until_approved BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN services.hold_until_approved IS 'T-147: hide the estimate from the customer until the business approves it (default off = show, then confirm)';

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS review_hold TEXT;
COMMENT ON COLUMN quotes.review_hold IS 'T-147: why the quote awaits the business: shown | held | check (NULL = hidden)';

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_review_hold_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_review_hold_check
  CHECK (review_hold IS NULL OR review_hold IN ('shown', 'held', 'check'));
