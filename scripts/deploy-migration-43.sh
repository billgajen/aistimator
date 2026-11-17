#!/usr/bin/env bash
# Push migration 43 (T-173: close the open database rules) to production
# Supabase via the management API, same route as deploy-migration-42.sh. Token
# comes from the macOS keychain item "Supabase CLI"; it never touches disk.
#
# What it closes (see the migration's own header):
#   - the public key could read every quote, and list every business's key,
#     services and form settings;
#   - the public key could insert rows into four tables;
#   - a signed-in user could move itself into another business, and every
#     sign-up counted as a platform admin;
#   - a signed-in business could change its own subscription row.
# No row is deleted. Every existing profile becomes 'owner' (once).
# It refuses to start unless production is at 42 or already has 43 recorded.
#
# Deploy ORDER: this can go first and on its own. The web app that is live
# today keeps working: every public page already reads through the server.
# After it, NOBODY is a platform admin until you run
#   bash scripts/set-platform-admin.sh you@example.com
#
# Run from repo root:  bash scripts/deploy-migration-43.sh
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"
FILE="supabase/migrations/00000000000043_close_open_database_rules.sql"

TOKEN="$(security find-generic-password -s 'Supabase CLI' -w)"
if [ -z "$TOKEN" ]; then
  echo "ERROR: could not read 'Supabase CLI' token from keychain" >&2
  exit 1
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

CHECK="SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname ILIKE 'Public can %') AS public_rules,
  (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon') AS signed_out_grants,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'user_profiles_guard') AS profile_guard,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'subscriptions' AND cmd = 'UPDATE' AND policyname NOT ILIKE '%service role%') AS subscription_user_rules,
  (SELECT count(*) FROM user_profiles WHERE role = 'admin') AS platform_admins,
  (SELECT count(*) FROM user_profiles WHERE role = 'owner') AS owners;"

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(42|43)"'; then
  echo "ERROR: expected latest=00000000000042 (or 43 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Before:"
before="$(query "$CHECK")"
echo "  ${before}"
fail_on_error "$before" "before-check"

echo "→ Applying 00000000000043 close_open_database_rules..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "close_open_database_rules"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000043', 'close_open_database_rules', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording close_open_database_rules"
echo "  OK"

echo "→ After:"
after="$(query "$CHECK")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000043, public_rules 0, signed_out_grants 0, profile_guard 1,"
echo "          subscription_user_rules 0, platform_admins 0 (until set-platform-admin.sh), owners = every account."
