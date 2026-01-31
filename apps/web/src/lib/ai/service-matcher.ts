/**
 * AI Service Matcher
 *
 * Uses Gemini to validate if a project description matches the selected service.
 * Can also suggest the best matching service from available options.
 */

interface Service {
  id: string
  name: string
}

interface MatchResult {
  isMatch: boolean
  confidence: number
  suggestedServiceId?: string
  suggestedServiceName?: string
  reason: string
}

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

/**
 * Validate if the project description matches the selected service
 */
export async function validateServiceMatch(
  projectDescription: string,
  selectedService: Service,
  availableServices: Service[],
  apiKey: string
): Promise<MatchResult> {
  if (!apiKey) {
    console.warn('[ServiceMatcher] No Gemini API key, skipping validation')
    return {
      isMatch: true,
      confidence: 0.5,
      reason: 'AI validation not available',
    }
  }

  if (!projectDescription || projectDescription.trim().length < 10) {
    // Too short to validate
    return {
      isMatch: true,
      confidence: 0.5,
      reason: 'Project description too short for validation',
    }
  }

  const serviceList = availableServices.map(s => `- ${s.name} (ID: ${s.id})`).join('\n')

  const prompt = `You are a service matching assistant. Analyze if a customer's project description matches their selected service.

AVAILABLE SERVICES:
${serviceList}

SELECTED SERVICE: ${selectedService.name}

PROJECT DESCRIPTION:
"${projectDescription}"

Analyze the project description and determine:
1. Does the description match the selected service "${selectedService.name}"?
2. If not, which available service would be the best match?
3. If no available service matches, say so.

Respond with ONLY a JSON object in this exact format:
{
  "isMatch": true/false,
  "confidence": 0.0-1.0,
  "suggestedServiceId": "service_id or null if selected is correct",
  "suggestedServiceName": "service_name or null",
  "reason": "brief explanation"
}

Be strict: If the description clearly describes a different type of work (e.g., "patio cleaning" when "Kitchen Renovation" is selected), return isMatch: false.`

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.1, // Low temperature for consistent results
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      // Check for rate limit
      if (response.status === 429) {
        console.warn('[ServiceMatcher] Rate limited, allowing submission')
        return {
          isMatch: true,
          confidence: 0.5,
          reason: 'AI validation temporarily unavailable',
        }
      }
      throw new Error(`Gemini API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // Parse JSON from response
    let result: MatchResult
    try {
      // Remove markdown code blocks if present
      let cleaned = text.trim()
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
      else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
      cleaned = cleaned.trim()

      result = JSON.parse(cleaned)
    } catch {
      console.error('[ServiceMatcher] Failed to parse response:', text)
      return {
        isMatch: true,
        confidence: 0.5,
        reason: 'Could not parse AI response',
      }
    }

    return {
      isMatch: result.isMatch ?? true,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      suggestedServiceId: result.suggestedServiceId || undefined,
      suggestedServiceName: result.suggestedServiceName || undefined,
      reason: result.reason || 'Unknown',
    }
  } catch (error) {
    console.error('[ServiceMatcher] Error:', error)
    // On error, allow the submission but log the issue
    return {
      isMatch: true,
      confidence: 0.5,
      reason: 'AI validation error, proceeding with selected service',
    }
  }
}
