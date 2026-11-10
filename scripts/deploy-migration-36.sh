#!/usr/bin/env bash
# Push migration 36 (T-153 public demo: tenants.is_demo + guard trigger,
# quotes.is_demo copied from the tenant, the demo slug reserved) to production
# Supabase via the management API, same route as deploy-migration-35.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 36 is additive and re-runnable (ADD COLUMN IF NOT EXISTS; functions
# CREATE OR REPLACE; triggers dropped and re-created; ON CONFLICT DO NOTHING).
# It refuses to start unless production is at 35 or already has 36 recorded.
#
# Deploy ORDER matters: migration first (the web app and worker read is_demo),
# then the seed (npx tsx scripts/seed-demo-tenant.mts --prod), the worker, then
# the web app.
#
# Run from repo root:  bash scripts/deploy-migration-36.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(35|36)"'; then
  echo "ERROR: expected latest=00000000000035 (or 36 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Applying 00000000000036 public_demo..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000036_public_demo.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "public_demo"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000036', 'public_demo', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording public_demo"
echo "  OK"

echo "→ Verifying (want tenant_col 1, quote_col 1, guard 1, inherit 1, slug_reserved 1, latest 00000000000036)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='tenants' AND column_name='is_demo') AS tenant_col,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='quotes' AND column_name='is_demo') AS quote_col,
  (SELECT count(*) FROM pg_trigger WHERE tgname='tenants_demo_guard') AS guard,
  (SELECT count(*) FROM pg_trigger WHERE tgname='quotes_inherit_demo') AS inherit,
  (SELECT count(*) FROM reserved_slugs WHERE slug='example-home-services') AS slug_reserved,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
