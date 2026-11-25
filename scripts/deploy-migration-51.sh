#!/usr/bin/env bash
# Push migration 51 (T-202) to production Supabase via the management API, same
# route as deploy-migration-50.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# What it does (see the migration's own header):
#   - tenants.test_estimate_times: when a business started each of its test
#     estimates of the last 24 hours. It is how "5 test estimates a day" is
#     counted, kept apart from the quotes because a business can delete a test
#     and a deleted test must still count. Empty for every business.
#   - a trigger on tenants so a business cannot empty that list through its own
#     row (only the server can write it);
#   - claim_test_estimate and release_test_estimate, for the server only.
# Nothing is deleted and NO existing row is changed (the new column starts
# empty for everyone).
# It refuses to start unless production is at 50 or already has 51 recorded.
#
# Deploy ORDER: this goes FIRST, before the web app of T-202. The code that is
# live today keeps working with it in place: it reads and writes nothing the
# migration adds. Without the migration the T-202 web app cannot start a test
# estimate (it calls claim_test_estimate).
#
# The Before and After checks read only things that exist at migration 50 AND
# at 51: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-51.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-51.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000051_t202.sql"

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
# column or function that the migration creates except through the catalogue.
CHECK="SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT coalesce(max(udt_name || ' ' || is_nullable || ' ' || column_default), 'none') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'test_estimate_times') AS test_times_column,
  (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'tenants' AND tg.tgname = 'tenants_test_estimate_guard' AND NOT tg.tgisinternal) AS guard_triggers,
  (SELECT coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ' ORDER BY p.proname, p.pronargs), 'none') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('claim_test_estimate', 'release_test_estimate')) AS test_functions,
  (SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema = 'public' AND routine_name IN ('claim_test_estimate', 'release_test_estimate') AND grantee IN ('anon', 'authenticated', 'PUBLIC')) AS test_functions_open_to_users,
  (SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema = 'public' AND routine_name IN ('claim_test_estimate', 'release_test_estimate') AND grantee = 'service_role' AND privilege_type = 'EXECUTE') AS test_functions_for_server,
  (SELECT count(*) FROM tenants) AS tenants,
  (SELECT count(*) FROM quotes) AS quotes,
  (SELECT count(*) FROM quotes WHERE is_test) AS test_quotes;"

# After only: it names the new column, so it is never run before.
FILLED="SELECT (SELECT count(*) FROM tenants WHERE cardinality(test_estimate_times) > 0) AS businesses_with_a_test_counted;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(50|51)"'; then
  echo "ERROR: expected latest=00000000000050 (or 51 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000051 t202..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "t202"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000051', 't202', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording t202"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
filled="$(query "$FILLED")"
echo "  ${filled}"
fail_on_error "$filled" "filled-check"
echo "Expected: latest 00000000000051, test_times_column \"_timestamptz NO '{}'::timestamp with time zone[]\","
echo "          guard_triggers 1,"
echo "          test_functions = claim_test_estimate(p_tenant_id text, p_limit integer);"
echo "          release_test_estimate(p_tenant_id text, p_claimed_at timestamp with time zone),"
echo "          test_functions_open_to_users 0, test_functions_for_server 2;"
echo "          tenants, quotes and test_quotes unchanged from Before."
echo "          businesses_with_a_test_counted 0 on a first run (it grows once the T-202 web app is live)."
