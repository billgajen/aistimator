'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import type { TenantBranding, TenantTemplate } from '@estimator/shared'

export const dynamic = 'force-dynamic'

const DEFAULT_BRANDING: TenantBranding = {
  logoAssetId: null,
  primaryColor: '#2563eb',
  footerNotes: null,
}

const DEFAULT_TEMPLATE: TenantTemplate = {
  showLineItems: true,
  includeAssumptions: true,
  includeExclusions: true,
  validityDays: 30,
}

// Mock quote data for preview
const MOCK_QUOTE = {
  id: 'qte_preview123',
  serviceName: 'Kitchen Renovation',
  customer: {
    name: 'John Smith',
    email: 'john@example.com',
  },
  pricing: {
    breakdown: [
      { label: 'Base fee', amount: 500 },
      { label: 'Premium materials', amount: 250 },
      { label: 'Extended warranty', amount: 100 },
    ],
    subtotal: 850,
    taxLabel: 'VAT',
    taxRate: 0.2,
    taxAmount: 170,
    total: 1020,
  },
  content: {
    scopeSummary: 'Complete kitchen renovation including cabinet installation, countertop replacement, and new appliances.',
    assumptions: [
      'Access to property during normal business hours',
      'Electrical and plumbing in good condition',
      'Customer to clear work area before start',
    ],
    exclusions: [
      'Structural modifications',
      'Flooring replacement',
      'Appliance disposal',
    ],
  },
  createdAt: new Date().toISOString(),
}

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

  // Branding state
  const [branding, setBranding] = useState<TenantBranding>(DEFAULT_BRANDING)

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
      setBranding(data.branding || DEFAULT_BRANDING)
      setTemplate(data.template || DEFAULT_TEMPLATE)
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Branding" description="Customize how your quotes look to customers" />
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Branding" description="Customize how your quotes look to customers" />

      {/* Success message */}
      {success && (
        <div className="mb-4 rounded-md bg-green-50 p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <p className="ml-3 text-sm text-green-700">Branding saved successfully</p>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <p className="ml-3 text-sm text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
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
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-gray-900">Logo</h2>
            <p className="mt-1 text-sm text-gray-500">Your logo appears on quotes and the widget</p>

            <div className="mt-4 flex h-32 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
              <div className="text-center">
                <svg
                  className="mx-auto h-8 w-8 text-gray-400"
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
                <p className="mt-2 text-sm text-gray-500">Logo upload coming soon</p>
                <p className="text-xs text-gray-400">PNG, JPG up to 2MB</p>
              </div>
            </div>
          </div>

          {/* Colors section */}
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-gray-900">Brand Colors</h2>
            <p className="mt-1 text-sm text-gray-500">Customize the widget and quote appearance</p>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">Primary Color</label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="color"
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  className="h-10 w-10 cursor-pointer rounded-lg border border-gray-300"
                />
                <input
                  type="text"
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                  pattern="^#[0-9A-Fa-f]{6}$"
                  className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">Used for buttons, links, and accents</p>
            </div>
          </div>

          {/* Footer notes */}
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-gray-900">Footer Notes</h2>
            <p className="mt-1 text-sm text-gray-500">
              Additional text shown at the bottom of quotes
            </p>

            <div className="mt-4">
              <textarea
                value={branding.footerNotes || ''}
                onChange={(e) => setBranding({ ...branding, footerNotes: e.target.value || null })}
                placeholder="e.g., Thank you for your business! Payment terms: Net 30"
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Template toggles */}
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="text-lg font-medium text-gray-900">Quote Template</h2>
            <p className="mt-1 text-sm text-gray-500">Choose which sections to show on quotes</p>

            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.showLineItems}
                  onChange={(e) => setTemplate({ ...template, showLineItems: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Show line items</span>
                  <p className="text-xs text-gray-500">Display itemized breakdown of costs</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.includeAssumptions}
                  onChange={(e) =>
                    setTemplate({ ...template, includeAssumptions: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Include assumptions</span>
                  <p className="text-xs text-gray-500">Show what the quote assumes to be true</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={template.includeExclusions}
                  onChange={(e) =>
                    setTemplate({ ...template, includeExclusions: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">Include exclusions</span>
                  <p className="text-xs text-gray-500">Show what is not included in the quote</p>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-gray-700">
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
                  className="mt-1 w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
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
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-medium text-gray-900">Preview</h2>

            {/* Quote Preview */}
            <div
              className="rounded-lg border border-gray-200 bg-white p-6"
              style={{ '--primary-color': branding.primaryColor } as React.CSSProperties}
            >
              {/* Header */}
              <div className="mb-6 flex items-start justify-between border-b border-gray-200 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{tenantName || 'Your Business'}</h3>
                  <p className="text-sm text-gray-500">Quote #{MOCK_QUOTE.id.slice(-8)}</p>
                </div>
                <div
                  className="rounded-full px-3 py-1 text-xs font-medium text-white"
                  style={{ backgroundColor: branding.primaryColor }}
                >
                  {MOCK_QUOTE.serviceName}
                </div>
              </div>

              {/* Customer */}
              <div className="mb-4">
                <p className="text-sm text-gray-500">Prepared for:</p>
                <p className="font-medium text-gray-900">{MOCK_QUOTE.customer.name}</p>
              </div>

              {/* Scope */}
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700">Scope of Work</p>
                <p className="mt-1 text-sm text-gray-600">{MOCK_QUOTE.content.scopeSummary}</p>
              </div>

              {/* Line Items */}
              {template.showLineItems && (
                <div className="mb-4">
                  <p className="mb-2 text-sm font-medium text-gray-700">Pricing Breakdown</p>
                  <div className="space-y-1">
                    {MOCK_QUOTE.pricing.breakdown.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600">{item.label}</span>
                        <span className="text-gray-900">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assumptions */}
              {template.includeAssumptions && MOCK_QUOTE.content.assumptions && (
                <div className="mb-4">
                  <p className="mb-1 text-sm font-medium text-gray-700">Assumptions</p>
                  <ul className="list-inside list-disc text-sm text-gray-600">
                    {MOCK_QUOTE.content.assumptions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Exclusions */}
              {template.includeExclusions && MOCK_QUOTE.content.exclusions && (
                <div className="mb-4">
                  <p className="mb-1 text-sm font-medium text-gray-700">Exclusions</p>
                  <ul className="list-inside list-disc text-sm text-gray-600">
                    {MOCK_QUOTE.content.exclusions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Total */}
              <div className="border-t border-gray-200 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span>{formatCurrency(MOCK_QUOTE.pricing.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {MOCK_QUOTE.pricing.taxLabel} ({(MOCK_QUOTE.pricing.taxRate * 100).toFixed(0)}%)
                  </span>
                  <span>{formatCurrency(MOCK_QUOTE.pricing.taxAmount)}</span>
                </div>
                <div className="mt-2 flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span style={{ color: branding.primaryColor }}>
                    {formatCurrency(MOCK_QUOTE.pricing.total)}
                  </span>
                </div>
              </div>

              {/* Validity */}
              <p className="mt-4 text-xs text-gray-500">
                This quote is valid for {template.validityDays} days from the date of issue.
              </p>

              {/* Footer notes */}
              {branding.footerNotes && (
                <div className="mt-4 border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-500">{branding.footerNotes}</p>
                </div>
              )}

              {/* Accept button preview */}
              <button
                className="mt-4 w-full rounded-lg py-2 text-sm font-medium text-white"
                style={{ backgroundColor: branding.primaryColor }}
              >
                Accept Quote
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
