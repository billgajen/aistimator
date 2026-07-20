# Hardcore E2E Test — 10 Scenarios

API-level gauntlet, no browser. Each scenario = one fresh tenant, pricing configured
through the **plain-language compiler** (T-104), customer request submitted through the
**public widget API**, quote polled and verified from the terminal.

Environment: local full stack (local Supabase + wrangler dev worker + real Gemini).
Assets: real photos dropped by the user into `test-assets/hardcore/S0X-*/` (gitignored).

Deliberate spread across the scenarios:

- **Pricing models:** per-sqm, per-unit count, per-metre, categorical (vehicle class),
  tiered volume, per-head with derived staffing, per-mile distance, per-visit recurring,
  hourly, risk multipliers, volume discounts, surcharges, minimums, hard exclusions.
- **Request styles:** vague, hyper-detailed, urgent, imperial units, emoji/slang,
  multi-issue, third-party payer, out-of-scope asks, either/or scope ambiguity,
  stated counts to verify against photos, text-only (no photos at all).
- **Ticket sizes:** ~£95 (valet) to multi-thousand (roofing, catering, tree removal) —
  exercises both the cheap path and the stakes-based adjudication tier (M4).

---

## S01 — Painting & Decorating (core vertical) — "Brushline Decorators"

**Pricing (plain language fed to compiler):**
> Exterior masonry painting is £28 per square metre including minor crack filling and
> two coats. If access is above single storey, add £250 for scaffold tower. Minimum job
> £350. We cover 15 miles from BS7, no travel charge.

**Customer request (verbatim):**
> Hi, the front of our house is looking really tired, paint peeling around the windows
> and the render looks patchy. How much roughly to freshen it all up? Photos attached.
> Hoping to get it done before my daughter's wedding in September.

**Assets:** 2–3 photos of a house front/exterior.
**Stresses:** full measurement engine (M1–M7), vague scope → VOI question, estimate
grade, plausibility envelope, scaffold addon inference from storeys.

---

## S02 — Roofing — "Apex Ridge Roofing"

**Pricing:**
> Replacing slipped or broken slates: £45 per slate for the first 10, £30 per slate
> after that. Ridge repointing £60 per metre. Leak investigation £180 fixed. Access
> tower £120 per day. Jobs needed within 48 hours get a 1.5x emergency multiplier.
> We do not do full re-roofs — anything over 40 slates needs an in-person survey.

**Customer request:**
> Storm last night and water is coming into the back bedroom. From the garden I can see
> 5 or 6 slates slipped near the ridge and one is cracked on the patio. Need someone
> THIS WEEK, it's forecast rain again Thursday.

**Assets:** 1–2 photos of a roof taken from ground level.
**Stresses:** count-based takeoff from distant photos, urgency multiplier, "5 or 6"
uncertainty, exclusion boundary (over 40 slates), high-stakes adjudication.

---

## S03 — Landscaping — "GreenForm Landscapes"

**Pricing:**
> Returfing £22 per square metre including topsoil and prep. Closeboard fencing £85 per
> metre supplied and installed. Porcelain patio £140 per square metre. Waste removal
> £90 per load. 10% discount on jobs over £5,000.

**Customer request:**
> Quite a specific list: lawn is roughly 30ft x 18ft and needs returfing. Replace about
> 65 feet of fence on the left boundary. New porcelain patio approx 12ft x 10ft where
> the old shed was. Can you break the price down per item? What's the lead time?

**Assets:** 1–2 photos of a garden.
**Stresses:** multi-line itemised quote, imperial→metric conversion, stated dimensions
vs photo evidence, volume discount trigger maths.

---

## S04 — Mobile Car Valeting — "GleamSquad Mobile Valeting"

**Pricing:**
> Full valet: small car £70, SUV or 7-seater £95. Pet hair removal add £25. Child seat
> deep clean £10 each. Stain treatment £15 per seat. Weekend appointments £20 extra.
> We need at least 24 hours notice.

**Customer request:**
> Got a 7 seater (Skoda Kodiaq), dog crates lived in the boot for years so dog hair is
> EVERYWHERE, plus two child seats that have seen things 😅 It's my sister's wedding
> Sunday morning — can you make it showroom by Saturday evening?? 🙏

**Assets:** 2–3 photos of a car interior and/or boot.
**Stresses:** small-ticket path (no senior adjudication), categorical vehicle pricing,
addon stacking, weekend surcharge inference, emoji/slang parsing.

---

## S05 — Accounting (digital service) — "Ledgerly & Co"

**Pricing:**
> Limited company year-end accounts and CT600: £850 covering up to 1,000 transactions,
> then £150 per extra 500 transactions. VAT return catch-up £95 per quarter. Payroll
> £8 per payslip per month. Director self-assessment £160 each. Bookkeeping tidy-up
> £45 per hour where records are messy.

**Customer request:**
> Behind on everything. Ltd company, year end was March. About 2,400 transactions
> across two bank accounts (statement attached). 3 VAT quarters outstanding. Me and my
> wife are both on monthly payroll and both need self assessments. What will it cost to
> get us fully up to date?

