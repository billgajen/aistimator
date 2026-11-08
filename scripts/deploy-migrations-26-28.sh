#!/usr/bin/env bash
# Push migrations 26 (region layer), 27 (SMS channel) and 28 (US plans) to
# production Supabase via the management API (direct db connections fail on
# IPv6 — see Docs/CHANGELOG.md 2026-07-21 deploy record). Token comes from the
# macOS keychain item "Supabase CLI"; it never touches disk.
#
# Migration 27 is NOT re-runnable (CREATE TRIGGER / CREATE POLICY), so the
# script refuses to start unless production is exactly at migration 25, and
# records each migration in history as soon as it applies. Each file runs as
# one implicit transaction: a failure rolls that file back completely.
#
# Run from repo root:  bash scripts/deploy-migrations-26-28.sh
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
    echo "FAILED on ${label} — nothing from this step was kept (single transaction)." >&2
    exit 1
  fi
}

# 1. Pre-check: production must be at 25 with none of 26–28 recorded.
echo "→ Checking migration history..."
state="$(query "SELECT
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest,
  (SELECT count(*) FROM supabase_migrations.schema_migrations
     WHERE version IN ('00000000000026','00000000000027','00000000000028')) AS already;")"
echo "  ${state}"
fail_on_error "$state" "pre-check"
if ! echo "$state" | grep -q '"latest":"00000000000025"' || ! echo "$state" | grep -q '"already":0'; then
  echo "ERROR: expected latest=00000000000025 and already=0. Stop and check by hand." >&2
  exit 1
fi

apply() {
  local version="$1" name="$2"
  local file="supabase/migrations/${version}_${name}.sql"
  echo "→ Applying ${version} ${name}..."
  local response
  response="$(jq -Rs '{query: .}' "$file" | curl -sS -X POST "$API" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data-binary @-)"
  fail_on_error "$response" "$name"
  response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('${version}', '${name}', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
    ON CONFLICT (version) DO NOTHING;")"
  fail_on_error "$response" "recording ${name}"
  echo "  OK"
}

# 2. Order matters: 26 must land before the new web app / worker go live.
apply 00000000000026 region_layer
apply 00000000000027 sms_channel
apply 00000000000028 us_plans

# 3. Verify.
echo "→ Verifying (want region_cols 2, gb_tenants = all_tenants, sms_tables 4, us_plans 3, legacy_active 0)..."
query "SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='tenants' AND column_name IN ('region','unit_system')) AS region_cols,
  (SELECT count(*) FROM tenants WHERE region='GB') AS gb_tenants,
  (SELECT count(*) FROM tenants) AS all_tenants,
  (SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'sms_%') AS sms_tables,
  (SELECT count(*) FROM plans WHERE id LIKE 'plan_us_%' AND is_active) AS us_plans,
  (SELECT count(*) FROM plans WHERE id IN ('plan_starter','plan_growth','plan_pro') AND is_active) AS legacy_active;"
echo
echo "Done."
