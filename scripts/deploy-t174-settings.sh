#!/usr/bin/env bash
# T-174: move the production settings to the product's own domain.
#
# The names come from packages/shared/src/domains.json: `main` (qolumns.com)
# and `previous` (the address the app ran at, which keeps serving).
#
#   bash scripts/deploy-t174-settings.sh [--dry-run] <step> [<step> ...]
#
# Steps, in the order to run them (each can be run again safely):
#   cors     the storage bucket accepts photo uploads from the main address as
#            well as the previous one (additive; safe before anything else)
#   auth     Supabase auth: Site URL = the main address; allowed redirect URLs
#            = the main and the previous address
#   app-url  the worker's APP_URL and Vercel's NEXT_PUBLIC_APP_URL (production)
#            = https://<main>. The worker changes at once; the web app at its
#            next production deploy.
#   sender   POSTMARK_FROM_EMAIL = quotes@<main> on the worker and on Vercel
#            (production). ONLY after the domain is verified in Postmark, or
#            emails will be refused. The web app changes at its next deploy.
#
# --dry-run prints what each step would send and changes nothing.
# No secret value is printed. The Supabase token comes from the macOS keychain
# item "Supabase CLI" and never touches disk.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAINS="$ROOT/packages/shared/src/domains.json"
PROJECT_REF="ygsuzeveesgrafgpkrev"
# the production bucket, as the worker binds it (not typed here a second time)
BUCKET="$(awk '/^\[\[env\.production\.r2_buckets\]\]/{f=1} f && /bucket_name/{gsub(/.*= *"|".*/, ""); print; exit}' "$ROOT/apps/worker/wrangler.toml")"
[ -n "$BUCKET" ] || { echo "Could not read the production bucket name from apps/worker/wrangler.toml" >&2; exit 1; }

MAIN="$(jq -r '.main' "$DOMAINS")"
APP_URL="https://${MAIN}"
SENDER="quotes@${MAIN}"

DRY=0
STEPS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    cors|auth|app-url|sender) STEPS+=("$arg") ;;
    *) echo "Unknown argument: $arg (steps: cors auth app-url sender; option: --dry-run)" >&2; exit 2 ;;
  esac
done
if [ "${#STEPS[@]}" -eq 0 ]; then
  echo "Name at least one step: cors auth app-url sender" >&2
  exit 2
fi

# The bucket's CORS rule: local development, every previous address, the main address
cors_json() {
  jq '{rules: [{
        allowed: {
          origins: (["http://localhost:3000", "http://localhost:3001"] + [.previous[] | "https://" + .] + ["https://" + .main]),
          methods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
          headers: ["*"]
        },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600
      }]}' "$DOMAINS"
}

# Supabase auth: where confirmation links land by default, and where they may land
auth_json() {
  jq '{site_url: ("https://" + .main),
       uri_allow_list: (["https://" + .main + "/**"] + [.previous[] | "https://" + . + "/**"] | join(","))}' "$DOMAINS"
}

step_cors() {
  echo "→ cors: bucket ${BUCKET}"
  if [ "$DRY" -eq 1 ]; then cors_json; return; fi
  local file
  file="$(mktemp)"
  cors_json > "$file"
  (cd "$ROOT/apps/worker" && npx wrangler r2 bucket cors set "$BUCKET" --file "$file" --force)
  rm -f "$file"
  (cd "$ROOT/apps/worker" && npx wrangler r2 bucket cors list "$BUCKET") | grep -E "allowed_origins"
}

step_auth() {
  echo "→ auth: Supabase project ${PROJECT_REF}"
  if [ "$DRY" -eq 1 ]; then auth_json; return; fi
  local token response
  token="$(security find-generic-password -s 'Supabase CLI' -w)"
  response="$(auth_json | curl -sS -X PATCH "https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth" \
    -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @-)"
  # only the two fields are shown: the full answer holds settings that are not ours to print
  echo "$response" | jq '{site_url, uri_allow_list, message}'
  echo "$response" | jq -e --arg want "$APP_URL" '.site_url == $want' > /dev/null || { echo "FAILED: site_url was not set" >&2; exit 1; }
}

# NAME VALUE: the same value on the worker and on Vercel production
set_both() {
  local worker_name="$1" vercel_name="$2" value="$3"
  if [ "$DRY" -eq 1 ]; then
    echo "  worker secret ${worker_name} = ${value}"
    echo "  Vercel production ${vercel_name} = ${value} (takes effect at the next production deploy)"
    return
  fi
  (cd "$ROOT/apps/worker" && printf '%s' "$value" | npx wrangler secret put "$worker_name" --env production)
  # --no-sensitive: an address, not a secret, so `vercel env ls` can show it was set
  (cd "$ROOT" && printf '%s' "$value" | npx vercel env add "$vercel_name" --environment production --force --no-sensitive --yes)
}

step_app_url() {
  echo "→ app-url: ${APP_URL}"
  set_both APP_URL NEXT_PUBLIC_APP_URL "$APP_URL"
}

step_sender() {
  echo "→ sender: ${SENDER}"
  if [ "$DRY" -eq 0 ] && [ "${POSTMARK_DOMAIN_VERIFIED:-}" != "yes" ]; then
    echo "Refusing: set POSTMARK_DOMAIN_VERIFIED=yes once Postmark shows ${MAIN} as verified (DKIM and Return-Path)." >&2
    exit 1
  fi
  set_both POSTMARK_FROM_EMAIL POSTMARK_FROM_EMAIL "$SENDER"
}

for step in "${STEPS[@]}"; do
  case "$step" in
    cors) step_cors ;;
    auth) step_auth ;;
    app-url) step_app_url ;;
    sender) step_sender ;;
  esac
done
[ "$DRY" -eq 1 ] && echo "(dry run: nothing was changed)" || echo "Done."
