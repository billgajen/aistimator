#!/usr/bin/env bash
# Push migration 40 (T-162: reserve the quote-link names "qolumns" and
# "qolums") to production Supabase via the management API, same route as
# deploy-migration-39.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 40 is additive and re-runnable (INSERT ... ON CONFLICT DO NOTHING).
# It stops, changing nothing, if a business holds or has held either word;
# this script checks that first and says who.
# It refuses to start unless production is at 39 or already has 40 recorded.
#
# Deploy ORDER: migration first, then the worker, then the web app. The old
# web app does not read the two new rows, so the gap between steps is safe.
#
# Run from repo root:  bash scripts/deploy-migration-40.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(39|40)"'; then
  echo "ERROR: expected latest=00000000000039 (or 40 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Checking that no business holds or held the two names (want holders 0)..."
holders="$(query "SELECT
  (SELECT count(*) FROM tenants WHERE slug IN ('qolumns', 'qolums'))
  + (SELECT count(*) FROM tenant_slug_history WHERE old_slug IN ('qolumns', 'qolums')) AS holders;")"
echo "  ${holders}"
fail_on_error "$holders" "holder check"
if ! echo "$holders" | grep -qE '"holders":"?0"?[,}]'; then
  echo "ERROR: a business holds or held 'qolumns' or 'qolums'. Nothing was changed. Decide what to do with that business first." >&2
  exit 1
fi

echo "→ Applying 00000000000040 reserve_qolumns..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000040_reserve_qolumns.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "reserve_qolumns"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000040', 'reserve_qolumns', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording reserve_qolumns"
echo "  OK"

echo "→ Verifying (want reserved_new 2, reserved_total 50: the 47 of migration 32 and the demo link of migration 36 are still there, latest 00000000000040)..."
query "SELECT
  (SELECT count(*) FROM reserved_slugs WHERE slug IN ('qolumns', 'qolums')) AS reserved_new,
  (SELECT count(*) FROM reserved_slugs) AS reserved_total,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
