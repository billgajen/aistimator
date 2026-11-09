import type { AddonConfig, ServiceDraftConfig } from '@estimator/shared'

/**
 * AI-drafted add-ons ({name, price, description}) → the service's add-on
 * config ({id, label, price}). Unnamed or unpriced entries are skipped. The
 * owner reviews them in the Add-ons list before saving; nothing is
 * auto-charged (no trigger keywords are invented here).
 */
export function draftAddonsToConfig(
  addOns: ServiceDraftConfig['pricing']['addOns'] | undefined,
  newId: () => string
): AddonConfig[] {
  return (addOns ?? [])
    .filter((a) => a.name?.trim() && Number.isFinite(a.price) && a.price > 0)
    .map((a) => ({ id: newId(), label: a.name.trim(), price: a.price }))
}
