/**
 * Setup's draft services (T-106/T-113) and the exact payload that creates
 * them. T-150: shared by the setup flow and its live check, so "edit a price
 * in setup → the next quote charges it" is tested on the same code path.
 */
import type { AddonConfig, MultiplierConfig, ServiceDraftConfig } from '@estimator/shared'

export interface DraftService {
  name: string
  description: string
  draft: ServiceDraftConfig
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
  selected: boolean
}

export function isUnpriced(svc: Pick<DraftService, 'draft'>): boolean {
  return svc.draft.pricing.workSteps.length === 0 && svc.draft.pricing.baseFee === 0
}

/** The POST /api/services body — the same pricing config the service editor writes (AD-001) */
export function servicePayload(svc: Omit<DraftService, 'selected'>) {
  return {
    name: svc.name,
    description: svc.description,
    documentTypeDefault: 'instant_estimate' as const,
    scopeIncludes: svc.draft.scope.included,
    scopeExcludes: svc.draft.scope.excluded,
    defaultAssumptions: svc.draft.scope.assumptions,
    mediaConfig: {
      minPhotos: svc.draft.media.minPhotos,
      maxPhotos: svc.draft.media.maxPhotos,
      photoGuidance: svc.draft.media.photoGuidance,
      // Guided-capture slots (T-107) — without this line pack/AI-draft angles were silently dropped
      requiredAngles: svc.draft.media.requiredAngles,
    },
    workSteps: svc.draft.pricing.workSteps,
    expectedSignals: svc.draft.expectedSignals,
    pricingRules: {
      baseFee: svc.draft.pricing.baseFee,
      minimumCharge: svc.draft.pricing.minimumCharge,
      addons: svc.addons,
      multipliers: svc.multipliers,
      workSteps: svc.draft.pricing.workSteps,
    },
    draftConfig: svc.draft,
  }
}

/**
 * Apply a plain-English compile (T-104). As in the service editor, an empty
 * add-on or adjustment list from the compiler never clears the existing one.
 */
export function applyCompile<T extends Omit<DraftService, 'selected'>>(
  svc: T,
  result: { updatedConfig: ServiceDraftConfig; addons: AddonConfig[]; multipliers: MultiplierConfig[] }
): T {
  return {
    ...svc,
    draft: result.updatedConfig,
    addons: result.addons.length > 0 ? result.addons : svc.addons,
    multipliers: result.multipliers.length > 0 ? result.multipliers : svc.multipliers,
  }
}
