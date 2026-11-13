-- T-157: a link the customer already has keeps working.
--
-- Raw quote tokens are never stored, so every action that hands out a link
-- (copy link, send again, text link, the 3-day reminder, approval, edit and
-- send, re-pricing) makes a new token and replaces quotes.quote_token_hash.
-- Until now that broke the link in the customer's earlier email; T-146 kept
-- one earlier link (previous_token_hash) for approval and edit-and-send only.
--
-- quotes.link_token_hashes: the sha256 of every earlier link of the quote,
--   newest first, no duplicates, at most 10.
-- quotes_keep_link_tokens (BEFORE UPDATE): whenever quote_token_hash changes,
--   the hash it replaces is put at the front of that list. A trigger, so no
--   route can forget. It only edits the row being written, so it needs no
--   extra rights (not SECURITY DEFINER).
--
-- Expiry is unchanged: quotes.token_expires_at covers every link of the quote.
-- previous_token_hash stays and is still accepted.
--
-- Additive and re-runnable.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS link_token_hashes TEXT[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN quotes.link_token_hashes IS 'T-157: sha256 of every earlier customer link (newest first, max 10), kept by trigger quotes_keep_link_tokens; all expire with token_expires_at';

CREATE OR REPLACE FUNCTION public.quotes_keep_link_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  kept TEXT[];
BEGIN
  IF NEW.quote_token_hash IS DISTINCT FROM OLD.quote_token_hash AND OLD.quote_token_hash IS NOT NULL THEN
    -- the replaced hash first, without a second copy of it further down
    kept := array_prepend(
      OLD.quote_token_hash,
      array_remove(COALESCE(NEW.link_token_hashes, '{}'::TEXT[]), OLD.quote_token_hash)
    );
    -- the current hash never also sits in the list
    IF NEW.quote_token_hash IS NOT NULL THEN
      kept := array_remove(kept, NEW.quote_token_hash);
    END IF;
    NEW.link_token_hashes := COALESCE(kept[1:10], '{}'::TEXT[]);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_keep_link_tokens ON quotes;
CREATE TRIGGER quotes_keep_link_tokens
  BEFORE UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION quotes_keep_link_tokens();
