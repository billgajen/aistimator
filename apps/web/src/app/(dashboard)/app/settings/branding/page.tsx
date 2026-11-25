'use client'

import { useState, useEffect, useCallback } from 'react'
import { readableTextOn } from '@/lib/color'
import { LogoUpload } from '@/components/settings/LogoUpload'
import { PDF_ONLY_LINE, PdfOnlyTag } from '@/components/dashboard/PdfOnlyTag'
import type { TenantBranding, TenantTemplate } from '@qolumns/shared'
import { DEFAULT_PRIMARY_COLOR, formatMoney, getRegion, noBadgeLine, PRODUCT_NAME } from '@qolumns/shared'
import { NEUTRAL_SAMPLE, previewTotals, ratePercentText, type BrandingSample, type PreviewTax } from '@/lib/branding-preview'

/**
 * Curated brand colours — trade-friendly, all tested against white and ink
 * text. Custom colours are still allowed via the picker; readable text is
 * computed automatically either way.
 */
const PRESET_COLORS: Array<{ hex: string; name: string }> = [
  { hex: '#205E56', name: 'Juniper' },
  { hex: '#1E3A5F', name: 'Navy' },
  { hex: '#2D5A27', name: 'Forest' },
  { hex: '#A23B2E', name: 'Brick' },
  { hex: '#16697A', name: 'Ocean' },
  { hex: '#5B3758', name: 'Plum' },
  { hex: '#A5731B', name: 'Amber' },
  { hex: '#333B41', name: 'Charcoal' },
]

export const dynamic = 'force-dynamic'

const DEFAULT_BRANDING: TenantBranding = {
  logoAssetId: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  footerNotes: null,
}

const DEFAULT_TEMPLATE: TenantTemplate = {
  showLineItems: true,
  includeAssumptions: true,
  includeExclusions: true,
  validityDays: 30,
  acceptQuoteEnabled: true,
}

// T-204: the preview is the business's own look (lib/branding-preview.ts). Until the page has
// loaded, and for a business with no priced service yet, the neutral sketch stands in.
interface PreviewData {
  currency: string
  tax: PreviewTax
  badgeShown: boolean
  badgeLine: string
  sample: BrandingSample
}

const SAMPLE_CUSTOMER = 'Your customer'

/**
 * Branding Page
 *
 * Configure logo, colors, and quote templates.
 */
