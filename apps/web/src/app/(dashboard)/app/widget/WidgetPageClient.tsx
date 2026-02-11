'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'

interface WidgetPageClientProps {
  tenantKey: string
}

/**
 * Field type options
 */
const FIELD_TYPES = [
  { value: 'text', label: 'Text Input' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'checkbox', label: 'Checkboxes (Multi-select)' },
  { value: 'boolean', label: 'Yes/No Toggle' },
] as const

type FieldType = (typeof FIELD_TYPES)[number]['value']

interface FieldOption {
  value: string
  label: string
}

interface WidgetField {
  fieldId: string
  type: FieldType
  label: string
  required: boolean
  placeholder?: string
  helpText?: string
  options?: FieldOption[]
  /** Service ID this field belongs to (null = global/all services) */
  serviceId?: string | null
}

interface Service {
  id: string
  name: string
  active: boolean
}

interface WidgetConfig {
  fields: WidgetField[]
  files: {
    minPhotos: number
    maxPhotos: number
    maxDocs: number
  }
}

const DEFAULT_CONFIG: WidgetConfig = {
  fields: [],
  files: {
    minPhotos: 0,
    maxPhotos: 8,
    maxDocs: 3,
  },
}

function generateFieldId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 30) || `field_${Date.now()}`
}

/**
 * Widget & Embed Page Client Component
 *
 * Configure widget form fields and get embed code.
 */
