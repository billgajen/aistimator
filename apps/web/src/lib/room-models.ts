/**
 * T-193: a scanned room's 3D model (RoomPlan's USDZ export), kept privately
 * in storage with the quote, like its photos.
 *
 * Where a model lives is decided here and nowhere else: under the tenant's
 * own folder, at an id the server made when the upload was started. The scan
 * stored with the request carries only the id. Every address handed out is
 * built from the QUOTE's tenant and an id that is in that quote's own scan,
 * so an id from another business opens nothing (multi-tenant isolation), and
 * a quote can only ever show its own rooms. There is no public address: each
 * one is signed for a few minutes, and only when a viewer is opened.
 */
import { randomUUID } from 'node:crypto'
import { ROOM_MODEL_ID, roomScanOfAnswers } from '@qolumns/shared'
import { generateDownloadUrl, generateUploadUrl, isR2Configured } from '@/lib/r2'

/** The type RoomPlan's export is, and the only one taken */
export const ROOM_MODEL_CONTENT_TYPE = 'model/vnd.usdz+zip'

/** A room's model is a few megabytes; this leaves room for a large, furnished one */
export const ROOM_MODEL_MAX_BYTES = 40 * 1024 * 1024

/** How long an address to a model lasts (it is asked for when the viewer opens) */
export const ROOM_MODEL_URL_SECONDS = 10 * 60

export function roomModelKey(tenantId: string, modelId: string): string {
  return `${tenantId}/room-models/${modelId}.usdz`
}

export function isRoomModelId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_MODEL_ID.test(value)
}

/** Is this model one of the rooms in this request's own scan? */
export function scanHasModel(jobAnswers: unknown, modelId: string): boolean {
  if (!isRoomModelId(modelId)) return false
  return Boolean(roomScanOfAnswers(jobAnswers)?.rooms.some((room) => room.modelId === modelId))
}

export type StartModelUpload =
  | { ok: true; modelId: string; uploadUrl: string }
  | { ok: false; status: number; code: string; message: string }

/** A signed address that takes exactly this many bytes of a USDZ, at a new id in this tenant's folder */
export async function startModelUpload(tenantId: string, sizeBytes: unknown): Promise<StartModelUpload> {
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) <= 0) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'sizeBytes must be a whole number of bytes' }
  }
  if ((sizeBytes as number) > ROOM_MODEL_MAX_BYTES) {
    return { ok: false, status: 400, code: 'FILE_TOO_LARGE', message: `A room model can be at most ${ROOM_MODEL_MAX_BYTES / 1024 / 1024}MB` }
  }
  if (!isR2Configured()) return { ok: false, status: 503, code: 'STORAGE_UNAVAILABLE', message: 'File storage is not set up' }
  const modelId = randomUUID()
  const uploadUrl = await generateUploadUrl(roomModelKey(tenantId, modelId), ROOM_MODEL_CONTENT_TYPE, 3600, sizeBytes as number)
  return { ok: true, modelId, uploadUrl }
}

/**
 * A short-lived address for one of a quote's models. The caller has already
 * proved it may see the quote (signed in to its business, its approval link,
 * or its own customer token); this checks the model is in that quote's scan.
 * Null when it is not, or when storage is not set up.
 */
export async function signedRoomModelUrl(quote: { tenantId: string; jobAnswers: unknown }, modelId: string): Promise<string | null> {
  if (!scanHasModel(quote.jobAnswers, modelId) || !isR2Configured()) return null
  try {
    return await generateDownloadUrl(roomModelKey(quote.tenantId, modelId), ROOM_MODEL_URL_SECONDS)
  } catch (error) {
    // the error's name only: a message could carry the key
    console.error('[RoomModel] could not be signed:', error instanceof Error ? error.name : 'unknown')
    return null
  }
}
