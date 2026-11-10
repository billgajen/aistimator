/**
 * Cloudflare R2 Client
 *
 * Uses AWS S3 SDK compatible API for R2 operations.
 * Provides signed URL generation for direct uploads and downloads.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'estimator-assets'
const R2_ENDPOINT = process.env.R2_ENDPOINT

// Check if R2 is configured
export function isR2Configured(): boolean {
  return !!(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && (R2_ENDPOINT || R2_ACCOUNT_ID))
}

// Create S3 client for R2
function getR2Client(): S3Client {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured')
  }

  const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  })
}

/**
 * Generate a signed URL for uploading a file directly to R2
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const client = getR2Client()

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  })

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
}

/**
 * Generate a signed URL for downloading a file from R2
 */
export async function generateDownloadUrl(
  key: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const client = getR2Client()

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  })

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
}

/**
 * Get the public R2 URL for a key (if bucket is public)
 * Note: For private buckets, use generateDownloadUrl instead
 */
export function getPublicUrl(key: string): string {
  // R2 public URLs follow this pattern when custom domain is set
  // For now, we rely on signed URLs for access
  const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  return `${endpoint}/${R2_BUCKET_NAME}/${key}`
}

/**
 * Upload a file directly to R2 from the server
 * Used for generated files like PDFs
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const client = getR2Client()

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  })

  await client.send(command)
}

/**
 * T-153: delete objects (the demo clean-up). Up to 1,000 keys per call, as
 * the S3 API allows; returns how many were deleted.
 */
export async function deleteFromR2(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0
  const client = getR2Client()
  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    const result = await client.send(
      new DeleteObjectsCommand({ Bucket: R2_BUCKET_NAME, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } })
    )
    deleted += batch.length - (result.Errors?.length ?? 0)
  }
  return deleted
}