export default function BrandingPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [tenantName, setTenantName] = useState('')
  // T-152: placeholders follow the business's region (no hardcoded number)
  const [region, setRegion] = useState<string | null>(null)
  const regionCopy = getRegion(region).copy
  const [preview, setPreview] = useState<PreviewData | null>(null)

  // Branding state
  const [branding, setBranding] = useState<TenantBranding>(DEFAULT_BRANDING)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  // Template state
  const [template, setTemplate] = useState<TenantTemplate>(DEFAULT_TEMPLATE)

  const fetchBranding = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/tenant/branding')
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to fetch branding')
      }

      setTenantName(data.tenantName || '')
      setRegion(data.region ?? null)
      setBranding(data.branding || DEFAULT_BRANDING)
      setTemplate(data.template || DEFAULT_TEMPLATE)
      setLogoUrl(data.logoUrl || null)
      setPreview((data.preview as PreviewData | undefined) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch branding')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBranding()
  }, [fetchBranding])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/tenant/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branding, template }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to save branding')
      }

      setBranding(data.branding)
      setTemplate(data.template)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding')
    } finally {
      setSaving(false)
    }
  }

  // T-204: the business's own currency, tax and sample (they were dollars, "VAT (20%)" and a kitchen)
  const sample = preview?.sample ?? NEUTRAL_SAMPLE
  const currency = preview?.currency || getRegion(region).currency
  const formatCurrency = (amount: number) => formatMoney(amount, currency, getRegion(region).locale)
  const totals = previewTotals(sample, preview?.tax ?? { enabled: false, label: '', ratePercent: 0 })
  // Shown while loading only if nothing says otherwise: a business that hides the badge never sees it flash
  const badgeShown = preview ? preview.badgeShown : false

  if (loading) {
    return (
      <div>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div>

      {/* Success message */}
      {success && (
        <div className="mb-4 rounded-xl bg-secondary-light p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-secondary" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <p className="ml-3 text-sm text-secondary">Branding saved successfully</p>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-xl bg-danger-light p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-danger" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <p className="ml-3 text-sm text-danger">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-danger hover:text-danger">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settings Column */}
        <div className="space-y-6">
          {/* Logo section */}
          <div className="rounded-xl bg-surface p-6 shadow-warm">
            <h2 className="text-lg font-medium text-text-primary">Logo</h2>
            <p className="mt-1 text-sm text-text-muted">Your logo appears on quotes and the widget</p>

            <LogoUpload
              logoUrl={logoUrl}
              onError={setError}
              onChange={(assetId, url) => {
                setLogoUrl(url)
                setBranding((prev) => ({ ...prev, logoAssetId: assetId }))
              }}
            />
          </div>

          {/* Business identity */}
          <div className="rounded-xl bg-surface p-6 shadow-warm">
            <h2 className="text-lg font-medium text-text-primary">Business Details</h2>
            <p className="mt-1 text-sm text-text-muted">
              Shown on your quotes and PDFs so customers can reach you
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Tagline</label>
                <input
                  type="text"
                  value={branding.tagline || ''}
                  maxLength={80}
                  onChange={(e) => setBranding({ ...branding, tagline: e.target.value || null })}
                  placeholder="e.g., Family-run since 1998"
                  className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-text-secondary">Phone</label>
                  <input
                    type="tel"
                    value={branding.phone || ''}
                    onChange={(e) => setBranding({ ...branding, phone: e.target.value || null })}
                    placeholder={regionCopy.phoneExample}
                    className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary">Email</label>
                  <input
                    type="email"
                    value={branding.email || ''}
                    onChange={(e) => setBranding({ ...branding, email: e.target.value || null })}
                    placeholder={regionCopy.emailExample}
                    className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Website</label>
                <input
                  type="text"
                  value={branding.website || ''}
                  onChange={(e) => setBranding({ ...branding, website: e.target.value || null })}
                  placeholder={regionCopy.websiteExample}
                  className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                />
              </div>
            </div>
          </div>

          {/* Colors section */}
          <div className="rounded-xl bg-surface p-6 shadow-warm">
            <h2 className="text-lg font-medium text-text-primary">Brand Colors</h2>
            <p className="mt-1 text-sm text-text-muted">Customize the widget and quote appearance</p>

            <div className="mt-4">
              <label className="block text-sm font-medium text-text-secondary">Primary Color</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    title={preset.name}
                    onClick={() => setBranding({ ...branding, primaryColor: preset.hex })}
                    className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                      branding.primaryColor.toLowerCase() === preset.hex.toLowerCase()
                        ? 'ring-2 ring-ink ring-offset-2'
                        : 'ring-1 ring-border'
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="color"
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  className="h-10 w-10 cursor-pointer rounded-xl border border-border"
                />
                <input
                  type="text"
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="w-28 rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                />
              </div>
              <p className="mt-1 text-xs text-text-muted">Used for buttons, links, and accents</p>
            </div>
          </div>

          {/* Footer notes */}
          <div className="rounded-xl bg-surface p-6 shadow-warm">
            <h2 className="text-lg font-medium text-text-primary">Footer Notes</h2>
            <p className="mt-1 text-sm text-text-muted">
              Additional text shown at the bottom of quotes
            </p>

            <div className="mt-4">
              <textarea
                value={branding.footerNotes || ''}
                onChange={(e) => setBranding({ ...branding, footerNotes: e.target.value || null })}
                placeholder="e.g., Thank you for your business! Payment terms: Net 30"
                rows={3}
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
              />
            </div>
          </div>

          {/* Template toggles */}
          <div className="rounded-xl bg-surface p-6 shadow-warm">
            <h2 className="text-lg font-medium text-text-primary">Quote Template</h2>
            {/* T-201: says that the three tick boxes change the PDF and not the customer's page */}
            <p className="mt-1 text-sm text-text-muted">{PDF_ONLY_LINE}</p>

            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.showLineItems}
                  onChange={(e) => setTemplate({ ...template, showLineItems: e.target.checked })}
                  className="h-4 w-4 rounded-sm border-border text-primary"
                />
                <div>
                  <span className="text-sm font-medium text-text-secondary">Show line items</span>
                  <PdfOnlyTag />
                  <p className="text-xs text-text-muted">Print the price lines on the PDF</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.includeAssumptions}
                  onChange={(e) =>
                    setTemplate({ ...template, includeAssumptions: e.target.checked })
                  }
                  className="h-4 w-4 rounded-sm border-border text-primary"
                />
                <div>
                  <span className="text-sm font-medium text-text-secondary">Include assumptions</span>
                  <PdfOnlyTag />
                  <p className="text-xs text-text-muted">Print what the quote assumes to be true on the PDF</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.includeExclusions}
                  onChange={(e) =>
                    setTemplate({ ...template, includeExclusions: e.target.checked })
                  }
                  className="h-4 w-4 rounded-sm border-border text-primary"
                />
                <div>
                  <span className="text-sm font-medium text-text-secondary">Include exclusions</span>
                  <PdfOnlyTag />
                  <p className="text-xs text-text-muted">Print what is not included on the PDF</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.acceptQuoteEnabled !== false}
                  onChange={(e) =>
                    setTemplate({ ...template, acceptQuoteEnabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded-sm border-border text-primary"
                />
                <div>
                  <span className="text-sm font-medium text-text-secondary">Allow customers to accept quotes directly</span>
                  <p className="text-xs text-text-muted">Show an &quot;Accept Quote&quot; button on the customer quote page</p>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-text-secondary">
                  Quote validity (days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={template.validityDays}
                  onChange={(e) =>
                    setTemplate({ ...template, validityDays: parseInt(e.target.value) || 30 })
                  }
                  className="mt-1 w-24 rounded-xl border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                />
                <p className="mt-1 text-xs text-text-muted">
                  How long quotes remain valid for acceptance
                </p>
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </div>

        {/* Preview Column */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl bg-surface p-6 shadow-warm">
            <h2 className="text-lg font-medium text-text-primary">Preview</h2>
            {/* T-201: the sketch follows the tick boxes, which only the PDF does */}
            <p className="mb-4 mt-1 text-sm text-text-muted" data-testid="branding-preview-note">
              {sample.own
                ? `A sketch of your quote, with lines from your ${sample.serviceName} service at sample sizes. It follows the three tick boxes the way the PDF does.`
                : 'A sketch of your quote. Once a service has prices, its own lines show here. It follows the three tick boxes the way the PDF does.'}
            </p>

            {/* Quote Preview */}
            <div
              className="rounded-xl border border-border bg-surface p-6"
              style={{ '--primary-color': branding.primaryColor } as React.CSSProperties}
              data-testid="branding-preview"
            >
              {/* Header */}
              <div className="mb-6 flex items-start justify-between border-b border-border pb-4">
                <div>
                  {logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
                    <img src={logoUrl} alt="" className="mb-2 h-10 max-w-[160px] object-contain object-left" />
                  )}
                  <h3 className="text-xl font-bold text-text-primary">{tenantName || 'Your Business'}</h3>
                  {branding.tagline && (
                    <p className="text-xs text-text-secondary">{branding.tagline}</p>
                  )}
                  {(branding.phone || branding.email || branding.website) && (
                    <p className="text-[11px] text-text-muted">
                      {[branding.phone, branding.email, branding.website].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <p className="text-sm text-text-muted">Quote #12345678</p>
                </div>
                <div
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{ backgroundColor: branding.primaryColor, color: readableTextOn(branding.primaryColor) }}
                >
                  {sample.serviceName}
                </div>
              </div>

              {/* Customer */}
              <div className="mb-4">
                <p className="text-sm text-text-muted">Prepared for:</p>
                <p className="font-medium text-text-primary">{SAMPLE_CUSTOMER}</p>
              </div>

              {/* Scope */}
              <div className="mb-4">
                <p className="text-sm font-medium text-text-secondary">Scope of work</p>
                <p className="mt-1 text-sm text-text-secondary">{sample.scopeSummary}</p>
              </div>

              {/* Line Items */}
              {template.showLineItems && (
                <div className="mb-4">
                  <p className="mb-2 text-sm font-medium text-text-secondary">Pricing breakdown</p>
                  <div className="space-y-1">
                    {sample.lines.map((item, i) => (
                      <div key={i} className="flex justify-between gap-4 text-sm" data-testid="branding-preview-line">
                        <span className="text-text-secondary">{item.label}</span>
                        <span className="figure shrink-0 text-text-primary">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assumptions */}
              {template.includeAssumptions && sample.assumptions.length > 0 && (
                <div className="mb-4">
                  <p className="mb-1 text-sm font-medium text-text-secondary">Assumptions</p>
                  <ul className="list-inside list-disc text-sm text-text-secondary">
                    {sample.assumptions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Exclusions */}
              {template.includeExclusions && sample.exclusions.length > 0 && (
                <div className="mb-4">
                  <p className="mb-1 text-sm font-medium text-text-secondary">Exclusions</p>
                  <ul className="list-inside list-disc text-sm text-text-secondary">
                    {sample.exclusions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Total */}
              <div className="border-t border-border pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Subtotal</span>
                  <span className="figure">{formatCurrency(totals.subtotal)}</span>
                </div>
                {/* T-204: the business's own tax name and rate; no line at all when it charges none */}
                {totals.tax && (
                  <div className="flex justify-between text-sm" data-testid="branding-preview-tax">
                    <span className="text-text-secondary">
                      {totals.tax.label} ({ratePercentText(totals.tax.ratePercent)}%)
                    </span>
                    <span className="figure">{formatCurrency(totals.tax.amount)}</span>
                  </div>
                )}
                <div className="mt-2 flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span className="figure" style={{ color: branding.primaryColor }}>
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>

              {/* Validity */}
              <p className="mt-4 text-xs text-text-muted">
                This quote is valid for {template.validityDays} days from the date of issue.
              </p>

              {/* Footer notes */}
              {branding.footerNotes && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-xs text-text-muted">{branding.footerNotes}</p>
                </div>
              )}

              {/* Accept button preview */}
              {template.acceptQuoteEnabled !== false && (
                <button
                  className="mt-4 w-full rounded-xl py-2 text-sm font-medium"
                  style={{ backgroundColor: branding.primaryColor, color: readableTextOn(branding.primaryColor) }}
                >
                  Accept Quote
                </button>
              )}

              {/* T-204: only when this business's estimates carry the badge today (the free start and Pro hide it) */}
              {badgeShown && (
                <p className="mt-4 text-center text-[10px] text-text-muted" data-testid="branding-preview-badge">
                  Prepared with {PRODUCT_NAME}
                </p>
              )}
            </div>
            {/* T-201: the plan names come from the plans on offer (the line named a plan that no longer exists) */}
            <p className="mt-3 text-xs text-text-muted" data-testid="badge-plans-line">
              {preview?.badgeLine ?? noBadgeLine()}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
