'use client'

import { CustomerContactSettings } from '@/components/settings/CustomerContactSettings'
import { contactRequirementOf } from '@/lib/contact-rules'
import { useState, useEffect, useCallback } from 'react'
import type { ServiceAreaMode, RegionCode, UnitSystem } from '@estimator/shared'
import { getRegion, listRegions } from '@estimator/shared'

export const dynamic = 'force-dynamic'

const CURRENCIES = [
  { code: 'USD', label: 'USD - US Dollar', symbol: '$' },
  { code: 'GBP', label: 'GBP - British Pound', symbol: '£' },
  { code: 'EUR', label: 'EUR - Euro', symbol: '€' },
  { code: 'CAD', label: 'CAD - Canadian Dollar', symbol: '$' },
  { code: 'AUD', label: 'AUD - Australian Dollar', symbol: '$' },
  { code: 'NZD', label: 'NZD - New Zealand Dollar', symbol: '$' },
]

const SERVICE_AREA_MODES: { value: ServiceAreaMode; label: string; description: string }[] = [
  { value: 'none', label: 'No restrictions', description: 'Accept quotes from anywhere' },
  {
    value: 'postcode_allowlist',
    label: 'Postcode/ZIP allowlist',
    description: 'Only accept quotes from specific postcodes or ZIP codes',
  },
  {
    value: 'county_state',
    label: 'County/State',
    description: 'Only accept quotes from specific counties or states',
  },
]

interface TenantTemplate {
  showLineItems: boolean
  includeAssumptions: boolean
  includeExclusions: boolean
  validityDays: number
}

interface TenantSettings {
  id: string
  name: string
  region: RegionCode
  unitSystem: UnitSystem | null
  currency: string
  taxEnabled: boolean
  taxLabel: string | null
  taxRate: number
  serviceAreaMode: ServiceAreaMode
  serviceAreaValues: string[]
  notificationEmail: string | null
  defaultTermsText: string | null
  templateJson: TenantTemplate
}

/**
 * Settings → Business (T-152: the first tab of the Settings area).
 * Notifications moved to its own tab (/app/settings/notifications).
 */
