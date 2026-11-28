# V2 Strategy — The World's Best Estimator

> **Status:** North star, agreed 2026-07-18.
> **One-line positioning:** *"Your price, never the AI's — quoted in 60 seconds, on your website and your WhatsApp."*
> This document supersedes ad-hoc feature direction. Read alongside `00-v1-scope.md` (v1 boundaries) and `CHANGELOG.md` (decision history).

---

## 1. Why we win (validated market thesis)

Deep market research (July 2026) confirms the core bet and reveals the gap:

- **Nobody combines all four:** customer-facing instant quotes + photo AI + business-configured deterministic pricing + multi-vertical engine. ResponsiBid is customer-facing but has no photos/AI. Yembo and Hover do photo AI but are pro-facing and single-vertical. Jobber's AI drafts quotes internally — a human still sends them. Our architecture (AD-001: AI never sets price) is exactly the pattern every funded winner follows, and the Zillow Offers failure (>$880M loss from algorithmic pricing) validates the constraint.
- **The willingness to pay is proven:** Roofr sells its customer-facing Instant Estimator widget as a standalone **$149/mo add-on**. Per-unit pricing norms across the market: $13–38/measurement report, $25/consult (SmileSnap), $0.79/AI conversation (Jobber).
- **Speed-to-lead is the sales pitch, with verified numbers:**
  - 40% of home-service companies **never respond** to a lead; 95% miss the 5-minute window (Valve+Meter 2024 secret-shopper audit, n=466).
  - Responding in 5 min vs 30 min: 21x more likely to qualify the lead (Lead Response Management Study); 7x within-the-hour effect replicated by HBR (n=2,241 firms).
  - Hatch turned this narrative alone into a **$270M exit** (Yelp, Jan 2026, at ~$25M ARR).
  - Do NOT cite: "78% buy from first responder", "ServiceTitan 62% vs 28%" — both debunked as folklore during verification.
- **WhatsApp quoting is an empty category:** inbound business conversations are **free** since Meta's July 2025 pricing change; UK reach 92% (Ofcom 2025); Meta's Business Agent (global June 2026) does FAQs/booking but cannot produce configured, priced quote documents.
- **Shared-lead marketplaces are dying** (Angi revenue −13% FY2025; ~$833 effective cost per booked job). A widget that converts the business's *own* traffic is positioned directly against this pain.

**Timing risk:** incumbents are bundling AI fast (ServiceTitan Atlas, Jobber AI, Housecall Pro AI Team, all shipped Aug 2025–May 2026). Our defensible wedge is the thing a horizontal FSM or Meta agent can't credibly promise: *the price is always the business's own, deterministically.* Speed matters.

---

## 2. Honest diagnosis of v1 (the five flaws)

### Flaw 1 — Config engine instead of answer engine
The recurring CHANGELOG bug themes (semantic signal-key matching, negation regexes, phrase verification, keyword collisions, type coercion) are symptoms of one architectural mismatch: businesses hand-encode a DSL (signal keys, trigger conditions, multiplier operators) and the AI fuzzy-matches natural language into that rigid schema. Every mismatch becomes a bug we patch by hand.

**Inversion (AD-021):** the business describes pricing in **plain language** ("£12/sqm for walls, £15/sqm ceilings, add 20% for ceilings above 2.6m, minimum £150"). AI *compiles* it once — at config time, reviewable as a diff — into the deterministic rate card the existing rules engine executes. At quote time, AI's only job is **quantities and facts with evidence**. Quantities × rates = price. No keyword matching in the pricing hot path. The rules engine survives; the hand-authored DSL editing UX goes.

### Flaw 2 — No outcome feedback loop (the missing moat)
`quote_amendments` and `tenant_learning_context` exist but nothing closes the loop from outcomes (accepted / amended / rejected, and by how much) back to calibration of rates, confidence thresholds, and vision prompts. Confidence thresholds are hand-tuned constants. The world's best estimator is the one that learns that *this* business's quotes for *this* service run 12% under after amendments — and corrects. Per-tenant calibration history is also the defensibility a copycat can't replicate.

