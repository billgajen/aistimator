# Hardcore E2E Test — Findings (2026-07-20)

Terminal-driven gauntlet: 10 fresh tenants across 10 unrelated verticals (painting,
roofing, landscaping, car valeting, accounting, catering, tree surgery, window
cleaning, piano moving, pest control), each configured through the **plain-language
pricing compiler** and hit with an adversarial customer request through the
**public API** — no browser anywhere. Harness: `scripts/hardcore-test/`
(`node scripts/hardcore-test/run.mjs`). Four runs; findings verified against raw
Gemini reproductions and pricing traces. Real photos supplied by the user; the
accounting scenario used a generated 2,388-transaction bank statement PDF.

## Final run scoreboard (run 4, all harness-fidelity fixes in)

| # | Vertical | Total | Verdict vs hand-computed truth |
|---|---|---|---|
| S01 | Painting | £350 | ✅ Minimum-charge path correct for a customer who can't state area — but no clarification asked and photos unused (F5/F3) |
| S02 | Roofing | £1,057.50 | ✅ Emergency ×1.5 applied, penny-exact trace — but tier fields double-counted 7+7 slates (F2) and ridge priced ×1 fallback (F3) |
| S03 | Landscaping | £4,430 | ✅ **Penny-exact** (1,100+1,700+1,540+90); imperial→metric via customer answers; £5k discount correctly NOT applied |
| S04 | Valeting | £145 | ❌ SUV (+£25) and weekend (+£20) surcharges silently dropped — empty trigger conditions (F7) |
| S05 | Accounting | £1,487 | ❌ Transaction-tier step omitted this run (−£450+£850 base scope); run 3 same config idea → **£361,471** (×2,400 raw). Tiering inexpressible (F2) |
| S06 | Catering | £9,644 | ⚠️ Heads/canapés/kids exact; staff priced ×1 (£140 vs £1,260), marquee £380 and 10% service charge absent (F2/F3) |
| S07 | Tree surgery | £1,912.50 | ✅ (1,400+120+10... exact per config) with 25% risk premium applied |
| S08 | Window cleaning | £435.54 | ✅ **Penny-exact**: (28×3.20 + 56×4.50) × 0.85 monthly × 1.5 first-clean |
| S09 | Piano move | **£0 — SENT** | ❌ Both item steps dropped (empty triggers), quality gate sent a zero-price quote (F7/F6) |
| S10 | Pest control | £315 | ✅ 85+40+190; £15 landlord admin not compiled (asked as ambiguity — correct per never-invent, but then never resolved) |

Deterministic pricing held everywhere: every total reconciles penny-exact against
its config + answers via `pricing_trace_json`. AD-001 (AI never sets price) was
never violated. The failures are all in **what the config could express** and
**what the pipeline did about gaps** — not in the arithmetic.

## Fixed during the test (shipped this session)

- **F1 — Compiler discarded entire compilations.** Prompt never showed the
  `updatedConfig` schema; Gemini emitted `workSteps` at the draft root with
  `label`, the normalizer read only `pricing.workSteps[].name` → every
  compilation silently emptied, and invented defaults (`minimumCharge: 50`,
  step cost `25`) papered over it: all 10 verticals sent **£50 Grade-A "this
  price is exact"** quotes (a 128-guest wedding for £50). Fixed: explicit schema
  in prompt, shape-drift hoisting, `label`/`price` tolerance, invented defaults
  → 0, thinking-token headroom 8192→16384 (also cured the intermittent 500s).
  Result: 0 work steps across 10 tenants → 40.
- **F8 — Services API 500 on object options.** Compiler sometimes emits
  `options: [{label, value}]`; both services routes called `opt.toLowerCase()`.
  Fixed via `normalizeFieldOption()`.

## Open findings (each needs a ticket — ordered by severity)

- **F2 — The rules engine cannot express derived quantities.** No
  `ceil(max(0, n−1000)/500)` (transaction tiers), no `max(0, miles−25)`
  (distance thresholds), no `ceil(guests/15)` (staffing), no percentage-of-lines
  (service charge, over-£5k discount — compiler explicitly said so in
  ambiguities). The compiler compensates by pushing engine maths onto customer
  form fields ("miles beyond 30", two slate-tier fields), which customers
  predictably misanswer — S02 double-counted, S06 paid excess miles below the
  threshold, and S05 swung from **+£359k to −£718** across two runs of the same
  pricing text. This is the #1 structural gap. Design direction: a small typed
  expression layer over form fields/signals in `WorkStepConfig.quantitySource`
  (still deterministic, still config — no AI in the maths).
- **F2b (observation, 2026-07-20 post-T-125):** *range/category pricing* ("crown reduction £450 small / £900 large", "removal **from** £1,400") still has no schema home — `defaultCost` is a single number. The compiler nondeterministically models it well (category `when` steps) or badly (one S07 run produced a junk "£1 × 18" step priced £18 for a tree removal, sent Grade A). Candidate: min/max bounds on work steps feeding the T-120 interval, or category-conditioned `when` steps as the blessed pattern in the prompt. Track under T-127/T-128 plausibility work.
- **F7 — Conditional fixed charges can't bind to form answers.** Step triggers
  key on AI signals only; the compiler emits `triggerCondition: {operator:
  'equals'}` with no value/signal for "SUV +£25", "weekend +£20", "if piano" —
  engine drops the step silently. S09's two item steps both dropped → **a £0
  quote was sent**. Needs: `triggerField`-style conditions on work steps + the
  engine refusing to send a quote whose primary work steps all failed to bind.