export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [userEmail, setUserEmail] = useState<string>('')

  // Form state
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [region, setRegion] = useState<RegionCode>('US')
  const [unitSystem, setUnitSystem] = useState<UnitSystem | null>(null)
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxLabel, setTaxLabel] = useState('')
  const [taxRatePercent, setTaxRatePercent] = useState('0')
  const [serviceAreaMode, setServiceAreaMode] = useState<ServiceAreaMode>('none')
  const [serviceAreaInput, setServiceAreaInput] = useState('')

  // Quote Template state
  const [showLineItems, setShowLineItems] = useState(true)
  const [includeAssumptions, setIncludeAssumptions] = useState(true)
  const [includeExclusions, setIncludeExclusions] = useState(true)
  const [validityDays, setValidityDays] = useState('30')
  const [defaultTermsText, setDefaultTermsText] = useState('')


  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/tenant')
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to fetch settings')
      }

      const tenant = data.tenant as TenantSettings
      setSettings(tenant)
      setUserEmail(data.user?.email || '')

      // Populate form
      setName(tenant.name)
      setCurrency(tenant.currency)
      setRegion(tenant.region)
      setUnitSystem(tenant.unitSystem)
      setTaxEnabled(tenant.taxEnabled)
      setTaxLabel(tenant.taxLabel || '')
      setTaxRatePercent(((tenant.taxRate || 0) * 100).toString())
      setServiceAreaMode(tenant.serviceAreaMode)
      setServiceAreaInput((tenant.serviceAreaValues || []).join(', '))

      // Quote Template fields
      const template = tenant.templateJson || {
        showLineItems: true,
        includeAssumptions: true,
        includeExclusions: true,
        validityDays: 30,
      }
      setShowLineItems(template.showLineItems)
      setIncludeAssumptions(template.includeAssumptions)
      setIncludeExclusions(template.includeExclusions)
      setValidityDays(template.validityDays.toString())
      setDefaultTermsText(tenant.defaultTermsText || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async (
    section: 'business' | 'tax' | 'serviceArea' | 'quoteTemplate'
  ) => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      let updates: Record<string, unknown> = {}

      if (section === 'business') {
        if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
          throw new Error('Currency must be a 3-letter ISO code, e.g. USD')
        }
        updates = { name, region, unitSystem, currency: currency.trim().toUpperCase() }
      } else if (section === 'tax') {
        updates = {
          taxEnabled,
          taxLabel: taxLabel || null,
          taxRate: parseFloat(taxRatePercent) / 100 || 0,
        }
      } else if (section === 'serviceArea') {
        const values = serviceAreaInput
          .split(/[,\n]/)
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
        updates = {
          serviceAreaMode,
          serviceAreaValues: values,
        }
      } else if (section === 'quoteTemplate') {
        updates = {
          templateJson: {
            showLineItems,
            includeAssumptions,
            includeExclusions,
            validityDays: parseInt(validityDays) || 30,
          },
          defaultTermsText: defaultTermsText || null,
        }
      }

      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to save settings')
      }

      setSettings(data.tenant)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div>

      {/* Success message */}
      {success && (
        <div className="mb-4 rounded-warm-lg bg-secondary-light p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <p className="ml-3 text-sm text-secondary">Settings saved successfully</p>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-warm-lg bg-danger-light p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <p className="ml-3 text-sm text-danger">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-danger"
            >
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

      <div className="space-y-6">
        {/* Business Info */}
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <h2 className="text-lg font-medium text-text-primary">Business Information</h2>
          <p className="mt-1 text-sm text-text-muted">Basic information about your business</p>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-text-secondary">Business Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary">Contact Email</label>
              <input
                type="email"
                value={userEmail}
                className="mt-1 w-full rounded-warm-lg border border-border bg-background px-3 py-2 text-text-muted"
                disabled
              />
              <p className="mt-1 text-xs text-text-muted">Email is managed through your account</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary">Region</label>
              <select
                value={region}
                onChange={(e) => {
                  // Choosing a region applies its defaults; each stays overridable
                  const next = getRegion(e.target.value)
                  setRegion(next.code)
                  setCurrency(next.currency)
                  setUnitSystem(null)
                }}
                className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {listRegions().map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-muted">
                Sets currency, units, tax wording and {getRegion(region).copy.postalCodeLabel} format on your estimates
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary">Currency</label>
              <input
                type="text"
                list="currency-options"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 uppercase focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <datalist id="currency-options">
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </datalist>
              <p className="mt-1 text-xs text-text-muted">Any 3-letter ISO currency code</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary">Units</label>
              <select
                value={unitSystem ?? ''}
                onChange={(e) =>
                  setUnitSystem(e.target.value === '' ? null : (e.target.value as UnitSystem))
                }
                className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">
                  Region default ({getRegion(region).unitSystem === 'imperial' ? 'feet, sq ft' : 'metres, sqm'})
                </option>
                <option value="imperial">Imperial (feet, sq ft, gallons)</option>
                <option value="metric">Metric (metres, sqm, litres)</option>
              </select>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('business')}
              disabled={saving}
              className="inline-flex items-center rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Business Info'}
            </button>
          </div>
        </div>

        {/* Tax Settings */}
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <h2 className="text-lg font-medium text-text-primary">Tax Settings</h2>
          <p className="mt-1 text-sm text-text-muted">Configure how taxes are calculated on quotes</p>

          <div className="mt-6">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={taxEnabled}
                onChange={(e) => setTaxEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <span className="text-sm font-medium text-text-secondary">Enable tax on quotes</span>
            </label>
          </div>

          {taxEnabled && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-text-secondary">Tax Label</label>
                <input
                  type="text"
                  value={taxLabel}
                  onChange={(e) => setTaxLabel(e.target.value)}
                  placeholder={`${getRegion(region).copy.taxLabel} (region default)`}
                  className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="mt-1 text-xs text-text-muted">
                  This label appears on quotes (e.g., VAT, GST, Sales Tax)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary">Tax Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(e.target.value)}
                  className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="mt-1 text-xs text-text-muted">Enter as percentage (e.g., 20 for 20%)</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('tax')}
              disabled={saving}
              className="inline-flex items-center rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Tax Settings'}
            </button>
          </div>
        </div>

        {/* Service Area */}
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <h2 className="text-lg font-medium text-text-primary">Service Area</h2>
          <p className="mt-1 text-sm text-text-muted">Define where you provide services</p>

          <div className="mt-6 space-y-4">
            {SERVICE_AREA_MODES.map((mode) => (
              <label key={mode.value} className="flex items-start gap-3">
                <input
                  type="radio"
                  name="serviceArea"
                  value={mode.value}
                  checked={serviceAreaMode === mode.value}
                  onChange={(e) => setServiceAreaMode(e.target.value as ServiceAreaMode)}
                  className="mt-1 h-4 w-4 border-border text-primary focus:ring-primary/30"
                />
                <div>
                  <span className="text-sm font-medium text-text-secondary">{mode.label}</span>
                  <p className="text-xs text-text-muted">{mode.description}</p>
                </div>
              </label>
            ))}
          </div>

          {serviceAreaMode !== 'none' && (
            <div className="mt-6">
              <label className="block text-sm font-medium text-text-secondary">
                {serviceAreaMode === 'postcode_allowlist'
                  ? 'Allowed Postcodes/ZIP Codes'
                  : 'Allowed Counties/States'}
              </label>
              <textarea
                value={serviceAreaInput}
                onChange={(e) => setServiceAreaInput(e.target.value)}
                placeholder={
                  serviceAreaMode === 'postcode_allowlist'
                    ? 'Enter postcodes separated by commas or one per line\ne.g., SW1A, W1, EC1, 10001, 90210'
                    : 'Enter counties or states separated by commas or one per line\ne.g., California, Texas, New York'
                }
                rows={4}
                className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1 text-xs text-text-muted">
                Separate multiple values with commas or put each on a new line
              </p>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('serviceArea')}
              disabled={saving}
              className="inline-flex items-center rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Service Area'}
            </button>
          </div>
        </div>

        {/* Quote Template Settings */}
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <h2 className="text-lg font-medium text-text-primary">Quote Template</h2>
          <p className="mt-1 text-sm text-text-muted">
            Configure the default appearance and content of your quotes
          </p>

          <div className="mt-6 space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={showLineItems}
                onChange={(e) => setShowLineItems(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <div>
                <span className="text-sm font-medium text-text-secondary">Show line items</span>
                <p className="text-xs text-text-muted">Display itemized pricing breakdown on quotes</p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={includeAssumptions}
                onChange={(e) => setIncludeAssumptions(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <div>
                <span className="text-sm font-medium text-text-secondary">Include assumptions</span>
                <p className="text-xs text-text-muted">
                  Show assumptions section on quotes (e.g., &quot;Clear access to work area&quot;)
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={includeExclusions}
                onChange={(e) => setIncludeExclusions(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <div>
                <span className="text-sm font-medium text-text-secondary">Include exclusions</span>
                <p className="text-xs text-text-muted">
                  Show exclusions section on quotes (e.g., &quot;Materials not included&quot;)
                </p>
              </div>
            </label>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-text-secondary">
                Quote Validity (days)
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
                className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1 text-xs text-text-muted">
                How long quotes remain valid before expiring
              </p>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium text-text-secondary">
              Default Terms & Conditions
            </label>
            <textarea
              value={defaultTermsText}
              onChange={(e) => setDefaultTermsText(e.target.value)}
              placeholder="Enter your default terms and conditions text that will appear on all quotes..."
              rows={4}
              className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="mt-1 text-xs text-text-muted">
              This text will appear at the bottom of all quotes
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('quoteTemplate')}
              disabled={saving}
              className="inline-flex items-center rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Quote Template'}
            </button>
          </div>
        </div>

        {/* T-151: which contact details customers must give */}
        {settings && (
          <CustomerContactSettings
            initial={contactRequirementOf((settings as { contactRequirement?: string }).contactRequirement)}
          />
        )}

        {/* Account Info (read-only) */}
        <div className="rounded-warm-lg bg-background p-6">
          <h2 className="text-lg font-medium text-text-primary">Account Information</h2>
          <p className="mt-1 text-sm text-text-muted">Your account details</p>

          <div className="mt-4 text-sm text-text-secondary">
            <p>
              <span className="font-medium">Tenant ID:</span> {settings?.id}
            </p>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-warm-lg border border-danger/20 bg-danger-light p-6">
          <h2 className="text-lg font-medium text-danger">Danger Zone</h2>
          <p className="mt-1 text-sm text-danger">Irreversible actions that affect your account</p>

          <div className="mt-6">
            <button
              className="rounded-warm-lg border border-red-300 bg-surface px-4 py-2 text-sm font-medium text-danger hover:bg-danger-light"
              disabled
            >
              Delete Account
            </button>
            <p className="mt-2 text-xs text-danger">
              Account deletion is not available during beta. Contact support if needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
