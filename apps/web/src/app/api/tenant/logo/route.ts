import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { uploadToR2, generateDownloadUrl, isR2Configured } from '@/lib/r2'
import type { TenantBranding } from '@estimator/shared'

const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2MB, as promised in the dashboard UI
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

async function requireTenant() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'UNAUTHORIZED' as const }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) return { error: 'NO_TENANT' as const }

  return { tenantId: profile.tenant_id as string }
}

/**
 * POST /api/tenant/logo
 * Upload the tenant logo (multipart form, field "file"). Stores in R2,
 * creates an asset row, and points branding_json.logoAssetId at it.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireTenant()
    if ('error' in auth) {
      return NextResponse.json(
        { error: { code: auth.error, message: 'Not authorized' } },
        { status: 401 }
      )
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: { code: 'STORAGE_NOT_CONFIGURED', message: 'File storage is not configured' } },
        { status: 503 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'file is required' } },
        { status: 400 }
      )
    }

    const extension = ALLOWED_TYPES[file.type]
    if (!extension) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Logo must be a PNG, JPG or WebP image' } },
        { status: 400 }
      )
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Logo must be 2MB or smaller' } },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())
    const r2Key = `${auth.tenantId}/branding/logo-${Date.now()}.${extension}`
    await uploadToR2(r2Key, buffer, file.type)

    const { data: asset, error: assetError } = await admin
      .from('assets')
      .insert({
        tenant_id: auth.tenantId,
        type: 'image',
        file_name: file.name || `logo.${extension}`,
        content_type: file.type,
        size_bytes: file.size,
        r2_key: r2Key,
      })
      .select('id')
      .single()

    if (assetError || !asset) {
      console.error('[Logo] Failed to create asset record:', assetError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to save logo' } },
        { status: 500 }
      )
    }

    // Merge into existing branding rather than replacing it
    const { data: tenant } = await admin
      .from('tenants')
      .select('branding_json')
      .eq('id', auth.tenantId)
      .single()
    const branding = (tenant?.branding_json || {}) as Partial<TenantBranding>
    const { error: updateError } = await admin
      .from('tenants')
      .update({ branding_json: { ...branding, logoAssetId: asset.id } })
      .eq('id', auth.tenantId)

    if (updateError) {
      console.error('[Logo] Failed to update branding:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to save logo' } },
        { status: 500 }
      )
    }

    const logoUrl = await generateDownloadUrl(r2Key)
    return NextResponse.json({ logoAssetId: asset.id, logoUrl })
  } catch (error) {
    console.error('[Logo] Upload error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tenant/logo
 * Remove the logo from branding (the asset row is kept for audit).
 */
export async function DELETE() {
  try {
    const auth = await requireTenant()
    if ('error' in auth) {
      return NextResponse.json(
        { error: { code: auth.error, message: 'Not authorized' } },
        { status: 401 }
      )
    }

    const admin = createAdminClient()
    const { data: tenant } = await admin
      .from('tenants')
      .select('branding_json')
      .eq('id', auth.tenantId)
      .single()
    const branding = (tenant?.branding_json || {}) as Partial<TenantBranding>
    const { error } = await admin
      .from('tenants')
      .update({ branding_json: { ...branding, logoAssetId: null } })
      .eq('id', auth.tenantId)

    if (error) {
      console.error('[Logo] Failed to remove logo:', error)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to remove logo' } },
        { status: 500 }
      )
    }

    return NextResponse.json({ logoAssetId: null })
  } catch (error) {
    console.error('[Logo] Delete error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
