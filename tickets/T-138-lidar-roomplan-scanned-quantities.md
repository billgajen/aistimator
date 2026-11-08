# tickets/T-138-lidar-roomplan-scanned-quantities.md

## Goal
Exact on-site measurement with the iPhone's LiDAR (AD-028). Only the basic estimator
fundamentals: rooms, walls, openings, floor and ceiling. No Polycam-style 3D.

## Decisions
- Use **Apple RoomPlan** (`RoomCaptureView` / `RoomCaptureSession`) through a small native
  Swift module wrapped as an Expo module. iOS only, LiDAR devices only. Detect support
  at runtime (`RoomCaptureSession.isSupported`) and hide the scan option when unsupported.
- The device sends **structured dimensions only** (JSON), not meshes. Optionally a USDZ
  file is stored in R2 for the business's records; it's never used for pricing.

## In scope
- **Native module:** start scan → live RoomPlan UI → finish → return a `CapturedRoom`
  summary. Supports multiple rooms per job (scan room by room, label each).
- **Scan schema** in `@estimator/shared` (metric canonical, per AD-025): per room — walls
  (width, height, area), doors and windows (width, height, which wall), openings, floor area,
  perimeter, ceiling height, plus scan confidence flags from RoomPlan.
- **Derived quantities (code, AD-024):** gross wall area, net wall area (minus openings),
  ceiling area, floor area, perimeter (skirting/trim length), door and window counts.
  Unit-tested formulas.
- **Engine:** new quantity basis `scanned` (`basis: measured|adjudicated|envelope|confirmed|scanned`).
  Scanned values skip ensemble/adjudication, are trusted, and count as Grade A drivers.
  Wire them in through the existing fusion so form-wins and confirmed rules still apply.
  Map scan quantities to service quantity keys via pack/service config (e.g. the painting
  pack maps `net_wall_area` → `wall_area_sqm`). No trade names in engine code.
- **Quote document:** takeoff rows show the method ("Net wall area: 412 sqft — LiDAR scan,
  3 rooms"). A simple 2D room summary (dimensions list; floor-plan drawing optional) on
  the quote page and PDF.
- **Fallback:** on non-LiDAR devices, the photo flow with ranges (existing). No AR
  tap-to-measure in this ticket.

## Out of scope
- Meshes, textures, CAD/DXF export, Android depth scanning, homeowner-side scanning,
  exterior scanning.

## Acceptance criteria
- [ ] On a LiDAR iPhone, scanning 2 rooms produces dimensions within ±3% of a tape measure on 3 checked walls (record results in the CHANGELOG)
- [ ] A painting quote from a scan prices from net wall area and is Grade A
- [ ] On a non-LiDAR device the scan button is hidden and the photo flow works
- [ ] Derived-quantity formulas have unit tests; no RoomPlan types leak into the engine (the shared schema is the boundary)
