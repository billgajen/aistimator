# tickets/T-133-region-layer-us-localisation.md

## Goal
Make the product US-native without forking the engine. Introduce a region layer (AD-025)
so currency, units, tax, formats and physical reference sizes all come from data.

## Context
Today the product is UK-shaped: £ in copy and packs, metres/sqm in prompts and the
takeoff, UK door sizes as constants in code (CHANGELOG T-118: "a UK door is a UK door"),
VAT wording, UK postcodes. Tenants already have a `currency` column.

## In scope
- **Region data files** (e.g. `packages/shared/src/regions/{us,gb}.ts`): currency, locale,
  unit system (imperial/metric), tax label ("Sales tax" / "VAT"), address/ZIP format,
  phone format, date format, and **reference object dimensions** (US interior door
  80×36 in, US brick course, standard fence panel 6 ft, etc.).
- **Tenant `region` column** (migration). Default `US` for new signups, backfill `GB` for
  existing tenants. Region picker in onboarding and settings.
- **Move reference dimensions** out of engine constants into region data. The measurement
  engine reads them through the tenant's region. Packs can still override them.
- **Canonical internal units:** keep metric internally for all maths. Convert at the
  edges only (prompts, the customer confirm step, the takeoff table, PDF, dashboard).
  Customers type and see ft/sqft/in in US tenants. Add conversion helpers with tests.
- **Display:** currency and number formatting via `Intl` everywhere money or quantities
  render (widget, quote page, PDF, emails, dashboard, WhatsApp messages).
- **Tax:** a tenant-set sales tax rate with a label from the region. No state-by-state
  engine. Allow "tax not applicable" for services that aren't taxed.
- **Copy:** US English across widget, quote page, emails and PDF for US tenants
  (estimate/quote wording, "ZIP code").
- **Painting pack US version:** a USD, sqft, US-production-rate variant
  (`painting-decorating-us`). Keep the GB pack.
- **Compiler and wording prompts** receive the tenant's region so they parse "$2.50/sqft" and "per linear foot" correctly and write in the right units.
- Currency and unit system default from the region but can be overridden per tenant in settings (any ISO currency; imperial or metric).

## Out of scope
- New trades (T-140/T-141). Multi-currency per tenant. Translations.

## Acceptance criteria
- [ ] A new US tenant sees $, sqft/ft, "Sales tax" and ZIP everywhere, including PDF and emails — API, widget and quote data verified live; PDF and email rendering not checked (no DocRaptor/Postmark keys locally, see OWNER-TODO.md)
- [x] Existing GB tenants are unchanged (gauntlet baseline holds)
- [x] No reference dimensions remain hardcoded in engine code (grep check in the CHANGELOG entry)
- [x] Compiler correctly compiles "$3.20 per sqft walls, $450 minimum" for a US tenant
- [x] Measurement scenario with a US door reference produces sensible sqft (1,000 sq ft on the S01 photos; real US photos still an owner item)
- [x] Unit conversion and formatting have unit tests

## Plan
1. **Shared region layer** (`packages/shared/src/regions/`): `RegionDefinition` type plus
   `us.ts` and `gb.ts` data files (currency, locale, unit system, tax label, postal-code
   label and pattern, phone example, date style, reference object dimensions in metres,
   customer-facing copy terms). `resolveRegionContext(tenant)` applies per-tenant
   overrides (currency, unit system, tax label).
2. **Units + formatting** (`packages/shared/src/units.ts`, `format.ts`): metric⇄imperial
   conversion for length, area, volume; unit aliases; `formatMoney` / `formatQuantity` /
   `formatDate` via `Intl`. Unit tests in the worker suite.
3. **Migration 26**: `tenants.region` (backfill `GB` for every existing tenant, default `US`
   for new ones), `tenants.unit_system` (nullable override), `services.tax_exempt`.
   No new tables, so no new RLS.
4. **Measurement engine**: delete the `REFERENCE_OBJECTS` constant; the reference table
   comes from the tenant's region, overridable by `draft_config.referenceObjects` (packs).
   Geometry stays metric; the anchored result converts to the target's unit (fixes a
   latent bug where a `sqft` target received a sqm value).
5. **Worker**: load region on the tenant; tax label falls back to the region label;
   `tax_exempt` services skip tax; money labels and emails format with the region locale;
   wording prompt receives the region (US English, units, tax and postal wording).
6. **Web**: tenant API reads/writes `region` + `unitSystem`; region picker in onboarding and
   settings (choosing a region applies its currency, units and tax label as defaults,
   all overridable); compiler and AI-draft prompts receive the region; one shared
   `formatMoney` replaces the six local currency formatters (quote page, PDF, emails,
   dashboard, accept/cron routes); widget and WhatsApp use the region's postal-code label.
7. **US painting pack** `painting-decorating-us` (USD, sqft, linear ft, US envelope);
   packs carry a `region`, the picker lists the tenant's region first. GB pack unchanged.
8. **Harness**: GB scenarios set `region: 'GB'` explicitly so the baseline stays GB;
   add a US compile check and a US measurement scenario.
9. Gates, gauntlet, CHANGELOG (incl. reference-dimension grep), summary, commit.

## Implementation Summary
- **Region data** in `packages/shared/src/regions/` (US, GB): currency, locale, units, tax label,
  postal label/pattern/examples, language variant and metric reference-object tables.
  `resolveRegionContext` applies tenant overrides; `regionPromptBlock` feeds every AI prompt.
- **Units + Intl formatting** in `packages/shared/src/{units,format}.ts`, with 13 tests.
- **Migration 26**: `tenants.region` (GB backfill, US default), `tenants.unit_system`, `services.tax_exempt`.
- **Measurement**: reference sizes come from the region (pack overrides allowed); the table, not the
  model, owns the size; anchored areas convert into the signal's unit (fixed a latent sqft bug).
- **Display**: one shared `formatMoney`/`formatDate` replaces six currency tables across quote page,
  PDF, emails, dashboard, widget; postal wording from region in widget and WhatsApp.
- **Settings + onboarding** region picker; currency any ISO code; unit-system override.
- **US painting pack** `painting-decorating-us` with placeholder rates (TODO-OWNER).
- **Compiler** keeps the owner's billing unit and declares signal units; rule 3a hardened after the
  gauntlet showed copied example descriptions shrinking S01's measured scope.
- Verified: `verify-t133.mjs` 13/13; GB gauntlet within baseline after the S01 fix (CHANGELOG).
- New decision **AD-030** (metric geometry, prices bind in the step's unit).
