# Changelog & Decision Log

> This document tracks issues encountered, architectural decisions, and fixes made to the AI Estimate Platform. It serves as institutional memory to prevent regressions and ensure consistency across development sessions.

---

## Table of Contents

- [Issues & Resolutions](#issues--resolutions)
- [Architectural Decisions](#architectural-decisions)
- [Known Constraints](#known-constraints)
- [Fix Dependencies](#fix-dependencies)

---

## Issues & Resolutions

### 2026-02-12: Removed Hardcoded Complexity Multiplier

**Context:** The pricing engine was automatically applying a "Simple job discount" (10% off) when AI detected complexity as "low", and a 25% premium for "high" complexity. This violated the anti-hardcoding principle: "AI can extract signals and draft wording, but AI must not set the final price."

**Issue:** Hardcoded values in `getComplexityMultiplier()` function were automatically adjusting prices based on AI-detected complexity:
- `low` → 0.9 (10% discount, shown as "Simple job discount")
- `medium` → 1.0 (no change)
- `high` → 1.25 (25% premium)

**Solution:** Removed the automatic complexity multiplier entirely from three locations in `apps/worker/src/pricing/rules-engine.ts`:
1. `calculatePricing()` function (lines 304-313)
2. `getComplexityMultiplier()` helper function (lines 904-915)
3. `calculatePricingWithTrace()` function (lines 1676-1693)

Replaced with explanatory comments following the same pattern used for the previously removed access difficulty multiplier.

**Impact:**
- Quotes will no longer show automatic "Simple job discount" or complexity premiums
- Businesses can still configure complexity-based pricing manually as multiplier rules with trigger conditions
- This aligns with the principle that pricing should be deterministic based on business configuration, not AI decisions

**Related:** Follows same pattern as access difficulty multiplier removal (see line 315-316 comments in the file)

---

### 2026-02-11: Vercel Deployment Configuration

**Context:** Needed to deploy the monorepo to Vercel for external testers. The standard deployment methods weren't working due to monorepo structure with pnpm workspaces.

**Issue:** Initial CLI deployments completed in ~130ms without running the actual Next.js build. The dashboard Root Directory setting conflicted with CLI deployments.

**Solution:** Used Vercel's builds API v2 in a root-level `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "apps/web/package.json",
      "use": "@vercel/next",
      "config": {
        "installCommand": "cd ../.. && pnpm install"
      }
    }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "apps/web/$1" }
  ]
}
```

**Key learnings:**
- The `builds` array with `@vercel/next` explicitly tells Vercel to build the Next.js app at `apps/web`
- The `installCommand` in config navigates to root to install all workspace dependencies
- Using `framework: null` doesn't work as expected for monorepos
- The original `aistimator` project has a `rootDirectory: apps/web` setting that causes CLI deploy conflicts
- Created a new `estimator-web` project that works correctly from root

**Deployment URLs:**
- Web App: https://estimator-web-phi.vercel.app
- Worker: https://estimator-worker-production.billgajen.workers.dev

---

### 2026-02-11: Editorial Black Design System

**Context:** User requested a bold, minimalist black & white design to replace the previous warm/thin design.

**Design Tokens:**
- Font: Sora (display + body), JetBrains Mono (code) via `next/font/google`
- Colors: white bg (#FFFFFF), zinc-50 surface (#F4F4F5), near-black primary (#09090B), green secondary (#16A34A)
- Typography: extrabold headings, semibold nav (text-[15px]), font-semibold buttons
- Shadows: border-based (`0 0 0 1px`) flat editorial look

**Component Library:** Created reusable components in `apps/web/src/components/ui/`:
- Button, Input, Textarea, Select, Card, Badge, PageHeader
- `cn()` utility at `apps/web/src/lib/cn.ts` (dependency-free)

**Note:** Embed widget (`apps/web/src/app/embed/`) has minimal styling changes as it renders on customer sites.

---

### 2026-02-06: Dashboard Setup Checks & Stats Bug Fixes

**Context:** Three bugs in the dashboard prevented setup completion checks and quote stats from working correctly due to incorrect column names and wrong table references.

**Bugs Fixed:**

| Bug | Root Cause | Fix |
|-----|------------|-----|
| "Add a service" not completing | Using `is_active` column that doesn't exist | Changed to `active` (correct column name in `services` table) |
| "Embed on website" never completing | Using `is_verified` column that doesn't exist | Changed to `is_active` (correct column name in `tenant_sites` table) |
| Quote stats showing all zeros | Querying `quote_requests` table | Changed to `quotes` table (which has `status` and `pricing_json` columns) |

**Schema Reference:**
- `services` table: has `active BOOLEAN` (not `is_active`)
- `tenant_sites` table: has `is_active BOOLEAN` (no `is_verified` column exists)
- `quotes` table: has `status` and `pricing_json` columns
- `quote_requests` table: does NOT have `status` or `pricing_json` columns

**File Modified:** `apps/web/src/app/(dashboard)/app/page.tsx` (lines 44, 84, 97)

**Verification:** `pnpm typecheck && pnpm lint` — pass.

---

### 2026-02-06: Dashboard & Menu Reorganization

**Context:** Streamlined the dashboard by removing redundant menu items, fixing broken stat cards, moving the setup checklist inline, and improving the welcome message.

**Changes:**

| Change | Description |
|--------|-------------|
| Menu Reorganization | Reduced from 9 to 7 menu items. Removed "Setup Checklist" (moved inline) and "Pricing Rules" (deprecated redirect). Renamed "Getting Started" to "Overview" and "Configuration" to "Configure". |
| Welcome Message | Changed from "Welcome back, [name]" to business name as heading (e.g., "Acme Plumbing"). |
| Dashboard Stats | Stats now fetch real data from `quote_requests` table. Queries count quotes by status for Sent/Viewed/Accepted, and sum `pricing_json.total` for Revenue. |
| Inline Setup Progress | Setup checklist is now a compact card at top of dashboard. Shows 4 steps with progress bar. Auto-hides when all steps complete. |
| Quick Actions | Reduced from 4 to 3 actions. Removed "Setup Checklist" link. |
| Deleted Pages | Removed `/app/onboarding` (moved inline) and `/app/pricing` (deprecated redirect). |

**Setup Completion Checks:**
1. Add a service → `services` table has active service for tenant
2. Configure widget → `widget_configs` has config with form fields
3. Customize branding → `branding_json.logoAssetId` is set OR `primaryColor` differs from default `#2563eb`
4. Embed on website → `tenant_sites` has at least 1 verified site

**Files Modified:**
- `apps/web/src/app/(dashboard)/layout.tsx` - Removed 2 menu items, renamed sections, removed unused icon functions
- `apps/web/src/app/(dashboard)/app/page.tsx` - New welcome, real stats, inline setup progress, updated quick actions

**Files Deleted:**
- `apps/web/src/app/(dashboard)/app/onboarding/page.tsx`
- `apps/web/src/app/(dashboard)/app/pricing/page.tsx`

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` — all pass.

---

### 2026-02-05: UI Redesign — "Editorial Black" Bold Minimalist Design

**Context:** Complete visual redesign of the platform. Initially implemented "Warm & Approachable" (terracotta/cream), but user rejected it as looking bad. First B&W iteration with Manrope font was also rejected (text too thin/small, dull). Final "Editorial Black" iteration uses bold, modern, minimalist B&W aesthetic with Sora font.

**Design System:**
- **Font:** Sora (geometric sans-serif — display + body), JetBrains Mono (code) via `next/font/google`
- **Colors:** Pure white background (#FFFFFF), zinc-50 surface (#F4F4F5), near-black primary (#09090B), green secondary (#16A34A) for positive indicators only, zinc grays for text hierarchy
- **Shadows:** Border-based (`0 0 0 1px`) for editorial flat look, blur only on hover
- **Corners:** Tighter radius (`rounded-lg`, `rounded-xl`) — no oversized rounding
- **Typography:** Extrabold headings (text-3xl+), semibold nav items (text-[15px]), generous sizing throughout
- **Animation:** `fade-in-up` 0.25s with staggered delays

**Changes (5 phases, 30+ files):**

| Phase | Files | Description |
|-------|-------|-------------|
| Foundation | `tailwind.config.ts`, `globals.css`, `layout.tsx`, `cn.ts` | CSS variables, theme tokens, font loading, utility |
| Components | 7 new files in `components/ui/` + `EmptyState.tsx` update | Button, Input, Textarea, Select, Card, Badge, PageHeader |
| Layouts | Dashboard, auth, admin, landing layouts | Warm cream bg, warm sidebar, Fraunces headings |
| Pages | All 22 routes updated | Systematic class replacement (gray→semantic, blue→primary, etc.) |
| Polish | Verification pass | typecheck, lint, build all pass |

**Files Created:**
- `apps/web/src/lib/cn.ts`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Input.tsx`
- `apps/web/src/components/ui/Textarea.tsx`
- `apps/web/src/components/ui/Select.tsx`
- `apps/web/src/components/ui/Card.tsx`
- `apps/web/src/components/ui/Badge.tsx`
- `apps/web/src/components/ui/PageHeader.tsx`

**Architectural Decisions:**
- CSS variables for all design tokens — enables future runtime theming
- Embed widget gets minimal treatment (subtle input/button changes only) since it renders on customer sites
- `cn()` utility is dependency-free (no clsx/tailwind-merge) — just filters falsy values and joins
- Component library uses forwardRef for Input/Textarea/Select for form library compatibility
- Kept some raw Tailwind colors where they serve functional purposes (spinners, progress bars, error overlays) rather than semantic ones

