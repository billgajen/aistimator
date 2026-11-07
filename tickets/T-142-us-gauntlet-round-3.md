# tickets/T-142-us-gauntlet-round-3.md

## Goal
Prove the US product before beta with the same rigour as rounds 1 and 2
(Docs/08-hardcore-test-findings.md).

## In scope
- Extend `scripts/hardcore-test/` with a US scenario set: at least 5 scenarios per
  launch pack (6 packs → 30+), US tenants (region US, USD, imperial), blind-authored
  customer requests (including wrong-trade plants, hagglers, unit confusion
  — feet vs metres, gallons), in-character simulated answers (existing `customer-sim.mjs`).
- **Real photos:** the owner supplies labelled photo sets per scenario. The harness reads
  them from a gitignored folder; never commit customer photos.
- **Scan fixtures:** recorded RoomPlan JSON outputs (from T-138 testing) as inputs for
  on-site painting scenarios.
- **SMS channel scenarios:** at least 3 run through the SMS adapter in test mode.
- Scoreboard: correct-money rate, grade honesty (no Grade A on untrusted drivers), holds
  that worked as designed, median latency, AI cost per quote.
- Write findings into `Docs/08-hardcore-test-findings.md` as "Round 3 — US" with an open-findings list.

## Out of scope
- Fixing findings (each becomes its own ticket, T-145+).

## Acceptance criteria
- [ ] 30+ US scenarios run end to end from one command
- [ ] A scoreboard and findings are recorded; every wrong-money quote has a root cause
- [ ] Baseline recorded for regression comparison in later tickets
