#!/usr/bin/env bash
# Push migration 48 (T-198: the Help assistant's data) to production Supabase
# via the management API, same route as deploy-migration-48.sh. Token comes
# from the macOS keychain item "Supabase CLI"; it never touches disk.
#
# What it adds (see the migration's own header):
#   - help_questions, with no policy: every question asked of "Ask Qolumns",
#     its answer, the rating and the owner's note, for the service role only;
#   - support_reports.from_assistant: a report made with "Send this to the
#     Qolumns team";
#   - support_report_internal.draft_reply: the draft reply for a report that
#     is not a fault.
# No row is deleted and no existing row is changed.
# It refuses to start unless production is at 47 or already has 48 recorded.
#
# Deploy ORDER: this goes FIRST, before the worker and the web app of T-198.
# The code that is live today keeps working with it in place (it only adds).
# Without it, the T-198 code still prices every quote and every page still
# works: the assistant answers but nothing is kept, and a report from the
# Help panel is not saved until the migration is in.
#
# The Before and After checks read only things that exist at migration 47 AND
# at 48: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-48.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-48.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000048_help_questions.sql"

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
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'help_questions') AS help_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'help_questions' AND c.relrowsecurity) AS help_tables_with_rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'help_questions') AS help_policies,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'help_questions' AND grantee IN ('anon', 'authenticated')) AS help_open_to_users,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'support_reports' AND column_name = 'from_assistant') OR (table_name = 'support_report_internal' AND column_name = 'draft_reply'))) AS new_columns,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('support_reports', 'support_report_internal', 'support_messages', 'feature_requests', 'feature_votes')) AS support_policies,
  (SELECT count(*) FROM support_reports) AS support_reports,
  (SELECT count(*) FROM tenants) AS tenants,
  (SELECT count(*) FROM quotes) AS quotes;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(47|48)"'; then
  echo "ERROR: expected latest=00000000000047 (or 48 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000048 help_questions..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "help_questions"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000048', 'help_questions', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording help_questions"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000048, help_tables 1, help_tables_with_rls 1, help_policies 0, help_open_to_users 0,"
echo "          new_columns 2, support_policies 6; support_reports, tenants and quotes unchanged from Before."
