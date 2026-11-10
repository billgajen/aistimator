#!/usr/bin/env bash
# Push migration 33 (T-150 setup: tenants.trade, trade_other, selected_plan,
# onboarding_skipped_at; quotes.is_test) to production Supabase via the management API, same
# route as deploy-migration-32.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 33 is additive and re-runnable (ADD COLUMN / CREATE INDEX IF NOT EXISTS,
# the length constraint is dropped and re-added). It refuses
# to start unless production is at 32 or already has 33 recorded.
#
# Deploy ORDER matters: migration first (the web app writes quotes.is_test), then
# the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-33.sh
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

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

echo "→ Checking migration history..."
state="$(query "SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -qE '"latest":"000000000000(32|33)"'; then
  echo "ERROR: expected latest=00000000000032 (or 33 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000033 setup_test_quote..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000033_setup_test_quote.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "setup_test_quote"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000033', 'setup_test_quote', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording setup_test_quote"
echo "  OK"

echo "→ Verifying (want tenant_cols 4, quote_cols 1, latest 00000000000033)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='tenants'
     AND column_name IN ('trade','trade_other','selected_plan','onboarding_skipped_at')) AS tenant_cols,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='quotes' AND column_name='is_test') AS quote_cols,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
