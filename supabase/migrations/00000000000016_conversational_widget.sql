-- Migration: Conversational Widget & Analytics
-- Phase 5: A/B testing support for form vs conversational widget

-- Widget analytics table for tracking A/B test results
CREATE TABLE IF NOT EXISTS widget_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('widget_opened', 'widget_completed', 'widget_abandoned')),
  widget_mode TEXT NOT NULL CHECK (widget_mode IN ('form', 'conversational')),
  page_url TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for querying analytics
CREATE INDEX IF NOT EXISTS idx_widget_analytics_tenant_id ON widget_analytics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_widget_analytics_tenant_mode ON widget_analytics(tenant_id, widget_mode);
CREATE INDEX IF NOT EXISTS idx_widget_analytics_tenant_event ON widget_analytics(tenant_id, event);
CREATE INDEX IF NOT EXISTS idx_widget_analytics_created_at ON widget_analytics(created_at);

-- Enable RLS
ALTER TABLE widget_analytics ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenants can only see their own analytics
CREATE POLICY "Tenants can view own analytics"
  ON widget_analytics
  FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id
    FROM user_profiles
    WHERE user_profiles.id = auth.uid()
  ));

-- Service role full access
CREATE POLICY "Service role full access widget_analytics"
  ON widget_analytics
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- Public insert policy (widget runs on customer sites, no auth)
CREATE POLICY "Public can insert analytics"
  ON widget_analytics
  FOR INSERT
  WITH CHECK (true);