**Known Issue Fixed During Implementation:**
- `replace_all` for `bg-green-50` also matched inside `bg-green-500`, producing corrupted `bg-secondary-light0`. Caught by verification grep and corrected. Same pattern checked across all files.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` — all pass. No new errors introduced.

---

### 2026-02-04: Quote Label & Signal Quality Fixes (3 fixes)

**Context:** Three quality improvements: breakdown labels showing unit math, cleaner multiplier labels, and reducing water damage false positives from AI.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| FIX-LABELS | `apps/worker/src/pricing/rules-engine.ts` | **Breakdown labels now show unit math.** For per_unit and per_hour work steps with quantity > 1, label changes from `"Pest Treatment"` to `"Pest Treatment  £50 x 2(Rooms)"`. Added `quantity` and `unitLabel` to `WorkStepCostResult` return type. Fixed cost steps and quantity=1 steps keep plain name. |
| FIX-MULT | `apps/worker/src/pricing/rules-engine.ts` | **Cleaner multiplier fallback labels.** `generateMultiplierLabel()` now strips UI suffixes (`_input`, `_select`, `_field`, `_type`, `_dropdown`, `_choice`) from fieldId and uses `"Field: Value"` format instead of `"Value field_id"`. E.g., `"Pest Type: Mice"` instead of `"Mice pest type input"`. Only affects multipliers without explicit `label` property. |
| FIX-WATER | `apps/worker/src/ai/signals.ts` | **Reduced water_damage false positives.** Added CONDITION DETECTION GUIDELINES to signal extraction prompt: pipes alone are not water damage, pest-caused staining is pest_damage not water_damage, be conservative when unsure. |

**Architectural Decisions:**
- FIX-LABELS: Label format only changes when quantity > 1. Single-quantity and fixed-cost steps keep plain name for clean display.
- FIX-MULT: Explicit `label` on multiplier config always takes priority over `generateMultiplierLabel()`. The fallback function is only used when businesses don't configure a label.
- FIX-WATER: Prompt-based fix, no structural code change. Conservative approach — tells AI to attribute ambiguous damage to the more likely source.

**Test Updates:**
- Updated label assertions in `rules-engine.test.ts`, `quote-processing.test.ts`, and `fence-scenarios.test.ts` to match new breakdown label format.
- Used `startsWith()` matching in fence tests for per_unit work step labels.

**Verification:** `pnpm typecheck`, `pnpm test`, `pnpm build` — all pass (118/118 tests).

---

### 2026-02-04: Platform Reliability Fixes (4 issues)

**Context:** Full platform review uncovered critical reliability gaps: missing images despite upload, silent quote loss on queue failure, duplicate Gemini API calls doubling cost, and a comma-parsing bug corrupting numeric values.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| FIX-IMG | `apps/worker/src/quote-processor.ts` | **"No images provided" when images WERE uploaded.** Root cause: asset linking (`UPDATE assets SET quote_request_id`) could silently fail, so `loadQuoteData` found 0 assets. Fix: added fallback — if no assets found via `quote_request_id`, load by `asset_ids` stored on `quote_requests` record. Also repairs the broken link for future retries. |
| FIX-IMG-2 | `apps/web/src/app/api/public/quotes/route.ts` | Asset linking error was unchecked (`await supabase.update(...)` with no error check). Now logs the error. `asset_ids` on `quote_requests` serves as a safety net. |
| FIX-QUEUE | `apps/web/src/lib/queue.ts`, `apps/web/src/app/api/public/quotes/route.ts` | **Silent quote loss.** `enqueueQuoteJob()` caught errors but never re-threw — API returned success while quote was stuck at `queued` forever. Fix: re-throw queue errors. Quotes route now catches queue failures, marks quote as `failed`, and returns a warning to the customer. |
| FIX-GEMINI | `apps/worker/src/ai/signals.ts`, `apps/worker/src/quote-processor.ts` | **Double Gemini API call.** When `expected_signals` configured, both `extractStructuredSignals()` AND `extractSignals()` were called — same images sent to Gemini twice. Fix: `extractStructuredSignals()` now returns both legacy and structured formats from a single call. Halves API cost for structured-signal services. |
| FIX-COMMA | `apps/worker/src/quote-processor.ts` | **"1,500" parsed as 501.** `convertFormValueToSignal()` split on commas and summed parts. Fix: detect thousands-separator pattern (`/^\d{1,3}(,\d{3})+(\.\d+)?$/`) first — "1,500" → 1500. Only sum when genuinely comma-separated measurements ("130,120,95" → 345). |

**Fix Dependencies:**
- FIX-IMG depends on `asset_ids` being stored on `quote_requests` (existing behavior at line 376 of quotes route)
- FIX-GEMINI changes the return type of `extractStructuredSignals()` — any other callers must destructure `{ legacy, structured }`

---

### 2026-02-04: Quote Quality Fixes v6

**Context:** Five quality fixes addressing signal type resolution, hardcoded keywords, aggressive conflict detection, note duplication, and stale widget configs.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| ISSUE-1 | `apps/worker/src/quote-processor.ts` | **Signal type resolution bug.** Address "27 Maple Close, Maidstone, Kent, ME15 7QJ" was parsed as number `27` because `parseFloat()` inference overrode the config-declared `type: 'string'`. Replaced 17-line inline type resolution with `resolveSignalType()` function using metadata-first priority cascade: (1) `expected_signals` config, (2) widget field type, (3) `draft_config.suggestedFields` type, (4) strict regex inference (only if ENTIRE string matches `/^-?\d+(\.\d+)?$/`), (5) default string. Added unit tests. |
| FIX-2 | `apps/worker/src/quote-processor.ts` | Deleted hardcoded `getAddonKeyword()` (car-service-only keywords). Rewrote `isAddonCoveredByService()` to use generic word-overlap via `extractSignificantWords()`. Added shared `ADDON_STOP_WORDS` and `extractSignificantWords()` utilities. |
| FIX-3 | `apps/worker/src/quote-processor.ts` | Replaced aggressive single-word conflict matching in `isAddonConflictingWithExcludes()` with minimum-overlap approach: requires 2+ significant word overlap OR Jaccard >0.4. Fixes false positives (e.g., "Wi-Fi smart controller" blocked by "Smart home integration setup"). |
| FIX-4 | `apps/worker/src/quote-processor.ts` | Added `deduplicateNotes()`: exact dedup via Set, semantic dedup (>50% word overlap keeps longer note), max 3 notes with priority ranking. Called before saving `pricing_json.notes`. |
| FIX-5a | `apps/web/src/app/api/services/route.ts` | POST handler: added `mapsToSignal` to widget field mapping (was stripped during `.map()` transformation). |
| FIX-5b | `apps/web/src/app/api/services/[id]/route.ts` | PATCH handler: syncs `widget_configs` when `draftConfig.suggestedFields` is provided. Checks for existing config (update preserving files settings) or inserts new. |

**Architectural Decisions:**
- ISSUE-1: `resolveSignalType()` consults 3 metadata sources (expected_signals, widget field type, draft_config.suggestedFields) before any value inference. If ANY metadata source declares a type, inference is skipped entirely. The old `parseFloat()` inference was the root cause — it can't distinguish "27 Maple Close" from "27". The new strict regex `/^-?\d+(\.\d+)?$/` only matches when the ENTIRE cleaned string is numeric.
- FIX-2: `extractSignificantWords()` shared across FIX-2/FIX-3/FIX-4 — extracts words >3 chars excluding stop words. Generic approach works for any service type.
- FIX-3: Jaccard similarity threshold of 0.4 chosen to block "Full exterior paint" vs "Exterior paint not included" (high overlap) while allowing "Wi-Fi smart controller" vs "Smart home integration setup" (low overlap).
- FIX-5: v5 FIX-1 runtime fallback (draft_config → expected_signals) kept as safety net for services created before this root-cause fix.

**Known Constraints:**
- ISSUE-1: `inferSignalTypeFromValue()` returns `null` (not `'string'`) when uncertain, forcing the cascade to fall through to the default. This is intentional — returning `'string'` from inference would prevent the default from ever being reached.
- FIX-3: Direct substring match (Check 1) still catches cases like "Powerflush Treatment" vs "Powerflush" exclusion, even when word-level overlap is only 1 word. This is intentional — substring containment is a strong signal.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test`.

---

### 2026-02-04: Quote Quality Fixes v5

**Context:** Five quality fixes and one cleanup task to improve signal accuracy, quote completeness, and data hygiene.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| FIX-1 | `apps/worker/src/quote-processor.ts` | `mapsToSignal` fallback: widget fields → `draft_config.suggestedFields` → `expected_signals` matching. Added `draft_config` to service query. |
| FIX-2 | `apps/worker/src/ai/signals.ts`, `packages/shared/src/database.types.ts` | Room-based services: added `'room'` to dimensions type union and mapped it to `item_count` signal instead of `linear_distance`. |
| FIX-3 | `apps/worker/src/quote-processor.ts`, `packages/shared/src/database.types.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx` | Available addons upsell: untriggered addons surfaced as "Optional Extras" section on quote page (green styling). Added `availableAddons` to `QuotePricing` type. |
| FIX-4 | `apps/worker/src/ai/wording.ts` | Notes deduplication: AI prompt now instructs not to repeat pricing notes verbatim in content notes. |
| FIX-5 | `scripts/fix-5-update-line-set-label.sql` | Data update script to fix form label from "Estimated line set length per unit" to "Number of line sets (indoor units)". |
| CLEANUP | `supabase/migrations/001_initial_schema.sql.bak` | Deleted legacy backup migration file. |

**Architectural Decisions:**
- FIX-1: Signal mapping uses a 3-tier fallback (widget config → draft_config → expected_signals) to handle cases where `mapsToSignal` is present in `draft_config.suggestedFields` but stripped when saved to `config_json.fields`.
- FIX-3: Available addons are stored in `pricing_json.availableAddons` alongside the pricing data. They exclude addons that conflict with `scope_excludes` or are covered by the core service.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (93/93 tests pass).

---

### 2026-02-03: AD-014 Location Context Conflict Detection

**Context:** Cross-service recommendations incorrectly suggested "Roof Leak Repair" for a customer describing a bathroom leak. The existing AD-008 (phrase verification) and AD-010 (keyword matching) validations passed because the phrase mentioned "leak" and the service name contained "Leak".

**Problem Analysis:**
- Customer: "minor leak around the shower or bath seal... ceiling below... bathroom above"
- Incorrect Recommendation: "Roof Leak Repair & Inspection"
- Why AD-010 failed: "leak" appears in both phrase and service name ✓
- Missing check: Context (bathroom) vs Context (roof) mismatch

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added `LOCATION_CONTEXTS` map with 12 context categories:
  - Indoor: bathroom, kitchen, bedroom, living
  - Structural: roof, basement, garage
  - Outdoor: garden, exterior
  - Systems: plumbing, electrical, heating
  - Other: vehicle, commercial
- Added `detectLocationContextConflict()` function that:
  - Extracts location contexts from customer phrase
  - Extracts location contexts from service name
  - Rejects recommendation if contexts don't overlap (e.g., bathroom vs roof)

**Example (Now Fixed):**
```
Phrase: "leak around the shower or bath seal"
  → Contexts: bathroom (shower, bath), plumbing (seal)
Service: "Roof Leak Repair"
  → Contexts: roof
Overlap check: bathroom/plumbing vs roof → NO OVERLAP → REJECTED
```

**Non-hardcoding Compliance:**
- `LOCATION_CONTEXTS` is a generic mapping, not tied to specific service names
- Groups semantically equivalent words that apply universally
- Can be extended without code changes (future: config-driven)

**Verification:**
- TypeScript type checking passes
- ESLint passes
- Bathroom leak customer will NOT get "Roof Leak Repair" recommendation

**Related to:** AD-008, AD-010, Cross-Service Quality

---

### 2026-02-03: Comprehensive Quote Validation Architecture

**Context:** Implemented a comprehensive quote validation system to catch ALL quote quality issues before quotes reach customers. The system validates pricing completeness, scope text, potential additional work, cross-service recommendations, addons, notes, and logical consistency.

