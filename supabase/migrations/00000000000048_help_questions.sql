-- T-198: "Ask Qolumns", the assistant in the Help panel.
--
-- 1. help_questions: every question a business asked the assistant, the
--    answer it was given, the guide entries the answer used, the business's
--    "Did this answer it?" and the owner's side (reviewed or not, a private
--    note). Service role only: a business never reads this table. Its own
--    conversation is kept in its browser for the session; the server writes
--    the row and the rating for the signed-in user's business only.
--    Rows are deleted 90 days after they were written (the worker's timer).
-- 2. support_reports.from_assistant: a report made with "Send this to the
--    Qolumns team" (a question the assistant could not answer). It is a
--    how-to question, whatever the sorter would have called it.
-- 3. support_report_internal.draft_reply: for a report that is not a fault,
--    a draft reply for the owner to edit and send. Never sent by itself.
--
-- Everything hangs off tenants(id) ON DELETE CASCADE: when a closed account's
-- data is deleted, its questions go with it.
--
-- Safe to run twice.

-- ---------- 1. the questions ----------
CREATE TABLE IF NOT EXISTS help_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- the questions of one sitting, in order (made in the browser)
  conversation_id UUID NOT NULL,
  -- the business's own words, with any customer's details taken out
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 2000),
  answer TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('answered', 'not_sure', 'not_offered', 'broken', 'team', 'declined', 'failed')),
  -- the ids of the guide entries the answer used (Docs/help)
  entries TEXT[] NOT NULL DEFAULT '{}',
  page TEXT,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  -- "Did this answer it?"
  rating TEXT CHECK (rating IS NULL OR rating IN ('yes', 'no')),
  -- the owner's side
  review TEXT NOT NULL DEFAULT 'open' CHECK (review IN ('open', 'guide_updated', 'nothing_to_do')),
  owner_note TEXT,
  -- the report it became, when the business sent it to the team
  report_id UUID REFERENCES support_reports(id) ON DELETE SET NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_help_questions_tenant ON help_questions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_questions_created ON help_questions(created_at);
CREATE INDEX IF NOT EXISTS idx_help_questions_conversation ON help_questions(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_help_questions_open ON help_questions(created_at DESC) WHERE review = 'open';

DROP TRIGGER IF EXISTS help_questions_updated_at ON help_questions;
CREATE TRIGGER help_questions_updated_at
  BEFORE UPDATE ON help_questions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE help_questions ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it
REVOKE ALL ON help_questions FROM anon, authenticated;

COMMENT ON TABLE help_questions IS 'T-198: questions asked of the Help assistant and its answers, kept 90 days to answer and improve support. Service role only; a business can never read it.';

-- ---------- 2. a report that came from the assistant ----------
ALTER TABLE support_reports ADD COLUMN IF NOT EXISTS from_assistant BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN support_reports.from_assistant IS 'T-198: made with "Send this to the Qolumns team": a question the assistant could not answer.';

-- ---------- 3. a draft reply for the owner ----------
ALTER TABLE support_report_internal ADD COLUMN IF NOT EXISTS draft_reply TEXT;
COMMENT ON COLUMN support_report_internal.draft_reply IS 'T-198: for a report that is not a fault, the AI''s draft reply. The owner edits and sends it; nothing sends it by itself.';
