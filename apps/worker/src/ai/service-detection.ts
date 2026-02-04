/**
 * AI-Powered Cross-Service Detection
 *
 * Uses Gemini to intelligently detect mentions of other services in customer descriptions.
 * More accurate than keyword matching - understands phrases like:
 * - "paint the walls" → Painting service
 * - "also need the fence fixed" → Fence Repair
 * - "clean the gutters too" → Gutter Cleaning
 *
 * Validation layers:
 * - AD-008: Phrase verification (matchedPhrase must exist in source)
 * - AD-010: Service name must contain request keywords
 * - AD-014: Location context must not conflict (e.g., bathroom vs roof)
 */

import { GeminiClient } from './gemini'

// ============================================================================
// AD-014: LOCATION CONTEXT CONFLICT DETECTION
// ============================================================================

/**
 * Location context categories for conflict detection.
 * Each category groups semantically equivalent location/context words.
 * This is a generic mapping that applies universally - not hardcoded to specific services.
 */
const LOCATION_CONTEXTS: Record<string, string[]> = {
  // Indoor room types
  bathroom: ['bathroom', 'shower', 'bath', 'tub', 'toilet', 'sink', 'vanity', 'en-suite', 'ensuite', 'wetroom', 'wet room'],
  kitchen: ['kitchen', 'cooker', 'oven', 'dishwasher', 'fridge', 'hob', 'extractor', 'splashback'],
  bedroom: ['bedroom', 'wardrobe', 'closet'],
  living: ['living room', 'lounge', 'sitting room', 'den'],

  // Structural locations
  roof: ['roof', 'rooftop', 'attic', 'loft', 'chimney', 'gutter', 'fascia', 'soffit', 'tiles', 'slates', 'flashing'],
  basement: ['basement', 'cellar', 'foundation'],
  garage: ['garage', 'carport', 'driveway'],

  // Outdoor
  garden: ['garden', 'yard', 'lawn', 'patio', 'deck', 'fence', 'shed', 'greenhouse', 'landscaping'],
  exterior: ['exterior', 'outside', 'outdoor', 'external', 'facade', 'render', 'cladding'],

  // Systems
  plumbing: ['plumbing', 'pipe', 'drain', 'seal', 'tap', 'faucet', 'water heater', 'boiler', 'cistern', 'overflow', 'waste'],
  electrical: ['electrical', 'wiring', 'socket', 'switch', 'fuse', 'circuit', 'lighting'],
  heating: ['heating', 'radiator', 'thermostat', 'hvac', 'air conditioning', 'ductwork'],

  // Vehicle
  vehicle: ['car', 'vehicle', 'automotive', 'garage door', 'carport'],

  // Commercial
  commercial: ['office', 'commercial', 'industrial', 'warehouse', 'retail', 'shop'],
}

/**
 * Detect if there's a location context conflict between the customer's phrase
 * and the suggested service name.
 *
 * For example:
 * - Phrase: "leak around the shower or bath seal" → contexts: bathroom, plumbing
 * - Service: "Roof Leak Repair" → contexts: roof
 * - Result: CONFLICT (bathroom/plumbing doesn't overlap with roof)
 *
 * This prevents recommending "Roof Leak Repair" when the customer is clearly
 * talking about a bathroom leak.
 */
function detectLocationContextConflict(
  matchedPhrase: string,
  serviceName: string
): { hasConflict: boolean; phraseContext?: string; serviceContext?: string } {
  const phraseLower = matchedPhrase.toLowerCase()
  const serviceNameLower = serviceName.toLowerCase()

  // Find which context(s) the phrase matches
  const phraseContexts: string[] = []
  for (const [context, keywords] of Object.entries(LOCATION_CONTEXTS)) {
    if (keywords.some(kw => phraseLower.includes(kw))) {
      phraseContexts.push(context)
    }
  }

  // Find which context(s) the service name matches
  const serviceContexts: string[] = []
  for (const [context, keywords] of Object.entries(LOCATION_CONTEXTS)) {
    if (keywords.some(kw => serviceNameLower.includes(kw))) {
      serviceContexts.push(context)
    }
  }

  // If both have specific contexts and they don't overlap → conflict
  // We need BOTH to have at least one context for this check to apply
  if (phraseContexts.length > 0 && serviceContexts.length > 0) {
    const overlaps = phraseContexts.some(pc => serviceContexts.includes(pc))
    if (!overlaps) {
      return {
        hasConflict: true,
        phraseContext: phraseContexts[0],
        serviceContext: serviceContexts[0],
      }
    }
  }

  return { hasConflict: false }
}

/**
 * Service available for matching
 */
export interface ServiceForMatching {
  id: string
  name: string
  description?: string
  detection_keywords?: string[]
}

/**
 * Result of AI service detection
 */
export interface DetectedServiceResult {
  serviceId: string
  serviceName: string
  confidence: number
  reason: string
  matchedPhrase: string
}

/**
 * Detect services mentioned in customer description using AI
 *
 * This intelligently matches phrases to services, even when the customer
 * doesn't use exact service names. For example:
 * - "I also want the walls painted" → matches "Painting" service
 * - "can you fix the broken fence too" → matches "Fence Repair" service
 */