- **F3 — Missing quantity ⇒ silent ×1 at full rate, labelled "Estimated — to be
  confirmed", still Grade A.** Fence £85 (should be £1,700), ridge £60, staff
  £140 (should be £1,260). T-108 clarification / T-121 VOI **never fired in any
  of 40 quote generations** — a £1,600 swing never triggered the max(£75, 10%)
  question bar because VOI only evaluates measured signals, not unresolved
  form-field quantities. `legacy_fallback` trace entries with
  `quantityTrusted: false` are the hook — they should feed VOI and cap the grade.
- **F6 — Grade A blind spots.** Grade asserts "all price-driving quantities
  provided or confirmed" on quotes with ×1 fallbacks, dropped steps, or (S09)
  zero priced lines. Grade should degrade on: untrusted quantity sources,
  unbound conditional steps, and empty/zero totals (which should block send
  entirely).
- **F4 — Per-service required fields unenforced at the public API.**
  `POST /api/public/quotes` validates only the global `widget_configs` row
  (`service_id IS NULL`); the per-service rows that `/api/services` creates from
  compiled `suggestedFields` are never checked, so required/critical fields can
  be omitted (feeding F3).
- **F5 — The V3 measurement engine never engages on compiler-built tenants.**
  The compiler is instructed to prefer `form_field` quantity sources, so zero
  `ai_signal` quantities existed across all runs → no ensemble, no envelopes, no
  adjudication, no reference-anchored takeoff — photos were decoration in 8
  photo scenarios (measurement-marked M1–M7 ran only as wording/context: e.g.
  S02's notes correctly observed the roof "might be asphalt shingles rather than
  slate", S09's notes caught that the stairwell photo didn't look like a "tight
  Victorian staircase" — real cross-checking that never touched the price).
  Design decision needed: measurable-from-photo quantities should compile to
  `ai_signal` + in-flow customer confirmation (AD-023), not raw ask-the-customer.
- **Cosmetic:** multiplier lines render raw condition labels ("Is Emergency Job:
  true", "Is First Clean: true") instead of human labels on the customer quote.

## Ticket plan for the open findings (agreed order)

One ticket at a time, per working style. Quick wins first, then the two
structural gaps, then truthfulness, then the strategic re-wiring:

- ✅ **ALL TICKETS SHIPPED 2026-07-20: T-129 (F4), T-125 (F2), T-126 (F7), T-127 (F3), T-128 (F6), T-130 (F5)** — see CHANGELOG entries. Final baseline run `2026-07-20-16-51-59-df6caa0f`: 9/10 delivered (8 sent + S07 correctly HELD at pending_review by the send-guard when the compiler produced a junk config — the F2b case, now caught instead of sent). Grades finally vary honestly (A×5/B×3/C×1 instead of uniform A); S01 priced FROM PHOTOS via ensemble+adjudication at £1,739.60 Grade B with interval £1,650–£1,818. **Open residue:** F2b range-pricing expressiveness (compiler still nondeterministic on "£450/£900 by size, from £1,400" — but failures now land in review, not with customers); S09 run-variance (stairs step occasionally compiles unbound — warn caught it); confirm-question quotes pre-adjudication value (cosmetic).
- **T-129 (F4, small):** `POST /api/public/quotes` must validate required/
  critical fields from per-service `widget_configs` rows, not only the global
  row. ~1 route change + test.
- **T-125 (F2, core):** deterministic derived quantities. New
  `quantitySource: { type: 'derived', formula }` with a tiny safe evaluator
  (`+ − × ÷ min max ceil floor`, operands = form fields / signals / constants;
  no AI, still pure config), plus a percentage line type for service charges /
  order-value discounts. Compiler prompt taught to emit formulas (it already
  writes them in prose). Takeoff shows the formula as the method.
- **T-126 (F7, core):** work-step conditions on form answers
  (`when: { fieldId, operator, value }`, same shape multipliers already use)
  + engine evaluation; **send-guard**: a quote whose work steps all failed to
  bind (or total £0 with non-empty request) can never auto-send — route to
  clarification/review.
- **T-127 (F3):** `quantityTrusted: false` / `legacy_fallback` trace entries
  feed T-121 VOI — if the swing clears max(£75, 10%), ask in-flow (AD-023)
  instead of silently pricing ×1.
- **T-128 (F6, small):** grade truthfulness — any untrusted quantity or unbound
  step caps the grade at B/C; Grade A requires every line trusted.
- **T-130 (F5, strategic):** compiler emits `ai_signal` (+ in-flow customer
  confirmation) for photo-measurable quantities instead of bare form fields, so
  the M1–M7 measurement engine actually runs for compiler-built tenants.
  Needs a short design pass first (which quantity kinds are photo-measurable,
  per AD-021/AD-023).

Re-run the gauntlet (`node scripts/hardcore-test/run.mjs`) after each ticket —
the run-4 scoreboard above is the baseline to beat.

## Harness notes

Per-scenario artifacts (compile, service, widget config, submission, public
quote, internal signals/trace/gate) land under
`scripts/hardcore-test/results/<run>/`. Auto-answering is hint-driven and
logged; option snapping, boolean coercion and specific-first hint order matter —
three earlier "bugs" were harness artifacts, and each is documented in the
run-over-run REPORT.md diffs. Local plumbing quirks (cookie minting, signup
trigger, tenant_sites insert, synchronous processing) are recorded in
CHANGELOG 2026-07-20 and the harness README block in SCENARIOS.md.
