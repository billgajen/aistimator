'use client'

import { useState } from 'react'

/**
 * T-152: the logo upload, shared by Settings → Branding and setup's basics
 * step — the same POST/DELETE /api/tenant/logo (PNG, JPG or WebP, 2 MB).
 */
export function LogoUpload({
  logoUrl,
  onChange,
  onError,
}: {
  logoUrl: string | null
  onChange: (logoAssetId: string | null, logoUrl: string | null) => void
  onError: (message: string | null) => void
}) {
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const handleLogoUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      onError('Logo must be 2MB or smaller')
      return
    }
    setUploadingLogo(true)
    onError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/tenant/logo', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to upload logo')
      }
      onChange(data.logoAssetId, data.logoUrl)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleLogoRemove = async () => {
    setUploadingLogo(true)
    onError(null)
    try {
      const res = await fetch('/api/tenant/logo', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error?.message || 'Failed to remove logo')
      }
      onChange(null, null)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  return (
    <>
      {logoUrl ? (
        <div className="mt-4 flex items-center gap-4 rounded-warm-lg border border-border bg-background p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL */}
          <img src={logoUrl} alt="Your logo" className="h-16 max-w-[200px] object-contain" />
          <div className="ml-auto flex gap-2">
            <label className="cursor-pointer rounded-warm-lg border border-border px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface">
              Replace
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploadingLogo}
                onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
              />
            </label>
            <button
              onClick={handleLogoRemove}
              disabled={uploadingLogo}
              className="rounded-warm-lg border border-danger/30 px-3 py-2 text-sm font-medium text-danger hover:bg-danger-light disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label className="mt-4 flex h-32 cursor-pointer items-center justify-center rounded-warm-lg border-2 border-dashed border-border bg-background transition-colors hover:border-border-strong">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={uploadingLogo}
            onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
          />
          <div className="text-center">
            {uploadingLogo ? (
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : (
              <svg
                className="mx-auto h-8 w-8 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            )}
            <p className="mt-2 text-sm font-medium text-text-secondary">
              {uploadingLogo ? 'Uploading…' : 'Click to upload your logo'}
            </p>
            <p className="text-xs text-text-muted">PNG, JPG or WebP up to 2MB</p>
          </div>
        </label>
      )}
    </>
  )
}
