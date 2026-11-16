/**
 * T-172: make the small copy of a photo in the browser, and upload it.
 *
 * No library: the browser decodes the picture, a canvas scales it, and the
 * canvas writes WebP (JPEG where the browser cannot write WebP). Anything
 * that goes wrong gives `null` and the photo simply has no small copy; small
 * sizes then show the original. Making or sending the copy never fails the
 * customer's upload, and the upload waits at most 15 seconds for it.
 */
import { isSmallPhotoType, SMALL_PHOTO_MAX_BYTES, smallPhotoSize } from './small-photo'

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

export async function makeSmallPhoto(file: Blob): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null
    if (!file.type.startsWith('image/')) return null
    // the browser applies the camera's rotation while decoding
    const bitmap = await createImageBitmap(file)
    try {
      const { width, height } = smallPhotoSize(bitmap.width, bitmap.height)
      if (width === 0 || height === 0) return null
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)
      // A browser that cannot write a type answers with PNG: only a WebP or a JPEG is kept
      for (const [type, quality] of [['image/webp', 0.8], ['image/jpeg', 0.82], ['image/jpeg', 0.6]] as const) {
        const blob = await toBlob(canvas, type, quality)
        if (blob && isSmallPhotoType(blob.type) && blob.size > 0 && blob.size <= SMALL_PHOTO_MAX_BYTES) return blob
      }
      return null
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

/** What the upload request says about the small copy, or nothing when there is none */
export const smallPhotoDeclaration = (small: Blob | null) => (small ? { small: { contentType: small.type, sizeBytes: small.size } } : {})

/** The photo's upload waits for its small copy for at most this long */
export const SMALL_PHOTO_UPLOAD_TIMEOUT_MS = 15_000

/**
 * Send the small copy to the address the server gave for it. Never throws, and gives up after
 * `SMALL_PHOTO_UPLOAD_TIMEOUT_MS`: the original is what matters.
 */
export async function uploadSmallPhoto(small: Blob | null, smallUploadUrl: unknown): Promise<void> {
  if (!small || typeof smallUploadUrl !== 'string' || !smallUploadUrl) return
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(SMALL_PHOTO_UPLOAD_TIMEOUT_MS) : undefined
    await fetch(smallUploadUrl, { method: 'PUT', body: small, headers: { 'Content-Type': small.type }, signal })
  } catch {
    // no small copy: small sizes show the original
  }
}
