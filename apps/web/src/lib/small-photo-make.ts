/**
 * T-177: make a photo's small copy on the server.
 *
 * A photo uploaded on the request form gets its small copy made in the
 * customer's browser (T-172). A photo sent in a chat (WhatsApp, a text
 * message) never passes through a browser of ours: the server downloads it
 * from the channel. This makes the same small copy there: a JPEG at most 480
 * px on its longest side, stored beside the original at `<key>.small`.
 *
 * - The original is untouched and stays private; it is what the AI reads and
 *   what the larger view shows (as for every other photo).
 * - Only a JPEG is handled: that is what WhatsApp and phones send. Anything
 *   else, anything too large to decode safely, and any failure give `null`,
 *   and the photo simply has no small copy (the original is served, as for a
 *   photo from before T-172).
 * - A photo's sideways-ness is in its EXIF data, not its pixels, so the
 *   orientation is read and applied; a small copy has no EXIF of its own.
 * - The decoder is `jpeg-js` (pure JavaScript, no dependencies). It is given
 *   hard limits, because the bytes come from a stranger.
 */
import jpeg from 'jpeg-js'
import { SMALL_PHOTO_MAX_BYTES, SMALL_PHOTO_MAX_EDGE, smallPhotoSize } from './small-photo'

/** An original larger than this is not decoded (the upload limit for a photo is 10 MB) */
const MAX_INPUT_BYTES = 10 * 1024 * 1024
/** Megapixels the decoder may produce: a 48 MP phone photo fits */
const MAX_MEGAPIXELS = 50
const MAX_DECODE_MEMORY_MB = 384
const QUALITIES = [72, 55, 40]

export const isJpeg = (bytes: Uint8Array): boolean => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

/**
 * The EXIF orientation of a JPEG (1 to 8), or 1 when it has none or it cannot
 * be read. 1 = upright; 3 = upside down; 6 and 8 = on its side; 2, 4, 5 and 7
 * are the mirrored versions.
 */
export function exifOrientation(bytes: Uint8Array): number {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return 1
      const marker = view.getUint8(offset + 1)
      // the picture data starts: no EXIF after this
      if (marker === 0xda || marker === 0xd9) return 1
      const length = view.getUint16(offset + 2)
      if (marker === 0xe1 && length >= 16 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
        const tiff = offset + 10
        const little = view.getUint16(tiff) === 0x4949
        if (!little && view.getUint16(tiff) !== 0x4d4d) return 1
        const ifd = tiff + view.getUint32(tiff + 4, little)
        const entries = view.getUint16(ifd, little)
        for (let i = 0; i < entries; i++) {
          const entry = ifd + 2 + i * 12
          if (entry + 12 > view.byteLength) return 1
          if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little)
            return value >= 1 && value <= 8 ? value : 1
          }
        }
        return 1
      }
      offset += 2 + length
    }
  } catch {
    // a malformed header reads as "no orientation"
  }
  return 1
}

interface Pixels {
  width: number
  height: number
  data: Uint8Array
}

/** Scale down by averaging each block of source pixels (never up) */
export function scaleDown(source: Pixels, width: number, height: number): Pixels {
  const out = new Uint8Array(width * height * 4)
  const xRatio = source.width / width
  const yRatio = source.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)))
      let r = 0
      let g = 0
      let b = 0
      for (let sy = y0; sy < y1; sy++) {
        let at = (sy * source.width + x0) * 4
        for (let sx = x0; sx < x1; sx++) {
          r += source.data[at] as number
          g += source.data[at + 1] as number
          b += source.data[at + 2] as number
          at += 4
        }
      }
      const count = (y1 - y0) * (x1 - x0)
      const to = (y * width + x) * 4
      out[to] = Math.round(r / count)
      out[to + 1] = Math.round(g / count)
      out[to + 2] = Math.round(b / count)
      out[to + 3] = 255
    }
  }
  return { width, height, data: out }
}

/** Turn pixels the way the EXIF orientation says they should be seen */
export function applyOrientation(source: Pixels, orientation: number): Pixels {
  if (orientation < 2 || orientation > 8) return source
  const swap = orientation >= 5
  const width = swap ? source.height : source.width
  const height = swap ? source.width : source.height
  const out = new Uint8Array(width * height * 4)
  const w = source.width
  const h = source.height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // where this pixel comes from in the stored picture
      let sx: number
      let sy: number
      switch (orientation) {
        case 2: sx = w - 1 - x; sy = y; break
        case 3: sx = w - 1 - x; sy = h - 1 - y; break
        case 4: sx = x; sy = h - 1 - y; break
        case 5: sx = y; sy = x; break
        case 6: sx = y; sy = h - 1 - x; break
        case 7: sx = w - 1 - y; sy = h - 1 - x; break
        default: sx = w - 1 - y; sy = x // 8
      }
      const from = (sy * w + sx) * 4
      const to = (y * width + x) * 4
      out[to] = source.data[from] as number
      out[to + 1] = source.data[from + 1] as number
      out[to + 2] = source.data[from + 2] as number
      out[to + 3] = 255
    }
  }
  return { width, height, data: out }
}

/**
 * The small copy of a photo, as JPEG bytes within the small-copy limits, or
 * null when one cannot be made. Never throws.
 */
export function makeSmallCopy(original: Uint8Array): Buffer | null {
  if (!isJpeg(original) || original.length > MAX_INPUT_BYTES) return null
  try {
    const decoded = jpeg.decode(original, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS, maxMemoryUsageInMB: MAX_DECODE_MEMORY_MB })
    if (!(decoded.width > 0 && decoded.height > 0)) return null
    const size = smallPhotoSize(decoded.width, decoded.height, SMALL_PHOTO_MAX_EDGE)
    const scaled = scaleDown({ width: decoded.width, height: decoded.height, data: decoded.data as Uint8Array }, size.width, size.height)
    const upright = applyOrientation(scaled, exifOrientation(original))
    for (const quality of QUALITIES) {
      const encoded = jpeg.encode({ width: upright.width, height: upright.height, data: Buffer.from(upright.data.buffer, upright.data.byteOffset, upright.data.byteLength) }, quality).data
      if (encoded.length > 0 && encoded.length <= SMALL_PHOTO_MAX_BYTES) return Buffer.from(encoded)
    }
    return null
  } catch {
    return null
  }
}
