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
- [ ] A new US tenant sees $, sqft/ft, "Sales tax" and ZIP everywhere, including PDF and emails
- [ ] Existing GB tenants are unchanged (gauntlet baseline holds)
- [ ] No reference dimensions remain hardcoded in engine code (grep check in the CHANGELOG entry)
- [ ] Compiler correctly compiles "$3.20 per sqft walls, $450 minimum" for a US tenant
- [ ] Measurement scenario with a US door reference produces sensible sqft
- [ ] Unit conversion and formatting have unit tests
