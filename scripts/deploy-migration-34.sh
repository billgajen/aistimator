#!/usr/bin/env bash
# Push migration 34 (T-151 customer flow: tenants.contact_requirement,
# quote_requests.customer_email nullable, quotes.acceptance_json, request_leads) to production Supabase via the management API, same
# route as deploy-migration-33.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 34 is additive and re-runnable (IF NOT EXISTS; constraints, trigger and policies
# are dropped and re-created; DROP NOT NULL is idempotent). It refuses
# to start unless production is at 33 or already has 34 recorded.
#
# Deploy ORDER matters: migration first (the web app writes request_leads), then
# the worker, then the web app.
#
# Run from repo root:  bash scripts/deploy-migration-34.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(33|34)"'; then
  echo "ERROR: expected latest=00000000000033 (or 34 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000034 customer_flow..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000034_customer_flow.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "customer_flow"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000034', 'customer_flow', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording customer_flow"
echo "  OK"

echo "→ Verifying (want contact_col 1, acceptance_col 1, leads_table 1, email_nullable YES, latest 00000000000034)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='tenants' AND column_name='contact_requirement') AS contact_col,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='quotes' AND column_name='acceptance_json') AS acceptance_col,
  (SELECT count(*) FROM information_schema.tables WHERE table_name='request_leads') AS leads_table,
  (SELECT is_nullable FROM information_schema.columns WHERE table_name='quote_requests' AND column_name='customer_email') AS email_nullable,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
