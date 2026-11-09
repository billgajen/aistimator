#!/usr/bin/env bash
# Push migration 30 (T-146 business review: services.auto_send, quotes
# approved_at/approved_by/previous_token_hash) to production Supabase via the
# management API, same route as deploy-migration-29.sh. Token comes from the
# macOS keychain item "Supabase CLI"; it never touches disk.
#
# Migration 30 is additive and re-runnable (ADD COLUMN / CREATE INDEX IF NOT
# EXISTS). The script refuses to start unless production is at 29 or already
# has 30 recorded.
#
# Deploy ORDER matters: migration first (the worker reads services.auto_send),
# then the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-30.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(29|30)"'; then
  echo "ERROR: expected latest=00000000000029 (or 30 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000030 business_review..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000030_business_review.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "business_review"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000030', 'business_review', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording business_review"
echo "  OK"

echo "→ Verifying (want review_cols 4, latest 00000000000030)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE (table_name='quotes' AND column_name IN ('approved_at','approved_by','previous_token_hash'))
        OR (table_name='services' AND column_name='auto_send')) AS review_cols,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
