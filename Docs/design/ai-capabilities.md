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

**Where the customer sees it (T-171).** On their quote page, in one block, "Measurement & takeoff": only what was
read or measured and is in the quote, a sentence each, built by `apps/web/src/lib/customer-read.ts`. Never an
amount, never the words read off a label, never how a reading was made, never a word of
`packages/shared/src/customer-language.ts`. A reading the customer corrected is not shown. A quote for which
nothing was read has no such block. The price lines are in "Price breakdown", once, and are not repeated there.

**Where the business sees it (T-169).** The dashboard quote page has a panel, "What Qolumns understood", that
lists what the rows below produced for that quote and nothing else: label readings with the words read, a
quantity measured from photos, notes from photos, an extra picked up from the customer's words, work that may also
be needed, and the question asked and the answer. A quote the AI produced nothing for has no panel. The lines are
built by `apps/web/src/lib/quote-understanding.ts` from the quote's stored signals, takeoff, questions and
answers; none carries an amount. The quote checker's findings show there too, as "Worth checking" (switched on
in T-172, for checks made with the business's money settings; section 4's `checker` row).

**Home's "What it notices" (T-174).** The order is the owner's: what the customer wrote (`extras-from-description`),
what the photos show (`photo-measurement`), then the label ("Model and size, read from a photo",
`label-reading`: the model number is among the words read, and the size is decoded from it or read beside it),
then the question. Under the walls example the page says "It's an estimate. Your customer checks it and you
confirm the price." It rests on `photo-measurement` and `confirm-question`: the customer is shown the wall
reading in every run (on the estimate, "From your photos: about 919 sq ft"), and in most runs is asked to
confirm it before the price settles (38 confirm questions; 2 quotes priced without one). "You confirm the
price" is the default way of sending (show, then confirm); a business can switch a service to send
automatically. No accuracy figure, as always.

**Home's "What it notices" (T-173).** The owner's new order: what the customer wrote, what the photos show
(the walls and the label are its two examples, worded as T-174 left them), an extra they mention, then the
question. The first example shows a customer's message beside what the product made of it, and was asked for as
"the service, the size of the job, key details". **The product does not work the service or the size out from a
message alone**: the customer picks the service and answers the size question, and no quantity was ever taken
from a description on a request without photos (0 of 2,153 such quotes). What it does, and what the example
therefore says, is read the message against those: `service-match` (the service fits what they wrote, or it
suggests another), `words-against-answers` (the words give a different size, so it asks) and
`extras-from-description` (the extra they asked for is added). All three were seen working on one live request on
2026-11-17. The example's three rows are gathered for the home page; they do not sit together on one product
screen (the suggestion is on the form, the question on the question screen, the extra in the price breakdown).

## 1. What it reads from a job (claimable)

