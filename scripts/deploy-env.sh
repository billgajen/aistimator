#!/usr/bin/env bash
# Set the new production env vars for today's features.
# Run from repo root:  bash scripts/deploy-env.sh
set -euo pipefail

# Required: lifecycle cron auth (the cron refuses to run without it).
# Generated fresh here; you never need to know the value — Vercel passes it
# to /api/cron/lifecycle automatically.
# Replace any existing value — a previous run stored it with a trailing
# newline (piped openssl output), which Vercel rejects at build time.
if npx vercel env ls production 2>/dev/null | grep -q "CRON_SECRET"; then
  npx vercel env rm CRON_SECRET production --yes
fi
# printf '%s' emits NO trailing newline — required for HTTP header values
printf '%s' "$(openssl rand -hex 32)" | npx vercel env add CRON_SECRET production --sensitive --yes
if npx vercel env ls production 2>/dev/null | grep -q "CRON_SECRET"; then
  echo "CRON_SECRET set and verified"
else
  echo "ERROR: CRON_SECRET did not save" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Optional but recommended — uncomment and fill in when you have the values:
#
# Upstash Redis (public-endpoint rate limiting; fails open without it):
#   Create a database at https://console.upstash.com, then:
# printf 'https://YOUR-DB.upstash.io' | npx vercel env add UPSTASH_REDIS_REST_URL production
# printf 'YOUR-TOKEN' | npx vercel env add UPSTASH_REDIS_REST_TOKEN production
#
# Postmark (ALL emails are silently off without this — quote-ready, accepted,
# declined, reminders, plan-limit warnings):
# printf 'YOUR-POSTMARK-SERVER-TOKEN' | npx vercel env add POSTMARK_API_TOKEN production
# printf 'quotes@yourdomain.com' | npx vercel env add POSTMARK_FROM_EMAIL production
#
# Cloudflare Turnstile (bot check on quote submission; safe to enable now
# that all widget modes run on the platform origin — create at
# https://dash.cloudflare.com -> Turnstile):
# printf 'YOUR-SITE-KEY' | npx vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production
# printf 'YOUR-SECRET-KEY' | npx vercel env add TURNSTILE_SECRET_KEY production
#
# WhatsApp (guided setup at /app/whatsapp needs these):
# printf 'ANY-RANDOM-STRING-YOU-CHOOSE' | npx vercel env add WHATSAPP_VERIFY_TOKEN production
# printf 'YOUR-META-APP-SECRET' | npx vercel env add WHATSAPP_APP_SECRET production
# openssl rand -hex 16 | npx vercel env add WHATSAPP_ENCRYPTION_KEY production
# ---------------------------------------------------------------------------

echo "Done."
