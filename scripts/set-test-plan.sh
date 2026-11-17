#!/usr/bin/env bash
# T-177: put one business on a plan by hand, as a FREE TEST ACCOUNT, or take
# that away. For our own test businesses (the one used for Meta's App Review),
# until plans are bought through Stripe.
#
# What the row is: a subscription with no Stripe customer and no Stripe
# subscription. So:
#   - it is never billed (Stripe does not know it exists);
#   - it is not revenue: anything that counts revenue must count Stripe
#     subscriptions only, and this row has none;
#   - it gives the business its plan's quote limit and channels (WhatsApp on a
#     plan that includes it), exactly like a paid one.
# A business that already has a Stripe subscription is never touched.
#
# It talks to production Supabase through the management API. Token comes from
# the macOS keychain item "Supabase CLI"; it never touches disk.
#
#   bash scripts/set-test-plan.sh tnt_xxxxxxxx plan_us_pro   # put it on that plan
#   bash scripts/set-test-plan.sh tnt_xxxxxxxx --remove      # back to the free allowance
#   bash scripts/set-test-plan.sh --list                     # every free test account
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

# a row with no Stripe customer and no Stripe subscription
FREE="s.stripe_customer_id IS NULL AND s.stripe_subscription_id IS NULL"
show() {
  query "SELECT t.id AS business, t.name, s.plan_id, s.status, (${FREE}) AS free_test_account
         FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id WHERE t.id = '$1';"
  echo
}

if [ "${1:-}" = "--list" ]; then
  query "SELECT t.id AS business, t.name, s.plan_id, s.status FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE ${FREE} ORDER BY t.name;"
  echo
  exit 0
fi

TENANT="${1:-}"
WHAT="${2:-}"
if ! echo "$TENANT" | grep -qE '^tnt_[a-z0-9]{8,40}$' || { [ "$WHAT" != "--remove" ] && ! echo "$WHAT" | grep -qE '^plan_[a-z_]{2,40}$'; }; then
  echo "Usage: bash scripts/set-test-plan.sh <business id: tnt_…> <plan id: plan_…>   |   <business id> --remove   |   --list" >&2
  exit 1
fi

echo "Before:"
show "$TENANT"

# Both ids are checked above (letters, digits and underscores only) before they go into a query
if [ "$WHAT" = "--remove" ]; then
  result="$(query "DELETE FROM subscriptions s WHERE s.tenant_id = '${TENANT}' AND ${FREE} RETURNING s.tenant_id;")"
else
  result="$(query "INSERT INTO subscriptions AS s (tenant_id, plan_id, status, current_period_start)
    SELECT t.id, p.id, 'active', now() FROM tenants t, plans p WHERE t.id = '${TENANT}' AND p.id = '${WHAT}'
    ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active'
      WHERE ${FREE}
    RETURNING s.tenant_id;")"
fi

echo "After:"
show "$TENANT"
if echo "$result" | grep -q "\"tenant_id\":\"${TENANT}\""; then
  echo "Done."
else
  echo "Nothing changed. Is the business id right, is the plan id one of the plans, and is this business free of a Stripe subscription? API said: ${result}" >&2
  exit 1
fi
