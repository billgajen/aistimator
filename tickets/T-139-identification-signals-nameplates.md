# tickets/T-139-identification-signals-nameplates.md

## Goal
Firm prices from photos for identify-and-replace jobs (AD-029). Read equipment labels and
nameplates, and identify fixtures and equipment types, so catalogue pricing can bind to
what the equipment actually is.

## Context
T-131 catalogue pricing and T-126 `when` conditions already let steps bind to form
answers. Identification fills those answers from photos, with evidence and confirmation.

## In scope
- **Identification signal type:** `{ key, value, evidence: { assetId, text_read, region? }, confidence, basis }`.
  Values are categorical or numeric (e.g. `fuel_type: gas`, `capacity_gal: 50`, `cooling_tons: 3`,
  `brand`, `model_number`, `manufacture_year`).
- **Identification schema per service, in packs:** which keys to identify, allowed values,
  units, and how to read them ("tonnage is encoded in the model number as BTU/12000;
  look for 024/030/036…"). Pack data only; the engine is generic.
- **Vision pass (model via the T-135 registry):** OCR-style reading of label photos plus
  type identification. Run 2 passes; agreement is the confidence (same principle as M3).
  Deterministic decoders in code where the pack supplies a rule (e.g. model-number
  regex → capacity).
- **Binding:** identified values fill the matching form fields as untrusted. Grade A
  requires customer or business confirmation through the existing in-flow confirm step
  ("We read: 50-gallon gas water heater, 2014 — correct?").
- **Guided capture:** packs can require a "label/nameplate close-up" angle, and image
  pre-validation (T-107) checks that it's legible (blur/glare) with a retake prompt.
- Takeoff/evidence rows on the quote: "Capacity: 50 gal — read from nameplate (photo 2)".

## Out of scope
- External model-number databases or paid APIs. Serial-number age decoding beyond what a pack supplies as a rule.

## Acceptance criteria
- [ ] 10 real nameplate photos (water heaters, AC condensers, furnaces): ≥8 have their key values read correctly; results recorded in the CHANGELOG
- [ ] A misread value can be corrected in the confirm step, and the price updates
- [ ] An unreadable label triggers a retake prompt, not a guess
- [ ] No trade-specific strings in engine code (grep check)
