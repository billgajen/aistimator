# tickets/T-015-ai-signals-and-rules-engine.md

## Goal
Run AI extraction (vision + text drafting) and compute deterministic pricing from rules.

## In scope
- Gemini 1.5 Flash: extract structured "signals" from images (JSON)
  - Identify materials, dimensions, condition, complexity signals
- Apply service area restrictions (reject or flag)
- Rules engine: compute price total and breakdown using tenant pricing config
- Gemini 1.5 Flash: draft scope summary and optional notes based on inputs and signals
- Store result in quotes.pricing_json and quotes.content_json

## Out of scope
- AI deciding the price (pricing is always deterministic from rules)
- Overly complex prompt libraries
- Multiple AI providers (single provider: Gemini 1.5 Flash)

## Acceptance criteria
- [x] Pricing output matches configured rules
- [x] AI output is constrained to wording fields only
- [x] If confidence low or missing inputs, output range or flag site visit recommended

## Implementation notes
- Single AI provider simplifies error handling and cost tracking
- Prompt strategy: structured JSON output for signals, markdown for wording
- Keep prompts version-controlled in code

## Completed
- 2026-01-25: AI signals and rules engine implementation complete
  - Created Gemini 1.5 Flash client (`apps/worker/src/ai/gemini.ts`):
    - Text and vision generation support
    - JSON response parsing with markdown handling
    - Error handling for safety filters and API errors
  - Created signal extraction module (`apps/worker/src/ai/signals.ts`):
    - Extracts structured signals from images (materials, dimensions, condition, complexity, access)
    - Confidence scoring and site visit recommendations
    - Prompts version-controlled in code
  - Created rules engine (`apps/worker/src/pricing/rules-engine.ts`):
    - Deterministic pricing from tenant rules (base fee, addons, multipliers)
    - Signal-based adjustments (complexity, access difficulty)
    - Form answer validation against multiplier rules
    - Tax calculation support
    - Price range output when confidence is low
  - Created wording generator (`apps/worker/src/ai/wording.ts`):
    - Generates scope summary, assumptions, exclusions, notes
    - Fallback wording when AI unavailable
    - AI constrained to wording only (no pricing decisions)
  - Created quote processor (`apps/worker/src/quote-processor.ts`):
    - Orchestrates the full pipeline: load data -> extract signals -> calculate pricing -> generate wording
    - R2 image fetching and base64 conversion
    - Stores signals metadata in content_json for reference
  - Updated worker to use new quote processor
  - All pricing is deterministic from rules - AI only provides signals and wording
