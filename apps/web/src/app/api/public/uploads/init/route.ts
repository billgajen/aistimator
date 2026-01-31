import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { AssetType } from '@estimator/shared'
import { generateUploadUrl, isR2Configured } from '@/lib/r2'

// Request body types
interface FileInput {
  fileName: string
  contentType: string
  sizeBytes: number
}

interface InitUploadsRequest {
  tenantKey: string
  files: FileInput[]
}

// Maximum file sizes
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_DOC_SIZE = 25 * 1024 * 1024 // 25MB
const MAX_FILES_PER_REQUEST = 10

// Allowed content types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ALLOWED_DOC_TYPES = ['application/pdf']

function getAssetType(contentType: string): AssetType | null {
  if (ALLOWED_IMAGE_TYPES.includes(contentType)) return 'image'
  if (ALLOWED_DOC_TYPES.includes(contentType)) return 'document'
  return null
}

function getMaxSize(assetType: AssetType): number {
  return assetType === 'image' ? MAX_IMAGE_SIZE : MAX_DOC_SIZE
}

/**
 * POST /api/public/uploads/init
 * Initialize upload intents and create asset records.
 * Returns signed URLs for direct upload to R2.
 *
 * Note: For v1, we create asset records immediately.
 * Actual R2 signed URL generation requires R2 configuration (T-012).
 */
export async function POST(request: Request) {
  try {
    const body: InitUploadsRequest = await request.json()

    // Validate required fields
    if (!body.tenantKey) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantKey is required' } },
        { status: 400 }
      )
    }

    if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'files array is required' } },
        { status: 400 }
      )
    }

    if (body.files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        {
          error: {
            code: 'TOO_MANY_FILES',
            message: `Maximum ${MAX_FILES_PER_REQUEST} files per request`,
          },
        },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Validate tenantKey
    const { data: tenantSite, error: siteError } = await supabase
      .from('tenant_sites')
      .select('tenant_id, is_active')
      .eq('tenant_key', body.tenantKey)
      .single()

    if (siteError || !tenantSite) {
      return NextResponse.json(
        { error: { code: 'INVALID_TENANT_KEY', message: 'Invalid or unknown tenant key' } },
        { status: 400 }
      )
    }

    if (!tenantSite.is_active) {
      return NextResponse.json(
        { error: { code: 'TENANT_INACTIVE', message: 'This tenant is not active' } },
        { status: 403 }
      )
    }

    const tenantId = tenantSite.tenant_id

    // Validate and process each file
    const uploads: Array<{
      assetId: string
      uploadUrl: string
      method: string
    }> = []
    const errors: Array<{ fileName: string; error: string }> = []

    for (const file of body.files) {
      // Validate file has required fields
      if (!file.fileName || !file.contentType || !file.sizeBytes) {
        errors.push({ fileName: file.fileName || 'unknown', error: 'Missing required fields' })
        continue
      }

      // Validate content type
      const assetType = getAssetType(file.contentType)
      if (!assetType) {
        errors.push({
          fileName: file.fileName,
          error: `Unsupported file type: ${file.contentType}`,
        })
        continue
      }

      // Validate file size
      const maxSize = getMaxSize(assetType)
      if (file.sizeBytes > maxSize) {
        errors.push({
          fileName: file.fileName,
          error: `File too large. Maximum size: ${maxSize / 1024 / 1024}MB`,
        })
        continue
      }

      // Generate R2 key
      const timestamp = Date.now()
      const sanitizedFileName = file.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
      const r2Key = `${tenantId}/${timestamp}-${sanitizedFileName}`

      // Create asset record
      const { data: asset, error: assetError } = await supabase
        .from('assets')
        .insert({
          tenant_id: tenantId,
          type: assetType,
          file_name: file.fileName,
          content_type: file.contentType,
          size_bytes: file.sizeBytes,
          r2_key: r2Key,
        })
        .select()
        .single()

      if (assetError || !asset) {
        console.error('Failed to create asset:', assetError)
        errors.push({ fileName: file.fileName, error: 'Failed to create asset record' })
        continue
      }

      // Generate R2 signed upload URL
      let uploadUrl: string

      if (isR2Configured()) {
        // Generate real R2 signed URL for direct upload
        uploadUrl = await generateUploadUrl(r2Key, file.contentType, 3600) // 1 hour expiry
      } else {
        // Fallback for development without R2: use local API endpoint
        console.warn('[Upload] R2 not configured, using local fallback')
        uploadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/public/uploads/${asset.id}`
      }

      uploads.push({
        assetId: asset.id,
        uploadUrl,
        method: 'PUT',
      })
    }

    // If all files failed validation, return error
    if (uploads.length === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'All files failed validation',
            details: errors,
          },
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      uploads,
      ...(errors.length > 0 && { errors }),
    })
  } catch (error) {
    console.error('Upload init error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
