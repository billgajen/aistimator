/**
 * "Describe your pricing": a business's own words compiled into the pricing
 * configuration (T-104, AD-021/AD-024). Moved here from the route (T-204) so
 * that the route, the unit tests and the live check all run the same code.
 *
 * The AI writes the configuration ONCE, at compile time. Everything after its
 * answer is code:
 *   - the same normalising every other draft path uses (../app/api/services/ai-draft/shared);
 *   - T-204: `linkPricing` ties the links the AI left loose where there is
 *     exactly one right answer (a conditional line to its question, "each
 *     additional" to the answer minus one, an optional number to "empty = 0");
 *   - T-204: `pricingChecks` flags what is still loose, for the business to
 *     see on the review: a question that changes no price line, and a line
 *     whose words say it depends on something but which nothing decides.
 *
 * Where the description is ambiguous the AI must ASK (ambiguities[]), never
 * invent a number.
 */
import type { ServiceDraftConfig, AddonConfig, MultiplierConfig, PricingFlag, LinkRepair } from '@qolumns/shared'
import { linkPricing, pricingChecks } from '@qolumns/shared'
import { validateAndNormalizeDraftBulk, carryOverSignalSpecs, parseGeminiJson, normalizeWorkSteps, normalizeSuggestedFields } from '../app/api/services/ai-draft/shared'
import { COMPILE_KEEPS, leftOutOf } from './pricing-left-out'

