#!/usr/bin/env bash
# Push migration 32 (T-149 quote link: tenants.slug + share flags,
# tenant_slug_history, reserved_slugs) to production Supabase via the management API, same
# route as deploy-migration-31.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 32 is additive and re-runnable (IF NOT EXISTS, ON CONFLICT, DROP+CREATE
# for triggers and the format constraint; the backfill skips named tenants). It refuses
# to start unless production is at 31 or already has 32 recorded.
#
# Deploy ORDER matters: migration first (the web app reads tenants.slug), then
# the web app. The worker is not touched.
#
# Run from repo root:  bash scripts/deploy-migration-32.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(31|32)"'; then
  echo "ERROR: expected latest=00000000000031 (or 32 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000032 quote_link..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000032_quote_link.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "quote_link"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000032', 'quote_link', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording quote_link"
echo "  OK"

echo "→ Verifying (want link_cols 4, link_tables 2, unnamed 0, latest 00000000000032)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='tenants'
     AND column_name IN ('slug','slug_changed_at','quote_link_copied_at','quote_link_first_visit_at')) AS link_cols,
  (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('tenant_slug_history','reserved_slugs')) AS link_tables,
  (SELECT count(*) FROM tenants WHERE slug IS NULL) AS unnamed,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
