# What the AI does today (T-167)

The list every marketing claim must map to. A claim on the site names a row here by its **id**
(`apps/web/src/lib/marketing/`), and a unit test fails if it names none, names a row marked "do not claim", or
appears on a trade page the row does not cover.

**How a row earns its place.** Not by the code existing: by the code being reachable and having run. T-166 was
written about a code path that could never run. So each row gives its evidence: what the local database shows the
real pipeline produced. Counts are from the local stack on 2026-11-15 (1,876 quotes; 1,609 carry per-stage
timings, from 2026-09-24). Production's own numbers were not read for this list.

**The rule above all rows (AD-001, AD-049).** The AI reads the job. It never sets, changes or suggests a price.
Every amount comes from the business's own configuration through the pricing engine. The site never says or
implies otherwise.

## 1. What it reads from a job (claimable)

| id | What it does | When it runs | What the customer sees | What the business sees | Code | Evidence |
|---|---|---|---|---|---|---|
| `label-reading` | Reads a label or rating plate in a photo, word for word; the template's own rules turn the text into the value (AD-032: the model transcribes, code decides). | Only for a service whose template names a label to read. Today: **water heaters** (tank capacity, fuel), **HVAC** (AC and heat pump tonnage, furnace input), **electrical** (panel amps). Not painting, plumbing or garage doors. | On the question screen: "we read 50 gal from the tank's rating label. Is that right?", "What we saw: …", "✓ Yes, 50 gal is right" / "No, let me correct it". After they confirm, the estimate's line says "Selected for 50 gal, as you confirmed". | The reading and the words it was read from, on the quote and in the pricing trace. | `apps/worker/src/ai/identification.ts`, `packages/shared` `resolveIdentification`, the packs' `identify` rules | 34 quotes made the label-reading call. Readings confirmed by the customer: panel amps 15, AC tonnage 5, tank capacity 5, furnace input 4. Fuel read straight from the label: 2. |
| `photo-measurement` | Works out a quantity from photos against an object of known size (a door), in several independent passes; code does the arithmetic. | Only for a service step whose quantity comes from photos. In the templates: **exterior painting** (wall area). A business can set it on its own services. | The estimate's "Measurement & takeoff" block: the quantity and "From your photos". When the passes disagree or the price swings on it: a range and one question. | "Measured across 2 independent passes (spread ±5%), anchored to entry door height". | `apps/worker/src/ai/measurement.ts` | 10 quotes with a timed measurement stage; 38 confirm questions about a measured wall or masonry area; only 2 quotes ended priced "From your photos" without a question. **Most photo measurements end in a range and a question.** |
| `second-look` | When measurement passes disagree, or the job is large, a stronger model reviews the photos and the passes, with the customer's own answers in front of it. | Photo-measured quantities only. | Nothing separate. | In the trace. | `measurement.ts` `adjudicateMeasurement`, `scope-answers.ts` | 22 quotes (24 calls). |
| `confirm-question` | A reading that changes the price is shown back to the customer to confirm before it sets the estimate. | Label readings and photo measurements. | The question screen (above). | "Waiting for the customer" on the quote. | `agents/quality-gate.ts`, `identification.ts` `identificationQuestion` | 74 confirm questions. The demo's own sample label: every one of 18 real runs that returned a result gave a range and a question (section 6). |
| `range-and-question` | When something that sets the price is unclear, the customer gets a range and one quick question, not a guess. | Any service. At most one round. | A range (for the sample label: $1,890 to $2,410) and the question. Their answer re-prices the job from the business's prices with no AI call. | The quote waits for the customer's answer. | `agents/quality-gate.ts`, `reprice-snapshot.ts` | 180 quotes asked a question; 170 were answered and re-priced. |
| `extras-from-description` | Notices when the customer's own words ask for an extra the business sells, and adds that extra at the business's price. | A service with add-ons, when the customer wrote a description. | The line, with "Added for you — detected from your description". | The line marked "(auto-recommended)". | `ai/signals.ts` `detectAddonsFromDescription` | Stage ran on 1,121 quotes; 35 quotes got such a line (for example "Trim, fascia, and doors"). |
| `photo-notes` | Reads general things from photos: condition, access, anything that complicates the job. They feed questions and the business's view, never a price. | Any request with photos. | Notes under the estimate. | Signals on the quote. | `ai/signals.ts` `extractSignalsFromImages` | 126 quotes made the photo-reading call (274 calls). |
| `worth-considering` | Lists work the customer may also need, from what it read, with no price. | When it read something no price line uses. | "Worth considering — From your description, you may also need: …", no amounts. | The same. | `ai/signal-recommendations.ts` | 100 quotes carry at least one. |
| `scope-wording` | Writes the estimate's scope summary, assumptions and exclusions in plain words, inside the business's own scope. A fixed word guard then repairs or removes banned words (T-148). | Every priced quote. | The scope and notes on the quote page. | The same, editable. | `ai/wording.ts`, `shared/wording-repair.ts` | 1,493 quotes. |

## 2. What it does for the business during setup (claimable)