export const COMPILE_SYSTEM_PROMPT = `You are an expert pricing engineer. A business owner describes how they charge for a service in plain language (typed text, or pasted from a price list). You compile that description into a structured pricing configuration that a deterministic rules engine executes.

CORE RULES:
1. NEVER invent prices, rates, thresholds, or percentages that the owner did not state. If a number is missing or unclear, omit that item from the config and add a specific question to "ambiguities".
1b. EVERY instruction in the description MUST be either applied or asked about — NEVER silently ignored. When the owner refers to an existing charge colloquially ("the room rate", "my hourly rate", "the per-metre price", "the call-out fee"), map it to the closest matching item in currentConfig by unit and meaning (e.g. "room rate" → the per-room work step; "call-out fee" → baseFee) and apply the change to it. If no confident match exists, add an ambiguity naming the options: "By 'room rate' did you mean 'Walls & ceilings' (£200/room)?"
2. Every chargeable item in the description becomes a work step:
   - Flat charges → costType "fixed" with defaultCost
   - Rates ("£12 per sqm", "$50/hour") → costType "per_unit" (or "per_hour") with defaultCost = the rate and a clear unitLabel
3. QUANTITY SOURCES for per-unit steps — choose by WHO can know the quantity:
   a. PHOTO-MEASURABLE quantities (physical dimensions and visible counts: wall/lawn/patio areas, fence/ridge lengths, window/slate/room counts, tree height class): use { "type": "ai_signal", "signalKey": "<key>" } so the measurement engine measures them from the customer's photos. REQUIRED companions:
      - a matching expectedSignals entry: { "signalKey": "<key>", "type": "number", "unit": "<the step's billing unit: sqm, sqft, m, ft…>", "description": "<the EXACT scope being charged, in the owner's own words plus what the job covers (e.g. 'total exterior wall area TO BE PAINTED in square metres — every surface the job covers'), then a scale hint (a door or window)>" }
        The description is the measurer's ONLY definition of scope: name what is being charged for, never just a material, or the measurer may exclude surfaces the job covers.
      - an OPTIONAL number field in suggestedFields with fieldId EQUAL to the signalKey (required: false, criticalForPricing: false, label ending "— if you know it"): a customer-stated value always overrides the measurement (AD-002)
      - media.minPhotos at least 1, and photoGuidance telling the customer exactly what to photograph for the measurement
   b. CUSTOMER-KNOWLEDGE quantities (guests, transactions, distances, dates, payslips, hours — nothing a photo can show): form_field (required, criticalForPricing: true) via { "type": "form_field", "fieldId": "<fieldId>" }
   c. derived (for ANY quantity computed from other answers or signals — tiers, thresholds, ratios): { "type": "derived", "formula": "<expression>" }. The formula references fieldIds/signalKeys and supports + - * / ( ) and ceil, floor, round, abs, min, max. ALWAYS use derived instead of asking the customer to do arithmetic. Examples:
      - "£150 per extra 500 transactions after the first 1,000" → ask total transactions once, step quantity: "ceil(max(0, num_transactions - 1000) / 500)"
      - "£2.10 per mile beyond 25 miles" → ask total miles, quantity: "max(0, total_distance_miles - 25)"
      - "one waiter per 15 guests" → quantity: "ceil((num_adult_guests + num_child_guests) / 15)"
      - tiered rates ("first 10 at £45, then £30") → ask ONE total field; first-tier step quantity "min(num_slates, 10)", second-tier step quantity "max(0, num_slates - 10)"
   d. constant for fixed quantities
3b. PERCENTAGE CHARGES ("10% service charge on food"): a work step with costType "percent", defaultCost = the percentage number, and "percentOf" = an array of the work-step ids it applies to (or "subtotal" for everything so far). Never ask the customer for a percentage amount.
3c. ORDER-VALUE RULES ("10% discount on jobs over £5,000"): a multiplier with { "when": { "subject": "subtotal", "operator": "gt", "value": 5000 }, "multiplier": 0.9 }. No customer question needed.
4. Conditional charges ("add X when Y", "extra for Z") — pick by what decides the condition and what it does:
   - FIXED charge decided by a customer answer ("SUV or 7-seater £95 instead of £70" → base £70 step + £25 surcharge step; "weekend +£20"; "£420 if it's a baby grand"): a work step with "when": { "fieldId": "<fieldId>", "operator": "equals", "equals": "<value>" }. The equals value MUST exactly match one of that field's options (or true/false for a boolean field). Create the customer question in suggestedFields if it doesn't exist.
   - PERCENTAGE adjustment decided by a customer answer: a multiplier { "when": { "fieldId": "<fieldId>", "operator": "equals|gt|gte|lt|lte", "equals": <value> }, "multiplier": <number> } ("add 20%" → 1.2, "10% discount" → 0.9).
   - Condition detected from PHOTOS/AI: an optional work step with triggerSignal + a COMPLETE triggerCondition (operator AND value) and a matching expectedSignals entry.
   NEVER emit a triggerCondition or "when" without both an operator and a comparison value, and never an optional step with no when/triggerSignal/quantitySource — such steps are silently dropped by the pricing engine and the charge is lost.
4g. LINK EVERY CONDITION TO ITS QUESTION (the most common failure — check each line before you answer):
   - A charge the owner makes conditional on something the CUSTOMER knows ("add $45 if the unit is in an attic", "weekend visits add $60", "only for gas units") is ALWAYS a work step with "when" bound to a question in suggestedFields. It is NEVER an add-on, and NEVER a step without "when": an unlinked step is charged to every customer.
   - A yes/no condition → a "boolean" question, "when": { "fieldId": ..., "operator": "equals", "equals": true }. A place, type or size → a "dropdown" question whose options include the owner's word, and "equals" set to that exact option.
   - "EACH ADDITIONAL" ("$129 for the first system and $89 for each additional system"): ask ONE required number question for the TOTAL count. First: a per_unit step at the first price with quantity { "type": "derived", "formula": "min(<count>, 1)" }. Additional: a per_unit step at the additional price with quantity { "type": "derived", "formula": "max(0, <count> - 1)" }. Never ask the customer for "the number of additional ones", and never give the additional step the plain count.
   - "ONLY IF NEEDED" / optional per-unit amounts ("refrigerant $95 per pound, only if needed"): an OPTIONAL number question (required: false, criticalForPricing: false) and quantitySource { "type": "form_field", "fieldId": ..., "missingMeansZero": true }. Left empty means 0, never 1.
   - Every question you create must change the price: a line's "when", a quantity, a formula or a multiplier reads it. Do not add questions the description gives no price for.
4b. PACKAGE / BLOCK pricing ("single session £48, block of 10 £430, block of 20 £780"): create ONE required choice field (dropdown) for the package, and one "when"-bound FIXED step per package option, each carrying that package's full price. NEVER emit a single £0 step because you could not pick one number — a mandatory £0 step blocks the whole quote. This applies to EVERY mutually-exclusive choice (online vs in-home, small vs large, standard vs premium): each alternative step MUST have "when" bound to the SAME choice field — two alternative steps without "when" conditions get BOTH charged to the customer.
4c. CATALOGUE / PRICE-LIST items (a menu of item types: "dining chair £45, armchair £420, sofa £680"; room types; surface types): one per_unit step PER ITEM with quantitySource { "type": "form_field", "fieldId": "num_<item>", "missingMeansZero": true } and an OPTIONAL (required: false) number field per item. missingMeansZero means an unanswered item is simply not requested — its line is dropped. NEVER model catalogue items as unconditional fixed steps: that prices the ENTIRE catalogue for every customer.
4d. FROM-PRICES and STATED RANGES ("armchair from £420", "typically £6,500 to £9,000", "£40 to £120 depending on severity"): defaultCost = the stated from/low figure, plus "costBand": { "low": <stated low>, "high": <stated high> } using ONLY the owner's stated figures (for a bare from-price with no upper figure, omit costBand and add an ambiguity asking for the typical upper end). The band widens the customer's estimate range honestly.
4e. CREDITS / DEDUCTIONS ("we reduce the price by our resale estimate", trade-ins): costType "credit" with defaultCost = the deduction amount (positive number) — it is subtracted and shown as a negative line. If the amount is inherently assessed on the day, make it an ambiguity, not a guessed credit.
4f. CONTINGENCY PENALTIES ("£60 wasted journey fee if prohibited items are found", "extra if the lock must be drilled"): these depend on something DISCOVERED at the job, so they are NOT quotable lines — put them in scope.excluded or assumptions wording. NEVER price a penalty because the customer merely mentioned the triggering item.
5. Optional extras the CUSTOMER chooses ("rush service +£50") become addons: { "label": ..., "price": ... }. Add triggerKeywords only for phrases a customer would plausibly type.
6. "Minimum charge", "minimum job", "call-out fee": call-out/base fees → baseFee; minimum totals → minimumCharge.
7. Field IDs: short snake_case (e.g. "wall_area_sqm"). Signal keys likewise. Keep IDs stable if currentConfig already defines matching items.
8. Preserve anything in currentConfig that the description doesn't contradict — this may be a partial edit, not a rewrite.
9. suggestedFields must contain every field referenced by a quantitySource or multiplier. expectedSignals must contain every signal referenced by a triggerSignal or ai_signal quantity source.

Return ONLY JSON, exactly in the shape below. Work steps live at updatedConfig.pricing.workSteps (NOT at the top of updatedConfig), each with "name" (not "label"). The "instructions" array comes FIRST and MUST contain one entry
per distinct instruction in the owner's description — this is your accounting: every
instruction is either applied (say exactly where) or asked about in "ambiguities".
An instruction that appears in neither place is a failure.
{
  "instructions": [
    { "instruction": "quoted from the description", "action": "applied", "target": "which config item changed and to what" },
    { "instruction": "...", "action": "ambiguous", "target": "why — with the matching question in ambiguities" }
  ],
  "updatedConfig": {
    "scope": { "included": ["..."], "excluded": ["..."], "assumptions": ["..."] },
    "media": { "minPhotos": 1, "maxPhotos": 8, "photoGuidance": "..." },
    "pricing": {
      "pricingModel": "fixed|per_unit|tiered|inspection_first",
      "baseFee": 0,
      "minimumCharge": 0,
      "workSteps": [
        { "id": "snake_case_id", "name": "...", "costType": "fixed|per_unit|per_hour", "defaultCost": 0, "unitLabel": "sqm", "optional": false, "quantitySource": { "type": "form_field", "fieldId": "..." } },
        { "id": "measured_example", "name": "Exterior painting", "costType": "per_unit", "defaultCost": 28, "unitLabel": "sqm", "optional": false, "quantitySource": { "type": "ai_signal", "signalKey": "masonry_area_sqm" } },
        { "id": "derived_example", "name": "...", "costType": "per_unit", "defaultCost": 0, "unitLabel": "...", "optional": false, "quantitySource": { "type": "derived", "formula": "ceil(max(0, some_field - 1000) / 500)" } },
        { "id": "conditional_example", "name": "SUV surcharge", "costType": "fixed", "defaultCost": 25, "optional": true, "when": { "fieldId": "vehicle_type", "operator": "equals", "equals": "suv_or_7_seater" } },
        { "id": "catalogue_example", "name": "Armchair reupholstery", "costType": "per_unit", "defaultCost": 420, "unitLabel": "armchair", "optional": false, "quantitySource": { "type": "form_field", "fieldId": "num_armchairs", "missingMeansZero": true }, "costBand": { "low": 420, "high": 600 } },
        { "id": "credit_example", "name": "Resale value credit", "costType": "credit", "defaultCost": 100, "optional": true, "when": { "fieldId": "has_resaleable_items", "operator": "equals", "equals": true } },
        { "id": "percent_example", "name": "Service charge", "costType": "percent", "defaultCost": 10, "optional": false, "percentOf": ["step_id_1", "step_id_2"] }
      ]
    },
    "expectedSignals": [ { "signalKey": "...", "type": "number|enum|boolean|string", "description": "..." } ],
    "suggestedFields": [ { "fieldId": "...", "label": "...", "type": "number|text|dropdown|radio|boolean", "required": true, "criticalForPricing": true, "options": ["only for dropdown/radio"] } ]
  },
  "addons": [ { "label": "...", "price": 0, "triggerKeywords": ["..."] } ],
  "multipliers": [ { "when": { "fieldId": "...", "operator": "equals", "equals": "..." }, "multiplier": 1.2 }, { "when": { "subject": "subtotal", "operator": "gt", "value": 5000 }, "multiplier": 0.9 } ],
  "ambiguities": [ "Specific question about missing/unclear information" ]
}`