export function WidgetPageClient({ tenantKey }: WidgetPageClientProps) {
  const [embedMode, setEmbedMode] = useState<'iframe' | 'floating' | 'inline'>('iframe')
  const [embedCode, setEmbedCode] = useState('')
  const [copied, setCopied] = useState(false)

  // Form builder state
  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Field editing state
  const [showAddField, setShowAddField] = useState(false)
  const [newField, setNewField] = useState<WidgetField>({
    fieldId: '',
    type: 'select',
    label: '',
    required: false,
    options: [{ value: '', label: '' }],
    serviceId: null,
  })

  // Services for service-specific fields
  const [services, setServices] = useState<Service[]>([])

  // Load services for service selector
  const loadServices = useCallback(async () => {
    try {
      const res = await fetch('/api/services')
      const data = await res.json()
      if (res.ok && data.services) {
        setServices(data.services.filter((s: Service) => s.active))
      }
    } catch (err) {
      console.error('Failed to load services:', err)
    }
  }, [])

  // Load config on mount
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/widget/config')
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to load config')
      }

      setConfig(data.config || DEFAULT_CONFIG)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadServices()
  }, [loadConfig, loadServices])

  // Save config
  const saveConfig = async () => {
    try {
      setSaving(true)
      setError(null)
      const res = await fetch('/api/widget/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to save config')
      }

      setHasChanges(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  // Update config and mark as changed
  const updateConfig = (updates: Partial<WidgetConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }))
    setHasChanges(true)
  }

  // Add a new field
  const addField = () => {
    if (!newField.label.trim()) {
      setError('Field label is required')
      return
    }

    const fieldId = newField.fieldId || generateFieldId(newField.label)

    // Check for duplicate fieldId
    if (config.fields.some((f) => f.fieldId === fieldId)) {
      setError(`Field ID "${fieldId}" already exists`)
      return
    }

    // Validate options for select/radio/checkbox
    if (['select', 'radio', 'checkbox'].includes(newField.type)) {
      const validOptions = newField.options?.filter((o) => o.value.trim() && o.label.trim()) || []
      if (validOptions.length === 0) {
        setError('At least one option with value and label is required')
        return
      }
      newField.options = validOptions
    } else {
      delete newField.options
    }

    updateConfig({
      fields: [...config.fields, { ...newField, fieldId }],
    })

    // Reset form
    setNewField({
      fieldId: '',
      type: 'select',
      label: '',
      required: false,
      options: [{ value: '', label: '' }],
      serviceId: null,
    })
    setShowAddField(false)
    setError(null)
  }

  // Remove a field
  const removeField = (index: number) => {
    updateConfig({
      fields: config.fields.filter((_, i) => i !== index),
    })
  }

  // Move field up/down
  const moveField = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= config.fields.length) return

    const newFields = [...config.fields]
    const removed = newFields.splice(index, 1)[0]
    if (removed) {
      newFields.splice(newIndex, 0, removed)
      updateConfig({ fields: newFields })
    }
  }

  // Update a field
  const updateField = (index: number, updates: Partial<WidgetField>) => {
    const newFields = [...config.fields]
    const existingField = newFields[index]
    if (existingField) {
      newFields[index] = { ...existingField, ...updates }
      updateConfig({ fields: newFields })
    }
  }

  // Add option to new field
  const addOption = () => {
    setNewField((prev) => ({
      ...prev,
      options: [...(prev.options || []), { value: '', label: '' }],
    }))
  }

  // Update option in new field
  const updateNewFieldOption = (optIndex: number, field: 'value' | 'label', value: string) => {
    setNewField((prev) => ({
      ...prev,
      options: prev.options?.map((opt, i) =>
        i === optIndex ? { ...opt, [field]: value } : opt
      ),
    }))
  }

  // Remove option from new field
  const removeNewFieldOption = (optIndex: number) => {
    setNewField((prev) => ({
      ...prev,
      options: prev.options?.filter((_, i) => i !== optIndex),
    }))
  }

  // Generate embed code
  useEffect(() => {
    const origin = window.location.origin

    let code = ''
    switch (embedMode) {
      case 'iframe':
        code = `<!-- Estimator Widget (Iframe) -->
<div id="estimator-widget"></div>
<script
  src="${origin}/iframe-loader.js"
  data-tenant-key="${tenantKey}"
  data-container="#estimator-widget"
  async
></script>`
        break
      case 'floating':
        code = `<!-- Estimator Widget (Floating) -->
<script
  src="${origin}/widget.js"
  data-tenant-key="${tenantKey}"
  data-mode="floating"
  data-button-label="Get Quote"
  async
></script>`
        break
      case 'inline':
        code = `<!-- Estimator Widget (Inline) -->
<div id="estimator-widget"></div>
<script
  src="${origin}/widget.js"
  data-tenant-key="${tenantKey}"
  data-mode="inline"
  data-container="#estimator-widget"
  async
></script>`
        break
    }
    setEmbedCode(code)
  }, [embedMode, tenantKey])

  function handleCopy() {
    navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const needsOptions = ['select', 'radio', 'checkbox'].includes(newField.type)

  return (
    <div>
      <PageHeader
        title="Widget & Embed"
        description="Configure the quote request form and embed it on your website"
        actions={
          hasChanges && (
            <button
              onClick={saveConfig}
              disabled={saving}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )
        }
      />

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-md bg-danger-light p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-danger">
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

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Form Configuration */}
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-text-primary">Form Fields</h2>
              <p className="mt-1 text-sm text-text-muted">
                Configure the questions shown to customers
              </p>
            </div>
            <button
              onClick={() => setShowAddField(true)}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
            >
              <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Field
            </button>
          </div>

          {loading ? (
            <div className="mt-6 flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : config.fields.length === 0 && !showAddField ? (
            <div className="mt-6 rounded-warm-lg border-2 border-dashed border-border p-8 text-center">
              <svg className="mx-auto h-10 w-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="mt-2 text-sm text-text-muted">
                No custom fields yet. Add fields to collect specific information from customers.
              </p>
              <button
                onClick={() => setShowAddField(true)}
                className="mt-4 inline-flex items-center text-sm font-medium text-primary hover:text-primary"
              >
                <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add your first field
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {/* Existing fields */}
              {config.fields.map((field, index) => (
                <div
                  key={field.fieldId}
                  className="flex items-center gap-3 rounded-warm-lg border border-border p-3"
                >
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveField(index, 'up')}
                      disabled={index === 0}
                      className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => moveField(index, 'down')}
                      disabled={index === config.fields.length - 1}
                      className="text-text-muted hover:text-text-secondary disabled:opacity-30"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{field.label}</span>
                      {field.required && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">Required</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <span className="rounded bg-background px-1.5 py-0.5">
                        {FIELD_TYPES.find((t) => t.value === field.type)?.label || field.type}
                      </span>
                      <span className="font-mono">{field.fieldId}</span>
                      {field.options && (
                        <span>{field.options.length} options</span>
                      )}
                      {field.serviceId ? (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                          {services.find((s) => s.id === field.serviceId)?.name || 'Service-specific'}
                        </span>
                      ) : (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-secondary">
                          All Services
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateField(index, { required: !field.required })}
                      className={`rounded px-2 py-1 text-xs ${
                        field.required
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-background text-text-secondary hover:bg-gray-200'
                      }`}
                    >
                      {field.required ? 'Required' : 'Optional'}
                    </button>
                    <button
                      onClick={() => removeField(index)}
                      className="text-text-muted hover:text-danger"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {/* Add field form */}
              {showAddField && (
                <div className="rounded-warm-lg border-2 border-primary/20 bg-primary-light p-4">
                  <h3 className="font-medium text-text-primary">Add New Field</h3>

                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary">Label *</label>
                        <input
                          type="text"
                          value={newField.label}
                          onChange={(e) => setNewField((prev) => ({ ...prev, label: e.target.value }))}
                          placeholder="e.g., Surface Condition"
                          className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary">Field Type *</label>
                        <select
                          value={newField.type}
                          onChange={(e) => setNewField((prev) => ({ ...prev, type: e.target.value as FieldType }))}
                          className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary">
                          Field ID
                          <span className="ml-1 text-xs font-normal text-text-muted">(auto-generated if blank)</span>
                        </label>
                        <input
                          type="text"
                          value={newField.fieldId}
                          onChange={(e) => setNewField((prev) => ({ ...prev, fieldId: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                          placeholder={generateFieldId(newField.label) || 'field_id'}
                          className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary">Show for Service</label>
                        <select
                          value={newField.serviceId || ''}
                          onChange={(e) => setNewField((prev) => ({ ...prev, serviceId: e.target.value || null }))}
                          className="mt-1 w-full rounded-warm-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <option value="">All Services (Global)</option>
                          {services.map((service) => (
                            <option key={service.id} value={service.id}>{service.name}</option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-text-muted">
                          Global fields show for all services. Service-specific fields only show when that service is selected.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newField.required}
                          onChange={(e) => setNewField((prev) => ({ ...prev, required: e.target.checked }))}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                        />
                        <span className="text-sm text-text-secondary">Required field</span>
                      </label>
                    </div>

                    {needsOptions && (
                      <div>
                        <label className="block text-sm font-medium text-text-secondary">Options *</label>
                        <div className="mt-2 space-y-2">
                          {newField.options?.map((opt, optIndex) => (
                            <div key={optIndex} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={opt.value}
                                onChange={(e) => updateNewFieldOption(optIndex, 'value', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                placeholder="value"
                                className="w-32 rounded-warm-lg border border-border px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <input
                                type="text"
                                value={opt.label}
                                onChange={(e) => updateNewFieldOption(optIndex, 'label', e.target.value)}
                                placeholder="Display label"
                                className="flex-1 rounded-warm-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              {(newField.options?.length || 0) > 1 && (
                                <button
                                  onClick={() => removeNewFieldOption(optIndex)}
                                  className="text-text-muted hover:text-danger"
                                >
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={addOption}
                            className="text-sm text-primary hover:text-primary"
                          >
                            + Add option
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          Use the value in multiplier rules (e.g., &quot;poor&quot; for condition field)
                        </p>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        onClick={() => {
                          setShowAddField(false)
                          setNewField({
                            fieldId: '',
                            type: 'select',
                            label: '',
                            required: false,
                            options: [{ value: '', label: '' }],
                            serviceId: null,
                          })
                        }}
                        className="rounded-warm-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-background"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={addField}
                        className="rounded-warm-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
                      >
                        Add Field
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tip about multipliers */}
          {config.fields.length > 0 && (
            <div className="mt-6 rounded-warm-lg bg-amber-50 p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-amber-800">Use with Pricing Multipliers</h3>
                  <p className="mt-1 text-sm text-amber-700">
                    Go to Pricing Rules to create multipliers that adjust prices based on customer answers.
                    Use the Field ID (e.g., &quot;{config.fields[0]?.fieldId}&quot;) when setting up multiplier conditions.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Embed Code */}
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <h2 className="text-lg font-medium text-text-primary">Embed Code</h2>
          <p className="mt-1 text-sm text-text-muted">
            Copy this code to your website
          </p>

          {/* Tenant Key Display */}
          <div className="mt-4 rounded-md bg-background p-3">
            <p className="text-xs text-text-muted">Your Tenant Key</p>
            <code className="text-sm font-mono text-text-primary">{tenantKey}</code>
          </div>

          {/* Mode selector */}
          <div className="mt-4 flex gap-2">
            {(['iframe', 'floating', 'inline'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setEmbedMode(mode)}
                className={`rounded-warm-lg px-3 py-1.5 text-sm font-medium capitalize ${
                  embedMode === mode
                    ? 'bg-blue-100 text-primary'
                    : 'bg-background text-text-secondary hover:bg-gray-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Code preview */}
          <pre className="mt-4 overflow-x-auto rounded-warm-lg bg-text-primary p-4 text-sm text-gray-100 whitespace-pre-wrap">
            {embedCode || 'Loading...'}
          </pre>

          <button
            onClick={handleCopy}
            className="mt-4 inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
          >
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>

      {/* Preview link */}
      <div className="mt-8 rounded-warm-lg bg-primary-light p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-primary">Test your widget</h3>
            <p className="text-sm text-primary">
              Preview how the widget looks and works before embedding
            </p>
          </div>
          <a
            href={`/demo?tenantKey=${tenantKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Open Demo Page
            <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  )
}
