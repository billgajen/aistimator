# tickets/T-144-us-marketing-site-landing-pages-meta.md

## Goal
The US-facing marketing site and the tracking needed for Meta ads. Run ads only after beta
proves conversion (Docs/09-us-launch-plan.md success metrics).

## In scope
- **US homepage** on the Design System v2 tokens ("The Measured Document"): pitch =
  instant estimates in the business's own prices, on the website, by text, and on site;
  honest-accuracy story (range from photos, exact from scan, firm from nameplate).
  Use only verified stats already listed in Docs/06-v2-strategy.md §1, plus our own beta
  accuracy numbers from T-143 once they exist.
- **Per-trade landing pages** from pack landing copy blocks (painting, HVAC, water
  heaters, plumbing, electrical, garage doors): a live demo widget pre-loaded with that
  pack, a 30-second demo video slot, trade-specific FAQ, pricing, and a trial CTA. One
  template; pages generated from pack data.
- **Pricing page** from the T-134 plan config (no duplicated numbers).
- **Tracking:** Meta Pixel + Conversions API (server-side, deduplicated by event_id) for
  `ViewContent` (landing view), `Lead` (demo widget used), `StartTrial`, `Subscribe`
  (from the Stripe webhook, with value). UTM capture stored on the tenant at signup.
  Google Analytics 4 optional via env. Cookie consent banner (US: opt-out link; GB/EU: opt-in).
- SEO basics: metadata, OG images per trade, sitemap, schema.org `SoftwareApplication`.
- Legal: terms, privacy policy, SMS terms (TCPA/10DLC wording) pages.

## Out of scope
- Blog/content pipeline. Running the ads themselves (owner does this).

## Acceptance criteria
- [ ] 6 trade landing pages generated from pack data, each with a working demo widget
- [ ] Meta Events Manager shows Pixel + CAPI events deduplicated for the full funnel in test mode
- [ ] `Subscribe` fires from the Stripe webhook with the correct value and currency
- [ ] Lighthouse ≥90 performance and accessibility on the homepage and one trade page (mobile)