| id | What it does | Where | Code | Evidence |
|---|---|---|---|---|
| `price-sentence` | Turns pricing written in plain English ("$375 per room, heavy prep adds $250") into a price list, shown back to the business to check and edit. The business confirms it; nothing is priced from an unchecked sentence. | Setup, and the service editor. | `apps/web/src/app/api/services/ai-draft/compile`, `components/services/PricingComposer.tsx` | Exercised by the hardcore harness (`scripts/hardcore-test/run.mjs`). No per-call log exists. |
| `service-draft` | Drafts a service for a trade without a template: its questions, scope and price structure, from a description. | Setup, "any other trade". | `apps/web/src/app/api/services/ai-draft`, `apps/worker/src/ai/service-draft.ts` | Same harness. No per-call log exists. |
| `service-match` | Checks that what the customer described fits the service they picked, and suggests the right one when it does not. | Request intake, when the customer wrote a description. | `apps/web/src/lib/ai/service-matcher.ts`, `lib/quote-intake.ts` | Code path only; no log. **Do not put it on a page until it has been seen working in a live check.** |

## 3. Product checks that are not AI (say them without the word "AI")

| id | What it does | Code |
|---|---|---|
| `photo-quality-check` | Before upload, the browser warns about a photo that is blurry, too dark, too bright or too small. | `apps/web/src/lib/image-quality.ts` |
| `measurement-memory` | A photo measurement the customer corrected or confirmed is remembered for that service and used to adjust later photo measurements for it. (The business confirming on site does the same, in the on-site app, which is not offered to new businesses yet.) | `apps/web/src/lib/measurement-memory.ts`, `measurement.ts` `computeCalibrationFactor`. 28 remembered measurements locally. Photo-measured services only, so today: exterior painting. |
| `pricing-engine` | Works the price out from the business's prices: steps, extras, adjustments, minimum charge, tax. The same inputs always give the same price. | `apps/worker/src/pricing/rules-engine.ts` |

## 4. Do not claim

| id | Why not |
|---|---|
| `checker` | The AI quote checker reads every priced quote and logs issues. It changes nothing (AD-049), and today its findings hold no quote and are shown on no screen. There is nothing here a business would notice. |
| `cross-service-suggestions` | Code exists to notice another of the business's services in the customer's words and estimate it. It ran on 543 quotes and stored a suggestion on **none**. |
| `learning-from-edits` | Code exists to learn wording habits from the business's edits. Its table (`tenant_learning_context`) is empty: it has never produced anything. The Features page's "Your corrections improve the next estimate" is true only of confirmed measurements (`measurement-memory`). |
| `inventory-from-photos` | Counting catalogue items in photos exists in code. No template uses it and it has never run in a timed quote. |
| `chat-form` | A chat form of the request exists as an embed option shown only in the developer view of `/demo`. The Quote link page does not offer it. Features says "a step-by-step form or a chat"; that should go, or be offered first. |
| `whatsapp-conversation` | Quoting inside a WhatsApp conversation is not live for a new business (0 conversations). "Share your link in WhatsApp" is true and is not an AI claim. |
| any accuracy figure | No "accurate to", no percentage, no "never wrong". A reading can be wrong; that is why the customer confirms it and the business confirms the estimate. |
| "the AI prices", "AI-powered pricing", "smart pricing" | AD-001. |

## 5. Which trade page may say what

| Trade page | `label-reading` | `photo-measurement` | Says instead |
|---|---|---|---|
| Water heaters | yes: capacity and fuel | no | |
| HVAC | yes: tonnage, furnace input | no | |
| Electrical | yes: panel amps | no | Run length and charger supply are the customer's answers. |
| Painting | no | yes: exterior wall area only | Interiors are priced per room from the customer's count. |
| Plumbing | no | no | The customer counts fixtures; photos arrive with the request for the business to see. |
| Garage doors | no | no | Size, style and spring count are the customer's answers. |

Every trade page may use `confirm-question` only with a reading it has, and may use `range-and-question`,
`extras-from-description`, `scope-wording`, `price-sentence`, `photo-quality-check` and `pricing-engine`.

## 6. The hero demo's sample image

`/demo/sample-water-heater-label.png` is a label drawn for this project ("SAMPLE LABEL · DEMO ONLY"). Run through
the example business's Water Heater Replacement on the local stack (2026-11-15, 18 seconds), the product returned:

- capacity **50 gal**: `Read from the tank's rating label (photo 1): "CAPACITY 50 U.S. GAL MODEL NO. EX-50-NG-DEMO" → 50 gal (capacity printed on the label)`
- fuel **Natural gas**: `Read from the tank's rating label (photo 1): "GAS TYPE NATURAL GAS" → Natural gas (gas type on the label)`
- to the customer: a range of **$1,890 to $2,410** and one question, "Capacity of the existing water heater tank:
  we read 50 gal from the tank's rating label. Is that right?" with the choices 30, 40, 50 and 75 gal.

It did not price the job outright, and neither did any of the 17 earlier runs of `verify-t153` that returned a
result (each gave the same range and a question): the reading is confirmed first. So
a demo that shows the photo followed at once by a price leaves out a step the product takes. The demo's reading
beat shows the reading and the customer's "Yes".
