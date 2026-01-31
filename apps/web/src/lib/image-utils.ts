/**
 * Client-side Image Utilities
 *
 * Provides image compression and resizing before upload.
 */

const MAX_WIDTH = 1920
const MAX_HEIGHT = 1920
const JPEG_QUALITY = 0.85

/**
 * Compress and resize an image file
 * Returns a new Blob with the compressed image
 */
export async function compressImage(
  file: File,
  maxWidth: number = MAX_WIDTH,
  maxHeight: number = MAX_HEIGHT,
  quality: number = JPEG_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      reject(new Error('Could not get canvas context'))
      return
    }

    img.onload = () => {
      // Calculate new dimensions while maintaining aspect ratio
      let width = img.width
      let height = img.height

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width)
        width = maxWidth
      }

      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height)
        height = maxHeight
      }

      canvas.width = width
      canvas.height = height

      // Draw image to canvas
      ctx.drawImage(img, 0, 0, width, height)

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to compress image'))
          }
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }

    // Load image from file
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Check if a file is an image that should be compressed
 */
export function shouldCompressImage(file: File): boolean {
  const compressibleTypes = ['image/jpeg', 'image/png', 'image/webp']
  return compressibleTypes.includes(file.type)
}

/**
 * Create a preview URL for a file
 */
export function createPreviewUrl(file: File | Blob): string {
  return URL.createObjectURL(file)
}

/**
 * Revoke a preview URL to free memory
 */
export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url)
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  if (parts.length <= 1) return ''
  const ext = parts[parts.length - 1]
  return ext ? ext.toLowerCase() : ''
}

/**
 * Check if file type is allowed
 */
export function isAllowedFileType(file: File): { allowed: boolean; type: 'image' | 'document' | null } {
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  const docTypes = ['application/pdf']

  if (imageTypes.includes(file.type)) {
    return { allowed: true, type: 'image' }
  }
  if (docTypes.includes(file.type)) {
    return { allowed: true, type: 'document' }
  }
  return { allowed: false, type: null }
}
