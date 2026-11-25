/**
 * T-204: how a customer's answer is compared with a price line's condition,
 * and how a typed number is read. Moved here unchanged from the worker's
 * rules engine (T-126, ISSUE-1, ISSUE-2, ISSUE-4, ISSUE-7, FIX-3), which now
 * imports it, so that anything else that shows a business how a line behaves
 * (the dashboard's checks and samples) decides it with the same code.
 *
 * Pure. Nothing here knows a trade, a service or a price.
 */

/**
 * Compare a form answer against a configured condition value (T-126: shared
 * by multiplier conditions and work-step `when` conditions).
 */
export function compareAnswerValue(
  answerValue: unknown,
  operator: string,
  compareValue: string | number | boolean | undefined
): boolean {
  const answer = { value: answerValue }
  switch (operator) {
    case 'equals':
      // Type-aware comparison to handle form data types vs config value types
      // E.g., checkbox submits true (boolean) but config may have "Yes" (string)

      // ISSUE-7 FIX: Handle array fields - check if array CONTAINS the compare value
      // This allows multipliers to work with multi-select form fields
      if (Array.isArray(answer.value) && typeof compareValue === 'string') {
        const compareValueLower = compareValue.toLowerCase()
        const hasMatch = answer.value.some(v =>
          typeof v === 'string' && v.toLowerCase() === compareValueLower
        )
        return hasMatch
      }

      // Handle boolean answer value → string compareValue
      if (typeof answer.value === 'boolean') {
        // Normalize compareValue to boolean for comparison
        const compareAsBool =
          compareValue === true ||
          compareValue === 'true' ||
          compareValue === 'True' ||
          compareValue === 'TRUE' ||
          compareValue === 'Yes' ||
          compareValue === 'yes' ||
          compareValue === 'YES' ||
          compareValue === '1' ||
          compareValue === 1
        return answer.value === compareAsBool
      }

      // Handle string answer value that represents a boolean → boolean compareValue
      // E.g., form sends "true" string but config has boolean true
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

      // Handle number answer value → string compareValue (or vice versa)
      if (typeof answer.value === 'number' || typeof compareValue === 'number') {
        const answerNum = Number(answer.value)
        const compareNum = Number(compareValue)
        // Only compare as numbers if both can be parsed as numbers
        if (!isNaN(answerNum) && !isNaN(compareNum)) {
          return answerNum === compareNum
        }
      }

      // FIX-3: Handle string comparisons with format normalization
      if (typeof answer.value === 'string' && typeof compareValue === 'string') {
        // First try case-insensitive exact match
        if (answer.value.toLowerCase() === compareValue.toLowerCase()) {
          return true
        }

        // FIX-3: Normalize common format variations (underscores, parentheses, spaces)
        const normalize = (s: string): string => s
          .toLowerCase()
          .replace(/_/g, ' ')           // underscores to spaces
          .replace(/[()<>]/g, '')       // remove brackets and comparison symbols
          .replace(/\s+/g, ' ')         // multiple spaces to single
          .trim()

        const normalizedAnswer = normalize(answer.value)
        const normalizedCompare = normalize(compareValue)

        if (normalizedAnswer === normalizedCompare) {
          return true
        }

        return false
      }

      // Fallback to strict equality
      return answer.value === compareValue
    case 'contains':
      if (typeof answer.value === 'string' && typeof compareValue === 'string') {
        return answer.value.toLowerCase().includes(compareValue.toLowerCase())
      }
      // ISSUE-4 FIX: Array contains with case-insensitive matching
      if (Array.isArray(answer.value) && typeof compareValue === 'string') {
        const compareValueLower = compareValue.toLowerCase()
        return answer.value.some(v =>
          typeof v === 'string' && v.toLowerCase() === compareValueLower
        )
      }
      return false
    // ISSUE-1 FIX: Numeric comparison operators now handle string values
    // Form inputs often come as strings (e.g., "30" instead of 30)
    case 'gt': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum > compareNum
    }
    case 'lt': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum < compareNum
    }
    case 'gte': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum >= compareNum
    }
    case 'lte': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum <= compareNum
    }
    default:
      return false
  }
}

/**
 * ISSUE-1 & ISSUE-2 FIX: Coerce a value to number with comma handling
 * Handles:
 * - Numbers (passthrough)
 * - String numbers ("30" → 30)
 * - Comma-formatted numbers ("2,400" → 2400)
 * - Empty/null/undefined → null
 */
export function coerceToNumber(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) {
    return value
  }
  if (typeof value === 'string') {
    // ISSUE-2 FIX: Strip commas from formatted numbers (e.g., "2,400" → "2400")
    const cleaned = value.replace(/,/g, '').trim()
    if (!cleaned) return null
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? null : parsed
  }
  return null
}