**Assets:** none required — a synthetic bank-statement CSV will be generated (drop a
real redacted statement in the folder if you prefer).
**Stresses:** fully digital service — no vision measurement, quantities from text+doc,
tiered volume pricing (2,400 → base + 3 tiers), multi-service composition.

---

## S06 — Event Catering — "Saffron & Sage Catering"

**Pricing:**
> Three-course seated menu £62 per head, children half price. Canapés on arrival £14
> per head. Vegan and gluten-free variants at no extra charge but must be flagged.
> Waiting staff: one per 15 guests at £140 each. Marquee/field kitchen setup £380.
> Travel beyond 30 miles: £1.20 per mile. 10% service charge on food.

**Customer request:**
> Wedding 14th June next year. 120 adults plus 8 children, seated three-course. 30
> vegans and 5 gluten-free among them. Canapés on arrival for everyone. It's in a
> marquee on a farm near Frome (BA11) — no kitchen on site at all. Can you quote
> all-in including staff?

**Assets:** none — text-only scenario.
**Stresses:** zero-photo pipeline, per-head pricing with child rate, derived staff
count (128 guests → 9 staff), conditional setup fee, service-charge maths.

---

## S07 — Tree Surgery — "Oakwise Tree Care"

**Pricing:**
> Crown reduction: £450 for trees under 10 metres, £900 for larger trees. Full removal
> of a large tree from £1,400. Work near structures or power lines carries a 25% risk
> premium. Chipping included; log removal £120 extra. TPO check £60.

**Customer request:**
> Big oak at the bottom of the garden — branches are now over next door's roof and
> quite close to the power line coming into the house. Neighbour is complaining. Not
> sure whether it needs taking down completely or just cutting back — what would each
> option cost? Photos taken from the upstairs window.

**Assets:** 1–2 photos of a large tree (garden/park tree fine).
**Stresses:** either/or scope ambiguity (reduction vs removal) → clarification/VOI,
size classification from photos, risk premium application, high-value adjudication.

---

## S08 — Commercial Window Cleaning — "ClearView Commercial"

**Pricing:**
> £3.20 per window per clean at ground level, £4.50 per window for second and third
> storeys (reach pole). Frame wipe-down included. Minimum visit £60. Monthly contract:
> 15% off the per-visit price. First clean is 50% extra as a deep clean.

**Customer request:**
> Three-storey office on an industrial estate. I counted 84 windows in total. We want
> monthly cleans — what's the per-visit price, and does the first clean cost more?
> Could start next month.

**Assets:** 1 photo of a multi-storey building facade (any office building works).
**Stresses:** customer-stated count (84) vs photo verification, storey-tiered per-unit
pricing, contract discount + first-clean surcharge interacting.

---

## S09 — Specialty Moving — "NoteWorthy Piano & Fine Moves"

**Pricing:**
> Baby grand piano local move £420. Grandfather/longcase clock £180. Stairs without a
> lift: £60 extra per flight per item. Distance beyond 25 miles: £2.10 per mile.
> Window/hoist extraction is not something we quote online — in-person survey required.
> Insurance up to £20,000 included.

**Customer request:**
> Yamaha GB1 baby grand plus a longcase clock, out of a 3rd floor flat in Bristol — no
> lift, tight Victorian staircase. Moving to Ambleside in Cumbria, about 250 miles.
> Slight worry the piano won't fit down the stairs and might need to go out the window?

**Assets:** 1 photo of a piano (or any large furniture item) + 1 of a stairwell.
**Stresses:** per-item + per-flight + per-mile stacking (2 items × 3 flights), excluded
service mentioned by customer (hoist) — must be flagged not priced, distance calc,
value >£1,000 adjudication.

---

## S10 — Pest Control — "ShieldPest Solutions"

**Pricing:**
> Wasp nest treatment £85, each additional nest £40. Mouse treatment programme (3
> visits) £190. Contaminated loft insulation clearance: not offered. Bird proofing:
> not a service we provide. Landlord or managed-property invoicing adds £15 admin.

**Customer request:**
> I'm the tenant but the landlord will pay. Wasps are getting in under the roof tiles
> into the loft — think there might be two nests?? Also found droppings under the
> kitchen sink, pretty sure we have mice. And while you're up there could you put
> spikes on the gutter so the pigeons stop sitting there? Photo of the corner where
> the wasps go in.

**Assets:** 1 photo of a roofline/eaves/gutter corner — deliberately low quality is
fine (this scenario tests poor evidence).
**Stresses:** multi-issue quote, hard out-of-scope ask (bird proofing must be excluded
via config, never priced), third-party payer admin fee, uncertain count ("two
nests??"), poor photo evidence → low grade / clarification.

---

## What gets verified per scenario

1. Compiler produced a config that matches the plain-language rules (spot-checked).
2. Submission accepted via public API; job processed; quote reached a terminal state.
3. **Deterministic pricing:** line items recomputed by hand from the config — penny-exact.
4. AI never set a price (AD-001): every line traces to a config rule.
5. Estimate grade (A/B/C), interval, and takeoff table present and coherent.
6. Clarification/VOI behaviour where designed (S01, S07, S10 expected candidates).
7. Out-of-scope asks excluded, not priced, not hardcoded around (S02, S09, S10).
8. Tenant isolation: each scenario's data invisible to the other 9 tenants.
