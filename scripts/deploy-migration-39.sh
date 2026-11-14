#!/usr/bin/env bash
# Push migration 39 (T-160 unfinished requests that clear:
# request_leads.seen_at and handled_at, and an index for the
# new-requests count) to production Supabase via the management
# API, same route as deploy-migration-38.sh. Token comes from the macOS
# keychain item "Supabase CLI"; it never touches disk.
#
# Migration 39 is additive and re-runnable (ADD COLUMN IF NOT EXISTS,
# CREATE INDEX IF NOT EXISTS).
# It refuses to start unless production is at 38 or already has 39 recorded.
#
# Deploy ORDER matters: migration first (the web app's Home, menu badge and
# Unfinished list read the new columns), then the web app. No worker deploy.
#
# Run from repo root:  bash scripts/deploy-migration-39.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(38|39)"'; then
  echo "ERROR: expected latest=00000000000038 (or 39 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000039 unfinished_requests_seen..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000039_unfinished_requests_seen.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "unfinished_requests_seen"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000039', 'unfinished_requests_seen', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording unfinished_requests_seen"
echo "  OK"

echo "→ Verifying (want seen_col 1, handled_col 1, both nullable YES, index 1, latest 00000000000039)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='request_leads' AND column_name='seen_at') AS seen_col,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='request_leads' AND column_name='handled_at') AS handled_col,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='request_leads' AND column_name='seen_at') AS seen_nullable,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='request_leads' AND column_name='handled_at') AS handled_nullable,
  (SELECT count(*) FROM pg_indexes WHERE indexname='idx_request_leads_tenant_new') AS index,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
