import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { AssetType } from '@estimator/shared'
import { generateUploadUrl, isR2Configured } from '@/lib/r2'

interface FileInput {
  fileName: string
  contentType: string
  sizeBytes: number
}

interface InitUploadsRequest {
  files: FileInput[]
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_DOC_SIZE = 25 * 1024 * 1024 // 25MB
const MAX_FILES_PER_REQUEST = 10

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

function getAssetType(contentType: string): AssetType | null {
  if (ALLOWED_IMAGE_TYPES.includes(contentType)) return 'image'
  if (ALLOWED_DOC_TYPES.includes(contentType)) return 'document'
  return null
}

function getMaxSize(assetType: AssetType): number {
  return assetType === 'image' ? MAX_IMAGE_SIZE : MAX_DOC_SIZE
}

/**
 * POST /api/uploads/init
 * Initialize upload intents for authenticated dashboard users.
 * Accepts images, PDFs, and Word documents.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    // Require authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    const tenantId = profile.tenant_id

    const body: InitUploadsRequest = await request.json()

    if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'files array is required' } },
        { status: 400 }
      )
    }

    if (body.files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: { code: 'TOO_MANY_FILES', message: `Maximum ${MAX_FILES_PER_REQUEST} files per request` } },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const uploads: Array<{ assetId: string; uploadUrl: string; method: string }> = []
    const errors: Array<{ fileName: string; error: string }> = []

    for (const file of body.files) {
      if (!file.fileName || !file.contentType || !file.sizeBytes) {
        errors.push({ fileName: file.fileName || 'unknown', error: 'Missing required fields' })
        continue
      }

      const assetType = getAssetType(file.contentType)
      if (!assetType) {
        errors.push({ fileName: file.fileName, error: `Unsupported file type: ${file.contentType}` })
        continue
      }

      const maxSize = getMaxSize(assetType)
      if (file.sizeBytes > maxSize) {
        errors.push({ fileName: file.fileName, error: `File too large. Maximum: ${maxSize / 1024 / 1024}MB` })
        continue
      }

      const timestamp = Date.now()
      const sanitizedFileName = file.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
      const r2Key = `${tenantId}/dashboard/${timestamp}-${sanitizedFileName}`

      const { data: asset, error: assetError } = await admin
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

      let uploadUrl: string
      if (isR2Configured()) {
        uploadUrl = await generateUploadUrl(r2Key, file.contentType, 3600)
      } else {
        console.warn('[Upload] R2 not configured, using local fallback')
        uploadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/public/uploads/${asset.id}`
      }

      uploads.push({ assetId: asset.id, uploadUrl, method: 'PUT' })
    }

    if (uploads.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'All files failed validation', details: errors } },
        { status: 400 }
      )
    }

    return NextResponse.json({
      uploads,
      ...(errors.length > 0 && { errors }),
    })
  } catch (error) {
    console.error('Authenticated upload init error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
