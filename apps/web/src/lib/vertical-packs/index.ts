/**
 * Vertical pack registry (T-113).
 *
 * Packs register here and become available in the onboarding interview's
 * "Start from a template" path. Adding a vertical = adding a data file and
 * one line here — no engine changes.
 */

import type { RegionCode } from '@estimator/shared'
import type { VerticalPack } from './types'
import { paintingPack } from './painting'
import { paintingPackUS } from './painting-us'
import { hvacPackUS } from './hvac-us'
import { waterHeaterPackUS } from './water-heater-us'

export type { VerticalPack, VerticalPackService } from './types'

/** All available packs. */
const PACKS: VerticalPack[] = [paintingPackUS, hvacPackUS, waterHeaterPackUS, paintingPack]

/**
 * All packs; when a region is given, that region's packs come first so a US
 * business sees the US variant at the top (other regions stay available).
 */
export function listPacks(region?: RegionCode): VerticalPack[] {
  if (!region) return PACKS
  return [...PACKS.filter((p) => p.region === region), ...PACKS.filter((p) => p.region !== region)]
}

export function getPack(id: string): VerticalPack | undefined {
  return PACKS.find((p) => p.id === id)
}