export interface CompileRequest {
  description: string
  serviceName?: string
  serviceDescription?: string
  currentConfig?: Partial<ServiceDraftConfig>
  currentAddons?: AddonConfig[]
  currentMultipliers?: MultiplierConfig[]
  currency?: string
}

export interface CompileAIResponse {
  /** Per-instruction accounting — forces the model to handle every instruction */
  instructions?: Array<{ instruction?: string; action?: string; target?: string }>
  updatedConfig?: Partial<ServiceDraftConfig>
  addons?: Array<{ label?: string; price?: number; triggerKeywords?: string[] }>
  multipliers?: Array<{
    when?: { subject?: string; fieldId?: string; operator?: string; equals?: string | number | boolean; value?: string | number }
    multiplier?: number
  }>
  ambiguities?: string[]
}

/** T-201: every add-on the compiler wrote that is usable, before the limit (so what is cut can be named) */
function usableAddons(addons: CompileAIResponse['addons']): NonNullable<CompileAIResponse['addons']> {
  return (addons || []).filter((a) => a.label && a.label.trim().length > 0 && typeof a.price === 'number' && a.price >= 0)
}

function normalizeAddons(addons: CompileAIResponse['addons']): AddonConfig[] {
  return usableAddons(addons)
    .slice(0, COMPILE_KEEPS.addons)
    .map((a, index) => ({
      id: `addon_${Date.now()}_${index}`,
      label: a.label!.trim(),
      price: a.price!,
      triggerKeywords: a.triggerKeywords?.filter((k) => k && k.trim().length > 0).slice(0, 6),
    }))
}

