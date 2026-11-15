#!/usr/bin/env bash
# Push migration 41 (T-166: rename the checker log's 'auto_corrected' label to
# 'passed_with_issues') to production Supabase via the management API, same
# route as deploy-migration-40.sh. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk.
#
# Migration 41 changes a label on old rows of quote_validation_logs and two
# column comments. No quote, price or setting is touched. Re-runnable.
# It stops, changing nothing, if any row has a correction recorded: that would
# mean the checker did change a quote once, and the owner should see it first.
# It refuses to start unless production is at 40 or already has 41 recorded.
#
# Deploy ORDER: the WORKER FIRST, then this. (The other way round, the old
# worker keeps writing the old label until it is replaced.) The web app does
# not read this table and needs no deploy for T-166.
#
# Run from repo root:  bash scripts/deploy-migration-41.sh
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
if ! echo "$state" | grep -qE '"latest":"000000000000(40|41)"'; then
  echo "ERROR: expected latest=00000000000040 (or 41 already). Stop and check by hand." >&2
  exit 1
fi

echo "→ Checking that the checker never recorded a correction (want with_a_fix 0)..."
fixes="$(query "SELECT count(*) FILTER (WHERE corrections_applied IS NOT NULL) AS with_a_fix,
  count(*) FILTER (WHERE outcome = 'auto_corrected') AS to_rename,
  count(*) AS runs
  FROM quote_validation_logs;")"
echo "  ${fixes}"
fail_on_error "$fixes" "correction check"
if ! echo "$fixes" | grep -qE '"with_a_fix":"?0"?[,}]'; then
  echo "ERROR: a checker run has a correction recorded. Nothing was changed. Look at that row first." >&2
  exit 1
fi

echo "→ Applying 00000000000041 checker_outcome_label..."
response="$(jq -Rs '{query: .}' supabase/migrations/00000000000041_checker_outcome_label.sql | curl -sS -X POST "$API" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @-)"
fail_on_error "$response" "checker_outcome_label"
response="$(query "INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
  VALUES ('00000000000041', 'checker_outcome_label', ARRAY['-- applied via management API $(date +%Y-%m-%d)'])
  ON CONFLICT (version) DO NOTHING;")"
fail_on_error "$response" "recording checker_outcome_label"
echo "  OK"

echo "→ Verifying (want old_label 0, latest 00000000000041)..."
query "SELECT
  (SELECT count(*) FROM quote_validation_logs WHERE outcome = 'auto_corrected') AS old_label,
  (SELECT count(*) FROM quote_validation_logs WHERE outcome = 'passed_with_issues') AS new_label,
  (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest;"
echo
echo "Done."
