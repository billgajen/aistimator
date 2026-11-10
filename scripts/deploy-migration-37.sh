#!/usr/bin/env bash
# Push migration 37 (T-156 one-tap approval from the review email:
# quote_approval_tokens (hash only, service role only), the trigger that
# invalidates open links when a quote changes, quotes.approved_via) to
# production Supabase via the management API, same route as
# deploy-migration-36.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 37 is additive and re-runnable (CREATE TABLE / INDEX IF NOT EXISTS,
# ADD COLUMN IF NOT EXISTS, the constraint added only if missing, the function
# CREATE OR REPLACE, the trigger dropped and re-created).
# It refuses to start unless production is at 36 or already has 37 recorded.
#
# Deploy ORDER matters: migration first (the worker writes the table and the
# web app reads it and sets approved_via), then the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-37.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(36|37)"'; then
  echo "ERROR: expected latest=00000000000036 (or 37 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000037 approval_links..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000037_approval_links.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "approval_links"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000037', 'approval_links', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording approval_links"
echo "  OK"

echo "→ Verifying (want table 1, rls true, policies 0, via_col 1, trigger 1, definer true, latest 00000000000037)..."
query "SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name='quote_approval_tokens') AS table,
  (SELECT relrowsecurity FROM pg_class WHERE relname='quote_approval_tokens') AS rls,
  (SELECT count(*) FROM pg_policies WHERE tablename='quote_approval_tokens') AS policies,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='quotes' AND column_name='approved_via') AS via_col,
  (SELECT count(*) FROM pg_trigger WHERE tgname='quotes_invalidate_approval_links') AS trigger,
  (SELECT prosecdef FROM pg_proc WHERE proname='quotes_invalidate_approval_links') AS definer,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