/** T-201: every adjustment the compiler wrote that is usable, before the limit */
function usableMultipliers(multipliers: CompileAIResponse['multipliers']): NonNullable<CompileAIResponse['multipliers']> {
  return (multipliers || []).filter(
    (m) =>
      // T-125: subtotal-conditioned multipliers need no fieldId
      (m.when?.fieldId || m.when?.subject === 'subtotal') &&
      typeof m.multiplier === 'number' &&
      m.multiplier > 0 &&
      m.multiplier < 10
  )
}

function normalizeMultipliers(multipliers: CompileAIResponse['multipliers']): MultiplierConfig[] {
  const validOps = ['equals', 'contains', 'gt', 'lt', 'gte', 'lte']
  return usableMultipliers(multipliers)
    .slice(0, COMPILE_KEEPS.adjustments)
    .map((m) => ({
      when: {
        subject: m.when!.subject === 'subtotal' ? ('subtotal' as const) : undefined,
        fieldId: m.when!.fieldId,
        operator: validOps.includes(m.when!.operator || '') ? m.when!.operator : m.when!.subject === 'subtotal' ? 'gt' : 'equals',
        equals: m.when!.equals,
        value: m.when!.value,
      },
      multiplier: m.multiplier!,
    }))
}

/** The words sent with the system prompt: the region's conventions, the service, its current configuration, the owner's text */
export function compileUserPrompt(body: CompileRequest, regionBlock: string): string {
  const contextParts: string[] = []
  contextParts.push(
    `${regionBlock}
- Keep the OWNER'S billing unit exactly as stated: "$2.50/sqft" → unitLabel "sqft"; "per linear foot" → unitLabel "linear_ft" (measured signal unit "ft"); "per sqm" → unitLabel "sqm". Never convert the owner's rates between units.
- Name measured signal keys after their unit (e.g. wall_area_sqft, fence_length_ft) and set the expectedSignals "unit" to match the step's unit.
- Write customer-facing text (labels, scope, photo guidance) in the region's language variant and units.`
  )
  if (body.serviceName) {
    contextParts.push(`Service: ${body.serviceName}`)
  }
  if (body.serviceDescription) {
    contextParts.push(`Service description: ${body.serviceDescription}`)
  }
  if (body.currentConfig) {
    // Keys deliberately distinct from the response schema — verification found
    // Gemini mirrors this wrapper shape into updatedConfig when they match
    contextParts.push(
      `Current configuration (preserve anything not contradicted):\n\`\`\`json\n${JSON.stringify(
        {
          currentDraftConfig: body.currentConfig,
          currentAddons: body.currentAddons || [],
          currentMultipliers: body.currentMultipliers || [],
        },
        null,
        2
      )}\n\`\`\``
    )
  }

  return `${contextParts.join('\n')}

The business owner describes their pricing:
"""
${body.description}
"""

Compile this into the pricing configuration. Remember: never invent numbers — ask via "ambiguities" instead.`
}

