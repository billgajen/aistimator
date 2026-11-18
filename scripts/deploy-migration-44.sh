#!/usr/bin/env bash
# Push migration 44 (T-180: Stripe billing) to production Supabase via the
# management API, same route as deploy-migration-43.sh. Token comes from the
# macOS keychain item "Supabase CLI"; it never touches disk.
#
# What it adds (see the migration's own header):
#   - three functions that count a plan's usage inside the database
#     (claim_plan_quote, release_plan_quote, increment_usage_counter), for
#     the service role only;
#   - four columns on subscriptions (billing_interval, cancel_at,
#     payment_failed_at, payment_failed_notified_at);
#   - three columns on tenants (suspended_at, suspended_reason,
#     free_warning_sent_at) and the guard that keeps them server-only;
#   - two tables: stripe_events and admin_activity_logs.
# No row is deleted and no existing row is changed.
# It refuses to start unless production is at 43 or already has 44 recorded.
#
# Deploy ORDER: this goes FIRST, before the worker and the web app of T-180.
# The code that is live today keeps working with it in place (it only adds).
# The T-180 code does NOT work without it: every request would be priced
# without being counted (it fails open and logs "Could not claim a quote").
#
# The Before and After checks read only things that exist at migration 43 AND at
# 44. The first version of this script counted suspended businesses from a
# column this migration creates, so its Before check failed on production
# (2026-11-18; nothing had been applied). It was then run, whole, against a
# local copy of the database standing at migration 43: see Docs/CHANGELOG.md.
#
# Run from repo root:  bash scripts/deploy-migration-44.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-44.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000044_stripe_billing.sql"

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

# Every line of this check must work BEFORE the migration as well as after it. So nothing here names
# a column, table or function that the migration creates: the new ones are looked up by name in the
# catalogue, and the count of suspended businesses reads the row as JSON (no such key before = 0).
CHECK="SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('claim_plan_quote', 'release_plan_quote', 'increment_usage_counter')) AS usage_functions,
  (SELECT count(*) FROM information_schema.routine_privileges WHERE routine_name IN ('claim_plan_quote', 'release_plan_quote', 'increment_usage_counter') AND grantee IN ('anon', 'authenticated', 'PUBLIC')) AS usage_functions_open_to_users,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name IN ('billing_interval', 'cancel_at', 'payment_failed_at', 'payment_failed_notified_at')) AS subscription_columns,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tenants' AND column_name IN ('suspended_at', 'suspended_reason', 'free_warning_sent_at')) AS tenant_columns,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tenants_billing_guard') AS billing_guard,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('stripe_events', 'admin_activity_logs')) AS new_tables,
  (SELECT count(*) FROM subscriptions) AS subscriptions,
  (SELECT count(*) FROM tenants t WHERE (to_jsonb(t) ->> 'suspended_at') IS NOT NULL) AS suspended_businesses;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(43|44)"'; then
  echo "ERROR: expected latest=00000000000043 (or 44 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000044 stripe_billing..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "stripe_billing"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000044', 'stripe_billing', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording stripe_billing"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000044, usage_functions 3, usage_functions_open_to_users 0,"
echo "          subscription_columns 4, tenant_columns 3, billing_guard 1, new_tables 2,"
echo "          subscriptions unchanged from Before, suspended_businesses 0."
