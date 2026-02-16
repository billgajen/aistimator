/**
 * A/B Test Framework for Widget Mode
 *
 * Determines which widget variant to show:
 * - 'form': Traditional multi-step form (default, existing)
 * - 'conversational': Chat-based interface
 * - 'ab-test': 50/50 sticky assignment via localStorage
 */

import type { WidgetDisplayMode } from './types'

const AB_TEST_STORAGE_KEY = 'estimator_widget_mode'

/**
 * Get the resolved widget mode.
 *
 * For 'form' and 'conversational', returns the mode directly.
 * For 'ab-test', assigns a sticky variant using localStorage.
 */
export function getWidgetMode(configMode: WidgetDisplayMode | undefined): 'form' | 'conversational' {
  const mode = configMode || 'form'

  if (mode === 'form') return 'form'
  if (mode === 'conversational') return 'conversational'

  // A/B test: sticky assignment
  return getOrAssignVariant()
}

/**
 * Get existing assignment or create a new one.
 * 50/50 split, persisted in localStorage for sticky behavior.
 */
function getOrAssignVariant(): 'form' | 'conversational' {
  try {
    const stored = localStorage.getItem(AB_TEST_STORAGE_KEY)
    if (stored === 'form' || stored === 'conversational') {
      return stored
    }

    // New assignment: 50/50 split
    const variant: 'form' | 'conversational' = Math.random() < 0.5 ? 'form' : 'conversational'
    localStorage.setItem(AB_TEST_STORAGE_KEY, variant)
    return variant
  } catch {
    // localStorage not available (private browsing, etc.) — default to form
    return 'form'
  }
}

/**
 * Get the current A/B test assignment without creating a new one.
 * Returns null if no assignment exists.
 */
export function getCurrentAssignment(): 'form' | 'conversational' | null {
  try {
    const stored = localStorage.getItem(AB_TEST_STORAGE_KEY)
    if (stored === 'form' || stored === 'conversational') {
      return stored
    }
    return null
  } catch {
    return null
  }
}
