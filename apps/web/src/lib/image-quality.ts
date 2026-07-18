/**
 * Client-side image quality pre-validation (T-107).
 *
 * Catches unusable photos BEFORE upload — bad photos silently produce bad
 * estimates (vision confidence drops, counts go wrong). Runs entirely in the
 * browser on a downscaled canvas; fails open on any internal error so a
 * quality-check bug can never block a customer from uploading.
 */

export type ImageQualityIssue = 'too_small' | 'blurry' | 'too_dark' | 'too_bright'

export interface ImageQualityResult {
  /** false only for hard failures (too_small); soft issues still allow upload */
  ok: boolean
  /** Soft + hard issues found, most severe first */
  issues: Array<{ code: ImageQualityIssue; message: string }>
  width: number
  height: number
}

const MIN_DIMENSION = 480 // hard: below this, vision output is unreliable
const ANALYSIS_MAX_DIM = 320 // downscale target for analysis
const DARK_LUMA = 35 // mean luma 0-255
const BRIGHT_LUMA = 240
const BLUR_VARIANCE = 25 // Laplacian variance on downscaled grayscale; conservative

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.src = url
  })
}

/**
 * Assess a photo for size, exposure, and sharpness.
 */
export async function assessImageQuality(file: File): Promise<ImageQualityResult> {
  try {
    const image = await decodeImage(file)
    const width = image.width
    const height = image.height

    const issues: ImageQualityResult['issues'] = []

    if (Math.min(width, height) < MIN_DIMENSION) {
      issues.push({
        code: 'too_small',
        message: `This photo is too small (${width}×${height}) for accurate analysis — please use your camera's normal resolution.`,
      })
      // Hard failure — no point analysing exposure/blur on a thumbnail
      return { ok: false, issues, width, height }
    }

    // Downscale for analysis
    const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { ok: true, issues: [], width, height } // fail open

    ctx.drawImage(image, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)

    // Grayscale + mean luminance
    const gray = new Float32Array(w * h)
    let lumaSum = 0
    for (let i = 0; i < w * h; i++) {
      const luma =
        0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!
      gray[i] = luma
      lumaSum += luma
    }
    const meanLuma = lumaSum / (w * h)

    if (meanLuma < DARK_LUMA) {
      issues.push({
        code: 'too_dark',
        message: 'This photo looks very dark — try turning on a light or using flash.',
      })
    } else if (meanLuma > BRIGHT_LUMA) {
      issues.push({
        code: 'too_bright',
        message: 'This photo looks washed out — try moving away from direct light.',
      })
    }

    // Blur: variance of the Laplacian (4-neighbour) over the grayscale image
    let lapSum = 0
    let lapSqSum = 0
    let count = 0
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const lap =
          4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!
        lapSum += lap
        lapSqSum += lap * lap
        count++
      }
    }
    if (count > 0) {
      const mean = lapSum / count
      const variance = lapSqSum / count - mean * mean
      if (variance < BLUR_VARIANCE) {
        issues.push({
          code: 'blurry',
          message: 'This photo looks blurry — hold steady and tap to focus before taking it.',
        })
      }
    }

    return { ok: true, issues, width, height }
  } catch {
    // Never block an upload because the quality check itself failed
    return { ok: true, issues: [], width: 0, height: 0 }
  }
}
