/**
 * Vertical pack registry (T-113).
 *
 * Packs register here and become available in the onboarding interview's
 * "Start from a template" path. Adding a vertical = adding a data file and
 * one line here — no engine changes.
 */

import type { VerticalPack } from './types'
import { paintingPack } from './painting'

export type { VerticalPack, VerticalPackService } from './types'

/** All available packs. */
const PACKS: VerticalPack[] = [paintingPack]

export function listPacks(): VerticalPack[] {
  return PACKS
}

export function getPack(id: string): VerticalPack | undefined {
  return PACKS.find((p) => p.id === id)
}
