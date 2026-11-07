# tickets/T-140-packs-hvac-water-heaters.md

## Goal
The first two US identify-and-replace packs, as pure data (AD-022, AD-029).

## In scope
- **`hvac-replacement-us` pack:** services for central AC replacement, furnace
  replacement, heat pump replacement, and AC + furnace system replacement.
  - Identification keys: system type, cooling tons, furnace BTU input, fuel, efficiency
    (SEER2/AFUE tier), indoor unit location (attic/basement/closet/garage), approximate age.
  - Customer questions: home square footage, number of storeys, access issues, thermostat
    replacement wanted, ductwork condition (and when to flag "needs inspection").
  - Pricing template: equipment tiers by tonnage/BTU × efficiency (catalogue steps with
    `when`), labour, removal and disposal, permit, line set, pad, thermostat add-on,
    attic/difficult-access multiplier. All rates are **editable placeholders** that the
    business must review during onboarding.
  - Guided capture: outdoor unit wide shot, outdoor nameplate close-up, indoor unit wide,
    indoor nameplate, thermostat, access path.
  - Plausibility envelopes (e.g. tons vs home sqft) to catch misreads.
  - Grade rules: ductwork replacement is always "needs site visit" (honest range).
- **`water-heater-us` pack:** tank (gas/electric) and tankless; like-for-like and
  conversions (tank→tankless as an alternative option).
  - Identification keys: fuel, capacity (gal), tank vs tankless, venting type, location,
    age; expansion tank present; code items (drain pan, seismic straps where the pack
    region data says so — not hardcoded per state in the engine).
  - Pricing template: unit by capacity × fuel, labour, haul-away, permit, expansion tank,
    pan, venting conversion, gas line work as "needs visit" flag.
- Per-pack `promptContext` and landing-page copy blocks (used by T-144).
- Register both in the pack registry.

## Out of scope
- Commercial HVAC. Load calculations (Manual J). Brand-specific price lists.

## Acceptance criteria
- [ ] Onboarding from each pack produces a working configured tenant in under 10 minutes
- [ ] 5 end-to-end quotes per pack with real photos price correctly against hand-computed truth from the pack's default rates
- [ ] Ductwork and gas-line cases come out as a range or "needs visit", never a falsely firm price
- [ ] No pack values in engine code
