#!/usr/bin/env bash
# Push migrations 24 (quote lifecycle) + 25 (whatsapp) to production Supabase
# via the management API (direct db connections fail on IPv6 — see
# Docs/CHANGELOG.md 2026-07-21 deploy record). Token comes from the macOS
# keychain item "Supabase CLI"; it never touches disk.
#
# Run from repo root:  bash scripts/deploy-migrations-24-25.sh
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

TOKEN="$(security find-generic-password -s 'Supabase CLI' -w)"
if [ -z "$TOKEN" ]; then
  echo "ERROR: could not read 'Supabase CLI' token from keychain" >&2
  exit 1
fi

run_sql_file() {
  local file="$1" label="$2"
  echo "→ Applying ${label}..."
  local response
  response="$(jq -Rs '{query: .}' "$file" | curl -sS -X POST "$API" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @-)"
  if echo "$response" | grep -qi '"message"'; then
    echo "  API says: $response"
    echo "$response" | grep -qi 'error' && { echo "FAILED on ${label}" >&2; exit 1; }
  fi
  echo "  OK"
}

run_sql() {
  local sql="$1" label="$2"
  echo "→ ${label}..."
  local response
  response="$(jq -n --arg q "$sql" '{query: $q}' | curl -sS -X POST "$API" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @-)"
  echo "  ${response}"
}

run_sql_file supabase/migrations/00000000000024_quote_lifecycle.sql "migration 24 (quote lifecycle)"
run_sql_file supabase/migrations/00000000000025_whatsapp.sql "migration 25 (whatsapp)"

# Record both in migration history so future `supabase db push` stays in sync.
run_sql "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('00000000000024', 'quote_lifecycle', ARRAY['-- applied via management API 2026-07-24']),
  ('00000000000025', 'whatsapp', ARRAY['-- applied via management API 2026-07-24'])
ON CONFLICT (version) DO NOTHING;" "Recording migration history"

# Verify.
run_sql "SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'whatsapp_%') AS whatsapp_tables,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='quotes' AND column_name IN ('declined_at','decline_reason','reminder_sent_at')) AS lifecycle_columns,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='quote_status' AND e.enumlabel='declined') AS declined_enum;" "Verifying (want 3 / 3 / 1)"

echo "Done."
