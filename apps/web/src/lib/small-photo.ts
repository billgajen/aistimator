/**
 * T-172: the small copy of a customer's photo.
 *
 * A small picture on the dashboard or the quote page used to load the full
 * upload (about 340 KB each, for a 48 px square). When a photo is uploaded
 * the browser now also makes a small copy and uploads it beside the original,
 * and small sizes show that copy.
 *
 * - The original is untouched: the AI reads it, and the larger view shows it.
 * - The copy is stored at a key derived from the original's key, so there is
 *   no new column and no migration. It is as private as the original:
 *   written through a signed URL, read through a signed URL.
 * - The browser is not trusted. Before a small copy is served, the server
 *   reads its first bytes and its size from storage (`lib/small-photo-server`)
 *   and checks both; a copy that fails, or is not there, is never served.
 * - A photo with no small copy (uploaded before this change, or by a browser
 *   that could not make one) falls back to the original.
 *
 * This file is plain rules, shared by the browser and the server.
 */

/** The longest side of a small copy, in pixels: twice the largest small picture (the quote page's grid) on a phone */
export const SMALL_PHOTO_MAX_EDGE = 480

/** A small copy over this size is refused. A 480 px WebP or JPEG is usually 20 to 60 KB. */
export const SMALL_PHOTO_MAX_BYTES = 200 * 1024

/** What a small copy may be. A browser that cannot write WebP writes JPEG. */
export const SMALL_PHOTO_TYPES = ['image/webp', 'image/jpeg'] as const
export type SmallPhotoType = (typeof SMALL_PHOTO_TYPES)[number]

export const isSmallPhotoType = (type: unknown): type is SmallPhotoType =>
  typeof type === 'string' && (SMALL_PHOTO_TYPES as readonly string[]).includes(type)

/** The storage key of an original's small copy */
export const smallPhotoKey = (originalKey: string) => `${originalKey}.small`

/** What the browser says it will upload: accepted only as a known image type within the size limit */
export function smallPhotoDeclarationOk(small: unknown): small is { contentType: SmallPhotoType; sizeBytes: number } {
  if (!small || typeof small !== 'object') return false
  const { contentType, sizeBytes } = small as { contentType?: unknown; sizeBytes?: unknown }
  return isSmallPhotoType(contentType) && typeof sizeBytes === 'number' && Number.isInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= SMALL_PHOTO_MAX_BYTES
}

/** How many leading bytes `smallPhotoBytesOk` needs */
export const SMALL_PHOTO_SNIFF_BYTES = 12

/**
 * What is actually in storage: do the first bytes say WebP or JPEG, and is
 * the object within the limit? The type is read from the bytes, not from the
 * header the uploader sent.
 */
export function smallPhotoBytesOk(head: Uint8Array, sizeBytes: number): boolean {
  if (!(sizeBytes > 0 && sizeBytes <= SMALL_PHOTO_MAX_BYTES)) return false
  const ascii = (from: number, text: string) => [...text].every((ch, i) => head[from + i] === ch.charCodeAt(0))
  const webp = head.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')
  const jpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  return webp || jpeg
}

/** The address of a photo's small size, from the address of the photo */
export function smallSizeUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}size=small`
}

/** The size a width and height scale down to (never up) so the longest side is at most the limit */
export function smallPhotoSize(width: number, height: number, maxEdge: number = SMALL_PHOTO_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (!(longest > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, maxEdge / longest)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
