-- T-197: the Help button's data: problem reports, estimate reports, their
-- threads, feature requests and votes.
--
-- 1. support_reports: what a business sent ("What went wrong?" or a report
--    on one estimate), with what we attach, its status, and the one hint a
--    business may be shown about its own prices. A business reads its own
--    rows and may add one; it changes nothing afterwards (the server marks a
--    reply as read).
-- 2. support_report_internal: the owner's side of a report: the AI's sorting,
--    the draft fix ticket, the private note, merges. Service role only, so a
--    business can never read it.
-- 3. support_messages: the thread on a report. A business reads its own and
--    may add its own side.
-- 4. feature_requests and feature_votes: one request, many businesses. A
--    business reads its own votes and the requests it voted for, and nothing
--    about who else asked. The server writes both (one vote per business per
--    request is the table's own rule).
--
-- Everything hangs off tenants(id) ON DELETE CASCADE: when a closed account's
-- data is deleted, its reports, threads and votes go with it.
--
-- Additive and re-runnable. Nothing is deleted. No existing row is changed.

-- ---------- 1. reports ----------
CREATE TABLE IF NOT EXISTS support_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- who sent it (kept when the user is removed: the business still owns the report)
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('problem', 'estimate')),
  -- the business's own words
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  -- an estimate report's choices ('too_high', 'too_low', ...)
  choices TEXT[] NOT NULL DEFAULT '{}',
  -- "What should the total have been?" Recorded only: nothing reads it to price anything.
  expected_total NUMERIC(12, 2) CHECK (expected_total IS NULL OR expected_total >= 0),
  currency TEXT,
  -- the estimate, by id. Nothing is copied out of the quote.
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  screenshot_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  -- what we attach: the page, the plan, the browser, the screen size, the last error shown
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'looking', 'fixed', 'answered', 'not_a_fault')),
  -- "This may be down to your prices": {line, rate, serviceId}, written by the sorter from the business's own setup
  setup_hint JSONB,
  -- a reply from us the business has not opened yet
  reply_unread BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_reports_tenant ON support_reports(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_reports_quote ON support_reports(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_reports_status ON support_reports(status, created_at DESC);

DROP TRIGGER IF EXISTS support_reports_updated_at ON support_reports;
CREATE TRIGGER support_reports_updated_at
  BEFORE UPDATE ON support_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE support_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_reports FROM anon;
REVOKE ALL ON support_reports FROM authenticated;
GRANT SELECT, INSERT ON support_reports TO authenticated;

DROP POLICY IF EXISTS "Businesses can view own support reports" ON support_reports;
CREATE POLICY "Businesses can view own support reports" ON support_reports
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- A new report is the sender's own, in the sender's own business, and starts as "new" with nothing of ours on it
DROP POLICY IF EXISTS "Businesses can add own support reports" ON support_reports;
CREATE POLICY "Businesses can add own support reports" ON support_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    AND status = 'new'
    AND setup_hint IS NULL
    AND reply_unread = FALSE
    AND (quote_id IS NULL OR EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.tenant_id = support_reports.tenant_id))
    AND (screenshot_asset_id IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id = screenshot_asset_id AND a.tenant_id = support_reports.tenant_id))
  );

COMMENT ON TABLE support_reports IS 'T-197: a problem a business reported, or a report on one estimate. A business reads its own rows and may add one. expected_total is recorded only and never read to price anything.';

