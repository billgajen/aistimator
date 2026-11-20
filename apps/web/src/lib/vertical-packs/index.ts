/**
 * Vertical pack registry (T-113).
 *
 * Packs register here and become available in the onboarding interview's
 * "Start from a template" path. Adding a vertical = adding a data file and
 * one line here — no engine changes.
 */

import type { RegionCode } from '@qolumns/shared'
import type { VerticalPack } from './types'
import { paintingPack } from './painting'
import { paintingPackUS } from './painting-us'
import { hvacPackUS } from './hvac-us'
import { waterHeaterPackUS } from './water-heater-us'
import { electricalPackUS } from './electrical-us'
import { plumbingPackUS } from './plumbing-us'
import { garageDoorsPackUS } from './garage-doors-us'
import { fencingPackUS } from './fencing-us'
import { junkRemovalPackUS } from './junk-removal-us'
import { pressureWashingPackUS } from './pressure-washing-us'

export type { VerticalPack, VerticalPackService } from './types'

/**
 * All available packs, in the ONE order every list follows (T-195): setup, "Add from a template", home's
 * step 1, the footer and the "Who it's for" page all read it from here. A business in another region
 * still sees its own region's packs first (`listPacks(region)`).
 */
const PACKS: VerticalPack[] = [
  waterHeaterPackUS,
  hvacPackUS,
  electricalPackUS,
  plumbingPackUS,
  garageDoorsPackUS,
  paintingPackUS,
  fencingPackUS,
  junkRemovalPackUS,
  pressureWashingPackUS,
  paintingPack,
]

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
