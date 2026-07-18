# The Measurement Engine — V3 Estimation Core

> **Status:** North star for the estimation core, agreed 2026-07-18. Extends `06-v2-strategy.md`.
> **One-line:** Stop guessing quantities — measure them, grade them, and show the work like a
> world-class estimator (Goldman-grade documents, AACE-style estimate classes).

## Why the V2 core was not enough

A quote is `quantity × rate`. Rates are business-configured and deterministic (AD-001). Therefore
**the entire accuracy problem reduces to producing trustworthy quantities** — and the V2 core got
them in the weakest possible way: one vision call guessing an absolute number, with confidence
self-reported by the same model that guessed. Live testing proved the failure shape: the same
photos produced *no estimate*, then 50 sqm, then 60 sqm across three runs (bug #10, the £480
3-storey quote). Guardrails around a guess are still a guess.

Professional cost engineering solved this decades ago:
- **AACE estimate classes** — every estimate declares its precision (Class 5 ±50% → Class 1 ±5%)
  and upgrades as information improves.
- **Quantity takeoff** — every quantity is listed *with how it was measured*.
- **Method transparency** — the document shows its work; that's what makes a number defensible.

## Architecture — seven stages

### M1 — Scene inventory
Per photo: what surface/object is shown, which KNOWN-SIZE reference objects are visible
(door 1.981×0.762 m UK, brick+mortar course 75 mm, standard fence panel 1.83 m, window, car,
person), photo quality, which guided-capture angle it satisfies. Output: a scene graph.

### M2 — Anchored takeoff (AI compares, code calculates — AD-024 for vision)
Extraction prompts stop asking "how many sqm?" (VLMs are weak at absolutes) and instead ask for
**reference-relative components**: "the wall is ~4.2 door-widths wide and ~3.4 door-heights tall."
Deterministic code converts reference units to metres and computes areas/counts/lengths.
Reference-object dimension tables ship in **vertical packs as pure data**.

### M3 — Ensemble: variance IS the confidence
N=3 independent M2 passes (temperature-varied Flash). Deterministic statistics: median + coefficient
of variation (CoV). CoV ≤ threshold → accept median with measured confidence f(CoV).
Self-reported model confidence is no longer trusted for quantities.

### M4 — Adjudication (stakes-based model routing)
When passes disagree (high CoV) or the provisional estimate value is high, a STRONGER reasoning
model receives the passes' reasoning + photos and resolves the *cause* of disagreement ("pass A
included the garage elevation; pass B did not"), returning a final measurement and, when needed,
what would resolve it (a missing angle, a customer question).
**Routing rule: measurement spend scales with estimate value.** Config-driven tiers behind a
provider-agnostic interface (Gemini Flash → Gemini Pro; Claude vision pluggable).

### M5 — Plausibility envelope (deterministic, ships in packs)
Bounds computed from facts the customer already gave (form answers) + pack envelope tables:
e.g. `wall_area_sqm` for a front elevation = width [4–12 m] × height [storeys × 2.3–3.0 m].
- Measurement outside envelope → REJECTED before pricing → clarification.
- Vision failed entirely → the envelope itself prices a **Grade C estimate** (range from bounds).
  A silent quantity-1 or "no estimate" is now structurally impossible.

### M6 — Interval quantities → graded estimates
Quantities are `{low, best, high, basis: measured|adjudicated|envelope|confirmed, cov}`.
The deterministic engine prices all three. Every quote carries a **declared grade**:
- **C — Concept**: envelope-based or high variance. Wide honest range, prominent upgrade path.
- **B — Measured**: anchored takeoff with acceptable CoV. Tight range (±10–15%).
- **A — Confirmed**: driver quantities human-confirmed (customer one-tap or business). Exact price.

### M7 — Value-of-information questioning
`priceSpread(q) = price(high_q) − price(low_q)` per uncertain quantity. Ask ONLY the top question(s)
where `spread > max(10% of total, £75)`, max 2. Questions exist to move money-driving quantities to
`confirmed` — i.e. to upgrade the grade — not to satisfy a confidence threshold.

### Learning loop — measurement memory
Every confirmed job stores photo(s) + confirmed quantities as per-tenant measurement examples,
few-shot-injected into M2 for that business + service. Adjudication disagreement causes are logged
for prompt improvement. The estimator improves with every job — the moat at the measurement layer.

## The document (Goldman-grade delivery)
Reference number (EST-YYYY-NNNN) · client & validity block · **grade badge** · the number (or graded
range) + one action on top · **quantity takeoff table** ("Wall area: 60 sqm — measured against
door-frame reference, 3 passes agreeing ±8%") · investment breakdown · assumptions/exclusions ·
acceptance block · prepared-by. Simple above the fold; audit-grade beneath. Print-perfect PDF.
The takeoff-with-method table is the flagship differentiator — no competitor shows measurement basis.

## Model strategy summary
| Task | Default | Escalation |
|---|---|---|
| M1/M2 passes | Gemini Flash ×3 | — |
| M4 adjudication | — | Gemini 2.5 Pro (provider-agnostic; Claude vision pluggable) |
| Compile (T-104) | Pro-tier | — |
| Wording/docs | Flash | — |
Escalation triggers: CoV above threshold, estimate value above tenant-configurable bar.

## Build order
- **T-116 Plausibility envelopes** — pack data + deterministic bounds + worker integration
  (reject/clamp, envelope-fallback Grade C pricing, clarification wiring). Pure code+data; kills the
  silent-wrong-quantity class outright.
- **T-117 Ensemble extraction** — N-pass quantities, CoV-based measured confidence replacing
  self-reported confidence for quantities.
- **T-118 Anchored takeoff** — reference tables in packs, component-measurement prompts, code-side
  geometry.
- **T-119 Adjudication tier** — provider-agnostic model routing by stakes.
- **T-120 Interval pricing + grades** — engine, quote page, PDF.
- **T-121 VOI questioning** — replaces threshold-based clarification.
- **T-122 The document** — takeoff table, grade badge, reference numbers, acceptance block.
- **T-123 Measurement memory** — few-shot from confirmed jobs.

## Non-negotiables carried forward
AD-001 (AI never sets prices — now extended: AI never even *finalizes a quantity* without either
measured agreement, envelope plausibility, or human confirmation) · AD-024 (AI compares, code
calculates) · anti-hardcoding (references, envelopes, thresholds all ship as pack/tenant data).