**Files Created/Modified:**
| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/00000000000012_quote_validation_logs.sql` | Created | Database table for validation logs + tenant settings |
| `packages/shared/src/database.types.ts` | Modified | Added 20+ validation-related types |
| `apps/worker/src/ai/quote-validator.ts` | Created | Core validator with 8 check categories |
| `apps/worker/src/ai/index.ts` | Modified | Export validator functions |
| `apps/worker/src/quote-processor.ts` | Modified | Integrated validator into pipeline |

**Validation Check Categories:**
1. **Pricing Completeness** - Form fields used, work steps triggered, expected total
2. **Scope Validation** - Promises match paid work, matches customer intent
3. **Potential Work** - No contradictions with form, no AI prices (AD-001)
4. **Cross-Service** - Service/request match, context match, negation respected
5. **Addons** - Negation respected, no conflicts with excludes
6. **Notes** - Relevance, error codes included
7. **Discounts** - No unauthorized changes
8. **Logic** - Form/description consistency

**Key Features:**
- **Auto-correction**: Automatically fixes auto-fixable issues (remove bad scope text, remove invalid recommendations)
- **Validation Logging**: All validation results logged to `quote_validation_logs` table for learning
- **Config Suggestions**: Issues flag suggested configuration fixes for business improvement
- **Tenant Settings**: Each tenant can configure validation behavior via `validation_settings` JSON column
- **Severity Levels**: Issues categorized as critical/high/medium/low with configurable actions per level

**Default Validation Settings:**
```json
{
  "enabled": true,
  "onCriticalIssue": "auto_correct",
  "onHighIssue": "auto_correct",
  "onMediumIssue": "auto_correct",
  "onLowIssue": "pass_with_warning",
  "pricingGapThresholdPercent": 20,
  "requireManualReviewAbove": 5000
}
```

**Architectural Decision:** Single comprehensive validator with structured checks (rather than multiple agents) for efficiency, shared context, and easier debugging.

**Verification:**
- All 93 worker tests pass
- TypeScript type checking passes
- ESLint passes

**Related to:** AD-001, AD-007, AD-009, AD-013, FIX-BATHROOM-1 through FIX-BATHROOM-5

---

### 2026-02-03: Bathroom Quote Quality Fixes (FIX-BATHROOM-1 to FIX-BATHROOM-4)

**Context:** A bathroom refresh quote test revealed multiple systemic issues where the quote didn't match customer expectations. Four code fixes were implemented; two issues (bathroom_size not used, missing refresh work steps) are service configuration issues requiring business dashboard changes.

---

#### FIX-BATHROOM-1: Form vs Description Conflict Detection (HIGH)

**Symptom:** Customer charged £184 rush surcharge despite description saying "ideally in the next 3 to 4 weeks". Form said "Urgent (<7 Days)" but AI correctly inferred "Flexible (2-4 weeks)" with 0.9 confidence.

**Root Cause:** `quote-processor.ts` always trusts form values (AD-007 principle), but had no mechanism to detect and flag conflicts between form input and AI inference from description.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Added `detectFormDescriptionConflicts()` function that:
  - Compares AI-inferred signals (confidence ≥ 0.8) against form values
  - Detects timeline conflicts (form=urgent, description=flexible and vice versa)
  - Detects condition conflicts (form=good, description=poor and vice versa)
  - Adds warning notes to pricing without changing pricing (form still wins per AD-007)

**Example Warning Added:**
```
Note: Form selected "Urgent (<7 Days)" for Timeline, but description mentions "Flexible (2-4 weeks)". Quote uses form selection. Please confirm timeline with customer.
```

**Lesson:** Surface conflicts between form and description so businesses can follow up with customers before confirming work.

---

#### FIX-BATHROOM-4: Potential Additional Work Contradicts Form (MEDIUM)

**Symptom:** "Potential Additional Work" section suggested "Full height tiling" when form said "Splash zones only", and "Average condition prep" when form said "Good condition".

**Root Cause:** `findUnusedSignals()` in `signal-recommendations.ts` filtered by signal source but didn't do semantic matching to detect when AI signals contradict form answers.

**Resolution:**
- File: `apps/worker/src/ai/signal-recommendations.ts`
- Added `signalContradictsFormAnswer()` function with semantic mappings for:
  - `tiling_coverage`: Detects form="splash zones" vs AI="full height"
  - `condition`: Detects form="good" vs AI="poor/average"
  - `waste`: Detects form="no" vs AI suggesting waste removal
- Added filter to `findUnusedSignals()` to skip contradicting signals

**Example Filtered:**
- Form says "Splash zones only" → AI signal "tiling_coverage=full_height" is EXCLUDED from recommendations

**Lesson:** Recommendations must not contradict what the customer explicitly selected on the form.

---

#### FIX-BATHROOM-5: Scope Text Promises Unpaid Work (MEDIUM)

**Symptom:** Scope text mentioned "re-sealing around the shower area, addressing minor issues like loose grout" but these weren't line items in pricing.

**Root Cause:** AI wording generator created scope text from service description and customer keywords without validating that promised items have corresponding price lines.

**Resolution:**
- File: `apps/worker/src/ai/wording.ts`
- Added `validateScopeAgainstPricing()` function that:
  - Checks scope text for work keywords (reseal, grout, clean, repair, tile, etc.)
  - Verifies each keyword has matching line item in pricing breakdown or scopeIncludes
  - Logs warnings for scope/pricing mismatches (for business/developer visibility)

**Example Warning Logged:**
```
[Wording] Scope validation warning: Scope mentions "reseal" but no matching line item in pricing. Consider adding to exclusions or pricing.
```

**Lesson:** Scope text should describe paid work. Unpaid promises create customer expectation mismatches.

---

#### FIX-BATHROOM-2: Unused Form Field Warning (MEDIUM)

**Symptom:** Customer provided `bathroom_size: 200` sqft but it wasn't reflected in pricing. The service had no per-sqft work steps configured.

**Root Cause:** Service configuration issue - work steps used `bathroom_count` (count-based) but no steps were configured for `bathroom_size` (area-based).

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Added unused form field detection at end of `calculatePricingWithTrace()`:
  - Tracks which form fields are used by work steps and multipliers
  - Identifies numeric form fields that were provided but unused
  - Logs warning for developer/business visibility

**Example Warning Logged:**
```
[Pricing] Numeric form fields provided but unused in pricing: bathroom_size=200
```

**Note:** This is a diagnostic warning. The fix requires the business to add work steps that use `bathroom_size` as a quantity source (service configuration task).

---

### Out of Scope (Business Configuration Tasks)

These issues require dashboard/database changes, not code:

1. **Issue 2: bathroom_size not used** - Business needs to add work steps with `quantitySource: { type: 'form_field', fieldId: 'bathroom_size' }`

2. **Issue 3: Missing refresh work steps** - Business needs to add refresh-specific work steps:
   - `bathroom_deep_clean` (£75/bathroom)
   - `silicone_reseal` (£85 fixed)
   - `grout_refresh` (£3/sqft)
   - `minor_repairs` (£50 fixed)

---

**Files Modified:**
| File | Changes |
|------|---------|
| `apps/worker/src/quote-processor.ts` | Added `detectFormDescriptionConflicts()`, integrated into pipeline |
| `apps/worker/src/ai/signal-recommendations.ts` | Added `signalContradictsFormAnswer()`, integrated into `findUnusedSignals()` |
| `apps/worker/src/ai/wording.ts` | Added `validateScopeAgainstPricing()`, integrated into `validateContent()` |
| `apps/worker/src/pricing/rules-engine.ts` | Added unused form field detection in `calculatePricingWithTrace()` |

**Verification:**
- All 93 worker tests pass
- TypeScript type checking passes
- ESLint passes

**Related to:** AD-007 (Form signals override AI), AD-009 (Potential work limits), AD-013 (AI scope constraints)

---

### 2026-02-02: Keyword Negation in Addon Detection (FIX-NEGATION-1)

**Issue:** The pricing engine was recommending addons based on keyword matches even when customers explicitly said they didn't want extras. For example, "wobbly post" would trigger a `concrete_spur` addon recommendation even if the customer said "please no extras" in the same description.

**Root Cause:** The `findMatchingKeyword()` function in `rules-engine.ts` used simple word-boundary regex matching without any context awareness. It would match keywords regardless of surrounding negation phrases.

**Resolution:** Implemented two-layer negation detection:

1. **Global Addon Suppressors** - Phrases like "no extras", "budget only", "keep it simple" that suppress ALL keyword-triggered addons:
   ```typescript
   const GLOBAL_ADDON_SUPPRESSORS = [
     /\b(no extras?)\b/i,
     /\b(budget (only|focused|conscious))\b/i,
     /\b(keep it (simple|basic|minimal))\b/i,
     // ... etc.
   ]
   ```

2. **Contextual Keyword Negation** - Checks if a specific keyword appears after negation words within 3 words:
   ```typescript
   // Pattern: negation word + 0-2 words + keyword
   // e.g., "don't want fridge", "no extra polish"
   ```

**Files Modified:**
- `apps/worker/src/pricing/rules-engine.ts` - Added negation detection functions and integrated into addon matching
- `apps/worker/src/pricing/rules-engine.test.ts` - Added TEST-13 with 6 test cases for negation detection

**Test Coverage (TEST-13):**
- "no extras" suppresses all addons
- Negated keyword ("don't clean fridge") is skipped
- Non-negated keyword still matches correctly
- "budget only" acts as global suppressor
- "keep it simple" acts as global suppressor
- Negation with intervening words ("don't want the fridge")

**Verification:**
- All 28 rules-engine tests pass
- All 43 fence-scenario tests pass
- PRICE-SENSITIVE scenario now correctly has no addon recommendations

**Related to:** Fence Service E2E Stress Test diagnostic report (HIGH priority issue)

---

### 2026-02-01: E2E Quote Processing Integration Tests

**Context:** Implemented comprehensive E2E integration tests for the quote processing pipeline. These tests verify the complete flow from quote request submission through pricing calculation, with mocked AI signals to ensure deterministic test results.

#### TEST SUITE: E2E Quote Processing Tests

**Files:**
- `apps/worker/src/__tests__/quote-processing.test.ts` - Main integration test file (22 tests)
- `apps/worker/src/__tests__/fixtures/test-services.ts` - Test service configurations
- `apps/worker/src/__tests__/mocks/ai-signals.ts` - Mock AI signal responses

**Coverage (22 tests across 6 scenarios):**
- TEST-E2E-1: Basic Quote Processing - Verifies pricing breakdown, tax, trace summary
- TEST-E2E-2: Addon Keyword Detection - Verifies auto-recommended addons from description keywords
- TEST-E2E-3: Cross-Service Detection - Verifies pricing unaffected by cross-service mentions
- TEST-E2E-4: Signal Recommendations - Verifies processing continues with unused AI signals
- TEST-E2E-5: Low Confidence Fallback - Verifies price range shown for low confidence scenarios
- TEST-E2E-6: Form Override - Verifies form values override AI signals (AD-007 compliance)

**Key Outputs Verified:**
- `pricing_json`: subtotal, taxAmount, total, breakdown (with autoRecommended flags), recommendedAddons, notes
- `pricing_trace_json`: trace steps, summary (baseFee, workStepsTotal, addonsTotal, multiplierAdjustment, taxAmount, total)
- `signals_json`: confidence, signals array

**Test Architecture:**
- Mock AI signal extraction for deterministic results
- Test the full pricing pipeline directly
- Verify all output fields match expected calculations

**Run Tests:**
```bash
pnpm --filter @estimator/worker test
```

---

### 2026-02-01: Pricing Accuracy Test Suite & Bug Fix

**Context:** Implemented comprehensive pricing accuracy test suite with 22 tests covering all pricing components (work steps, addons, multipliers, tax, minimum charge). Tests verify mathematical correctness of the deterministic pricing engine.

---

#### ISSUE-9: String Boolean Values Not Compared to Boolean Config (MEDIUM)

**Symptom:** Multiplier with `equals: true` for `heavy_soiling` not applied when form submitted `"true"` (string).

**Root Cause:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- The code handled boolean answer values compared to string config values (e.g., `true` vs `"Yes"`)
- But it didn't handle the reverse: string answer values compared to boolean config values (e.g., `"true"` vs `true`)

**Resolution:**
- Added new case in `shouldApplyMultiplier()` for string answer → boolean compareValue:
```typescript
// Handle string answer value that represents a boolean → boolean compareValue
if (typeof answer.value === 'string' && typeof compareValue === 'boolean') {
  const answerAsBool =
    answer.value === 'true' ||
    answer.value === 'True' ||
    answer.value === 'TRUE' ||
    answer.value === 'Yes' ||
    answer.value === 'yes' ||
    answer.value === 'YES' ||
    answer.value === '1'
  return answerAsBool === compareValue
}
```

**Lesson:** Form data can arrive as either booleans or strings depending on the form framework. Handle both directions of comparison.

---

#### TEST SUITE: Pricing Accuracy Tests

**File:** `apps/worker/src/pricing/rules-engine.test.ts`

**Coverage (22 tests):**
- TEST-1: Basic quote calculation (4 rooms, 2 bathrooms)
- TEST-2: Full service with all optional work steps and addons
- TEST-3: Minimum charge NOT triggered (above minimum)
- TEST-4: Minimum charge TRIGGERED (below minimum)
- TEST-5: String number parsing from form inputs
- TEST-6: Boolean string values ("true", "Yes")
- TEST-7: Array field multipliers (multi-select)
- TEST-8: Numeric comparison operators (gt, lt, lte, gte)
- TEST-9: Zero quantities don't create $0 lines
- TEST-10: Tax rounding precision (no floating-point errors)
- TEST-11: Multiplier stacking order (multiplicative)
- TEST-12: Addon keyword case sensitivity
- Additional edge cases (empty forms, disabled tax, large numbers)

**Test Service:** "Complete Home Cleaning" with comprehensive configuration:
- Base fee: £25, Minimum charge: £75
- Work steps: Room cleaning (per-unit), Bathroom (per-unit), Kitchen (fixed), Oven (optional), Carpet (optional), Windows (optional)
- Addons: Fridge, Laundry, Pet treatment (keyword-triggered)
- Multipliers: Property size, Urgency, Heavy soiling, New customer, Loyalty

**Run Tests:**
```bash
pnpm --filter @estimator/worker test
```

---

### 2026-02-01: Quote Generation Quality Fixes v6 (Stress Testing)

**Context:** Designed 20 ultra-realistic test scenarios across 7 service categories and identified 8 bugs/issues affecting real-world quote generation.

---

#### ISSUE-1: Numeric Comparison Operators Fail with String Form Values (HIGH)

**Symptom:** Multiplier with `gte: 25` for `roof_age_years` not applied when form submitted `"30"` (string).

**Root Cause:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Operators `gt`, `lt`, `gte`, `lte` required BOTH values to be `typeof number`
- Form inputs often come as strings, so `typeof "30" === 'string'` caused silent failure

**Resolution:**
- Added `coerceToNumber()` helper function with comma handling
- Updated all numeric operators to use coercion:
```typescript
case 'gte': {
  const answerNum = coerceToNumber(answer.value)
  const compareNum = coerceToNumber(compareValue)
  if (answerNum === null || compareNum === null) return false
  return answerNum >= compareNum
}
```

**Lesson:** Form data types are unpredictable. Numeric comparisons must coerce before comparing.

---

#### ISSUE-2: Comma-Separated Numbers Not Parsed (MEDIUM)

**Symptom:** Floor area "2,400" parsed as 2 instead of 2400, causing massive undercharge.

**Root Cause:**
- `parseFloat("2,400")` stops at first non-numeric character → returns 2
- Common UK/US formatting uses commas for thousands

**Resolution:**
- `coerceToNumber()` strips commas: `value.replace(/,/g, '')`
- Updated `calculateWorkStepCost()` to use `coerceToNumber()` for form field parsing
- Updated type inference in `quote-processor.ts` to detect comma-formatted numbers

**Lesson:** Always normalize number formats before parsing.

---

#### ISSUE-3: Zero Quantity Creates $0 Line Items (LOW)

**Symptom:** Quote shows "0 sockets × £25 = £0" instead of omitting the line.

**Root Cause:** No check to skip zero-cost line items in work step processing.

**Resolution:**
- Added check after `calculateWorkStepCost()`:
```typescript
if (stepResult.cost === 0) {
  console.log(`[Pricing] Skipping work step "${step.name}" - zero cost`)
  continue
}
```

**Lesson:** Zero-value line items are unprofessional. Skip them.

---

#### ISSUE-4: Array Contains Doesn't Match Case-Insensitively (MEDIUM)

**Symptom:** Multi-select `["network", "endpoints", "cloud_m365"]` didn't match multiplier `contains: "Cloud_M365"`.

**Root Cause:** Array `includes()` uses strict equality, case-sensitive.

**Resolution:**
- Updated `contains` operator for arrays:
```typescript
if (Array.isArray(answer.value) && typeof compareValue === 'string') {
  const compareValueLower = compareValue.toLowerCase()
  return answer.value.some(v =>
    typeof v === 'string' && v.toLowerCase() === compareValueLower
  )
}
```

**Lesson:** Multi-select values need case-insensitive matching.

---

#### ISSUE-5: Explicit Negation Not Detected in Cross-Service (HIGH)

**Symptom:** Customer wrote "thinking of getting an awning but not for this quote" but awning service was still recommended.

**Root Cause:** `isGenuineServiceRequest()` didn't detect explicit negation phrases.

**Resolution:**
- Added negation patterns to `nonRequestPatterns`:
```typescript
/\b(not for this|not for now|not this time)\b/i,
/\b(don'?t need|won'?t need|no need)\b/i,
/\b(not needed|not required|not necessary)\b/i,
/\b(don'?t want|won'?t want)\b/i,
/\b(just mentioning|for context|for reference)\b/i,
/\b(thinking of|considering|might|maybe)\b.*\b(but not|but later|another time)\b/i,
/\b(separate|different|another)\s+(quote|job|project)\b/i,
```

**Lesson:** Explicit customer negations must be respected.

---

#### ISSUE-6: Ambiguous Values Not Handled (MEDIUM)

**Symptom:** `levelling_required: "possibly"` treated as truthy, included in firm price.

**Root Cause:** No detection of ambiguous/uncertain values like "possibly", "maybe", "quote_option".

**Resolution:**
- Added `detectAmbiguousValue()` function
- `convertFormValueToSignal()` returns `null` for ambiguous values
- Ambiguous values are logged and skipped from firm pricing

**Lesson:** Uncertain customer inputs shouldn't be included in firm quotes.

---

#### ISSUE-7: Multi-Value Fields (Arrays) in Multipliers `equals` (MEDIUM)

**Symptom:** Array field `audit_scope: ["network", "endpoints", "cloud_m365"]` didn't trigger multiplier `equals: "network"`.

**Root Cause:** `equals` operator for arrays only checked strict equality, not contains.

**Resolution:**
- Added array handling to `equals` operator:
```typescript
if (Array.isArray(answer.value) && typeof compareValue === 'string') {
  const compareValueLower = compareValue.toLowerCase()
  const hasMatch = answer.value.some(v =>
    typeof v === 'string' && v.toLowerCase() === compareValueLower
  )
  return hasMatch
}
```

**Lesson:** Multipliers with `equals` should match any value in multi-select arrays.

---

#### ISSUE-8: Tax Calculation Rounding (LOW)

**Symptom:** Potential penny discrepancies with fractional tax rates.

**Root Cause:** Formula `Math.round(subtotal * rate) / 100` assumed rate is percentage integer.

**Resolution:**
- Changed to explicit percentage calculation:
```typescript
const rawTax = subtotal * (taxConfig.rate / 100)
taxAmount = Math.round(rawTax * 100) / 100
```
- Updated all 3 tax calculation locations

**Lesson:** Tax calculations should be explicit about percentage conversion.

---

### Files Modified

| File | Issues Fixed |
|------|-------------|
| `apps/worker/src/pricing/rules-engine.ts` | ISSUE-1, 2, 3, 4, 7, 8 |
| `apps/worker/src/quote-processor.ts` | ISSUE-2, 5, 6 |

---

### 2026-02-01: Quote Generation Quality Fixes v5

**Context:** Testing cybersecurity service quote revealed four issues. All fixes are future-proof with no hardcoded values.

---

#### FIX-1: Use structuredSignals.overallConfidence (CRITICAL)

**Symptom:** "Price shown as range due to limited information" appeared incorrectly for form-only submissions.

**Root Cause:** `calculatePricingWithTrace()` used legacy `signals.confidence` (defaults to 0.5 without images) instead of `structuredSignals.overallConfidence` (1.0 after form signals merged).

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
  - Changed: `const confidence = structuredSignals?.overallConfidence ?? signals.confidence`
  - Falls back to legacy confidence only when structuredSignals unavailable

**Lesson:** After form signal merging, `structuredSignals.overallConfidence` reflects true confidence (1.0 for form data).

---

#### FIX-2: No Warnings for Photo-Optional Services (HIGH)

**Symptom:** Three warnings appeared ("No images provided", "Site visit recommended") for services where `minPhotos = 0`.

**Root Cause:** No distinction between photo-required vs photo-optional services when no images uploaded.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Added `getSignalsWithoutImagesPhotoOptional()` - returns confidence 0.8, no warnings, no site visit
  - Added `getSignalsWithoutImagesV2PhotoOptional()` - matching V2 version
- File: `apps/worker/src/ai/index.ts`
  - Exported new functions
- File: `apps/worker/src/quote-processor.ts`
  - Checks `service.media_config?.minPhotos ?? 1`
  - Uses photo-optional functions when `minPhotos === 0`

**Lesson:** Business configuration (`minPhotos`) should control whether missing photos trigger warnings.

---

#### FIX-3: Enhanced String Matching for Multipliers (MEDIUM)

**Symptom:** Timeline multiplier not applied. `"urgent_(<7_days)"` didn't match `"Urgent (<7 days)"`.

**Root Cause:** Case-insensitive comparison insufficient when format differs (underscores vs spaces, brackets).

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
  - Enhanced `shouldApplyMultiplier()` for `equals` operator
  - Added `normalize()` function: converts to lowercase, underscores→spaces, removes brackets
  - `"urgent_(<7_days)"` → `"urgent 7 days"` matches `"Urgent (<7 days)"` → `"urgent 7 days"`

**Lesson:** Form option values may have format variations. Normalize before comparing.

---

#### FIX-4: Intent-Aware Addon Detection (MEDIUM)

**Symptom:** Phishing Simulation addon not recommended despite customer saying "want to tighten our controls".

**Root Cause:** FIX-7 (symptom vs solution) was too conservative - blocked intent signals.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Enhanced `detectAddonsFromDescription()` prompt
  - Added "INTENT SIGNALS" category: recognizes goal keywords ("want to", "need to", "improve", "prevent", "strengthen", "tighten", "ensure", "enhance")
  - Added "CONTEXT COMBINATION" rule: symptom + intent = recommend

**Lesson:** Distinguish between passive symptoms (no action) vs expressed intent (has goal).

---

### 2026-02-01: Quote Generation Quality Fixes v4

**Context:** Deep analysis of a boiler service quote test revealed multiple issues with quote generation quality. Four fixes were implemented based on severity.

---

#### FIX-1: Remove AI Prices from Potential Additional Work (CRITICAL)

**Symptom:** "Potential Additional Work" section showed AI-invented prices like £180, £125, £150 that were not from business configuration.

**Root Cause:** `signal-recommendations.ts` asked AI to generate `estimatedCost` values.

**Resolution (AD-001 Compliance):**
- File: `packages/shared/src/database.types.ts`
  - Made `estimatedCost` optional and deprecated
  - Updated `costBreakdown` to contain work description without prices
- File: `apps/worker/src/ai/signal-recommendations.ts`
  - Prompt now asks for `whatItInvolves` (work description) not costs
  - Added `stripPricesFromText()` to defensively remove any price patterns
  - Recommendations now describe WHAT might be needed, not how much it costs

**Lesson:** Extends AD-001 - AI can suggest work but cannot set or estimate prices.

---

#### FIX-2: Addon vs Exclusion Conflict Check (CRITICAL)

**Symptom:** "Powerflush" addon was auto-recommended even though "Powerflush" was in `scope_excludes`.

**Root Cause:** No check to prevent recommending addons that conflict with explicit exclusions.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
  - Added `isAddonConflictingWithExcludes()` function
  - Checks addon label/ID against `scope_excludes` words
  - Applied to both description-based and image-based addon detection
  - Logs when addon is skipped due to conflict

**Lesson:** Exclusions should prevent not just scope promises but also addon recommendations.

---

#### FIX-3: Vision Severity Calibration (HIGH)

**Symptom:** Severe corrosion with water staining rated as "fair" instead of "poor".

**Root Cause:** Vision prompt lacked calibration guidance for condition ratings.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Added "CONDITION RATING CALIBRATION" section to prompt
  - Clear definitions for excellent/good/fair/poor
  - Explicit examples: "Rust on pipe joints + water staining = poor"
  - Instruction to err on the side of rating WORSE when damage is visible

**Lesson:** AI vision needs explicit calibration examples for severity assessment.

---

#### FIX-6: Error Code Integration (HIGH)

**Symptom:** Customer-reported error codes (e.g., boiler "EA" code) captured but not used in quote wording.

**Root Cause:** Error codes extracted as signals but not passed to wording context.

**Resolution:**
- File: `apps/worker/src/ai/wording.ts`
  - Added `errorCode?: string` to `WordingContext`
  - Added prompt section for error code with instruction to explain if recognized
- File: `apps/worker/src/quote-processor.ts`
  - Extracts error code from structured signals (keys: error_code, boiler_error_code, fault_code, display_code)
  - Passes to wording context

**Lesson:** Captured signals should flow through to customer-facing content.

---

**Note:** FIX-5 (work step triggers) is a configuration issue, not code.

---

### 2026-02-01: Quote Generation Quality Fixes v4 - Remaining Fixes

Additional fixes from the v4 analysis, implementing FIX-4, FIX-7, and FIX-8.

---

#### FIX-4: Ignore Unused Signals in Fallback Calculation (HIGH)

**Symptom:** `linear_distance` triggered fallback mode (`"Low confidence for: linear_distance"`) for boiler service even though no work step uses that signal.

**Root Cause:** All low-confidence signals triggered fallback, regardless of whether they're actually used in pricing.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
  - Added `getUsedSignalKeys()` function to extract signal keys referenced by work steps
  - Modified `evaluateFallback()` to only include signals that are actually used
  - Logs when ignoring unused low-confidence signals

**Lesson:** Fallback should only trigger for signals that affect pricing, not all extracted signals.

---

#### FIX-7: Smarter Addon Keyword Matching (MEDIUM)

**Symptom:** "radiators go lukewarm" triggered Powerflush recommendation - symptom words matching addon names.

**Root Cause:** AI addon detection didn't distinguish between symptoms and explicit requests.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Updated `detectAddonsFromDescription` prompt with "SYMPTOM vs SOLUTION DISTINCTION" section
  - Clear examples of symptoms (don't match) vs requests (do match)
  - AI now only recommends addons when customer explicitly requests or mentions them

**Lesson:** Natural language understanding must distinguish between describing problems and requesting solutions.

---

#### FIX-8: Form Data Overrides Vision for Access (MEDIUM)

**Symptom:** Customer said "Access is easy" but AI detected "moderate" from cabinet photos, causing "Cabinet modification" to be recommended.

**Root Cause:** Customer's explicit statement about access wasn't overriding AI vision assessment.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
  - Added `detectAccessOverrideFromDescription()` function
  - Checks project description for explicit access statements
  - Overrides `access_difficulty` signal with confidence 1.0 when found
  - Patterns: "access is easy", "easy access", "readily accessible", etc.

**Lesson:** Explicit customer statements should override AI inference (extends AD-002).

---

### 2026-01-31: AI Scope Constraint & No-Hardcode Rule

**Context:** Customer asked "if possible, a service at the same time" and AI responded with "A boiler service is included" in the scope summary. The business never configured boiler servicing as part of this service.

**Impact:**
- If business doesn't offer it → loses trust when they can't deliver
- If business offers it at extra cost → loses money because AI said it's "included"

**Root Cause:**
- `scope_includes` was passed to AI as informational context, not a hard constraint
- The prompt said "reference what's included if provided" (optional)
- No explicit instruction telling AI it CANNOT mention services outside `scope_includes`
- AI read customer's "if possible, a service" as intent and included it

**Resolution:**

1. **File: `/CLAUDE.md`**
   - Added "Anti-hardcoding principle" section to Code conventions
   - Prevents future hardcoded fixes like "add 'boiler servicing' to excludes"
   - All business values must come from database configuration

2. **File: `apps/worker/src/ai/wording.ts`**
   - Added "CRITICAL - SCOPE BOUNDARIES ARE ABSOLUTE" section to WORDING_PROMPT
   - Explicit rules: MUST NOT mention services outside scope_includes
   - Customer requests outside scope acknowledged in notes, not promised
   - Examples showing correct vs wrong behavior

**Lesson:** This extends AD-001 (AI must not set prices) to "AI must not expand scope". The business configuration is the absolute boundary for what can be offered.

**See:** AD-013 for the architectural decision.

---

### 2026-01-31: Intelligent Signal Key Unification

**Context:** The BUG-001 fix used a hardcoded synonym map to match form signals to AI signals. This approach was not scalable (adding "paper_count" requires code changes) and brittle (substring matching, order-dependent). The system already had infrastructure for proper signal mapping (`mapsToSignal`, `expected_signals`) but it wasn't being used intelligently.

**Root Cause:** Form fields and AI extraction used DIFFERENT signal keys:
- Form field: `fieldId: "number_of_leaks"` (human-created)
- AI signal: `key: "leak_count"` (AI-invented)

Then the system tried to reconcile them with a brittle synonym map.

**Solution: Canonical Signal Key Derivation (AD-012)**

Instead of post-hoc matching, make form and AI use the SAME key from the start:
1. When a user creates a question like "How many papers?", the system auto-derives `paper_count`
2. This becomes the `mapsToSignal` on the field AND the signal key in `expectedSignals`
3. AI is constrained to use ONLY these expected signal keys

**Changes Made:**

1. **File: `apps/web/src/app/(dashboard)/app/services/page.tsx`**
   - Added `deriveSignalKey(label, fieldType)` function that intelligently derives canonical keys:
     - "How many papers?" (number) → `paper_count`
     - "Number of Leaks" (number) → `leak_count`
     - "Approximate Age of Roof" (number) → `roof_age`
     - "Is the leak causing interior damage?" (boolean) → `has_interior_damage`
     - "Type of Roofing Material" (dropdown) → `roofing_material_type`
   - Removes common filler words (how many, number of, please enter, etc.)
   - Singularizes plurals (papers → paper)
   - Adds appropriate suffix based on field type (_count, _type, has_, etc.)
   - Updated `fieldToSignal()` to use `deriveSignalKey()`

2. **File: `apps/worker/src/ai/signals.ts`**
   - Rewrote `buildExpectedSignalsPromptSection()` with STRICT instructions
   - AI is now explicitly told to use ONLY the provided signal keys
   - Prohibits AI from inventing new keys like "item_count" when "paper_count" is expected
   - Clear examples showing correct key usage

3. **File: `apps/worker/src/quote-processor.ts`**
   - Simplified `findSemanticSignalMatch()` to prioritize explicit `mapsToSignal`
   - Removed the hardcoded synonym map (no longer needed)
   - Matching order: direct mapsToSignal → exact fieldId → normalized → singular/plural
   - Added `mapsToSignal` parameter to the function

**Benefits:**
- No hardcoded synonyms - works for ANY field type automatically
- Deterministic - same derivation logic everywhere
- Self-documenting - `expected_signals` explicitly lists what matters
- AI-constrained - AI uses the keys we define, not invented ones
- Scalable - add new question types without code changes

**Lesson:** Signal matching should happen at configuration time, not processing time. By ensuring form and AI use identical canonical keys, we eliminate the need for fuzzy post-hoc matching.

---

### 2026-01-31: Quote Quality Fixes v3 (Comprehensive Review)

**Context:** Continued testing after v1.5.0 revealed 2 additional critical bugs. Cross-service recommendations were matching wrong services (gutter request → Window Cleaning), and multipliers were not being applied due to type comparison failures.

---

#### BUG-004: Cross-Service Recommending Wrong Service - CRITICAL

**Symptom:** Customer requested "gutter cleaning" but "Residential Window Cleaning" was recommended instead. The matched phrase verification (AD-008) passed because the phrase existed, but the SERVICE was wrong.

**Root Cause:**
- AD-008 verification only checked if `matchedPhrase` exists in source text
- It did NOT verify that the recommended SERVICE matches the customer's REQUEST
- Customer said "gutter cleaning" → AI matched to "Window Cleaning" because:
  - Either no "Gutter Cleaning" service exists
  - Or AI made a wrong semantic connection between "gutter" and "window"

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added AD-010: Service-request relevance validation after phrase verification
- Extracts key object words from the matched phrase (e.g., "gutter" from "gutter cleaning")
- Verifies the recommended service name contains the key object word
- Handles singular/plural variations (gutters → gutter)
- Rejects recommendations where service name doesn't match request keywords

**Lesson:** Phrase verification alone isn't enough. The recommended SERVICE must semantically match what the customer REQUESTED.

---

#### BUG-005: Multipliers Not Being Applied - CRITICAL

**Symptom:** User configured multipliers (e.g., "When roof age ≥ 10 → +5%", "When interior damage = Yes → +10%") but `multiplierAdjustment: 0` in pricing trace. Conditions were met but multipliers not applied.

**Root Cause:**
- File: `apps/worker/src/pricing/rules-engine.ts` line 649
- `case 'equals': return answer.value === compareValue` used STRICT equality
- Form checkbox submits `interior_damage: true` (boolean)
- Multiplier config has `equals: "Yes"` (string)
- `true === "Yes"` evaluates to `false` due to type mismatch
- Same issue with number values: `10` (number) vs `"10"` (string)

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Replaced strict equality with type-aware comparison in `shouldApplyMultiplier()`
- Boolean handling: `true` matches "Yes", "yes", "true", "1", 1
- Number handling: Compares as numbers if both can be parsed
- String handling: Case-insensitive comparison
- Fallback to strict equality for other types

**Lesson:** Form data types and config value types may differ. Comparison logic must normalize types before checking equality.

---

### 2026-01-31: Quote Quality Fixes v2 (Deep Investigation)

**Context:** Deep investigation of the v1.4.0 fixes revealed 3 critical bugs that were missed. These bugs caused form data to not properly override AI signals, false cross-service recommendations, and pricing configuration loss.

---

#### BUG-001: Signal Key Semantic Mismatch - CRITICAL

**Symptom:** Customer submitted "Number of Leaks: 2" via form, but signals_json showed BOTH `number_of_leaks=2` (form) AND `leak_count=1` (AI). The AI signal was sometimes used in pricing instead of the form signal.

**Root Cause:**
- Form used field ID `number_of_leaks` but AI extracted signal key `leak_count`
- Different keys = no override happened, both signals coexisted
- The form signal merge code only did exact key matching

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Added `findSemanticSignalMatch()` function that normalizes keys and matches synonyms
- Normalization: removes `number_of_`, `_count`, `_quantity` suffixes
- Synonym groups: `['leak', 'leaks', 'leakcount']`, `['room', 'rooms']`, etc.
- Form signal now finds and overrides the AI signal even with different keys

**Lesson:** Form->AI signal matching needs semantic awareness, not just exact string matching.

---

#### BUG-002: Keyword Fallback Bypassed Phrase Verification - CRITICAL

**Symptom:** "Residential Window Cleaning" recommended for roof leak quote. Customer said "gutters overflow on that side sometimes" but quote showed "The customer explicitly requests gutter cleaning with the phrase 'I might need some gutter cleaning as well.'" - a hallucinated phrase.

**Root Cause:**
- AI detection (AD-008) had phrase verification to prevent hallucination
- Keyword fallback `detectCrossServiceMentionsKeywords()` had NO verification
- Window Cleaning had keyword "gutter" → matched "gutters overflow" → false positive
- The "reason" text was fabricated, not from actual customer input

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Added `extractPhraseContext()` to get actual text around keyword match
- Added `isGenuineServiceRequest()` to verify intent patterns
- Request patterns: "need", "want", "require", "looking for", "also", "as well"
- Non-request patterns: "overflow", "sometimes", "because of", "near"
- Keyword matches must pass verification to be recommended

**Lesson:** ALL detection paths need the same validation rigor. Fallbacks can't be lower quality.

---

#### BUG-003: Add-ons and Multipliers Not Saved - CRITICAL

**Symptom:** User configured add-ons and multipliers in service wizard, but after saving and reloading, they were gone. Only default empty values shown.

**Root Cause:**
- POST handler destructured request body but `pricingRules` was NOT included
- PATCH handler same issue - `pricingRules` not extracted
- POST inserted hardcoded defaults: `{ baseFee: 0, addons: [], multipliers: [] }`
- Frontend sent `pricingRules` but API ignored it completely

**Resolution:**
- File: `apps/web/src/app/api/services/route.ts` (POST)
  - Added `pricingRules` to request body destructuring
  - Use `pricingRules.baseFee`, `.addons`, `.multipliers` in insert
  - Return `pricing_rules` in response for frontend state update
- File: `apps/web/src/app/api/services/[id]/route.ts` (PATCH)
  - Added `pricingRules` to request body destructuring
  - Added upsert to `service_pricing_rules` when `pricingRules` provided
  - Return `pricing_rules` in response
- File: `apps/web/src/app/api/services/route.ts` (GET)
  - Added join with `service_pricing_rules` table
  - Transform response to include `pricing_rules` at top level
- File: `apps/web/src/app/api/services/[id]/route.ts` (GET)
  - Added join with `service_pricing_rules` table
  - Transform response to include `pricing_rules` at top level

**Lesson:** When adding new fields to a wizard, ensure the API handler extracts and persists them, AND returns them when fetching.

---

### 2026-01-31: Quote Quality Fixes (Roof Leak Test)

**Context:** Testing a roof leak quote submission revealed 6 quality issues that made quotes look unprofessional.

---

#### Issue #1: Form Data Ignored (leak_count=2 became 1) - CRITICAL

**Symptom:** Customer submitted "Number of Leaks: 2" via form, but quote showed "1 leak" because AI vision extraction was used instead.

**Root Cause:**
- Form signal merge in `quote-processor.ts` line 382 was conditional on `service.expected_signals && service.expected_signals.length > 0`
- If `expected_signals` was empty/not configured, form answers were NEVER merged into signals
- AI-extracted signals (often wrong) were used instead of customer-provided form data

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Changed form signal merge to be UNCONDITIONAL - now happens if `structuredSignals` exists
- Processes EACH form answer, not just those matching `expected_signals`
- Uses `mapsToSignal` from widget config or falls back to `fieldId` as signal key
- Form signals always have `confidence: 1.0` and `source: 'form'`

**Lesson:** Form data is the source of truth - it should ALWAYS override AI guesses, regardless of signal configuration.

---

#### Issue #2: Window Cleaning Recommended for Roof Leak - HIGH

**Symptom:** AI recommended "Window Cleaning" service for a roof leak quote. Customer never mentioned windows.

**Root Cause:**
- AI fabricated `matchedPhrase: "may require gutter cleaning"` that didn't exist in customer text
- Previous validation only checked phrase length (> 5 chars), not existence in source

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added phrase existence verification: `descriptionLower.includes(phraseLower)`
- If `matchedPhrase` doesn't exist in source text, recommendation is REJECTED
- Raised confidence threshold from 0.8 to 0.9 to reduce false positives
- Added anti-hallucination rule to AI prompt

**Lesson:** AI-generated phrases must be verified against source text to prevent hallucination.

---

#### Issue #3: 6 Verbose Potential Work Items - MEDIUM

**Symptom:** Quote showed 6 "potential additional work" items with 2-3 sentence descriptions each, overwhelming the customer.

**Root Cause:**
- No limit in AI prompt for number of recommendations
- No constraint on description length in prompt

**Resolution:**
- File: `apps/worker/src/ai/signal-recommendations.ts`
- Updated prompt with strict constraints:
  - Maximum 3 recommendations
  - `workDescription`: 3-5 words only
  - `reason`: 1 sentence, max 20 words
  - `costBreakdown`: short phrase
- Added hard limit in `parseRecommendations()`: `slice(0, MAX_RECOMMENDATIONS)`
- Recommendations sorted by confidence before trimming

**Lesson:** AI output needs explicit length constraints, plus code-level enforcement as backup.

---

#### Issue #4: Scope Says "Inspection" When Customer Wants "Repair" - MEDIUM

**Symptom:** Customer wrote "carry out a repair... permanent fix, not just sealant" but scope summary only mentioned "inspect and provide a report".

**Root Cause:**
- Wording prompt didn't instruct AI to match scope language to customer intent keywords
- AI defaulted to conservative "inspection" language

**Resolution:**
- File: `apps/worker/src/ai/wording.ts`
- Added "SCOPE MUST MATCH CUSTOMER INTENT" section to prompt
- Intent detection based on keywords: repair/fix/replace vs inspect/check/assess
- Clear guidance for when pricing covers Phase 1 only but customer wants repair

**Lesson:** AI-generated wording must reflect customer's stated intent, not generic safe language.

---

#### Issue #5: Service Configuration Mismatch (Not a Code Bug)

**Symptom:** Service named "Roof Leak Repair" but work steps only included Inspection + Report, no repair line items.

**Root Cause:** Configuration issue - business configured service name implying repair but didn't add repair work steps.

**Resolution:**
- File: `apps/web/src/app/(dashboard)/app/services/page.tsx`
- Added validation warning in Test step:
  - Detects if service name contains "repair/fix/replace"
  - Checks if any work steps contain those keywords
  - Shows warning: "Service name includes 'Repair' but no repair work steps configured"

**Lesson:** UI should help users catch configuration mismatches before publishing.

---

### 2025-01-31: Service Creation UI Simplification

**Goal:** Make service creation simple and intuitive for business owners.

**Changes Made:**

1. **Renamed tabs to business-friendly terms:**
   - "Signals & Steps" → "Pricing Setup"
   - "Widget Fields" → "Customer Questions"

2. **Hidden "Expected Signals" editor:**
   - Business owners don't need to understand signals
   - Signals are now auto-generated from form fields

3. **Renamed "Work Steps" to "Price Breakdown":**
   - Clearer description: "Define how you charge for this service. Each item appears as a line on the quote."

4. **Updated Work Step trigger dropdown:**
   - Now shows question labels instead of signal keys
   - E.g., "How many employees?" instead of "employee_count"

5. **Removed arbitrary limits:**
   - Work steps no longer limited to 5 (was arbitrary)

**Files Changed:**
- `apps/web/src/app/(dashboard)/app/services/page.tsx`
- `apps/web/src/components/WorkStepEditor.tsx`
- `packages/shared/src/database.types.ts` (added SuggestedField type export)

**No Backend Changes:** AI extraction, pricing engine, and signal processing remain unchanged.

---

### 2025-01-30: IT Infrastructure Audit Test - Multiple Bugs

**Test Case:** IT Infrastructure Audit quote submission with form fields for `employee_count` and `server_count`.

#### Issue #1: Form Signals Flagged as Low Confidence (HIGH)

**Symptom:** `employee_count` and `server_count` (form signals with 100% confidence) appeared in `lowConfidenceSignals`, triggering unnecessary fallback warnings.

**Root Cause:**
- `lowConfidenceSignals` array was populated during initial AI extraction
- When form signals were merged later with `confidence: 1.0`, the array was NOT regenerated
- Fallback evaluation in `evaluateFallback()` still used the stale `lowConfidenceSignals` array

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- After form signals are merged into `structuredSignals.signals`, regenerate the `lowConfidenceSignals` array based on current signal confidence values
- Added after line ~457:
```typescript
const confidenceThreshold = service.confidence_threshold || 0.7
structuredSignals.lowConfidenceSignals = structuredSignals.signals
  .filter(s => s.confidence < confidenceThreshold)
  .map(s => s.key)