| id | What it does | When it runs | What the customer sees | What the business sees | Code | Evidence |
|---|---|---|---|---|---|---|
| `label-reading` | Reads a label or rating plate in a photo, word for word; the template's own rules turn the text into the value (AD-032: the model transcribes, code decides). | Only for a service whose template names a label to read. Today: **water heaters** (tank capacity, fuel), **HVAC** (AC and heat pump tonnage, furnace input), **electrical** (panel amps). Not painting, plumbing or garage doors. | On the question screen, one plain sentence (T-171): "We read 50 gal from your tank's rating label. Is that right?", then "✓ Yes, 50 gal is right" / "No, let me correct it". The words read off the label are not shown to the customer. After they confirm, the estimate's "Measurement & takeoff" block says "From your tank's rating label: 50 gal, Natural gas". | The reading and the words it was read from, on the quote and in the pricing trace. | `apps/worker/src/ai/identification.ts`, `packages/shared` `resolveIdentification`, the packs' `identify` rules | 34 quotes made the label-reading call. Readings confirmed by the customer: panel amps 15, AC tonnage 5, tank capacity 5, furnace input 4. Fuel read straight from the label: 2. |
| `photo-measurement` | Works out a quantity from photos against an object of known size (a door), in several independent passes; code does the arithmetic. | Only for a service step whose quantity comes from photos. In the templates: **exterior painting** (wall area). A business can set it on its own services. | The estimate's "Measurement & takeoff" block, one sentence with no amount (T-171): "From your photos: about 919 sq ft (Exterior walls)". When the passes disagree or the price swings on it: a range and one question. | "Measured across 2 independent passes (spread ±5%), anchored to entry door height". | `apps/worker/src/ai/measurement.ts` | 10 quotes with a timed measurement stage; 38 confirm questions about a measured wall or masonry area; only 2 quotes ended priced "From your photos" without a question. **Most photo measurements end in a range and a question.** |
| `second-look` | When measurement passes disagree, or the job is large, a stronger model reviews the photos and the passes, with the customer's own answers in front of it. | Photo-measured quantities only. | Nothing separate. | In the trace. | `measurement.ts` `adjudicateMeasurement`, `scope-answers.ts` | 22 quotes (24 calls). |
| `confirm-question` | A reading that changes the price is shown back to the customer to confirm before it sets the estimate. | Label readings and photo measurements. | The question screen (above). | "Waiting for the customer" on the quote. | `agents/quality-gate.ts`, `identification.ts` `identificationQuestion` | 74 confirm questions. The demo's own sample label: every one of 18 real runs that returned a result gave a range and a question (section 6). |
| `range-and-question` | When something that sets the price is unclear, the customer gets a range and one quick question, not a guess. | Any service. At most one round. | A range (for the sample label: $1,890 to $2,410) and the question. Their answer re-prices the job from the business's prices with no AI call. | The quote waits for the customer's answer. | `agents/quality-gate.ts`, `reprice-snapshot.ts` | 180 quotes asked a question; 170 were answered and re-priced. |
| `extras-from-description` | Notices when the customer's own words ask for an extra the business sells, and adds that extra at the business's price. | A service with add-ons, when the customer wrote a description. | The line, with "Added for you — detected from your description". | The line marked "(auto-recommended)". | `ai/signals.ts` `detectAddonsFromDescription` | Stage ran on 1,121 quotes; 35 quotes got such a line (for example "Trim, fascia, and doors"). |
| `words-against-answers` | Notices when the customer's own words give a different size from the answer they gave on the form, and asks which is right before the price settles. It checks the words against the answer; it does not work a size out from a message alone. | Any service, when the customer wrote a description and answered a quantity question. | One question, in the product's words for that request, for example: "You mentioned needing three bedrooms painted in your note, but selected 1 room on the form… What should we allow for?" | "Asked the customer" on the quote, with the answer. | `apps/worker/src/ai/wording.ts` (`quantityConcern`), `agents/quality-gate.ts` | 6 stored quotes carry such a question (4 from a description). **Seen working live on the local stack, 2026-11-17 (T-173):** a request for Interior Painting answering 1 room and writing "three bedrooms repainted, and the trim too" came back waiting for the customer with that question, priced at 1 room, with the trim line added. |
| `also-asked` | Notices when the customer's own words ask for another of the business's services, and offers it on the same quote. Nothing is added by the mention: the customer adds it (or the business does, in the editor), and that service is then priced on its own, from its own price list, with no AI call (AD-061, AD-064). One quote, one total, one accept. | Any business with more than one service, when the customer wrote a description. | On their estimate, a card for the other service with its price; "Add to my quote" puts it on the quote as its own part, with its own lines and subtotal, under one total. A service the business holds for approval shows no price for that part until the business approves. | "Customer also asked for" on the quote, the approval page and the review email, with where each stands; the added service as a section of the quote. | `apps/worker/src/ai/service-detection.ts` (detection), `packages/shared/src/quote-sections.ts` (`withSections`), `apps/web/src/app/api/public/quotes/[quoteId]/sections` | Local database, 2026-11-19: 122 quotes carry at least one "also asked for" entry; 64 quotes carry more than one service (34 added by the customer, 30 by the business). `verify-t179` runs the whole path (99 checks at T-179). In production since 18 November 2026 (T-179, T-180); a miss found there that day (an explicit "I also want X" produced no card) was fixed the same day (AD-064). **Claimable since T-187.** |
| `photo-notes` | Reads general things from photos: condition, access, anything that complicates the job. They feed questions and the business's view, never a price. | Any request with photos. | Notes under the estimate. | Signals on the quote. | `ai/signals.ts` `extractSignalsFromImages` | 126 quotes made the photo-reading call (274 calls). |
| `worth-considering` | Lists work the customer may also need, from what it read, with no price. | When it read something no price line uses. | "Worth considering — From your description, you may also need: …", no amounts. | The same. | `ai/signal-recommendations.ts` | 100 quotes carry at least one. |
| `scope-wording` | Writes the estimate's scope summary, assumptions and exclusions in plain words, inside the business's own scope. A fixed word guard then repairs or removes banned words (T-148). | Every priced quote. | The scope and notes on the quote page. | The same, editable. | `ai/wording.ts`, `shared/wording-repair.ts` | 1,493 quotes. |

