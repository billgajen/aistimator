/**
 * T-153: the demo business's three services, built from the existing US
 * packs exactly as setup builds them (`servicePayload`), with only these
 * demo changes:
 * - every service sends automatically, so the visitor sees the estimate at once;
 * - at most one photo (cost control), so each keeps only its first guided angle;
 * - interior painting needs no photo: rooms come from the form.
 * Prices are the packs' own, stored as the demo tenant's configuration (AD-001).
 *
 * Pure. Relative imports only: the seed script loads this with tsx.
 */
import type { ServiceDraftConfig } from '@estimator/shared'
import { servicePayload } from '../onboarding-service'
import { garageDoorsPackUS } from '../vertical-packs/garage-doors-us'
import { paintingPackUS } from '../vertical-packs/painting-us'
import { waterHeaterPackUS } from '../vertical-packs/water-heater-us'
import type { ServiceCreateBody } from '../service-rows'

/** Which pack services the demo offers, and whether each may skip photos */
export const DEMO_SERVICE_PICKS = [
  { pack: garageDoorsPackUS, name: 'Garage Door Spring Replacement', photoRequired: false },
  { pack: waterHeaterPackUS, name: 'Water Heater Replacement', photoRequired: true },
  { pack: paintingPackUS, name: 'Interior Painting', photoRequired: false },
] as const

export function demoServiceBodies(opts: { maxPhotos: number }): ServiceCreateBody[] {
  return DEMO_SERVICE_PICKS.map(({ pack, name, photoRequired }) => {
    const svc = pack.services.find((s) => s.name === name)
    if (!svc) throw new Error(`Pack ${pack.id} has no service "${name}"`)
    const media: ServiceDraftConfig['media'] = {
      ...svc.draft.media,
      minPhotos: photoRequired ? Math.min(1, opts.maxPhotos) : 0,
      maxPhotos: Math.min(svc.draft.media.maxPhotos, opts.maxPhotos),
      requiredAngles: (svc.draft.media.requiredAngles ?? []).slice(0, opts.maxPhotos),
    }
    const payload = servicePayload({ ...svc, addons: svc.addons ?? [], multipliers: svc.multipliers ?? [], draft: { ...svc.draft, media } })
    return { ...payload, autoSend: true, holdUntilApproved: false }
  })
}
