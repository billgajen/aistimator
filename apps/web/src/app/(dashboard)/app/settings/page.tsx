'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import type { ServiceAreaMode } from '@estimator/shared'

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
 * Settings Page
 *
 * Manage account and tenant settings.
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

  // Notifications state
  const [notificationEmail, setNotificationEmail] = useState('')

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

      // Notifications
      setNotificationEmail(tenant.notificationEmail || '')
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
    section: 'business' | 'tax' | 'serviceArea' | 'quoteTemplate' | 'notifications'
  ) => {
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      let updates: Record<string, unknown> = {}

      if (section === 'business') {
        updates = { name, currency }
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
      } else if (section === 'notifications') {
        updates = {
          notificationEmail: notificationEmail || null,
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
        <PageHeader title="Settings" description="Manage your account and business settings" />
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Settings" description="Manage your account and business settings" />

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
            <p className="ml-3 text-sm text-green-700">Settings saved successfully</p>
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
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600"
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
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-gray-900">Business Information</h2>
          <p className="mt-1 text-sm text-gray-500">Basic information about your business</p>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Business Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Contact Email</label>
              <input
                type="email"
                value={userEmail}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-gray-500"
                disabled
              />
              <p className="mt-1 text-xs text-gray-500">Email is managed through your account</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('business')}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Business Info'}
            </button>
          </div>
        </div>

        {/* Tax Settings */}
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-gray-900">Tax Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Configure how taxes are calculated on quotes</p>

          <div className="mt-6">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={taxEnabled}
                onChange={(e) => setTaxEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable tax on quotes</span>
            </label>
          </div>

          {taxEnabled && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Tax Label</label>
                <input
                  type="text"
                  value={taxLabel}
                  onChange={(e) => setTaxLabel(e.target.value)}
                  placeholder="e.g., VAT, GST, Sales Tax"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This label appears on quotes (e.g., VAT, GST, Sales Tax)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Tax Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Enter as percentage (e.g., 20 for 20%)</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('tax')}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Tax Settings'}
            </button>
          </div>
        </div>

        {/* Service Area */}
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-gray-900">Service Area</h2>
          <p className="mt-1 text-sm text-gray-500">Define where you provide services</p>

          <div className="mt-6 space-y-4">
            {SERVICE_AREA_MODES.map((mode) => (
              <label key={mode.value} className="flex items-start gap-3">
                <input
                  type="radio"
                  name="serviceArea"
                  value={mode.value}
                  checked={serviceAreaMode === mode.value}
                  onChange={(e) => setServiceAreaMode(e.target.value as ServiceAreaMode)}
                  className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">{mode.label}</span>
                  <p className="text-xs text-gray-500">{mode.description}</p>
                </div>
              </label>
            ))}
          </div>

          {serviceAreaMode !== 'none' && (
            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700">
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
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Separate multiple values with commas or put each on a new line
              </p>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('serviceArea')}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Service Area'}
            </button>
          </div>
        </div>

        {/* Quote Template Settings */}
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-gray-900">Quote Template</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure the default appearance and content of your quotes
          </p>

          <div className="mt-6 space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={showLineItems}
                onChange={(e) => setShowLineItems(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Show line items</span>
                <p className="text-xs text-gray-500">Display itemized pricing breakdown on quotes</p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={includeAssumptions}
                onChange={(e) => setIncludeAssumptions(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Include assumptions</span>
                <p className="text-xs text-gray-500">
                  Show assumptions section on quotes (e.g., &quot;Clear access to work area&quot;)
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={includeExclusions}
                onChange={(e) => setIncludeExclusions(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Include exclusions</span>
                <p className="text-xs text-gray-500">
                  Show exclusions section on quotes (e.g., &quot;Materials not included&quot;)
                </p>
              </div>
            </label>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Quote Validity (days)
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                How long quotes remain valid before expiring
              </p>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-700">
              Default Terms & Conditions
            </label>
            <textarea
              value={defaultTermsText}
              onChange={(e) => setDefaultTermsText(e.target.value)}
              placeholder="Enter your default terms and conditions text that will appear on all quotes..."
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              This text will appear at the bottom of all quotes
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('quoteTemplate')}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Quote Template'}
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-gray-900">Notifications</h2>
          <p className="mt-1 text-sm text-gray-500">Configure how you receive quote notifications</p>

          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-700">
              Notification Email (Override)
            </label>
            <input
              type="email"
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.target.value)}
              placeholder={userEmail || 'Leave empty to use account email'}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Quote notifications will be sent to this email instead of your account email. Leave
              empty to use your account email ({userEmail}).
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => handleSave('notifications')}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Notifications'}
            </button>
          </div>
        </div>

        {/* Account Info (read-only) */}
        <div className="rounded-lg bg-gray-50 p-6">
          <h2 className="text-lg font-medium text-gray-900">Account Information</h2>
          <p className="mt-1 text-sm text-gray-500">Your account details</p>

          <div className="mt-4 text-sm text-gray-600">
            <p>
              <span className="font-medium">Tenant ID:</span> {settings?.id}
            </p>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-lg font-medium text-red-800">Danger Zone</h2>
          <p className="mt-1 text-sm text-red-600">Irreversible actions that affect your account</p>

          <div className="mt-6">
            <button
              className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              disabled
            >
              Delete Account
            </button>
            <p className="mt-2 text-xs text-red-600">
              Account deletion is not available during beta. Contact support if needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
