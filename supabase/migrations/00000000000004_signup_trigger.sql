-- Signup Trigger Migration
-- Automatically creates tenant and user_profile when a user verifies their email
-- This ensures no orphaned accounts from spam signups

-- Drop old triggers if they exist (from previous implementations)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_verified ON auth.users;

-- Function to handle verified user (creates tenant + profile)
-- CRITICAL: SECURITY DEFINER + search_path + postgres owner = bypass RLS
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant_id TEXT;
  business_name TEXT;
BEGIN
  -- Only proceed if user doesn't already have a profile (idempotency check)
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Get business name from user metadata, default to email prefix
  business_name := COALESCE(
    NEW.raw_user_meta_data->>'business_name',
    split_part(NEW.email, '@', 1)
  );

  -- Create tenant
  INSERT INTO public.tenants (name)
  VALUES (business_name)
  RETURNING id INTO new_tenant_id;

  -- Create user profile linked to tenant
  INSERT INTO public.user_profiles (id, tenant_id, role, display_name)
  VALUES (
    NEW.id,
    new_tenant_id,
    'admin',
    split_part(NEW.email, '@', 1)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CRITICAL: Set owner to postgres to bypass RLS
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- Trigger fires when email_confirmed_at changes from NULL to non-NULL
-- This happens when the user clicks the email verification link
CREATE TRIGGER on_auth_user_verified
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();

-- Comment for documentation
COMMENT ON FUNCTION public.handle_new_user IS 'Creates tenant and user_profile when a user verifies their email';
