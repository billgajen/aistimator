-- T-160: unfinished requests that clear.
--
-- request_leads.seen_at:    when the business first saw this unfinished request
--                           (set when it opens the Unfinished list). The Home
--                           banner and the menu badge count only the ones with
--                           no seen_at, so both clear once the list is opened
--                           and return only for a new person.
-- request_leads.handled_at: when the business pressed "Done" on the person. A
--                           handled request leaves the list and every count.
--
-- Both are written by signed-in dashboard routes with the service role, scoped
-- to the caller's tenant. No new policy: the business still only reads its own
-- rows, and cannot write to this table directly.
--
-- Additive and re-runnable.

ALTER TABLE request_leads ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;
ALTER TABLE request_leads ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;

COMMENT ON COLUMN request_leads.seen_at IS 'T-160: when the business first saw this unfinished request (null = new)';
COMMENT ON COLUMN request_leads.handled_at IS 'T-160: when the business marked this unfinished request as done (leaves the list)';

-- The banner and the badge count new, open requests on every dashboard page
CREATE INDEX IF NOT EXISTS idx_request_leads_tenant_new ON request_leads (tenant_id, created_at DESC)
  WHERE completed_at IS NULL AND handled_at IS NULL AND seen_at IS NULL;
