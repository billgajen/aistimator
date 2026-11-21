#!/usr/bin/env bash
# Push migration 47 (T-197: the Help button's data) to production Supabase via
# the management API, same route as deploy-migration-46.sh. Token comes from
# the macOS keychain item "Supabase CLI"; it never touches disk.
#
# What it adds (see the migration's own header):
#   - support_reports and support_messages: a business's problem reports,
#     estimate reports and their threads, with row-level rules (a business
#     reads its own rows and may add its own);
#   - support_report_internal, with no policy: the AI's sorting, the draft fix
#     ticket and the owner's note, for the service role only;
#   - feature_requests and feature_votes: a business reads its own votes and
#     the requests it voted for; one vote per business per request.
# No row is deleted and no existing row or table is changed.
# It refuses to start unless production is at 46 or already has 47 recorded.
#
# Deploy ORDER: this goes FIRST, before the worker and the web app of T-197.
# The code that is live today keeps working with it in place (it only adds).
# Without it, the T-197 code still prices every quote and every page still
# works: the Help panel says a report could not be sent.
#
# The Before and After checks read only things that exist at migration 46 AND
# at 47: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-47.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-47.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000047_support.sql"

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
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes')) AS support_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes') AND c.relrowsecurity) AS support_tables_with_rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes')) AS support_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_report_internal') AS internal_policies,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name IN ('support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes') AND grantee = 'anon') AS support_open_to_anon,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'support_report_internal' AND grantee IN ('anon', 'authenticated')) AS internal_open_to_users,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name IN ('feature_requests', 'feature_votes') AND grantee = 'authenticated' AND privilege_type <> 'SELECT') AS feature_writes_open_to_users,
  (SELECT count(*) FROM tenants) AS tenants,
  (SELECT count(*) FROM quotes) AS quotes,
  (SELECT count(*) FROM assets) AS assets;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(46|47)"'; then
  echo "ERROR: expected latest=00000000000046 (or 47 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000047 support..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "support"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000047', 'support', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording support"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000047, support_tables 5, support_tables_with_rls 5, support_policies 6,"
echo "          internal_policies 0, support_open_to_anon 0, internal_open_to_users 0, feature_writes_open_to_users 0,"
echo "          tenants, quotes and assets unchanged from Before."
