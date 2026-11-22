#!/usr/bin/env bash
# Push migration 49 (T-199: a business's own address) to production Supabase
# via the management API, same route as deploy-migration-48.sh. Token comes
# from the macOS keychain item "Supabase CLI"; it never touches disk.
#
# What it adds (see the migration's own header):
#   - tenants.own_address, own_address_chosen_at, own_address_later_at: the
#     name a business chose for <name>.qolumns.com (its own field, not the
#     quote-link name);
#   - own_address_changes, with no policy: every choice and change, and the
#     90-day hold on a name the admin area changed;
#   - own_address_taken / own_address_held, a new tenant_slug_taken, and a
#     trigger on tenants: one name belongs to one business across the address
#     and the quote-link name, and only the server writes the address;
#   - eight more reserved names (cdn, dev, email, m, pm-bounces, q, staging,
#     status).
# No row is deleted, no existing row is changed, and NOBODY IS RENAMED: a
# business that already holds a newly reserved name as its quote-link name
# keeps it. The Before check lists any such business ("holders") so the owner
# knows; "none" is the expected answer.
# It refuses to start unless production is at 48 or already has 49 recorded.
#
# Deploy ORDER: this goes FIRST, before the web app of T-199. The code that is
# live today keeps working with it in place (it only adds, and the quote link
# is untouched). Without it the T-199 web app still serves every quote page,
# but Home and the Quote link page fail to read the new columns.
#
# The Before and After checks read only things that exist at migration 48 AND
# at 49: the new ones are looked up by name in the catalogue (the lesson of
# deploy-migration-44.sh, whose first Before check failed on production).
#
# Run from repo root:  bash scripts/deploy-migration-49.sh
#
# To try the script itself without touching production, point it at a stand-in
# for the management API that runs each query on a LOCAL copy of the database:
#   MIGRATION_TEST_API=http://127.0.0.1:8795/query bash scripts/deploy-migration-49.sh
# With that set it never reads the keychain and never talks to Supabase.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
FILE="supabase/migrations/00000000000049_own_address.sql"

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
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name IN ('own_address', 'own_address_chosen_at', 'own_address_later_at')) AS address_columns,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'own_address_changes') AS change_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'own_address_changes' AND c.relrowsecurity) AS change_tables_with_rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'own_address_changes') AS change_policies,
  (SELECT count(*) FROM information_schema.table_privileges WHERE table_schema = 'public' AND table_name = 'own_address_changes' AND grantee IN ('anon', 'authenticated')) AS change_open_to_users,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('own_address_taken', 'own_address_held', 'tenants_own_address_guard')) AS address_functions,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tenants_own_address_guard' AND NOT tgisinternal) AS address_triggers,
  (SELECT count(*) FROM reserved_slugs) AS reserved_names,
  (SELECT coalesce(string_agg(slug, ', ' ORDER BY slug), 'none') FROM tenants WHERE slug IN ('cdn', 'dev', 'email', 'm', 'pm-bounces', 'q', 'staging', 'status') OR slug IN (SELECT slug FROM reserved_slugs)) AS holders,
  (SELECT count(*) FROM tenants) AS tenants,
  (SELECT count(DISTINCT slug) FROM tenants) AS quote_link_names,
  (SELECT count(*) FROM quotes) AS quotes;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(48|49)"'; then
  echo "ERROR: expected latest=00000000000048 (or 49 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000049 own_address..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "own_address"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000049', 'own_address', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording own_address"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000049, address_columns 3, change_tables 1, change_tables_with_rls 1, change_policies 0,"
echo "          change_open_to_users 0, address_functions 3, address_triggers 1, reserved_names 8 more than Before"
echo "          (fewer if a name was already reserved); holders, tenants, quote_link_names and quotes unchanged from Before."
echo "holders lists every business whose quote-link name is a reserved name. The public demo (example-home-services) is"
echo "always there: its name is reserved for it. Nobody was renamed; every link keeps working."
