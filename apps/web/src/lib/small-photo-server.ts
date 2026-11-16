/**
 * T-172: which stored object to serve for a photo, on the server.
 *
 * For the small size, the small copy is served only after the server has
 * looked at it in storage: its first bytes must be a WebP or a JPEG and it
 * must be within the size limit (`smallPhotoBytesOk`). The browser that made
 * the copy is not trusted for either. If the copy is missing or fails, the
 * original is served, which is also what a photo uploaded before T-172 gets.
 *
 * A copy that passed is remembered for this server instance, so a list of
 * small pictures does not read storage again on every view. A miss is not
 * remembered: the copy may still be on its way.
 */
import { readObjectStart } from './r2'
import { SMALL_PHOTO_SNIFF_BYTES, smallPhotoBytesOk, smallPhotoKey } from './small-photo'

export type PhotoSize = 'small' | 'full'

export const photoSizeOf = (value: string | null | undefined): PhotoSize => (value === 'small' ? 'small' : 'full')

const REMEMBERED_MAX = 2000
const passed = new Set<string>()

type ReadStart = typeof readObjectStart

/** The key to sign for this photo at this size. Never throws: any trouble reading the copy means the original. */
export async function photoKeyToServe(originalKey: string, size: PhotoSize, read: ReadStart = readObjectStart): Promise<string> {
  if (size !== 'small') return originalKey
  const key = smallPhotoKey(originalKey)
  if (passed.has(key)) return key
  try {
    const start = await read(key, SMALL_PHOTO_SNIFF_BYTES)
    if (!start || !smallPhotoBytesOk(start.head, start.sizeBytes)) return originalKey
    if (passed.size >= REMEMBERED_MAX) passed.clear()
    passed.add(key)
    return key
  } catch {
    return originalKey
  }
}

/** For tests */
export const forgetCheckedSmallPhotos = () => passed.clear()
