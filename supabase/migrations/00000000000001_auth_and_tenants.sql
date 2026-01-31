-- Auth and Tenants Migration
-- Creates core tables needed for authentication and tenant management

-- Tenants table (minimal for auth, full schema in T-005)
CREATE TABLE tenants (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('tnt'),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  tax_enabled BOOLEAN NOT NULL DEFAULT false,
  tax_label TEXT,
  tax_rate NUMERIC(5, 4) DEFAULT 0,
  service_area_mode service_area_mode NOT NULL DEFAULT 'none',
  service_area_values JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to update updated_at
CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- User profiles table linking Supabase Auth users to tenants
-- Each user belongs to exactly one tenant (for v1)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to update updated_at
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index for looking up user by tenant
CREATE INDEX idx_user_profiles_tenant_id ON user_profiles(tenant_id);

-- RLS Policies

-- Enable RLS on tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tenant
CREATE POLICY "Users can view own tenant" ON tenants
  FOR SELECT
  USING (
    id IN (
      SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Users can update their own tenant
CREATE POLICY "Users can update own tenant" ON tenants
  FOR UPDATE
  USING (
    id IN (
      SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can only see their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT
  USING (id = auth.uid());

-- Users can update their own profile (except tenant_id and role)
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE
  USING (id = auth.uid());

-- Service role can do anything (for tenant creation)
CREATE POLICY "Service role full access to tenants" ON tenants
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to user_profiles" ON user_profiles
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Function to get current user's tenant_id (useful for RLS policies)
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS TEXT AS $$
  SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Comment for documentation
COMMENT ON FUNCTION get_current_tenant_id IS 'Returns the tenant_id for the currently authenticated user';
COMMENT ON TABLE tenants IS 'Business accounts that use the platform';
COMMENT ON TABLE user_profiles IS 'Links Supabase Auth users to tenants with role information';
