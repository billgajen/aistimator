#!/usr/bin/env bash
# Push migration 50 (T-201) to production Supabase via the management API, same
# route as deploy-migration-49.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# What it does (see the migration's own header; each block names its item):
#   - item 4:  tenants.customer_reminder_enabled, true for every business: the
#     one automatic reminder to a customer, on or off (Settings);
#   - item 26: tenants.benchmarks_opt_in defaults to true for a NEW business.
#     No existing row is changed: a business that never chose stays off;
#   - item 33: usage_counters.plan_estimates_created, and new versions of
#     claim_plan_quote and release_plan_quote (the latter now takes a third,
#     optional value). The free quotes a business has used are now the quotes
#     priced as free ones, not every quote ever priced.
# ONE THING IS WRITTEN TO EXISTING ROWS: the new column plan_estimates_created
# is filled once, for businesses that have a subscription row (of each month's
# quotes, those made on or after the day that row was created are taken as the
# plan's; never more than the month's count). No count that existed before is
# changed: the After check shows estimates_created with the same total.
# No row is deleted.
# It refuses to start unless production is at 49 or already has 50 recorded.
#
# Deploy ORDER: this goes FIRST, before the web app and the worker of T-201.
# The code that is live today keeps working with it in place: it calls
# release_plan_quote with two values, which the new function accepts, and it
# reads nothing the migration removes. Without the migration the T-201 web app
# cannot count a quote against a plan (it sends the third value) and Settings
# cannot save the reminder switch.
#
# The Before and After checks read only things that exist at migration 49 AND
# at 50: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-50.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-50.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000050_t201.sql"

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
# column or function signature that the migration creates except through the catalogue.
CHECK="SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'customer_reminder_enabled') AS reminder_columns,
  (SELECT coalesce(max(column_default), 'none') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'benchmarks_opt_in') AS benchmarks_default,
  (SELECT count(*) FROM tenants WHERE benchmarks_opt_in) AS businesses_sharing,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_counters' AND column_name = 'plan_estimates_created') AS plan_count_columns,
  (SELECT coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ' ORDER BY p.proname, p.pronargs), 'none') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('claim_plan_quote', 'release_plan_quote')) AS count_functions,
  (SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema = 'public' AND routine_name IN ('claim_plan_quote', 'release_plan_quote') AND grantee IN ('anon', 'authenticated', 'PUBLIC')) AS count_functions_open_to_users,
  (SELECT count(*) FROM information_schema.routine_privileges WHERE routine_schema = 'public' AND routine_name IN ('claim_plan_quote', 'release_plan_quote') AND grantee = 'service_role' AND privilege_type = 'EXECUTE') AS count_functions_for_server,
  (SELECT count(*) FROM usage_counters) AS usage_rows,
  (SELECT coalesce(sum(estimates_created), 0) FROM usage_counters) AS quotes_counted,
  (SELECT count(*) FROM subscriptions) AS subscriptions,
  (SELECT count(*) FROM tenants) AS tenants,
  (SELECT count(*) FROM quotes) AS quotes;"

# After only: what the new column was filled with. It names the new column, so it is never run before.
FILLED="SELECT
  (SELECT count(*) FROM tenants WHERE NOT customer_reminder_enabled) AS businesses_with_reminder_off,
  (SELECT coalesce(sum(plan_estimates_created), 0) FROM usage_counters) AS quotes_counted_on_a_plan,
  (SELECT count(*) FROM usage_counters WHERE plan_estimates_created > estimates_created) AS rows_where_plan_exceeds_total,
  (SELECT count(*) FROM usage_counters uc WHERE uc.plan_estimates_created > 0 AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = uc.tenant_id)) AS plan_counts_without_a_subscription;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(49|50)"'; then
  echo "ERROR: expected latest=00000000000049 (or 50 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000050 t201..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "t201"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000050', 't201', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording t201"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
filled="$(query "$FILLED")"
echo "  ${filled}"
fail_on_error "$filled" "filled-check"
echo "Expected: latest 00000000000050, reminder_columns 1, benchmarks_default true, plan_count_columns 1,"
echo "          count_functions = claim_plan_quote(p_tenant_id text, p_period text, p_limit integer, p_per text);"
echo "          release_plan_quote(p_tenant_id text, p_period text, p_per text)   (one of each, no two-value release),"
echo "          count_functions_open_to_users 0, count_functions_for_server 2;"
echo "          businesses_sharing, usage_rows, quotes_counted, subscriptions, tenants and quotes unchanged from Before."
echo "          businesses_with_reminder_off 0, rows_where_plan_exceeds_total 0, plan_counts_without_a_subscription 0."
echo "quotes_counted_on_a_plan is how many already-counted quotes were taken as a plan's (0 if nobody has had a plan)."
