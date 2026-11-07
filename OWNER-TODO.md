# Owner TODO

Things only the owner can do: keys, accounts, real devices, real photos, prices.
Each item names the ticket, what is needed, and exactly where it goes.
Code for every item is already built; these are the steps that unlock it.

## T-133 — Region layer + US localisation

- [ ] **Apply migration 26 to production BEFORE deploying the web app or worker.**
  The new code selects `tenants.region`, `tenants.unit_system` and `services.tax_exempt`;
  without the migration, quote processing fails. File:
  `supabase/migrations/00000000000026_region_layer.sql` (backfills every existing tenant to `GB`).
  Use the same management-API route as migrations 24–25 (`scripts/deploy-migrations-24-25.sh` pattern).
- [ ] **Review the US painting pack rates.** Every number marked `TODO-OWNER` in
  `apps/web/src/lib/vertical-packs/painting-us.ts` is a placeholder (e.g. $375/room,
  $2.50/sq ft exterior, $1,200 exterior minimum). Replace with figures you are happy to show
  US businesses as starting defaults.
- [ ] **Real US photos for the US measurement check.** `scripts/hardcore-test/verify-t133.mjs`
  currently measures the UK S01 house photos as if it were a US job. Drop photos of a US
  house front (siding, 80 in front door visible) into a new gitignored folder
  `test-assets/hardcore/US-painting/` and point the script's `collectAssets(...)` path at it.
- [ ] **Check one US PDF and one US email by eye** once DocRaptor and Postmark keys are set
  (`DOCRAPTOR_API_KEY`, `POSTMARK_API_TOKEN` in Vercel env). Expect `$`, "Sales tax" and US date order.
  Code paths: `apps/web/src/lib/pdf-template.ts`, `apps/worker/src/email/index.ts`.
