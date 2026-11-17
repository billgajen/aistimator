/**
 * T-177: the upload limits, for a file that reaches the server by a chat
 * (WhatsApp, a text message) instead of the request form.
 *
 * The form's limits live in `app/api/public/uploads/init/route.ts`, where
 * they are enforced at the door and signed into the upload address. These are
 * the same numbers and the same types; a unit test keeps the two in step.
 */
export const UPLOAD_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const UPLOAD_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
export const UPLOAD_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const UPLOAD_DOCUMENT_TYPES: readonly string[] = ['application/pdf']

export type UploadKind = 'image' | 'document'

/** What a file of this type is, or null when it is not a type we take. A type's parameters ("; charset=…") are ignored. */
export function uploadKindOf(contentType: string | null | undefined): UploadKind | null {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  if (UPLOAD_IMAGE_TYPES.includes(type)) return 'image'
  if (UPLOAD_DOCUMENT_TYPES.includes(type)) return 'document'
  return null
}

/** May a file of this type and size be kept? */
export function uploadAllowed(contentType: string | null | undefined, sizeBytes: number): boolean {
  const kind = uploadKindOf(contentType)
  if (!kind || !(sizeBytes > 0)) return false
  return sizeBytes <= (kind === 'image' ? UPLOAD_MAX_IMAGE_BYTES : UPLOAD_MAX_DOCUMENT_BYTES)
}
