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

*Last Updated: 2026-01-31 (v1.4.0)*