export async function detectServicesFromDescription(
  client: GeminiClient,
  primaryServiceName: string,
  description: string,
  availableServices: ServiceForMatching[]
): Promise<DetectedServiceResult[]> {
  if (!description || description.trim().length < 10 || availableServices.length === 0) {
    return []
  }

  // Build the service list for the prompt
  const serviceList = availableServices
    .map((s, i) => {
      let line = `${i + 1}. ID: "${s.id}" - ${s.name}`
      if (s.description) {
        line += ` (${s.description})`
      }
      if (s.detection_keywords && s.detection_keywords.length > 0) {
        line += ` [Keywords: ${s.detection_keywords.join(', ')}]`
      }
      return line
    })
    .join('\n')

  const prompt = `You are analyzing a customer's project description to identify if they mentioned any OTHER services beyond their main request.

Main service requested: ${primaryServiceName}

Customer's description:
"${description}"

Available services from this business (excluding the main service):
${serviceList}

TASK: Identify any services from the list above that the customer is EXPLICITLY REQUESTING as SEPARATE, ADDITIONAL work.

===== BUSINESS VS RESIDENTIAL CONTEXT (CRITICAL) =====
You MUST match the context of cross-service recommendations to the primary service:

BUSINESS/COMMERCIAL services include keywords like:
- IT, Server, Network, Infrastructure, Audit, Compliance, Enterprise
- Office, Commercial, Business, Corporate, Industrial
- B2B, Professional services, Consulting

RESIDENTIAL/CONSUMER services include keywords like:
- Home, House, Residential, Personal, Family
- Smart Home, Home Security, Home Cleaning
- Consumer, Domestic

RULE: If the primary service is BUSINESS/COMMERCIAL:
- Do NOT recommend residential/consumer services (Smart Home, Home Cleaning, etc.)
- Only recommend other business/commercial services

RULE: If the primary service is RESIDENTIAL/CONSUMER:
- Do NOT recommend business/commercial services (IT Audit, Office Cleaning, etc.)
- Only recommend other residential/consumer services

Example violations to AVOID:
- Primary: "IT Infrastructure Audit" → Do NOT recommend "Smart Home Wi-Fi Fix" (residential for business context)
- Primary: "Home Cleaning" → Do NOT recommend "Office IT Setup" (commercial for residential context)

===== CONTEXT AWARENESS (CRITICAL) =====
EVERY service has accessories, materials, and related items that are PART OF that service - NOT separate services:

For Carpet/Flooring services, these are PART OF the job (NOT other services):
- Door bars, threshold strips, transition strips, gripper rods
- Underlay, adhesive, edging
- Any mention of doors, doorways, or thresholds in carpet context

For Painting services, these are PART OF the job:
- Primer, undercoat, sealant
- Filling holes, sanding, prep work

For Window Cleaning services, these are PART OF the job:
- Frames, sills, tracks
- Interior/exterior glass

===== DETECTION CRITERIA =====
To detect a cross-service, ALL of these must be TRUE:
1. Customer uses explicit REQUEST language: "also need", "can you also", "would like you to", "while you're here", "in addition", "also want"
2. The requested work is GENUINELY DIFFERENT from the main service
3. The item mentioned is NOT an accessory/material for the main service

===== QUESTIONS VS REQUESTS =====
Questions about inclusions are NOT requests for other services:
- "Are door bars included?" → NOT a request, just a question
- "Do you provide underlay?" → NOT a request
- "Is cleaning included?" → NOT a request
- "Please confirm if X is included" → NOT a request

===== EXAMPLES - DO NOT MATCH =====
1. Main: "Carpet Fitting" + "Please confirm if door bars/threshold strips are included"
   → Do NOT match Window Cleaning - door bars are carpet accessories, NOT related to windows

2. Main: "Carpet Fitting" + "I need carpet in 4 rooms with door bars"
   → Do NOT match anything - door bars are standard carpet accessories

3. Main: "Driveway Cleaning" + "There are oil stains"
   → Do NOT match Car Service - describing the problem, not requesting car work

4. Main: "House Cleaning" + "The paint is peeling on the walls"
   → Do NOT match Painting - describing condition, not requesting painting

===== EXAMPLES - DO MATCH =====
1. "I also need you to paint the bedroom walls" → Match Painting service
2. "Can you also fix the fence while you're here?" → Match Fence Repair service
3. "Would like gutters cleaned too" → Match Gutter Cleaning service
4. "In addition to carpets, we need the windows cleaned" → Match Window Cleaning

===== OUTPUT =====
Return a JSON array. Only include services you are HIGHLY CONFIDENT (0.85+) the customer explicitly requested.
If uncertain or no clear requests, return an empty array [].

Response format:
[
  {
    "serviceId": "exact service ID from the list",
    "serviceName": "service name",
    "confidence": 0.85-1.0,
    "reason": "Why this is a genuine cross-service request (must cite the REQUEST phrase with action verb)",
    "matchedPhrase": "the exact phrase from description showing the request"
  }
]

CRITICAL ANTI-HALLUCINATION RULE (AD-008):
- The matchedPhrase MUST be an EXACT substring from the customer's text
- Do NOT paraphrase, summarize, or invent phrases
- Do NOT fabricate customer quotes that don't exist in the description
- If no exact phrase exists that requests this service, return empty array
- WRONG: "may require gutter cleaning" (if customer didn't say this)
- RIGHT: "gutters overflow on that side" (if this is actual customer text)
- The validation will verify matchedPhrase exists in the source text

Respond with ONLY the JSON array, no other text.`

  try {
    const response = await client.generateText(prompt)
    const results = GeminiClient.parseJSON<DetectedServiceResult[]>(response)

    if (!Array.isArray(results)) {
      console.log('[ServiceDetection] Invalid response format, expected array')
      return []
    }

    // Validate results (AD-008: stricter validation with phrase verification)
    const validServiceIds = new Set(availableServices.map((s) => s.id))
    const descriptionLower = description.toLowerCase()

    const validated = results.filter((r) => {
      if (!r.serviceId || !validServiceIds.has(r.serviceId)) {
        console.log(`[ServiceDetection] Skipping invalid service ID: ${r.serviceId}`)
        return false
      }

      // AD-008: Raise confidence threshold from 0.8 to 0.9 to reduce false positives
      if (typeof r.confidence !== 'number' || r.confidence < 0.9) {
        console.log(`[ServiceDetection] Skipping low confidence: ${r.serviceId} (${r.confidence})`)
        return false
      }

      // Ensure matchedPhrase exists and has meaningful content
      if (!r.matchedPhrase || r.matchedPhrase.trim().length < 5) {
        console.log(`[ServiceDetection] Skipping - no clear phrase: ${r.serviceId}`)
        return false
      }

      // AD-008: Verify phrase actually exists in source text (prevent hallucination)
      const phraseLower = r.matchedPhrase.toLowerCase().trim()
      const phraseExists = descriptionLower.includes(phraseLower)
      if (!phraseExists) {
        console.log(`[ServiceDetection] REJECTING hallucinated phrase: "${r.matchedPhrase}" not in source text for ${r.serviceId}`)
        return false
      }

      // AD-010: Verify service name is relevant to the matched phrase
      // Prevents "Window Cleaning" from matching "gutter cleaning" request
      const serviceNameLower = r.serviceName.toLowerCase()

      // Extract words from the phrase (excluding common service verbs and filler words)
      const commonWords = new Set([
        'cleaning', 'repair', 'installation', 'removal', 'painting', 'fixing', 'service',
        'also', 'need', 'want', 'some', 'the', 'a', 'an', 'my', 'our', 'your',
        'might', 'could', 'would', 'should', 'please', 'can', 'you', 'me', 'as', 'well', 'too',
        'i', 'we', 'they', 'it', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'shall', 'may',
        'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about',
        'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between'
      ])

      const phraseWords = phraseLower
        .split(/\s+/)
        .filter(w => w.length > 2 && !commonWords.has(w))

      // Find the key object words (nouns that identify what the customer wants)
      // These are words that aren't in the common list and could identify a service type
      const keyObjectWords = phraseWords.filter(word => {
        // Check if this word is a potential service identifier
        // It should NOT be a generic action word
        return word.length > 3
      })

      if (keyObjectWords.length > 0) {
        // Check if any key object word appears in the service name
        const serviceMatchesRequest = keyObjectWords.some(objectWord => {
          // Direct match: "gutter" in "Gutter Cleaning"
          if (serviceNameLower.includes(objectWord)) {
            return true
          }
          // Singular/plural handling: "gutters" matches "Gutter Cleaning"
          const singular = objectWord.replace(/s$/, '')
          const plural = objectWord + 's'
          if (serviceNameLower.includes(singular) || serviceNameLower.includes(plural)) {
            return true
          }
          return false
        })

        if (!serviceMatchesRequest) {
          console.log(`[ServiceDetection] REJECTING mismatched service: "${r.serviceName}" doesn't match request keywords [${keyObjectWords.join(', ')}] from phrase "${r.matchedPhrase}"`)
          return false
        }
      }

      // AD-014: Location context conflict detection
      // Prevents recommending "Roof Leak Repair" when customer mentions "bathroom leak"
      const contextConflict = detectLocationContextConflict(r.matchedPhrase, r.serviceName)
      if (contextConflict.hasConflict) {
        console.log(`[ServiceDetection] REJECTING context conflict (AD-014): phrase context "${contextConflict.phraseContext}" vs service context "${contextConflict.serviceContext}" for ${r.serviceId} ("${r.serviceName}")`)
        return false
      }

      return true
    })

    console.log(`[ServiceDetection] AI detected ${validated.length} services from description`)
    for (const service of validated) {
      console.log(`[ServiceDetection]   - ${service.serviceName} (conf: ${service.confidence}): "${service.matchedPhrase}"`)
    }

    return validated
  } catch (error) {
    console.error('[ServiceDetection] Failed to detect services:', error)
    return []
  }
}

