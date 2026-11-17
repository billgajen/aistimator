-- T-173: close the open database rules.
--
-- Found while listing what a stranger can reach. The site's public key is in
-- every page's JavaScript, so anything that key may do in the database, anyone
-- may do. Every public page and route reads and writes through the server
-- (service role) and checks the quote's token or the business's key there, so
-- none of these rules was needed by the product.
--
-- 1. Quotes. "Public can view quotes by token" never compared a token: it let
--    the public key read every quote of every business (customer details,
--    prices, the pricing trace).
--
-- 2. Business set-up. The public key could list every business's key, its
--    services (with their work steps) and its form settings.
--
-- 3. Open inserts. The public key could insert rows into quote_feedback,
--    assets, quote_requests and widget_analytics for any business.
--
-- 4. Signed-out callers lose every table privilege, now and for tables made
--    later, so a rule written too wide in future cannot reach a stranger.
--
-- 5. Profiles. "Users can update own profile" let a signed-in user change its
--    own tenant_id (and so read and write another business) and its own role.
--    A guard now refuses any change to id, tenant_id or role that does not
--    come from the service role.
--
-- 6. Platform admin. Every sign-up was given the role 'admin', and the /admin
--    area checks for exactly that word, so every business could open it. New
--    accounts are now 'owner'; existing ones become 'owner' once. 'admin' is
--    the platform's own role and only the service role can grant it
--    (scripts/set-platform-admin.sh).
--
-- 7. Subscriptions. A signed-in business could change its own subscription
--    row (its plan). Only the server writes that row now.
--
-- Re-runnable. No row is deleted. The role change in 6 runs once only, so a
-- platform admin granted afterwards is not undone by a second run.

-- ---------- 1. quotes ----------
DROP POLICY IF EXISTS "Public can view quotes by token" ON quotes;

-- ---------- 2. business set-up ----------
DROP POLICY IF EXISTS "Public can lookup tenant by key" ON tenant_sites;
DROP POLICY IF EXISTS "Public can view active services" ON services;
DROP POLICY IF EXISTS "Public can view widget configs" ON widget_configs;

-- ---------- 3. open inserts ----------
DROP POLICY IF EXISTS "Public can insert feedback" ON quote_feedback;
DROP POLICY IF EXISTS "Public can insert assets" ON assets;
DROP POLICY IF EXISTS "Public can insert quote requests" ON quote_requests;
DROP POLICY IF EXISTS "Public can insert quote_requests" ON quote_requests;
DROP POLICY IF EXISTS "Public can insert analytics" ON widget_analytics;

-- ---------- 4. signed-out callers hold no table privilege ----------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ---------- 5. profiles: id, business and role change only through the service role ----------
CREATE OR REPLACE FUNCTION public.user_profiles_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    ELSIF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_guard ON user_profiles;
CREATE TRIGGER user_profiles_guard
  BEFORE INSERT OR UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION user_profiles_guard();

COMMENT ON FUNCTION public.user_profiles_guard IS 'T-173: a profile''s id, business and role change only through the service role';

-- ---------- 6. platform admin is a role no sign-up gets ----------
ALTER TABLE user_profiles ALTER COLUMN role SET DEFAULT 'owner';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_role_check') THEN
    UPDATE user_profiles SET role = 'owner' WHERE role <> 'owner';
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('owner', 'admin'));
  END IF;
END;
$$;

COMMENT ON COLUMN user_profiles.role IS 'T-173: ''owner'' (a business''s own account, every sign-up) or ''admin'' (the platform''s own staff; granted by the service role only)';

-- The sign-up trigger, as it was, with the role it gives changed to 'owner'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    'owner',
    split_part(NEW.email, '@', 1)
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- ---------- 7. subscriptions are written by the server only ----------
DROP POLICY IF EXISTS "Users can update own subscription" ON subscriptions;
