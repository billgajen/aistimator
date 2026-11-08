/**
 * Region registry + per-tenant resolution (T-133, AD-025).
 * Adding a market = adding a data file and one line in REGIONS.
 */

import type { RegionCode, RegionDefinition, ReferenceObject, UnitSystem } from './types'
import { US_REGION } from './us'
import { GB_REGION } from './gb'

export type { RegionCode, RegionDefinition, ReferenceObject, RegionCopy, UnitSystem } from './types'
export { US_REGION } from './us'
export { GB_REGION } from './gb'

const REGIONS: Record<RegionCode, RegionDefinition> = {
  US: US_REGION,
  GB: GB_REGION,
}

/** Region for NEW tenants (the database column default matches). */
export const DEFAULT_REGION: RegionCode = 'US'

/**
 * Region assumed when a tenant row has no region at all. Only rows written
 * before migration 26 lack one, and every one of those is a GB tenant —
 * so a missing value must never silently flip an existing tenant to US.
 */
export const LEGACY_REGION: RegionCode = 'GB'

export function listRegions(): RegionDefinition[] {
  return Object.values(REGIONS)
}

export function isRegionCode(value: unknown): value is RegionCode {
  return typeof value === 'string' && value in REGIONS
}

export function getRegion(code: string | null | undefined): RegionDefinition {
  return isRegionCode(code) ? REGIONS[code] : REGIONS[LEGACY_REGION]
}

export function isUnitSystem(value: unknown): value is UnitSystem {
  return value === 'imperial' || value === 'metric'
}

/** Everything a request needs to localise output for one tenant. */
export interface RegionContext {
  region: RegionDefinition
  currency: string
  locale: string
  unitSystem: UnitSystem
  taxLabel: string
}

/**
 * Resolve the effective region settings for a tenant: region defaults with
 * the tenant's own overrides (currency, unit system, tax label) on top.
 */
export function resolveRegionContext(tenant: {
  region?: string | null
  currency?: string | null
  unit_system?: string | null
  tax_label?: string | null
}): RegionContext {
  const region = getRegion(tenant.region)
  return {
    region,
    currency: tenant.currency?.trim() || region.currency,
    locale: region.locale,
    unitSystem: isUnitSystem(tenant.unit_system) ? tenant.unit_system : region.unitSystem,
    taxLabel: tenant.tax_label?.trim() || region.copy.taxLabel,
  }
}

/**
 * Reference objects for anchored measurement: the region's table, with any
 * pack/service overrides replacing entries of the same id (or adding new ones).
 */
export function resolveReferenceObjects(
  region: RegionDefinition,
  overrides?: ReferenceObject[] | null
): ReferenceObject[] {
  if (!overrides || overrides.length === 0) return region.referenceObjects
  const valid = overrides.filter(
    (o) => o && typeof o.id === 'string' && Number.isFinite(o.metres) && o.metres > 0
  )
  const byId = new Map(region.referenceObjects.map((r) => [r.id, r]))
  for (const o of valid) byId.set(o.id, o)
  return [...byId.values()]
}

/**
 * A short block for AI prompts (wording, compiler, drafting) so output uses
 * the tenant's language variant, currency, units, tax and postal wording.
 * Pure data → text; no trade knowledge.
 */
export function regionPromptBlock(ctx: RegionContext): string {
  const imperial = ctx.unitSystem === 'imperial'
  const units = imperial
    ? 'imperial — areas in square feet (sq ft), lengths in feet (ft) or inches (in), volumes in US gallons (gal)'
    : 'metric — areas in square metres (sqm), lengths in metres (m), volumes in litres (L)'
  return [
    `REGION: ${ctx.region.name}.`,
    `- Language: ${ctx.region.copy.languageVariant}.`,
    `- Currency: ${ctx.currency}.`,
    `- Units: ${units}.`,
    `- The tax line is called "${ctx.taxLabel}". Postal codes are called "${ctx.region.copy.postalCodeNoun}".`,
  ].join('\n')
}