-- ---------- 2. the owner's side of a report ----------
CREATE TABLE IF NOT EXISTS support_report_internal (
  report_id UUID PRIMARY KEY REFERENCES support_reports(id) ON DELETE CASCADE,
  -- the AI's sorting
  title TEXT,
  summary TEXT,
  ai_kind TEXT CHECK (ai_kind IS NULL OR ai_kind IN ('fault', 'how_to', 'billing', 'feature', 'other')),
  severity TEXT CHECK (severity IS NULL OR severity IN ('high', 'medium', 'low')),
  -- up to three open problems that look the same: [{id, confidence}]
  similar_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- an estimate report's likely cause, read from the pricing trace
  likely_cause TEXT CHECK (likely_cause IS NULL OR likely_cause IN ('setup', 'ai_reading', 'fault', 'unknown')),
  evidence TEXT,
  fix_ticket TEXT,
  -- the template the estimate's service matches by name, or null
  service_template TEXT,
  sort_state TEXT NOT NULL DEFAULT 'waiting' CHECK (sort_state IN ('waiting', 'sorted', 'failed')),
  sort_attempts INTEGER NOT NULL DEFAULT 0,
  sorted_at TIMESTAMPTZ,
  model TEXT,
  -- the owner's own
  merged_into UUID REFERENCES support_reports(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  owner_note TEXT,
  -- when this business was emailed that the problem is fixed (once)
  fixed_emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_internal_merged ON support_report_internal(merged_into) WHERE merged_into IS NOT NULL;

DROP TRIGGER IF EXISTS support_report_internal_updated_at ON support_report_internal;
CREATE TRIGGER support_report_internal_updated_at
  BEFORE UPDATE ON support_report_internal
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE support_report_internal ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it
REVOKE ALL ON support_report_internal FROM anon, authenticated;

COMMENT ON TABLE support_report_internal IS 'T-197: the owner''s side of a support report: the AI''s sorting, the draft fix ticket, the private note, merges. Service role only; a business can never read it.';

-- ---------- 3. the thread ----------
CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('business', 'team')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_report ON support_messages(report_id, created_at);

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_messages FROM anon;
REVOKE ALL ON support_messages FROM authenticated;
GRANT SELECT, INSERT ON support_messages TO authenticated;

DROP POLICY IF EXISTS "Businesses can view own support messages" ON support_messages;
CREATE POLICY "Businesses can view own support messages" ON support_messages
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- A business writes its own side only, on its own report
DROP POLICY IF EXISTS "Businesses can add own support messages" ON support_messages;
CREATE POLICY "Businesses can add own support messages" ON support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author = 'business'
    AND user_id = auth.uid()
    AND tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM support_reports r WHERE r.id = report_id AND r.tenant_id = support_messages.tenant_id)
  );

COMMENT ON TABLE support_messages IS 'T-197: the thread on a support report. A business reads its own threads and adds its own side; our replies are written by the server.';

-- ---------- 4. feature requests ----------
CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 400),
  -- 'words' = the first business's own words, not yet rewritten: never shown to another business
  title_source TEXT NOT NULL DEFAULT 'words' CHECK (title_source IN ('words', 'ai', 'owner')),
  status TEXT NOT NULL DEFAULT 'under_review' CHECK (status IN ('under_review', 'planned', 'shipped', 'not_planned')),
  merged_into UUID REFERENCES feature_requests(id) ON DELETE SET NULL,
  -- when the owner first opened it (the count of new items in the admin area)
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS feature_requests_updated_at ON feature_requests;
CREATE TRIGGER feature_requests_updated_at
  BEFORE UPDATE ON feature_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS feature_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- the business's own words
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  -- when this business was emailed that the request shipped (once)
  shipped_emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- one vote per business per request
  UNIQUE (request_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_feature_votes_tenant ON feature_votes(tenant_id, created_at DESC);

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON feature_requests FROM anon;
REVOKE ALL ON feature_requests FROM authenticated;
REVOKE ALL ON feature_votes FROM anon;
REVOKE ALL ON feature_votes FROM authenticated;
GRANT SELECT ON feature_requests TO authenticated;
GRANT SELECT ON feature_votes TO authenticated;

DROP POLICY IF EXISTS "Businesses can view own feature votes" ON feature_votes;
CREATE POLICY "Businesses can view own feature votes" ON feature_votes
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- Only the requests this business voted for. Who else asked is in feature_votes, which shows a business its own rows only.
DROP POLICY IF EXISTS "Businesses can view requests they voted for" ON feature_requests;
CREATE POLICY "Businesses can view requests they voted for" ON feature_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM feature_votes v
      WHERE v.request_id = feature_requests.id
        AND v.tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    )
  );

COMMENT ON TABLE feature_requests IS 'T-197: one feature request, asked for by one or more businesses. A business reads only the requests it voted for; the server writes.';
COMMENT ON TABLE feature_votes IS 'T-197: one business asking for one feature request, with its own words. One per business per request. A business reads only its own.';