## 2. What it does for the business during setup (claimable)

| id | What it does | Where | Code | Evidence |
|---|---|---|---|---|
| `price-sentence` | Turns pricing written in plain English ("$375 per room, heavy prep adds $250") into a price list, shown back to the business to check and edit. The business confirms it; nothing is priced from an unchecked sentence. | Setup, and the service editor. | `apps/web/src/app/api/services/ai-draft/compile`, `components/services/PricingComposer.tsx` | Exercised by the hardcore harness (`scripts/hardcore-test/run.mjs`). No per-call log exists. |
| `service-draft` | Drafts a service for a trade without a template: its questions, scope and price structure, from a description, or (the same route, T-105) from the business's website, with a price only where the site states one. | Setup, "Something else": "Read my website" or "I'll describe it". | `apps/web/src/app/api/services/ai-draft`, `apps/worker/src/ai/service-draft.ts` | Same harness. No per-call log exists. |
| `service-match` | Checks that what the customer described fits the service they picked, and suggests the right one when it does not. It does not pick the service from a message: the customer picks, and this checks the pick. | Request intake, when the customer wrote a description (and the business has not switched the check off). | `apps/web/src/lib/ai/service-matcher.ts`, `lib/quote-intake.ts` | Nothing is stored for a suggestion, so there is no count. 4 stored quotes went to the business as a general enquiry because no service fitted. **Seen working live on the local stack, 2026-11-17 (T-173):** a request sent to Wallpaper Installation that said "I need three bedrooms repainted" was answered "Did you mean Interior Painting?" and nothing was created. Claimable since then. |

## 3. Product checks that are not AI (say them without the word "AI")

| id | What it does | Code |
|---|---|---|
| `photo-quality-check` | Before upload, the browser warns about a photo that is blurry, too dark, too bright or too small. | `apps/web/src/lib/image-quality.ts` |
| `measurement-memory` | A photo measurement the customer corrected or confirmed is remembered for that service and used to adjust later photo measurements for it. (The business confirming on site does the same, in the on-site app, which is not offered to new businesses yet.) | `apps/web/src/lib/measurement-memory.ts`, `measurement.ts` `computeCalibrationFactor`. 28 remembered measurements locally. Photo-measured services only, so today: exterior painting. |
| `pricing-engine` | Works the price out from the business's prices: steps, extras, adjustments, minimum charge, tax. The same inputs always give the same price. | `apps/worker/src/pricing/rules-engine.ts` |

## 4. Do not claim