### Flaw 3 — Uncertainty handled at the wrong moment
Low confidence currently → pending_review queue or a wide range. Both sacrifice "instant". Fix: push uncertainty back to the **customer, in the flow** — AI presents what it saw ("4 rooms, ~120 sqm wall area, standard prep — correct?") and one tap converts low-confidence AI signals into confidence-1.0 customer-confirmed ground truth *before* pricing (consistent with AD-002: form/customer input is source of truth). Combine with **range-first delivery**: instant range on the spot, firm quote after confirmation/review. Also missing: guided photo capture (Hover's core trick) and image pre-validation — bad photos currently degrade estimates silently.

### Flaw 4 — Not monetizing the moments that matter
- Usage limits are **not enforced** — quote #51 on a 50-quote plan just works. Revenue is structurally impossible today.
- No metered unit. The market-proven model is flat base + per-quote metering.
- Marketing doesn't use the speed-to-lead numbers that define the category.

### Flaw 5 — WhatsApp is a stub sitting on an empty category
Config UI + webhook exist; the conversation → quote flow doesn't. The conversational widget engine already does exactly what the WhatsApp flow needs.

---

## 3. Go-to-market: vertical wedge, horizontal engine

The engine stays generic (anti-hardcoding principle holds). Go to market **vertical-first** via **vertical packs** — pure configuration bundles (service templates, editable benchmark rates, vision guidance, guided-photo flows, landing pages). Packs are data, not code.

**Launch vertical: Painting & decorating** (decided 2026-07-18).
- $28.2B US market (IBISWorld); production-rate pricing (rate × sqm) is perfectly deterministic; photos→walls→sqm is within current vision reliability.
- Competition: PaintScout (~$119/seat/mo) has **no AI and no customer-facing widget**. The lane is open.
- Pack contents: interior/exterior painting + wallpaper/decorating service templates; editable production-rate defaults; guided capture ("one photo per wall, stand ~3m back, include floor-to-ceiling"); vision prompt tuned for wall area, ceiling height, prep conditions (cracks, damp, stripping); confirm-step schema (rooms, sqm, prep level).

**Expansion order (from research):** moving (Yembo proved photo accuracy 85–95% but stays pro-facing), junk removal/cleaning (natural photo→volume→price), roofing last (crowded: Roofr/Hover/EagleView).

---

## 4. Monetization (v2)

| Tier | Price (indicative) | Includes |
|---|---|---|
| Free | £0 | 5 quotes/mo, "Powered by" branding |
| Pro | ~£99/mo | 75 quotes/mo, full branding, hosted quote page, PDF |
| Scale | ~£249/mo | WhatsApp channel, calibration insights, priority support |
| Overage | per-quote metered | Stripe usage records beyond plan limit |

Principles: the widget is the product, not a freebie (Roofr precedent). Meter the tangible unit (a delivered quote). **Hard-enforce limits** with warning banners at 80% and a paywall at 100%. Pitch against shared-lead marketplaces, not against FSM suites.

---

## 5. Phased roadmap

Working style unchanged: one ticket at a time, plan → implement → checks → CHANGELOG.

### Phase 0 — Revenue foundation (do first; days not weeks)
- **T-101 Enforce plan limits.** Block quote creation past monthly limit (graceful widget message + business notification), warning banners at 80%, dashboard usage meter. *Gap noted in v1: no usage enforcement.*
- **T-102 Metered overage billing.** Stripe usage records for per-quote overage; plan structure supporting widget-as-SKU; proration on upgrade.
- **T-103 Speed-to-lead marketing homepage.** Rebuild homepage around verified stats (§1); painting-vertical landing page comes with T-114.

### Phase 1 — Setup revolution (kill the wizard)
- **T-104 Plain-language pricing compiler.** Natural-language / document / URL input → AI compiles to rate-card JSON (existing `PricingRules` schema) → business reviews a human-readable diff → deterministic engine executes. Replaces hand-editing multiplier DSL. Extends the existing ai-draft endpoints; compilation is config-time only.
- **T-105 Website-URL onboarding.** "Paste your website" → scrape services/pricing pages → draft full service set (builds on bulk upload extraction).
- **T-106 Onboarding interview agent.** Conversational setup replacing the 5-step wizard for the default path; wizard remains as "advanced mode". Target: signup → first test quote in **under 10 minutes**.

### Phase 2 — Accuracy engine
- **T-107 Guided photo capture + pre-validation.** Per-service capture instructions in the widget; client-side blur/brightness/size checks; reject-and-retake UX. (Vision quality was an unvalidated silent failure in v1.)
- **T-108 Quantity confirmation step.** After extraction, widget shows AI findings with evidence; customer confirms/corrects; confirmed values become 1.0-confidence signals (AD-002-consistent). Converts review-queue cases into instant quotes.
- **T-109 Range-first quoting.** Instant range always (within seconds); firm quote after confirmation and/or business review per fallback config. Never make the customer wait with nothing.
- **T-110 Outcome calibration loop.** Close the loop: amendments/acceptance/rejection deltas per tenant+service → suggested rate adjustments and threshold tuning, surfaced in dashboard ("your fence quotes get amended +15% on average — raise the base rate?"). Business approves; nothing auto-changes prices (AD-001 holds).

### Phase 3 — WhatsApp channel (empty category)
- **T-111 WhatsApp conversational intake.** Reuse the conversational widget engine over the existing webhook: media ingestion to R2, field extraction, confirm step, quote link delivered in-thread. Inbound-initiated → $0 message cost.
- **T-112 WhatsApp guided onboarding.** Embedded Business API signup (or BSP integration) replacing the raw credentials form.

### Phase 4 — Painting vertical pack
- **T-113 Vertical pack infrastructure.** Packs as data: service templates, rate defaults, vision guidance, capture flows, confirm schemas. Applied at onboarding as pre-filled, fully editable config. No business-specific values in code.
- **T-114 Painting pack + landing page.** Contents per §3; painting-specific landing page with live demo widget.
- **T-115 Calibration benchmarks.** Anonymized cross-tenant rate benchmarks for the vertical ("similar decorators charge £10–14/sqm") — opt-in, informational only.

### Success metrics
- Time-to-first-quote from signup: **< 10 min**
- Median customer wait, submission → range shown: **< 60 s**
- Quote accuracy: median |amended − quoted| / quoted **< 10%**
- % quotes needing manual review: **< 20%** and falling with calibration
- Paying tenants and MRR (only possible after T-101/T-102)

---

## 6. Explicitly not doing (v2 discipline)

- AI-set prices in any form (AD-001 is permanent; market-validated)
- Full FSM suite (scheduling/dispatch/CRM) — integrate later, don't build
- Shared-lead marketplace mechanics of any kind
- Multi-language output, multi-seat roles, deep compliance tooling (unchanged from v1 backlog)
- Aerial/satellite measurement (roofing-era problem; revisit at that expansion)
- Hardcoding painting-specific logic in the engine — the pack is configuration only

---

## 7. Oumn: a voice assistant for each business (planned; T-210 is step 0)

Added 27 November 2026 (T-210), revised 28 November (T-211). Outside the v1 scope. Nothing below is built
except the step 0 test.

**What she is.** Oumn is an AI voice assistant that answers for a business. A customer talks to her and she
answers questions from the business's own information, gives an estimate in the business's prices, and offers
times for a visit. She says she is an AI assistant when asked. She is the same promise as the rest of the
product, spoken: the price is always the business's own (AD-001). She asks the pricing engine for every price
and never works one out, and when the business's information does not answer a question she says she will get
it confirmed.

**Web call first.** The first channel is a call through the browser: a button on the business's quote link and
website form, the customer's microphone, her voice back. No phone number, no telephony provider, no app. A
phone line is a later step, and only if web calls show the demand.

**A calendar shared with the estimate page.** Offering a time needs the business's free times. That calendar
does not exist yet. When it is built it is one calendar, used by Oumn and by the estimate page's "book a visit"
alike, so a time offered by voice and a time picked on the page can never clash. Until then she can only take
a request for a visit.

**Step 0: the test call (T-210, done; round two T-211).** A private admin page (`/admin/voice-test`) where the owner talks to
her as a customer of any business. It answers five questions before the full build is committed to:
1. the cost of a minute of call;
2. the delay before she answers;
3. how natural she sounds (Mac Chrome, iPhone Safari, a British listener);
4. whether the prices she says are the pricing engine's, to the cent;
5. whether she keeps to the business's information and says so when she does not know.

The test stores nothing and changes nothing a customer or a business sees. Its free times are made up, and
booking and passing to a person only show what would have happened.

**What round one found (three live calls, 28 November 2026).** The prices she spoke were the engine's. A minute
cost 3.9 to 6.7 cents and rose with the length of the call. She answered in 1.2 to 2.4 seconds, and in up to 5.5
around a tool. Her voice and manner were robotic: she spoke of the business in the third person, repeated stock
sentences, said things the business had never said (an area it covers, a service it does not offer), and could
not send an estimate or end a call.

**The rules round two set (T-211).** These are the rules for the real build too.
- **Before a call:** the caller gives a name and an email or phone number, by the business's own contact rules,
  and passes the site's bot check. Under the button: "Oumn is {business}'s AI assistant. Calls are transcribed
  so {business} can follow up." She is given the details, greets by first name, and never asks for or says back
  a name, an email or a phone number; a detail the caller says is wrong is corrected in the call.
- **She is staff.** "We" and "our", contractions, one or two short sentences. She says she is an AI assistant
  when she opens and whenever asked. She never says the same sentence twice, says money in words in the
  business's currency, says a short line before a tool that takes a moment, answers in English unless the
  caller speaks a whole sentence in another language, and waits when a caller trails off.
- **What she knows.** The business's information is in her instructions from the first word. "Not included"
  is only for what a service lists as not included. Anything she cannot find is "not on my list, I'll get the
  team to confirm", and is recorded for the business. A vague answer is confirmed as a number before pricing.
- **Prices.** A typical price up front ("it depends on …, but we normally charge about … for …"), from the
  same pricing path as an estimate with the smallest valid answers; none for a service priced from photos.
  Several services are priced one at a time and she never adds them: the written estimate shows the total.
  She can send the estimate.
- **Where the business works.** A set area is the answer. With none set she says where the business is based
  (when that is known), that nearby is normally fine and the team will confirm, and asks where the job is.
  Another country is always no. She never promises an area that is not set.
- **General advice** about the kind of work, short and basic, ending "the team will confirm when they see it";
  never step-by-step instructions for work that could injure or damage. The business can switch it off.
- **Protection.** She ends a call herself: after a goodbye, after steering an off-topic caller once, after one
  warning to an abusive one, and when nobody is there. An off-topic or abusive ending is a strike; two in a
  day block the device and the address for two days, and a strike within thirty days of a block ending blocks
  for seven. Three calls a device a day, twenty a business, eight minutes a call. If the store that counts
  them is down, the call goes ahead. A blocked visitor is shown the request form instead.
- **Cost and speed.** Her memory of a call is a sliding window, so a long call does not cost more a minute than
  a short one; what her tools have answered is put back in her memory as it slides.

**A second engine, for comparison only.** The test page can run the same call on OpenAI's GPT-Live when its key
is set. It is not part of the product (AD-102).

**What follows, if the test passes** (each its own ticket, in this order):
- a relay of our own between the browser and the model, if the direct connection is not fast or safe enough
  for customers (the test reports on this);
- the calendar;
- the customer-facing call on the quote link, with a real request made at the end of a call (through the same
  intake as the form, so the business's review rules, plan count and notifications apply);
- passing to a person and urgent alerts, through the business's existing notifications.

**Not doing:** a price she works out herself, in any form; a voice that claims to be a person; recording calls
without the customer being told.
