#!/usr/bin/env bash
# T-173: make one account a platform admin (the /admin area), or take it away.
# Since migration 43 every sign-up is 'owner' and nobody can give itself
# 'admin'; this is the only way to grant it. It talks to production Supabase
# through the management API. Token comes from the macOS keychain item
# "Supabase CLI"; it never touches disk. The address is never stored anywhere.
#
#   bash scripts/set-platform-admin.sh you@example.com           # grant
#   bash scripts/set-platform-admin.sh you@example.com --remove  # back to owner
#   bash scripts/set-platform-admin.sh --list                    # who has it (count only)
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

if [ "${1:-}" = "--list" ]; then
  query "SELECT count(*) AS platform_admins FROM user_profiles WHERE role = 'admin';"
  echo
  exit 0
fi

EMAIL="${1:-}"
if ! echo "$EMAIL" | grep -qE '^[^@[:space:]'"'"']+@[^@[:space:]'"'"']+\.[^@[:space:]'"'"']+$'; then
  echo "Usage: bash scripts/set-platform-admin.sh you@example.com [--remove]" >&2
  exit 1
fi
ROLE="admin"
if [ "${2:-}" = "--remove" ]; then ROLE="owner"; fi

# The address is checked above (no spaces, no quotes) before it goes into the query
result="$(query "UPDATE user_profiles SET role = '${ROLE}'
  WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('${EMAIL}') AND email_confirmed_at IS NOT NULL)
  RETURNING role;")"
if echo "$result" | grep -q "\"role\":\"${ROLE}\""; then
  echo "Done: that account is now '${ROLE}'."
else
  echo "Nothing changed. Is there a confirmed account with that address? API said: ${result}" >&2
  exit 1
fi
