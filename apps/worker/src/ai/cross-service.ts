/**
 * Cross-Service AI Extraction
 *
 * Uses AI to extract relevant pricing signals for cross-services
 * mentioned in the customer's description.
 */

import type { GeminiClient } from './gemini'

/**
 * Extracted estimate details for a cross-service
 */
export interface CrossServiceEstimate {
  serviceName: string
  estimatedQuantity: number | null
  quantityUnit: string | null
  extractedDetails: string[]
  confidence: number
}

/**
 * Prompt for extracting cross-service details
 */
const CROSS_SERVICE_PROMPT = `You are analyzing a quote request where the customer mentioned an additional service.

Main service requested: {{MAIN_SERVICE}}
Additional service mentioned: {{CROSS_SERVICE}}

Customer's full description:
{{DESCRIPTION}}

Extract relevant details for the "{{CROSS_SERVICE}}" service:
1. Estimated quantity/size if mentioned (e.g., "2 walls", "50 sqm", "whole house exterior")
2. Any specific requirements mentioned for this service
3. Condition details if relevant

Return JSON only, no explanation:
{
  "estimatedQuantity": number or null,
  "quantityUnit": "sqm" | "sqft" | "walls" | "rooms" | "items" | "hours" | null,
  "extractedDetails": ["detail1", "detail2"],
  "confidence": 0.0-1.0
}

Guidelines:
- Only extract details specifically relevant to "{{CROSS_SERVICE}}"
- If quantity is mentioned as "whole house" or similar, estimate based on typical sizes
- confidence should be 0.9+ if details are explicitly stated, 0.5-0.8 if inferred, below 0.5 if mostly guessing
- extractedDetails should be short phrases describing the work mentioned
- If no relevant details are found, return empty extractedDetails and low confidence`

/**
 * Extract relevant details for a cross-service from the customer's description
 */
export async function extractCrossServiceDetails(
  client: GeminiClient,
  mainServiceName: string,
  crossServiceName: string,
  description: string
): Promise<CrossServiceEstimate> {
  // Build the prompt with context
  const prompt = CROSS_SERVICE_PROMPT
    .replace(/{{MAIN_SERVICE}}/g, mainServiceName)
    .replace(/{{CROSS_SERVICE}}/g, crossServiceName)
    .replace(/{{DESCRIPTION}}/g, description)

  try {
    const response = await client.generateText(prompt)

    // Parse the JSON response
    const parsed = parseExtractedDetails(response, crossServiceName)
    return parsed
  } catch (error) {
    console.error(`[CrossService] Failed to extract details for ${crossServiceName}:`, error)

    // Return low-confidence fallback
    return {
      serviceName: crossServiceName,
      estimatedQuantity: null,
      quantityUnit: null,
      extractedDetails: [],
      confidence: 0.3,
    }
  }
}

/**
 * Parse the AI response into structured data
 */
function parseExtractedDetails(response: string, serviceName: string): CrossServiceEstimate {
  try {
    // Remove markdown code blocks if present
    let cleaned = response.trim()
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7)
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3)
    }
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned) as {
      estimatedQuantity?: number | null
      quantityUnit?: string | null
      extractedDetails?: string[]
      confidence?: number
    }

    return {
      serviceName,
      estimatedQuantity: parsed.estimatedQuantity ?? null,
      quantityUnit: parsed.quantityUnit ?? null,
      extractedDetails: Array.isArray(parsed.extractedDetails) ? parsed.extractedDetails : [],
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    }
  } catch {
    // Return fallback if parsing fails
    return {
      serviceName,
      estimatedQuantity: null,
      quantityUnit: null,
      extractedDetails: [],
      confidence: 0.3,
    }
  }
}
