#!/usr/bin/env bash
# Push migration 42 (T-175: WhatsApp Embedded Signup columns; the WhatsApp
# settings table becomes server-only) to production Supabase via the
# management API, same route as deploy-migration-41.sh. Token comes from the
# macOS keychain item "Supabase CLI"; it never touches disk.
#
# Migration 42 is additive and re-runnable: new columns on whatsapp_configs
# (existing rows become 'manual'), three checks, two indexes, and the removal
# of the policy and grants that let a signed-in browser read or write the row.
# No row is changed.
# It refuses to start unless production is at 41 or already has 42 recorded.
#
# Deploy ORDER: this first, then the web app (the new code reads the new
# columns). The old web app only loses the ability to read the row from the
# browser session, and no business has a WhatsApp connection in production.
#
# Run from repo root:  bash scripts/deploy-migration-42.sh
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"
FILE="supabase/migrations/00000000000042_whatsapp_embedded_signup.sql"

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
if ! echo "$state" | grep -qE '"latest":"000000000000(41|42)"'; then
  echo "ERROR: expected latest=00000000000041 (or 42 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ WhatsApp connections stored today (expect 0):"
before="$(query "SELECT count(*) AS connections FROM whatsapp_configs;")"
echo "  ${before}"
fail_on_error "$before" "row count"

echo "→ Applying 00000000000042 whatsapp_embedded_signup..."
response="$(jq -Rs '{query: .}' "$FILE" | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "whatsapp_embedded_signup"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000042', 'whatsapp_embedded_signup', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording whatsapp_embedded_signup"
echo "  OK"

echo "→ After:"
after="$(query "SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'whatsapp_configs' AND column_name IN ('connection_method','waba_id','business_id','verified_name','number_kind','token_expires_at','expiry_warned_at','app_secret_encrypted','registered_at','registration_pin_encrypted','messages_ready_at','connected_at')) AS new_columns,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'whatsapp_configs') AS policies,
  (SELECT count(*) FROM information_schema.role_table_grants WHERE table_name = 'whatsapp_configs' AND grantee IN ('authenticated','anon')) AS browser_grants;")"
echo "  ${after}"
fail_on_error "$after" "post-check"
echo "Expected: latest 00000000000042, new_columns 12, policies 1 (service role), browser_grants 0."
