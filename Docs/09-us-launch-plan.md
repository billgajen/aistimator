# US Launch Plan — Aistimator V4

> **Status:** North star for the next build phase, agreed 2026-11-07. Extends `06-v2-strategy.md`
> and `07-measurement-engine.md`. Where this file conflicts with them, this file wins.

## Decisions (owner-stated)

- **AD-025: USA is the first market.** Worldwide later. Every tenant has a region
  (`US` default for new signups, `GB` kept for existing ones); units, currency, tax and
  physical reference sizes come from region data, never from engine code.
- **AD-026: Subscription only.** No per-deposit commission and no marketplace mechanics.
  Per-quote overage stays in the codebase but is off by default. Plan limits are hard caps
  with an upgrade prompt.
- **AD-027: Three channels.**
  1. The business's website (widget, built).
  2. Messaging: WhatsApp (built) plus SMS (new, required for the US).
  3. The business's own mobile app for quoting on site (new).
- **AD-028: Quantity basis `scanned`.** LiDAR room scans (Apple RoomPlan) taken by the
  business on site are measured ground truth. They rank alongside `confirmed`, and a
  quote whose driver quantities are all scanned or confirmed is Grade A eligible.
- **AD-029: Identification signals.** For identify-and-replace trades, the price depends
  on WHAT the equipment is (model, capacity, fuel, tonnage), not on its size. Vision reads
  labels and nameplates with evidence. Decoding tables and option lists live in packs.
  The customer or business confirms before Grade A.

## Accuracy promise (honest by design)

- Customer photos → instant **range** (Grade B/C) for area-based jobs.
- Business on-site LiDAR scan → **exact** price (Grade A).
- Identify-and-replace jobs (nameplate photo + a few answers) → **firm** price from photos.

## Launch trades

1. Painting & decorating (built; needs the US version).
2. HVAC replacement (AC, furnace, heat pump).
3. Water heaters.
4. Plumbing fixture replacement.
5. Electrical: panel upgrades and EV charger installs.
6. Garage doors.

Wave 2 (not this phase): roofing, gutters, fencing, concrete, landscaping, all using
satellite measurement. Wave 3: flooring, cleaning.

**Rule for adding a trade:** the previous wave must hit ≥80% of quotes within ±10% of the
final invoice.

## Ticket order

| Ticket | What | Type |
|---|---|---|
| T-132 | Production launch basics | Ops |
| T-133 | Region layer + US localisation | Core |
| T-134 | Subscription-only USD plans | Billing |
| T-135 | AI model upgrade + config-driven model routing | AI |
| T-136 | SMS channel (Twilio) | Channel |
| T-137 | Business mobile app (Expo) — on-site quoting — **built 2026-11-09** (API live-verified; on-device run pending) | App |
| T-138 | LiDAR room scan (RoomPlan) → `scanned` quantities — **built 2026-11-09** (engine live-verified; native module needs a device build) | App + engine |
| T-139 | Identification signals (nameplate reading) — **built 2026-11-09** (AD-032; real-nameplate accuracy proven in T-140/T-142) | Engine |
| T-140 | Packs: HVAC replacement + water heaters — **built 2026-11-09** (placeholder rates) | Packs |
| T-141 | Packs: plumbing fixtures, electrical, garage doors — **built 2026-11-09** (placeholder rates; gauntlet 10/10) | Packs |
| T-142 | US gauntlet (round 3) | Testing |
| T-143 | Beta instrumentation: final invoice + accuracy dashboard | Product |
| T-144 | US marketing site, per-trade landing pages, Meta Pixel + CAPI | Growth |

## Not doing in this phase

Satellite measurement · full 3D meshes/photogrammetry/CAD exports (Polycam-style) ·
homeowner-side LiDAR · marketplace or lead selling · FSM features (scheduling, dispatch,
CRM) · automated sales-tax engines (tenant-set rates only) · Android LiDAR.

## Success metrics for beta

- 10–20 paying US businesses before any Meta ad spend.
- Median |final invoice − quoted| / quoted < 10% per trade.
- Signup → first test quote < 10 minutes.
- Submission → price shown < 60 s.