```

**Lesson:** Always regenerate derived data (like `lowConfidenceSignals`) when the source data (signals array) is modified.

---

#### Issue #2: Cross-Service Recommending Residential for Business (HIGH)

**Symptom:** "Smart Home Wi-Fi Dead Zone Fix" was recommended for a Business IT Audit - completely irrelevant context.

**Root Cause:** No filtering for business context - all tenant services were matched regardless of B2B vs B2C appropriateness.

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added B2B/B2C context awareness section to the AI prompt
- AI now detects the context of the primary service (residential vs commercial/business)
- Only recommends cross-services that match the same context
- Example rule: "If the primary service is business/commercial (e.g., IT Audit), do NOT recommend residential consumer services (e.g., Smart Home)"

**Lesson:** Cross-service detection needs context awareness, not just keyword matching.

---

#### Issue #3: Automatic Global Access Difficulty Multiplier (MEDIUM)

**Symptom:** Line items like "moderate access: £95" appeared for IT Audit service - a service where "access difficulty" makes no sense.

**Root Cause:**
- Access multiplier was **hardcoded globally** in the pricing engine
- Applied to EVERY quote regardless of service type
- Businesses had NO control over this - they didn't configure it
- AI extracted `access_difficulty` from photos and pricing engine ALWAYS applied multiplier

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Removed `getAccessMultiplier()` function
- Removed access multiplier application in `calculatePricing()` (lines 315-324)
- Removed access multiplier application in `calculatePricingWithTrace()` (lines 1296-1315)
- Added comments explaining removal and alternative approach

**Future Enhancement:** If a business WANTS access-based pricing, they can configure it as a work step with trigger conditions in their service's pricing rules.

**Lesson:** Global automatic pricing adjustments are dangerous. All pricing logic should be business-configurable, not hardcoded.

---

#### Issue #4: Cross-Service Recommendations with £0.00 Price (HIGH)

**Symptom:** "Smart Home Wi-Fi Dead Zone Fix" showed with "~£0.00" - worse than not showing it at all.

**Root Cause:**
- Cross-service recommendations were shown even with £0 or unknown price
- If pricing rules weren't configured or calculation failed, £0 was displayed

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Before adding to recommendations, check `estimatedTotal > 0`
- Skip and log services with invalid pricing:
```typescript
if (pricingResult.estimatedTotal <= 0) {
  console.log(`[Processor] Skipping cross-service ${rec.serviceName} - invalid pricing`)
  continue
}
```

**Lesson:** Always validate pricing output before displaying. £0 recommendations damage credibility.

---

#### Issue #5: Meaningless `item_count` Signal for IT Audit (LOW)

**Symptom:** `item_count = 2` extracted for IT audit - meaningless for this service type.

**Root Cause:** Generic signal extraction tries to count "items" regardless of service context.

**Status:** Deferred - Lower priority since it doesn't affect pricing due to work-step model. Consider making `item_count` extraction conditional based on service type in future.

---

## Architectural Decisions

### AD-001: Deterministic Pricing from Business Configuration

**Decision:** AI does NOT set prices. All pricing is computed from business-configured rules.

**Rationale:**
- Pricing must be predictable and auditable
- Businesses need full control over their pricing
- AI can extract signals and draft wording, but the final price comes from rules

**Implications:**
- Pricing engine only uses signals as inputs to configured rules
- No "AI suggested price" feature
- Work steps, addons, multipliers all configured by business

---

### AD-002: Form Signals Override AI-Extracted Signals

**Decision:** When a customer provides a value via form (e.g., square footage), it ALWAYS overrides any AI-extracted value.

**Rationale:**
- Customer knows their project better than AI vision guessing from photos
- Form inputs have confidence: 1.0 by definition
- Reduces disputes ("I told you it was 500 sqft, not 800!")

**Implications:**
- Form signal merging must happen AFTER AI extraction
- Must regenerate derived data (lowConfidenceSignals) after merge
- Log when form overrides AI for debugging

---

### AD-003: Work-Step Pricing Model

**Decision:** Primary pricing model uses configurable work steps with trigger conditions, not global automatic adjustments.

**Rationale:**
- Different services need different pricing logic
- Global adjustments (like access difficulty) don't apply to all service types
- Businesses should control what factors affect their pricing

**Implications:**
- Removed automatic access difficulty multiplier (see Issue #3)
- Complexity multiplier kept (applies more universally)
- New pricing factors should be added as configurable work steps

---

### AD-004: Cross-Service Context Matching

**Decision:** Cross-service recommendations must match the context (B2B vs B2C) of the primary service.

**Rationale:**
- Recommending "Smart Home" for "IT Audit" is nonsensical
- Damages credibility of the entire quote
- Better to recommend nothing than something irrelevant

**Implications:**
- AI prompt includes context awareness rules
- Services implicitly categorized by keywords in name/description
- Future: Consider explicit B2B/B2C flag on service configuration

---

### AD-005: Explicit Quantity Sources for Per-Unit Pricing

**Decision:** Per-unit pricing items must explicitly declare their quantity source: `form_field`, `constant`, or `ai_signal` (deprecated).

**Rationale:**
- Form data (100% confidence) must be used over AI guesses (60% confidence)
- "Kitchen × room_count" is nonsensical and destroys trust
- Business owners need full control over pricing logic
- Deterministic pricing enables the Quote Simulator
- Eliminates the "where did this number come from?" confusion

**Superseded by AD-006** - See below for the enhanced implementation.

---

### AD-007: Unconditional Form Signal Override

**Decision:** Form answers are ALWAYS merged into structured signals with `confidence: 1.0`, regardless of `expected_signals` configuration.

**Rationale:**
- Form data is explicitly provided by the customer - it's the source of truth
- AI vision extraction can guess wrong (e.g., counting 1 leak when customer says 2)
- Business shouldn't need to configure `expected_signals` for form data to work
- Removing the dependency simplifies configuration

**Implications:**
- All form answers (except `_` prefixed internal fields) become signals
- `mapsToSignal` from widget config is used if available, otherwise `fieldId`
- Signal type is inferred from value if not in `expected_signals`
- Form signals always override AI signals for the same key

---

### AD-008: Cross-Service Phrase Verification

**Decision:** Cross-service recommendations are rejected if `matchedPhrase` cannot be found as an exact substring in the customer's input text.

**Rationale:**
- AI sometimes fabricates customer quotes (hallucination)
- Recommending "Window Cleaning" for a roof leak is embarrassing
- Verification ensures recommendations are grounded in actual customer text
- Raising threshold to 0.9 reduces marginal false positives

**Implications:**
- `matchedPhrase` must be a literal substring of description (case-insensitive)
- Paraphrased or summarized phrases will be rejected
- May reduce some valid recommendations, but prevents hallucinated ones
- Confidence threshold raised from 0.8 to 0.9

---

### AD-009: Potential Work Limits

**Decision:** Signal recommendations are limited to 3 items maximum, with strict length limits on descriptions.

**Rationale:**
- 6 verbose items overwhelm customers
- Long descriptions look like upselling, not helpful suggestions
- Quality over quantity improves trust
- Sorted by confidence ensures best recommendations shown

**Constraints:**
- Maximum 3 recommendations
- `workDescription`: 3-5 words
- `reason`: 1 sentence, max 20 words
- `costBreakdown`: short phrase
- Sorted by confidence before trimming

---

### AD-010: Cross-Service Name-Request Relevance

**Decision:** Cross-service recommendations are rejected if the SERVICE NAME doesn't contain keywords from the customer's REQUEST.

**Rationale:**
- AD-008 phrase verification prevents hallucinated phrases but doesn't verify service match
- "Gutter cleaning" request should NOT recommend "Window Cleaning" service
- Customer mentions "gutter" → only "Gutter Cleaning" service is relevant
- Recommending wrong service is worse than recommending nothing

**Implementation:**
1. Extract key object words from matched phrase (excluding common verbs/fillers)
2. Check if any key word appears in the service name
3. Handle singular/plural variations (gutters → gutter)
4. Reject if no match found

**Examples:**
- Phrase: "gutter cleaning" → Key words: ["gutter"] → Matches "Gutter Cleaning" ✓
- Phrase: "gutter cleaning" → Key words: ["gutter"] → Rejects "Window Cleaning" ✗
- Phrase: "paint the walls" → Key words: ["paint", "walls"] → Matches "Painting" ✓

**Implications:**
- More restrictive than AD-008 alone
- May reduce some edge-case valid recommendations
- Significantly reduces false positives
- Works in conjunction with AD-008 (phrase verification)

---

### AD-011: Type-Aware Multiplier Comparison

**Decision:** Multiplier condition matching handles type differences between form values and config values.

**Rationale:**
- Form checkboxes submit `true`/`false` (boolean)
- Config values may be "Yes"/"No" (string) or 1/0 (number)
- Strict equality fails across types: `true === "Yes"` → false
- Businesses shouldn't need to match exact types in config

**Type Normalization:**
| Form Value | Matches Config Values |
|------------|----------------------|
| `true` (bool) | `true`, "true", "True", "Yes", "yes", "1", 1 |
| `false` (bool) | `false`, "false", "False", "No", "no", "0", 0 |
| `10` (number) | 10, "10" |
| "Large" (string) | "large", "LARGE", "Large" (case-insensitive) |

**Implications:**
- Config values are more forgiving
- Boolean checkboxes work with string "Yes"/"No" conditions
- Number fields work with string number conditions
- String comparisons are case-insensitive

---

### AD-012: Canonical Signal Key Derivation

**Decision:** Form fields and AI extraction MUST use identical signal keys, derived automatically from question labels using `deriveSignalKey()`.

**Rationale:**
- BUG-001 fix used hardcoded synonym map - not scalable or maintainable
- Different keys (form: `number_of_leaks`, AI: `leak_count`) caused override failures
- Signal matching should happen at configuration time, not processing time
- Canonical keys eliminate the need for fuzzy post-hoc matching

**Implementation:**

| Question Label | Field Type | Derived Key |
|----------------|------------|-------------|
| "How many papers?" | number | `paper_count` |
| "Number of Leaks" | number | `leak_count` |
| "Approximate Age of Roof" | number | `roof_age` |
| "Is the leak causing damage?" | boolean | `has_leak_damage` |
| "Type of Roofing Material" | dropdown | `roofing_material_type` |

**Derivation Rules:**
1. Remove filler words: "how many", "number of", "please enter", etc.
2. Singularize plurals: "papers" → "paper"
3. Add suffix based on type:
   - number → `_count` (default), `_age`, `_area` (if label contains those)
   - dropdown/radio → `_type`, `_material`, `_condition` (based on label)
   - boolean/checkbox → `has_` or `is_` prefix

**AI Constraint:**
- Expected signals prompt explicitly tells AI to use ONLY provided keys
- AI cannot invent new keys like `item_count` when `paper_count` is expected
- Violations result in unmatched signals (acceptable over wrong matches)

**Migration:**
- Existing services continue to work with normalized matching fallback
- New services automatically use canonical keys
- No code changes needed for new question types

---

### AD-013: AI Wording Constrained to Configured Scope

**Decision:** AI-generated wording MUST NOT promise services outside the business's configured `scope_includes`.

**Rationale:**
- `scope_includes` is the source of truth for what the business offers
- AI accepting customer requests for unconfigured services causes:
  - Lost trust (can't deliver what was promised)
  - Lost money (gave away service for free)
- This extends AD-001 "AI must not set prices" to "AI must not expand scope"

**Implementation:**
- Prompt constraint is primary defense (explicit instruction in WORDING_PROMPT)
- Business configuration is respected as absolute boundary
- Customer requests outside scope are acknowledged but not promised
- Notes suggest: "Additional services like [X] can be quoted separately upon request."

**Implications:**
- AI cannot say a service is "included" unless it appears in scope_includes
- Customer requests for unlisted services are handled gracefully
- When in doubt, AI mentions LESS not MORE
- Business controls what they offer; AI describes it, never expands it

**Related:**
- AD-001: Deterministic Pricing from Business Configuration
- AD-007: Unconditional Form Signal Override

---

### AD-006: Consolidated Pricing with Auto-Linking and Strict Validation

**Decision:** All pricing configuration consolidated in Service wizard with auto-linking, smart defaults, and strict validation that blocks publish.

**Key Features:**

1. **Simplified UI - "Multiply by" Dropdown:**
   - No technical "quantity source" terminology
   - Simple dropdown: "Multiply by [Number of Bedrooms]" or "Always 1"
   - Customer Questions appear as options, Fixed quantities as fallback

2. **Auto-Linking:**
   - System suggests matching questions based on step name keywords
   - "Bedroom Cleaning" + question "Number of Bedrooms" = auto-suggest link
   - One-click accept: "Link to 'Number of Bedrooms'? [Yes, link it]"

3. **Smart Defaults:**
   - Only 1 number question? Auto-select it
   - Step name matches question? Pre-select that link
   - No number questions? Default to "Always 1"

4. **Strict Validation (Block Publish):**
   - Per-unit items without quantity link = HARD ERROR
   - Invalid field references = HARD ERROR
   - Publish button disabled until errors fixed
   - Clear error messages with "Go back to Pricing Setup" guidance

5. **Hidden Advanced Mode:**
   - AI Signal option hidden behind "Show advanced options"
   - Only visible for legacy services or power users

6. **Consolidated Pricing Page:**
   - Base fee, minimum charge, add-ons, multipliers all in Service wizard
   - Standalone `/app/pricing` page now redirects to Services
   - One place to configure everything about a service

**Quantity Source Types:**
| Type | Display Name | Use Case |
|------|--------------|----------|
| `form_field` | Customer Question dropdown | Links to a number question answer |
| `constant` | "Always 1", "Always 2", etc. | Fixed quantity |
| `ai_signal` | Hidden in Advanced mode | Legacy only |

**Files Changed:**
- `apps/web/src/components/WorkStepEditor.tsx` - Complete rewrite with auto-linking, simplified UI
- `apps/web/src/app/(dashboard)/app/services/page.tsx` - Added base fee, add-ons, multipliers; strict validation
- `apps/web/src/app/(dashboard)/app/pricing/page.tsx` - Replaced with redirect to Services
- `apps/worker/src/pricing/rules-engine.ts` - Uses explicit quantitySource
- `packages/shared/src/database.types.ts` - QuantitySource interface

**Validation Rules:**
| Type | Condition | Action |
|------|-----------|--------|
| Error | per_unit/per_hour without quantitySource | Block publish |
| Error | quantitySource.fieldId not in questions | Block publish |
| Warning | No pricing items and baseFee = 0 | Show warning |

**Migration:**
- Existing services continue to work (legacy fallback)
- New services must have all quantities linked to publish
- Standalone pricing page shows redirect message

---

## Known Constraints

### KC-001: No Automatic Access-Based Pricing

**Constraint:** The system no longer automatically applies access difficulty multipliers.

**Why:**
- Access difficulty doesn't apply to all service types (e.g., IT Audit)
- Businesses didn't configure it, so shouldn't appear in quotes
- Creates confusing line items customers didn't expect

**Workaround:** Businesses wanting access-based pricing can configure it as a work step with appropriate trigger conditions.

---

### KC-002: Cross-Service Requires Valid Pricing

**Constraint:** Cross-service recommendations are only shown if they have pricing > £0.

**Why:**
- £0 recommendations look broken
- If pricing rules aren't configured, recommendation shouldn't show
- Better user experience to show nothing than broken data

---

### KC-003: Form Signals Must Match Expected Signals (RESOLVED)

**Constraint:** ~~Form fields with `mapsToSignal` must match signal keys defined in `expected_signals`.~~

**Status:** RESOLVED by KC-004 - signals are now auto-generated from form fields.

---

### KC-004: Signals Auto-Generated from Form Fields

**Constraint:** Expected signals are no longer manually configured. They are automatically derived from Customer Questions (form fields).

**Why:**
- Business owners don't understand "signals" - they understand "questions"
- Manual signal configuration was error-prone and confusing
- Auto-generation ensures signals always match form fields

**How it works:**
1. When a user creates a Customer Question (e.g., "How many employees?"), the system auto-generates:
   - An expected signal with key derived from the label (e.g., "employees")
   - Signal type inferred from field type (number → number, dropdown → enum, etc.)
   - `mapsToSignal` set on the field to match the generated signal key
2. The "Expected Signals" editor is hidden from the UI
3. Work step triggers now show question labels instead of signal keys

**Implications:**
- ExpectedSignalEditor component is no longer used in service creation
- Backend processing logic unchanged - signals still work the same way
- AI continues to extract standard signals (complexity, condition, etc.)

---

### KC-005: Per-Unit Items Should Declare Quantity Source

**Constraint:** Per-unit and per-hour pricing items should have an explicit `quantitySource` to ensure accurate, deterministic pricing.

**Why:**
- Without explicit source, the system guesses using legacy fallback logic
- Guessing leads to wrong prices (e.g., "Kitchen × room_count")
- Form data is 100% accurate, AI guesses are ~60% accurate
- Business owners need to understand and control pricing logic

**Workaround:** Legacy services continue to work with fallback logic, but:
- A deprecation warning is logged
- Quote notes may include "uses legacy quantity estimation"
- New services should always configure explicit quantity sources

**Validation:**
- Quote Simulator shows warnings for missing quantity sources
- Per-unit items display "(no source!)" in collapsed header if not configured
- Test step shows configuration status summary

---

## Fix Dependencies

### FD-001: Issue #1 and Fallback System

**Relationship:** Issue #1 fix (regenerating lowConfidenceSignals) directly affects the fallback evaluation system.

**Dependencies:**
- `evaluateFallback()` reads `structuredSignals.lowConfidenceSignals`
- If this array is stale, wrong fallback mode may be triggered
- Form signals with 1.0 confidence must NOT trigger "low confidence" fallbacks

**Testing:** When testing fallback modes, always verify with a mix of AI-extracted and form-provided signals.

---

### FD-002: Issue #2 and Issue #4 Relationship

**Relationship:** Both issues relate to cross-service recommendations quality.

**Flow:**
1. AI detects potential cross-services (Issue #2 context fix)
2. Pricing is calculated for each
3. Only services with valid pricing are shown (Issue #4 fix)

**Testing:** Test cross-service with:
- B2B primary service + mixed B2B/B2C other services
- Service without pricing rules configured
- Service with £0 base fee and no applicable rules

---

### FD-003: Issue #3 and Work-Step Model

**Relationship:** Removing automatic access multiplier pushes pricing control to work-step configuration.

**Migration:** Existing businesses relying on access adjustments need to:
1. Add a work step for access adjustment
2. Configure trigger signal: `access_difficulty`
3. Configure trigger condition: `equals: "difficult"` (or similar)
4. Set appropriate pricing

**Note:** This is a breaking change for businesses that expected automatic access pricing.

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-06 | 1.13.0 | Dashboard & Menu Reorganization: Reduced menu from 9 to 7 items, inline setup progress, real quote stats, improved welcome message, deleted redundant pages |
| 2026-02-03 | 1.12.0 | Comprehensive Quote Validation Architecture: 8 validation categories, auto-correction, validation logging, config suggestions, tenant settings |
| 2026-02-03 | 1.11.0 | Bathroom Quote Quality Fixes: Form/description conflict detection (FIX-BATHROOM-1), contradicting signal filter (FIX-BATHROOM-4), scope/pricing validation (FIX-BATHROOM-5), unused form field warning (FIX-BATHROOM-2) |
| 2026-02-02 | 1.10.1 | Keyword negation in addon detection (FIX-NEGATION-1): Global addon suppressors, contextual keyword negation |
| 2026-02-01 | 1.10.0 | Quote Quality Fixes v6 (Stress Testing): 8 issues fixed - numeric operator type coercion (ISSUE-1), comma-separated numbers (ISSUE-2), zero line items (ISSUE-3), array case-insensitive (ISSUE-4), explicit negation (ISSUE-5), ambiguous values (ISSUE-6), array equals matching (ISSUE-7), tax rounding (ISSUE-8) |
| 2026-02-01 | 1.9.1 | Quote Quality Fixes v4 (remaining): Ignore unused signals in fallback (FIX-4), smarter addon keyword matching (FIX-7), form overrides vision for access (FIX-8) |
| 2026-02-01 | 1.9.0 | Quote Quality Fixes v4: AD-001 compliance for recommendations (no AI prices), addon/exclusion conflict check, vision severity calibration, error code integration |
| 2026-01-31 | 1.8.0 | AI Scope Constraint & No-Hardcode Rule (AD-013): AI cannot promise services outside scope_includes, added anti-hardcoding principle to CLAUDE.md |
| 2026-01-31 | 1.7.0 | Intelligent Signal Key Unification (AD-012): Canonical signal key derivation, AI constrained to expected keys, removed hardcoded synonym map |
| 2026-01-31 | 1.6.0 | Quote Quality Fixes v3 (BUG-004, BUG-005): Cross-service relevance validation (AD-010), multiplier type coercion (AD-011) |
| 2026-01-31 | 1.5.0 | Quote Quality Fixes v2 (BUG-001, BUG-002, BUG-003): Semantic signal matching, keyword phrase verification, pricing rules save fix |
| 2026-01-31 | 1.4.0 | Quote Quality Fixes (AD-007, AD-008, AD-009): Unconditional form signal merge, cross-service phrase verification, potential work limits |
| 2026-01-31 | 1.3.0 | Consolidated Pricing (AD-006): Auto-linking, smart defaults, strict validation, hidden advanced mode, standalone pricing page removed |
| 2026-01-31 | 1.2.0 | Explicit Quantity Sources (AD-005): Added quantitySource to WorkStepConfig, reordered wizard (Questions before Pricing), added Test step with Quote Simulator |
| 2025-01-31 | 1.1.0 | Simplified Service Creation UI: renamed tabs to business-friendly terms, hid signals editor, auto-generate signals from form fields |
| 2025-01-30 | 1.0.0 | Initial changelog created. Documented IT Audit test bugs #1-5. |

---

## How to Use This Document

### When Fixing a Bug:
1. Add entry under "Issues & Resolutions" with symptom, root cause, resolution
2. Check "Fix Dependencies" to see if your fix affects other areas
3. Update "Known Constraints" if your fix introduces new limitations

### When Making Architectural Changes:
1. Add entry under "Architectural Decisions" with rationale
2. Document implications for existing code
3. Check if change conflicts with existing decisions

### Before Starting New Work:
1. Review "Known Constraints" to avoid reintroducing removed features
2. Check "Fix Dependencies" if working in related areas
3. Search this doc for related previous issues

---

*Last Updated: 2026-02-06 (v1.13.0)*
