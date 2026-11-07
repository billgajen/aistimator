/**
 * Vertical pack types (T-113, AD-022).
 *
 * A pack is pure DATA: a bundle of service templates (scope, media guidance,
 * guided-capture angles, default rates, expected signals, customer questions)
 * for one vertical. Packs are applied at onboarding as pre-filled, fully
 * editable configuration — the engine stays generic, and nothing in a pack is
 * hardcoded into pricing or AI logic (anti-hardcoding principle holds:
 * templates are content, not code).
 *
 * Rates in packs are EDITABLE DEFAULTS ("typical" numbers the business must
 * review), never authoritative pricing.
 */

import type { ServiceDraftConfig, AddonConfig, MultiplierConfig, RegionCode } from '@estimator/shared'

export interface VerticalPackService {
  name: string
  description: string
  /** Complete draft config: scope, media (incl. requiredAngles), pricing defaults, signals, fields */
  draft: ServiceDraftConfig
  /** Optional extras with default prices */
  addons?: AddonConfig[]
  /** Conditional price adjustments keyed to the pack's suggestedFields */
  multipliers?: MultiplierConfig[]
  /** Vertical-specific AI vision guidance (stored as the service's prompt_context) */
  promptContext?: string
}

export interface VerticalPack {
  /** Stable identifier, e.g. 'painting-decorating' */
  id: string
  /** Display name, e.g. 'Painting & Decorating' */
  name: string
  /** One-line pitch shown in the pack picker */
  description: string
  /** Emoji shown in the picker */
  icon: string
  /** Currency the default rates were authored in (display hint only — rates are editable) */
  rateCurrency: string
  /** T-133: market the pack's units, rates and wording were written for */
  region: RegionCode
  services: VerticalPackService[]
}
