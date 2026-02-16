-- Migration: Add missing RLS policies
-- Production DB was set up manually with only SELECT policies.
-- Migrations 0-12 were marked as applied but never actually ran,
-- so INSERT/UPDATE and service_role policies are missing.

-- ============================================================================
-- QUOTES — Missing INSERT, UPDATE, and service_role policies
-- ============================================================================

CREATE POLICY "Users can insert own quotes"
  ON quotes FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users can update own quotes"
  ON quotes FOR UPDATE
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role full access quotes"
  ON quotes FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- ============================================================================
-- QUOTE REQUESTS — Missing INSERT, UPDATE, and service_role policies
-- ============================================================================

CREATE POLICY "Users can insert own quote_requests"
  ON quote_requests FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users can update own quote_requests"
  ON quote_requests FOR UPDATE
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role full access quote_requests"
  ON quote_requests FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- ============================================================================
-- ASSETS — Missing INSERT and service_role policies
-- ============================================================================

CREATE POLICY "Users can insert own assets"
  ON assets FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role full access assets"
  ON assets FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- ============================================================================
-- SUBSCRIPTIONS — Missing UPDATE and service_role policies
-- ============================================================================

CREATE POLICY "Users can update own subscription"
  ON subscriptions FOR UPDATE
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role full access subscriptions"
  ON subscriptions FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- ============================================================================
-- SERVICE ROLE policies for remaining tables
-- ============================================================================

CREATE POLICY "Service role full access tenant_sites"
  ON tenant_sites FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role full access services"
  ON services FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role full access service_pricing_rules"
  ON service_pricing_rules FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role full access widget_configs"
  ON widget_configs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role full access plans"
  ON plans FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role full access usage_counters"
  ON usage_counters FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- ============================================================================
-- PUBLIC POLICIES for widget/quote submission flow
-- ============================================================================

-- Public can insert quote requests (widget submission — no auth)
CREATE POLICY "Public can insert quote_requests"
  ON quote_requests FOR INSERT
  WITH CHECK (true);

-- Public can insert assets (widget upload — no auth)
CREATE POLICY "Public can insert assets"
  ON assets FOR INSERT
  WITH CHECK (true);

-- Public can view quotes by token (hosted quote page)
CREATE POLICY "Public can view quotes by token"
  ON quotes FOR SELECT
  USING (quote_token_hash IS NOT NULL);
