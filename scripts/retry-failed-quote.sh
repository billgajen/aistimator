#!/usr/bin/env bash
# T-178: price a failed (or stuck) quote again, from the platform owner's machine.
#
#   bash scripts/retry-failed-quote.sh --list             # failed quotes, and ones stuck for 15 minutes or more
#   bash scripts/retry-failed-quote.sh qte_0123abcd...    # retry one
#
# How it is allowed to: it writes the hash of a random one-time code onto the
# quote through production Supabase's management API (the token comes from
# the macOS keychain item "Supabase CLI"; it never touches disk), then calls
# the web app's retry route with the code. The code works once, for that
# quote, for ten minutes. No password, key or customer detail is printed.
#
# The customer's existing link keeps working. When the retry prices the
# quote, the business and the customer get the usual emails.
set -euo pipefail

PROJECT_REF="ygsuzeveesgrafgpkrev"
API="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"
APP="${QOLUMNS_URL:-https://qolumns.com}"

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

if [ "${1:-}" = "--list" ]; then
  # The business and the stored reason; never the customer
  query "SELECT q.id, q.status, to_char(q.created_at AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI') AS created_utc,
           t.name AS business, left(coalesce(q.content_json->>'error', ''), 120) AS reason
         FROM quotes q JOIN tenants t ON t.id = q.tenant_id
         WHERE q.status = 'failed'
            OR (q.status IN ('queued', 'generating') AND q.created_at < now() - interval '15 minutes')
         ORDER BY q.created_at DESC LIMIT 50;" | jq -r 'if type == "array" then (if length == 0 then "No failed or stuck quotes." else .[] | "\(.id)  \(.status)  \(.created_utc) UTC  \(.business)  \(.reason)" end) else . end'
  exit 0
fi

QUOTE="${1:-}"
if ! echo "$QUOTE" | grep -qE '^qte_[A-Za-z0-9_]{6,60}$'; then
  echo "Usage: bash scripts/retry-failed-quote.sh qte_... | --list" >&2
  exit 1
fi

CODE="$(openssl rand -hex 32)"
HASH="$(printf '%s' "$CODE" | shasum -a 256 | awk '{print $1}')"

# The id is checked above (letters, digits and _ only) and the hash is hex
marked="$(query "UPDATE quotes
  SET content_json = content_json || jsonb_build_object('retryCode', jsonb_build_object(
        'hash', '${HASH}',
        'expiresAt', to_char((now() + interval '10 minutes') AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')))
  WHERE id = '${QUOTE}' AND status IN ('failed', 'queued', 'generating')
  RETURNING status;")"
if ! echo "$marked" | grep -q '"status"'; then
  echo "Nothing to retry: no failed or stuck quote has that id. API said: ${marked}" >&2
  exit 1
fi

reply="$(curl -sS -X POST "${APP}/api/admin/quotes/${QUOTE}/retry" -H "X-Retry-Code: ${CODE}" -H 'Content-Type: application/json' -w '\n%{http_code}')"
status="$(echo "$reply" | tail -1)"
if [ "$status" = "200" ]; then
  echo "Done: ${QUOTE} is being priced again. Look at it in a few minutes: bash scripts/retry-failed-quote.sh --list"
else
  echo "The retry was refused (HTTP ${status}): $(echo "$reply" | sed '$d')" >&2
  exit 1
fi
