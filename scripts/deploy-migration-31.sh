#!/usr/bin/env bash
# Push migration 31 (T-147 show, then confirm: services.hold_until_approved,
# quotes.review_hold) to production Supabase via the management API, same
# route as deploy-migration-30.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 31 is additive and re-runnable (ADD COLUMN IF NOT EXISTS, and the
# check constraint is dropped and re-added). The script refuses to start
# unless production is at 30 or already has 31 recorded.
#
# Deploy ORDER matters: migration first (the worker writes quotes.review_hold
# and reads services.hold_until_approved), then the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-31.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(30|31)"'; then
  echo "ERROR: expected latest=00000000000030 (or 31 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000031 show_then_confirm..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000031_show_then_confirm.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "show_then_confirm"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000031', 'show_then_confirm', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording show_then_confirm"
echo "  OK"

echo "→ Verifying (want mode_cols 2, latest 00000000000031)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE (table_name='quotes' AND column_name='review_hold')
        OR (table_name='services' AND column_name='hold_until_approved')) AS mode_cols,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
