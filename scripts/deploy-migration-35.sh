#!/usr/bin/env bash
# Push migration 35 (T-152 simpler dashboard: tenants.prices_checked_at) to
# production Supabase via the management API, same route as deploy-migration-34.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 35 is additive and re-runnable (ADD COLUMN IF NOT EXISTS; no new
# table, so no new policy). It refuses to start unless production is at 34 or
# already has 35 recorded.
#
# Deploy ORDER matters: migration first (the web app reads and writes
# prices_checked_at), then the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-35.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(34|35)"'; then
  echo "ERROR: expected latest=00000000000034 (or 35 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000035 dashboard_checklist..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000035_dashboard_checklist.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "dashboard_checklist"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000035', 'dashboard_checklist', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording dashboard_checklist"
echo "  OK"

echo "→ Verifying (want prices_col 1, latest 00000000000035)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='tenants' AND column_name='prices_checked_at') AS prices_col,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
