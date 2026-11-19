#!/usr/bin/env bash
# Push migration 45 (T-189: where a business came from, and the owner's alerts)
# to production Supabase via the management API, same route as
# deploy-migration-44.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# What it adds (see the migration's own header):
#   - one column on tenants (signup_source) and the guard that keeps it
#     server-only (tenants_signup_source_guard);
#   - one table, ops_alerts, with no policy: the service role only;
#   - one function, claim_ops_alert, for the service role only.
# No row is deleted and no existing row is changed.
# It refuses to start unless production is at 44 or already has 45 recorded.
#
# Deploy ORDER: this goes FIRST, before the worker and the web app of T-189.
# The code that is live today keeps working with it in place (it only adds).
# Without it, the T-189 code still prices every quote: an alert falls back to
# its own hour in memory, and a sign-up's source is simply not saved.
#
# The Before and After checks read only things that exist at migration 44 AND
# at 45: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-45.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-45.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000045_signup_source_and_alerts.sql"

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
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'signup_source') AS signup_source_column,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tenants_signup_source_guard') AS signup_source_guard,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ops_alerts') AS ops_alerts_table,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'ops_alerts' AND c.relrowsecurity) AS ops_alerts_rls,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'ops_alerts' AND grantee IN ('anon', 'authenticated')) AS ops_alerts_open_to_users,
  (SELECT count(*) FROM pg_proc WHERE proname = 'claim_ops_alert') AS claim_function,
  (SELECT count(*) FROM information_schema.routine_privileges WHERE routine_name = 'claim_ops_alert' AND grantee IN ('anon', 'authenticated', 'PUBLIC')) AS claim_function_open_to_users,
  (SELECT count(*) FROM tenants) AS tenants;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(44|45)"'; then
  echo "ERROR: expected latest=00000000000044 (or 45 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000045 signup_source_and_alerts..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "signup_source_and_alerts"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000045', 'signup_source_and_alerts', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording signup_source_and_alerts"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000045, signup_source_column 1, signup_source_guard 1, ops_alerts_table 1,"
echo "          ops_alerts_rls 1, ops_alerts_open_to_users 0, claim_function 1, claim_function_open_to_users 0,"
echo "          tenants unchanged from Before."
