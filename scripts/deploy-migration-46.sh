#!/usr/bin/env bash
# Push migration 46 (T-196: the phone app's notifications, and the business's
# time zone) to production Supabase via the management API, same route as
# deploy-migration-45.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# What it adds (see the migration's own header):
#   - one table, push_devices: the phones the app may notify and each user's
#     three switches, with row-level rules (a user's own rows only);
#   - one table, push_events, with no policy: the service role only;
#   - one column on tenants (time_zone).
# No row is deleted and no existing row is changed.
# It refuses to start unless production is at 45 or already has 46 recorded.
#
# Deploy ORDER: this goes FIRST, before the worker and the web app of T-196.
# The code that is live today keeps working with it in place (it only adds).
# Without it, the T-196 code still prices every quote and sends every email:
# a notification is simply not sent, and "this month" is counted in the
# region's time zone.
#
# The Before and After checks read only things that exist at migration 45 AND
# at 46: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-46.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-46.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000046_push_devices.sql"

if [ -n "${MIGRATION_TEST_API:-}" ]; then
  case "$MIGRATION_TEST_API" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "ERROR: MIGRATION_TEST_API must be an address on this machine" >&2; exit 1 ;;
  esac
  API="$MIGRATION_TEST_API"
  TOKEN="local-test"
  echo "TEST RUN against ${API} (a local stand-in). Production is not touched."
else
  API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"
  TOKEN="$(security find-generic-password -s 'Supabase CLI' -w)"
  if [ -z "$TOKEN" ]; then
    echo "ERROR: could not read 'Supabase CLI' token from keychain" >&2
    exit 1
  fi
fi

query() {
  jq -n --arg q "$1" '{query: $q}' | curl -sS -X POST "$API" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @-
}

fail_on_error() {
  local response="$1" label="$2"
  if echo "$response" | grep -qi '"message"\|error'; then
    echo "  API says: $response" >&2
    echo "FAILED on ${label}; nothing from this step was kept (single transaction)." >&2
    exit 1
  fi
}

# Every line of this check must work BEFORE the migration as well as after it: nothing here names a
# column, table or function that the migration creates except through the catalogue.
CHECK="SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_devices') AS push_devices_table,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'push_devices' AND c.relrowsecurity) AS push_devices_rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'push_devices') AS push_devices_policies,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'push_devices' AND grantee = 'anon') AS push_devices_open_to_anon,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_events') AS push_events_table,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'push_events' AND c.relrowsecurity) AS push_events_rls,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'push_events' AND grantee IN ('anon', 'authenticated')) AS push_events_open_to_users,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'time_zone') AS time_zone_column,
  (SELECT count(*) FROM tenants) AS tenants,
  (SELECT count(*) FROM quotes) AS quotes;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(45|46)"'; then
  echo "ERROR: expected latest=00000000000045 (or 46 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000046 push_devices..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "push_devices"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000046', 'push_devices', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording push_devices"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000046, push_devices_table 1, push_devices_rls 1, push_devices_policies 4,"
echo "          push_devices_open_to_anon 0, push_events_table 1, push_events_rls 1, push_events_open_to_users 0,"
echo "          time_zone_column 1, tenants and quotes unchanged from Before."
