#!/usr/bin/env bash
# Push migration 29 (T-143 final invoice columns) to production Supabase via
# the management API, same route as deploy-migrations-26-28.sh. Token comes
# from the macOS keychain item "Supabase CLI"; it never touches disk.
#
# Migration 29 is additive and re-runnable (ADD COLUMN / CREATE INDEX IF NOT
# EXISTS). The script still refuses to start unless production is at 28 or
# already has 29 recorded, so it can't run against an unexpected state.
#
# Run from repo root:  bash scripts/deploy-migration-29.sh
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
if ! echo "$state" | grep -qE '"latest":"0000000000002(8|9)"'; then
  echo "ERROR: expected latest=00000000000028 (or 29 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000029 final_invoice..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000029_final_invoice.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "final_invoice"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000029', 'final_invoice', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording final_invoice"
echo "  OK"

echo "→ Verifying (want invoice_cols 3, latest 00000000000029)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='quotes' AND column_name IN ('final_invoice_amount','final_invoice_recorded_at','final_invoice_note')) AS invoice_cols,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