| id | Why not |
|---|---|
| `checker` | The AI quote checker reads every priced quote and logs issues. It changes nothing (AD-049) and its findings hold no quote. Since T-172 it is told the business's currency, base fee, minimum charge and tax, so it no longer reports those as mistakes: four kinds of correct quote (under the minimum, with a base fee, with tax, in pounds) came back with no finding in 12 runs of 12, where 6 runs of 8 had one before. Its findings show to the business on the dashboard quote page as "Worth checking" (`SHOW_WORTH_CHECKING` in `apps/web/src/lib/quote-understanding.ts`, on), only for checks made with those settings. **Still not claimable on a marketing page:** it is an AI's note, it can be wrong about scope and wording, and it is a note to the business, never a guarantee to a customer. |
| `cross-service-suggestions` | The first attempt at this: code that noticed another of the business's services in the customer's words and showed a rough figure outside the total. It ran on 543 quotes and stored a suggestion on **none**. T-179 replaced it with `also-asked` (section 1), which is the row to claim; nothing may say the product estimates a second service by itself. |
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
| HVAC | yes: tonnage, furnace input | no | Mini-splits are priced from the customer’s answers. |
| Electrical | yes: panel amps | no | Run length and charger supply are the customer's answers. |
| Painting | no | yes: exterior wall area only | Interiors are priced per room from the customer's count. |
| Plumbing | no | no | The customer counts fixtures; photos arrive with the request for the business to see. |
| Garage doors | no | no | Size, style and spring count are the customer's answers. |
| Fence installation | no | no | Priced from the customer's answers (length, height, material, gates, slope). No label reading, no photo measurement. No trade page yet (T-195). |
| Junk removal | no | no | Priced from the customer's answers (how much of a truck, where it is, mattresses and appliances). No label reading, no photo measurement. No trade page yet (T-195). |
| Pressure washing | no | no | Priced from the customer's answers (which surfaces and how big). No label reading, no photo measurement. No trade page yet (T-195). |

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
a demo that shows the photo followed at once by a price leaves out a step the product takes. T-167's hero demo
therefore showed the reading and the customer's "Yes".

