#!/usr/bin/env bash
# Push migration 38 (T-157 a link the customer already has keeps working:
# quotes.link_token_hashes and the trigger that keeps the replaced hash
# whenever quote_token_hash changes) to production Supabase via the management
# API, same route as deploy-migration-37.sh. Token comes from the macOS
# keychain item "Supabase CLI"; it never touches disk.
#
# Migration 38 is additive and re-runnable (ADD COLUMN IF NOT EXISTS, the
# function CREATE OR REPLACE, the trigger dropped and re-created).
# It refuses to start unless production is at 37 or already has 38 recorded.
#
# Deploy ORDER matters: migration first (the web app's token filter reads the
# new column), then the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-38.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(37|38)"'; then
  echo "ERROR: expected latest=00000000000037 (or 38 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000038 quote_link_tokens..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000038_quote_link_tokens.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "quote_link_tokens"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000038', 'quote_link_tokens', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording quote_link_tokens"
echo "  OK"

echo "→ Verifying (want links_col 1, not_null NO, default '{}'::text[], trigger 1, before_update true, latest 00000000000038)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='quotes' AND column_name='link_token_hashes') AS links_col,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='quotes' AND column_name='link_token_hashes') AS not_null,
  (SELECT column_default FROM information_schema.columns WHERE table_name='quotes' AND column_name='link_token_hashes') AS \"default\",
  (SELECT count(*) FROM pg_trigger WHERE tgname='quotes_keep_link_tokens') AS trigger,
  (SELECT (tgtype & 2) = 2 AND (tgtype & 16) = 16 FROM pg_trigger WHERE tgname='quotes_keep_link_tokens') AS before_update,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