export interface CompileResult {
  updatedConfig: ServiceDraftConfig
  leftOut?: ReturnType<typeof leftOutOf>
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
  ambiguities: string[]
  /** T-204: what the code tied after the AI's answer, in words */
  linked: LinkRepair[]
  /** T-204: what is still loose. Shown on the review; never blocks applying or saving. */
  flags: PricingFlag[]
}

/** Everything after the AI's answer: parse it, normalise it, tie the loose links, flag the rest. Pure. */
export function finishCompile(responseText: string, body: CompileRequest): CompileResult {
  const result = parseGeminiJson<CompileAIResponse>(responseText)

  // Defensive unwrap (verification finding): despite the schema, Gemini may nest
  // the draft under updatedConfig.config (mirroring the context wrapper) and/or
  // place addons/multipliers inside updatedConfig instead of at the top level.
  const rawUpdated = result.updatedConfig as
    | (Partial<ServiceDraftConfig> & {
        config?: Partial<ServiceDraftConfig>
        addons?: CompileAIResponse['addons']
        multipliers?: CompileAIResponse['multipliers']
      })
    | undefined
  const updatedDraft = rawUpdated?.config ?? rawUpdated
  const responseAddons = result.addons?.length ? result.addons : rawUpdated?.addons
  const responseMultipliers = result.multipliers?.length ? result.multipliers : rawUpdated?.multipliers

  // Shape-drift tolerance (hardcore-test finding, 2026-07-20): the model
  // sometimes emits workSteps at the draft root instead of under pricing —
  // which used to silently discard the ENTIRE compilation.
  if (updatedDraft) {
    const rootSteps = (updatedDraft as { workSteps?: unknown[] }).workSteps
    if (Array.isArray(rootSteps) && rootSteps.length && !updatedDraft.pricing?.workSteps?.length) {
      updatedDraft.pricing = {
        ...(updatedDraft.pricing ?? {}),
        workSteps: rootSteps,
      } as ServiceDraftConfig['pricing']
    }
  }

  // Normalize through the same pipeline every other AI-draft path uses.
  // Start from currentConfig so scope/media survive when the AI omits them.
  const merged: Partial<ServiceDraftConfig> = {
    ...body.currentConfig,
    ...updatedDraft,
  }
  // Bulk limits (10 steps/fields) — pasted price lists often have many lines
  const normalized = validateAndNormalizeDraftBulk(merged)

  // T-204: tie what the AI left loose, then flag what is still loose
  const multipliers = normalizeMultipliers(responseMultipliers)
  const { workSteps, repairs } = linkPricing(normalized.pricing.workSteps, normalized.suggestedFields)
  const updatedConfig: ServiceDraftConfig = {
    ...normalized,
    pricing: { ...normalized.pricing, workSteps },
    expectedSignals: carryOverSignalSpecs(body.currentConfig?.expectedSignals, normalized.expectedSignals),
  }
  const flags = pricingChecks({ workSteps, fields: normalized.suggestedFields, multipliers })

  // T-201: a service keeps ten lines and ten questions. What the compiler wrote past that is named
  // in the result, so the review can say what was left out (the limits themselves are unchanged).
  const leftOut = leftOutOf({
    lines: normalizeWorkSteps(merged.pricing?.workSteps || []).map((s) => s.name),
    questions: normalizeSuggestedFields(merged.suggestedFields || []).map((f) => f.label),
    addons: usableAddons(responseAddons).map((a) => a.label!.trim()),
    adjustments: usableMultipliers(responseMultipliers).length,
  })

  return {
    updatedConfig,
    ...(leftOut && { leftOut }),
    addons: normalizeAddons(responseAddons),
    multipliers,
    ambiguities: (result.ambiguities || []).filter((a) => a && a.trim().length > 0).slice(0, 8),
    linked: repairs,
    flags,
  }
}