**T-168:** the hero demo no longer shows a photo or a reading at all. It is three short frames about a job with
no photo (one question, one price line from the example business's price list, one lead to approve), so it makes
no claim about reading anything. The reading and the customer's "Yes" are shown in "What it notices" on Home, on
Features and on the trade pages that have a label, with the sample label above.

## 7. Plan lines on Pricing (T-170)

Not AI claims, but the same rule: the Pricing page may show a line as included only if a business on that plan
can use it today. What a plan includes is in `packages/shared/src/plans.ts` and is the owner's to decide; which
of those things exist yet is in `apps/web/src/lib/marketing/plan-claims.ts`, which the page reads. A line that is
not live is listed after the live ones and marked "Coming later"; none is dropped and none is shown as live that
is not. Checked against the code and the production setup on 2026-11-16.

**T-181 (2026-11-18):** each line is now worded as what the business gets, not as the feature's name (the
feature behind each is unchanged; the old names were "Website widget", "Hosted estimate pages", "Your branding
on every estimate", "Accuracy insights from finished jobs", "Quoting by text (SMS)", "WhatsApp quoting", "On-site
app for your phone", "LiDAR room scanning on site", "Multiple team members", "Priority support"). Text messages
are no longer on the site at all, not even as "Coming later" (the owner's decision); the plans still include the
channel. WhatsApp has run for our own test business since 17 November, and stays "coming later" until Meta has
reviewed the app, because no other business can connect a number before that. Home's plan cards list the live
lines only.

| Line on Pricing | Plans | Today | What was found |
|---|---|---|---|
| Customers see your price straight away, on your website or from a link you share | all | live | The embed code and the hosted quote link work on every plan. |
| Every customer gets their own estimate page to open, accept and come back to | all | live | Every estimate has its own page. |
| Estimates under your brand alone, with no badge of ours | Pro, Business | live | Enforced by plan (`hasCustomBranding`): the "Prepared with Qolumns" badge is left off the estimate. The business's logo and colour are on every plan, Starter included, so the line promises a little more than the plan adds. |
| See how your estimates compare with your final invoices | Pro, Business | live | Analytics has the panel (T-143): it compares estimates with the final invoices a business records on a quote. **It is not held back from Starter or the free allowance**: no code checks `calibration_insights`. True for Pro and Business; not exclusive to them. |
| Quoting by text message | Pro, Business | **not shown on the site (T-181)** | Built (`lib/sms-intake.ts`, `/app/sms`). Production runs it in test mode with no number provider, so no business has a number. |
| Quotes inside WhatsApp, on your own business number | Pro, Business | **coming soon** ("coming later" until T-187) | Built, with a setup page in the dashboard. Production has no WhatsApp keys and no conversation has ever run (section 4, `whatsapp-conversation`). Sharing the quote link in a WhatsApp chat works on every plan and is not this. |
| The mobile app: see, approve and send your quotes from your phone | all (T-199) | **coming soon** | Built (`apps/mobile`). It is in no app store and no business has it. Since T-199 any business can sign in to it, on any plan or none: no plan check stands in front of the app. |
| On-site quotes in the app: price a job while you are there | Pro, Business, and the free start (T-199) | **coming soon** | The same app. Starting a quote in it is the `mobile_app` channel: the app shows "On-site quotes are part of Pro" and starts nothing for a business without it, and `POST /api/app/quotes` refuses in the same words. (Until T-199 this line read "An app for pricing a job while you are on site".) |
| Measure a room by scanning it with your phone | Pro, Business, and the free start | **coming soon** | Built in the on-site app (T-138, T-193, T-194), in a build that has never been shipped. Refused by the server for a business without it (`canUse(…, 'room_scan')`). |
| Your own address: yourname.qolumns.com | Pro, Business, and the free start (T-199) | **coming soon** until switched on | Built in T-199: the business chooses a name, and a small Cloudflare Worker serves its quote page there. Live once that Worker and its DNS record are deployed and `NEXT_PUBLIC_OWN_ADDRESS_HOST` is set; until then the dashboard offers nothing. |
| Logins for your whole team | Business | **coming later** | Not built: there is no way to invite a second person to a business. |
| Faster answers from us when you need help | Business | **coming later** | The site has no support address (`SUPPORT_EMAIL` is empty), so there is no support to give priority in. |

**T-199 (2026-11-22):** what a business can use is decided by one rule (`businessAccess`,
`packages/shared/src/access.ts`). A new business with free quotes left works like Pro, so every "Pro, Business"
line above is also true of the free start. The free offer on the site reads "Try every Pro feature free: 10
quotes, no card" (`freeOfferLabel`).

**Also changed on that page:** the plans' own taglines name things that are not live ("Website, text and WhatsApp
— plus the on-site app", "On-site measurement with LiDAR scanning"), so Pricing shows a line of its own for Pro
and Business (`PRICING_TAGLINES`); the words under the headline no longer say "by text, and on site"; and "Most
popular" (a claim about customers) became "Recommended" (our own advice). The dashboard's billing page still
lists the plan definitions as they are; it was out of this ticket's scope.

**The owner's decision (2026-11-16):** with these marked, Business differed from Pro only by its 600 quotes a
month, so **Business is left off the Pricing page and Home's plan cards until one of its own lines is live**
(`sitePlans()` in `plan-claims.ts`: a plan is shown once it has a live line the plan below it lacks). The plan
itself is unchanged in `plans.ts`. The page therefore shows Starter and Pro, with three "Coming later" lines on
Pro. The table above still lists Business's lines, because they are what brings it back.

**T-187 (2026-11-19):** the mark reads "Coming soon" (it read "Coming later"). Three things are shown on the
site before they are live, each from the one flag of its line in `plan-claims.ts` (`soonMark`): quotes inside
WhatsApp, the on-site app, and the room scan. Home (the setup step, "Add it anywhere", the app section, the plan
cards, two questions), Pricing (the cards and the table's last group) and Features (its last three sections)
all ask that flag, so marking a line live removes the mark everywhere. The words about each are in
`plan-claims.ts` beside the flag (`UPCOMING`); they describe what is built, not what a business can use, and
are never written through `says`. WhatsApp's line now reads "Quotes inside WhatsApp, on your own business
number". The room scan is a Business-plan line, and Business is off the site, so no plan card and no row of
Pricing's table lists it; it is shown on Home's app section and on Features, marked.

**Asked for in T-187 and not claimed:**
- **"A quote page and PDF in your brand":** the page is claimed; the PDF is not. Production makes a PDF only
  when the business asks for one from the dashboard, and as a DocRaptor test document (OWNER-TODO, T-155, still
  open).
- **"It flags what looks wrong":** the Features section rests on `photo-quality-check`, `service-match` and
  `words-against-answers`. The AI quote checker (section 4, `checker`) stays unclaimed.
