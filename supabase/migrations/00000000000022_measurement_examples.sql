-- T-123: Measurement memory (Measurement Engine learning loop).
-- Every human-confirmed quantity becomes a calibration example: what the AI
-- measured vs what turned out to be true. Future measurements for the same
-- tenant+service+signal are calibrated against this history — the estimator
-- improves with every confirmed job.
--
-- NOTE: tenant_id/service_id are TEXT with NO foreign keys — local dev uses
-- TEXT prefixed ids (tnt_...) while production uses UUID (see 2026-02-16
-- migration lessons). TEXT holds both; RLS casts for cross-type safety.

CREATE TABLE IF NOT EXISTS measurement_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  signal_key TEXT NOT NULL,
  -- What the AI measured before confirmation
  measured_value NUMERIC NOT NULL,
  -- The human-confirmed true value
  confirmed_value NUMERIC NOT NULL,
  -- Where the confirmation came from
  source TEXT NOT NULL DEFAULT 'clarification' CHECK (source IN ('clarification', 'amendment')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurement_examples_lookup
  ON measurement_examples(tenant_id, service_id, signal_key, created_at DESC);

ALTER TABLE measurement_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant measurement examples"
  ON measurement_examples FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role has full access to measurement examples"
  ON measurement_examples FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT SELECT ON measurement_examples TO authenticated;
GRANT ALL ON measurement_examples TO service_role;

COMMENT ON TABLE measurement_examples IS 'Measurement calibration memory: AI-measured vs human-confirmed quantities (T-123)';
