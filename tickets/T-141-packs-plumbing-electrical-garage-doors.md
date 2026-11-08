# tickets/T-141-packs-plumbing-electrical-garage-doors.md

## Goal
The remaining three launch packs, as data, following the T-140 pattern.

## In scope
- **`plumbing-fixtures-us`:** toilet, faucet, garbage disposal, sink, shower valve/trim,
  sump pump, water softener install.
  - Identification: fixture type, count, rough-in (toilet 10/12/14 in), shut-off valve
    condition, access (cabinet, crawlspace).
  - Pricing: per-fixture labour + customer-supplied vs contractor-supplied fixture tiers,
    disposal, valve replacement add-on. Anything behind walls → "needs visit" flag.
- **`electrical-us`:** panel upgrade (100→200A), EV charger install (Level 2),
  subpanel, dedicated circuit.
  - Identification: panel amperage and brand from the panel label/main breaker, open
    slots, panel location; EV charger distance from panel (customer-stated or estimated
    from photos with a range), wall type, garage vs exterior.
  - Pricing: base install + wire run per foot (derived formula) + permit + utility
    coordination flag. Known-hazard panels identified from the label → flag for visit (pack data list).
- **`garage-doors-us`:** door replacement (single/double), opener install/replacement,
  spring replacement.
  - Identification and measurement: door width/height (anchored against the standard
    door sizes in region data), panel style, insulation, opener type.
  - Pricing: door by size × tier catalogue, opener tiers, haul-away, spring add-ons.
- Guided capture, envelopes, promptContext and landing copy blocks for each pack.

## Out of scope
- Whole-home repiping, rewiring, custom doors.

## Acceptance criteria
- [ ] 5 end-to-end quotes per pack with real photos are correct against hand-computed truth
- [ ] EV charger wire-run distance is shown as a range unless confirmed or scanned
- [ ] Hazard/behind-wall cases never produce a falsely firm Grade A
- [ ] No pack values in engine code
