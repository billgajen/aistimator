'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Embedded Widget Page
 *
 * This page is designed to be loaded in an iframe on partner websites.
 * It handles:
 * - TenantKey validation
 * - Origin validation (optional)
 * - PostMessage-based height resizing
 * - Full widget functionality
 */

interface EmbedPageProps {
  params: { tenantKey: string }
}

interface ServiceMediaConfig {
  minPhotos: number
  maxPhotos: number
  photoGuidance: string | null
}

interface MeasurementModel {
  type: 'fixed' | 'per_unit'
  unit: string | null
  unitLabel: string | null
  pricePerUnit: number
  askCustomerForQuantity: boolean
}

interface WidgetService {
  id: string
  name: string
  mediaConfig: ServiceMediaConfig
  measurementModel: MeasurementModel | null
}

interface WidgetField {
  fieldId: string
  type: string
  label: string
  required: boolean
  options?: Array<{ value: string; label: string }>
  placeholder?: string
  helpText?: string
}

interface WidgetData {
  tenantName: string
  services: WidgetService[]
  /** @deprecated Use globalFields instead. Kept for backwards compatibility. */
  fields: WidgetField[]
  /** Global fields that apply to all services (service_id = null) */
  globalFields: WidgetField[]
  /** Service-specific fields keyed by service ID */
  serviceFields: Record<string, WidgetField[]>
  files: {
    minPhotos: number
    maxPhotos: number
    maxDocs: number
  }
}

interface QuoteResponse {
  quoteId: string
  status: string
  quoteViewUrl: string
}

type Step = 'loading' | 'service' | 'details' | 'files' | 'contact' | 'submitting' | 'success' | 'error'

// File upload types
interface UploadedFile {
  id: string
  assetId: string
  file: File
  previewUrl: string
  status: 'pending' | 'uploading' | 'complete' | 'error'
  progress: number
  error?: string
}

// Helper function to get human-readable unit labels
function getUnitLabel(unit: string | null): string {
  const labels: Record<string, string> = {
    sqft: 'Square Footage',
    sqm: 'Square Meters',
    room: 'Number of Rooms',
    item: 'Number of Items',
    hour: 'Estimated Hours',
    linear_ft: 'Linear Feet',
    linear_m: 'Linear Meters',
  }
  return unit ? (labels[unit] || `Quantity (${unit})`) : 'Quantity'
}

// Validation helpers
function validateRequiredFields(
  fields: WidgetData['fields'],
  answers: Record<string, string | number | boolean | string[]>
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    if (!field.required) continue

    const value = answers[field.fieldId]

    if (value === undefined || value === null || value === '') {
      errors[field.fieldId] = `${field.label} is required`
      continue
    }

    // Check array types (checkbox multi-select)
    if (Array.isArray(value) && value.length === 0) {
      errors[field.fieldId] = `${field.label} is required`
      continue
    }
  }

  return errors
}

export default function EmbedPage({ params }: EmbedPageProps) {
  const { tenantKey } = params
  const searchParams = useSearchParams()
  const serviceId = searchParams.get('serviceId')

  const containerRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<Step>('loading')
  const [widgetData, setWidgetData] = useState<WidgetData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestedService, setSuggestedService] = useState<{ id: string; name: string } | null>(null)
  const [quoteResult, setQuoteResult] = useState<QuoteResponse | null>(null)

  // Form state
  const [selectedService, setSelectedService] = useState<string>(serviceId || '')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [jobAddress, setJobAddress] = useState('')
  const [jobPostcode, setJobPostcode] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [jobQuantity, setJobQuantity] = useState<number | null>(null)
  const [fieldAnswers, setFieldAnswers] = useState<Record<string, string | number | boolean | string[]>>({})

  // Get selected service data for media config and measurement model
  const selectedServiceData = widgetData?.services.find((s) => s.id === selectedService)
  const serviceMediaConfig = selectedServiceData?.mediaConfig
  const serviceMeasurementModel = selectedServiceData?.measurementModel

  // File upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  // Send height to parent iframe
  const sendHeight = useCallback(() => {
    if (containerRef.current && window.parent !== window) {
      const height = containerRef.current.scrollHeight
      window.parent.postMessage(
        {
          type: 'estimator-resize',
          height: height + 20, // Add padding
          tenantKey,
        },
        '*'
      )
    }
  }, [tenantKey])

  // Send height on content changes
  useEffect(() => {
    sendHeight()
    // Also send after a short delay to catch any async renders
    const timer = setTimeout(sendHeight, 100)
    return () => clearTimeout(timer)
  }, [step, widgetData, error, sendHeight])

  // Set up resize observer
  useEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      sendHeight()
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [sendHeight])

  // Load widget config
  const loadWidgetConfig = useCallback(async () => {
    setStep('loading')
    try {
      const response = await fetch(`/api/public/widget/config?tenantKey=${tenantKey}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error?.message || 'Failed to load widget')
        setStep('error')
        return
      }

      setWidgetData(data)

      // Skip service selection if only one service or service pre-selected
      if (serviceId) {
        setSelectedService(serviceId)
        setStep('details')
      } else if (data.services.length === 1) {
        setSelectedService(data.services[0].id)
        setStep('details')
      } else {
        setStep('service')
      }
    } catch {
      setError('Failed to connect to server')
      setStep('error')
    }
  }, [tenantKey, serviceId])

  useEffect(() => {
    loadWidgetConfig()
  }, [loadWidgetConfig])

  async function handleSubmit() {
    setStep('submitting')

    try {
      const response = await fetch('/api/public/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          serviceId: selectedService,
          customer: {
            name: customerName,
            email: customerEmail,
            phone: customerPhone || undefined,
          },
          job: {
            address: jobAddress || undefined,
            postcodeOrZip: jobPostcode || undefined,
            quantity: jobQuantity || undefined,
            answers: [
              // Include project description as a special field
              ...(jobDescription ? [{ fieldId: '_project_description', value: jobDescription }] : []),
              // Include quantity as a special field if provided
              ...(jobQuantity ? [{ fieldId: '_quantity', value: jobQuantity }] : []),
              // Include other field answers
              ...Object.entries(fieldAnswers).map(([fieldId, value]) => ({
                fieldId,
                value,
              })),
            ],
          },
          assetIds: uploadedFiles.filter((f) => f.status === 'complete').map((f) => f.assetId),
          source: {
            type: 'widget',
            pageUrl: document.referrer || undefined,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error?.message || 'Failed to submit')

        // Handle service mismatch with suggestion
        if (data.error?.code === 'SERVICE_MISMATCH' && data.error?.suggestedService) {
          setSuggestedService(data.error.suggestedService)
        } else {
          setSuggestedService(null)
        }

        setStep('error')
        return
      }

      setQuoteResult(data)
      setStep('success')

      // Notify parent of successful submission
      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'estimator-submitted',
            quoteId: data.quoteId,
            quoteViewUrl: data.quoteViewUrl,
            tenantKey,
          },
          '*'
        )
      }
    } catch {
      setError('Failed to submit quote request')
      setStep('error')
    }
  }

  // Calculate progress step number for indicator
  const showProgress = ['service', 'details', 'files', 'contact'].includes(step)
  const hasServiceStep = widgetData && widgetData.services.length > 1
  const showFilesStep = widgetData && (widgetData.files.maxPhotos > 0 || widgetData.files.maxDocs > 0)

  // Build progress steps array based on configuration
  const progressSteps: string[] = []
  if (hasServiceStep) progressSteps.push('Service')
  progressSteps.push('Details')
  if (showFilesStep) progressSteps.push('Photos')
  progressSteps.push('Contact')

  // Calculate current step index
  let currentProgressIndex = 0
  if (hasServiceStep && step === 'service') {
    currentProgressIndex = 0
  } else if (step === 'details') {
    currentProgressIndex = hasServiceStep ? 1 : 0
  } else if (step === 'files') {
    currentProgressIndex = hasServiceStep ? 2 : 1
  } else if (step === 'contact') {
    currentProgressIndex = progressSteps.length - 1
  }

  return (
    <div
      ref={containerRef}
      className="min-h-full bg-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}
    >
      {/* Progress indicator */}
      {showProgress && (
        <ProgressIndicator steps={progressSteps} currentStep={currentProgressIndex} />
      )}

      {step === 'loading' && <LoadingState />}
      {step === 'error' && (
        <ErrorState
          message={error}
          suggestedService={suggestedService}
          onRetry={loadWidgetConfig}
          onSelectSuggested={suggestedService ? () => {
            setSelectedService(suggestedService.id)
            setSuggestedService(null)
            setError(null)
            setStep('contact') // Go back to contact to resubmit
          } : undefined}
        />
      )}
      {step === 'service' && widgetData && (
        <ServiceStep
          tenantName={widgetData.tenantName}
          services={widgetData.services}
          onSelect={(id) => {
            setSelectedService(id)
            setStep('details')
          }}
        />
      )}
      {step === 'details' && widgetData && (
        <DetailsStep
          fields={[
            ...(widgetData.globalFields || widgetData.fields || []),
            ...(widgetData.serviceFields?.[selectedService] || []),
          ]}
          answers={fieldAnswers}
          jobAddress={jobAddress}
          jobPostcode={jobPostcode}
          jobDescription={jobDescription}
          jobQuantity={jobQuantity}
          measurementModel={serviceMeasurementModel}
          onFieldChange={(id, val) => setFieldAnswers((prev) => ({ ...prev, [id]: val }))}
          onAddressChange={setJobAddress}
          onPostcodeChange={setJobPostcode}
          onDescriptionChange={setJobDescription}
          onQuantityChange={setJobQuantity}
          onBack={widgetData.services.length > 1 ? () => setStep('service') : undefined}
          onNext={() => setStep(showFilesStep ? 'files' : 'contact')}
        />
      )}
      {step === 'files' && widgetData && (
        <FileUploadStep
          tenantKey={tenantKey}
          files={uploadedFiles}
          setFiles={setUploadedFiles}
          minPhotos={serviceMediaConfig?.minPhotos ?? widgetData.files.minPhotos}
          maxPhotos={serviceMediaConfig?.maxPhotos ?? widgetData.files.maxPhotos}
          maxDocs={widgetData.files.maxDocs}
          photoGuidance={serviceMediaConfig?.photoGuidance ?? null}
          onBack={() => setStep('details')}
          onNext={() => setStep('contact')}
        />
      )}
      {step === 'contact' && (
        <ContactStep
          name={customerName}
          email={customerEmail}
          phone={customerPhone}
          onNameChange={setCustomerName}
          onEmailChange={setCustomerEmail}
          onPhoneChange={setCustomerPhone}
          onBack={() => setStep(showFilesStep ? 'files' : 'details')}
          onSubmit={handleSubmit}
        />
      )}
      {step === 'submitting' && <SubmittingState />}
      {step === 'success' && quoteResult && (
        <SuccessState quoteUrl={quoteResult.quoteViewUrl} />
      )}
    </div>
  )
}

// Step Components

function ProgressIndicator({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="px-6 pt-4 pb-2">
      <div className="flex items-center justify-between">
        {steps.map((label, index) => {
          const isActive = index === currentStep
          const isCompleted = index < currentStep

          return (
            <div key={label} className="flex items-center flex-1">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    isCompleted
                      ? 'bg-blue-600 text-white'
                      : isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={`text-xs mt-1 ${
                    isActive || isCompleted ? 'text-blue-600 font-medium' : 'text-gray-500'
                  }`}
                >
                  {label}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    index < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
      <p className="text-gray-500 text-sm">Loading...</p>
    </div>
  )
}

function ErrorState({
  message,
  suggestedService,
  onRetry,
  onSelectSuggested,
}: {
  message: string | null
  suggestedService?: { id: string; name: string } | null
  onRetry: () => void
  onSelectSuggested?: () => void
}) {
  return (
    <div className="text-center py-12 px-4">
      <div className="text-4xl mb-4">⚠️</div>
      <p className="text-gray-600 mb-4">{message || 'Something went wrong'}</p>

      {suggestedService && onSelectSuggested && (
        <div className="mb-4">
          <button
            onClick={onSelectSuggested}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Switch to &quot;{suggestedService.name}&quot; and Submit
          </button>
        </div>
      )}

      <button
        onClick={onRetry}
        className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        Start Over
      </button>
    </div>
  )
}

function ServiceStep({
  tenantName,
  services,
  onSelect,
}: {
  tenantName: string
  services: Array<{ id: string; name: string }>
  onSelect: (id: string) => void
}) {
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">{tenantName}</h2>
      <p className="text-sm text-gray-500 mb-4">Select a service to get started</p>
      <div className="space-y-2">
        {services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect(service.id)}
            className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            {service.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailsStep({
  fields,
  answers,
  jobAddress,
  jobPostcode,
  jobDescription,
  jobQuantity,
  measurementModel,
  onFieldChange,
  onAddressChange,
  onPostcodeChange,
  onDescriptionChange,
  onQuantityChange,
  onBack,
  onNext,
}: {
  fields: WidgetData['fields']
  answers: Record<string, string | number | boolean | string[]>
  jobAddress: string
  jobPostcode: string
  jobDescription: string
  jobQuantity: number | null
  measurementModel: MeasurementModel | null | undefined
  onFieldChange: (id: string, value: string | number | boolean | string[]) => void
  onAddressChange: (value: string) => void
  onPostcodeChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onQuantityChange: (value: number | null) => void
  onBack?: () => void
  onNext: () => void
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  function handleContinue() {
    const validationErrors = validateRequiredFields(fields, answers)
    setErrors(validationErrors)

    // Mark all fields as touched to show errors
    const allTouched: Record<string, boolean> = {}
    fields.forEach((f) => {
      allTouched[f.fieldId] = true
    })
    setTouched(allTouched)

    if (Object.keys(validationErrors).length === 0) {
      onNext()
    }
  }

  function handleFieldBlur(fieldId: string) {
    setTouched((prev) => ({ ...prev, [fieldId]: true }))
    // Re-validate this field
    const field = fields.find((f) => f.fieldId === fieldId)
    if (field?.required) {
      const value = answers[fieldId]
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        setErrors((prev) => ({ ...prev, [fieldId]: `${field.label} is required` }))
      } else {
        setErrors((prev) => {
          const updated = { ...prev }
          delete updated[fieldId]
          return updated
        })
      }
    }
  }

  function handleCheckboxChange(fieldId: string, optionValue: string, checked: boolean) {
    const currentValues = (answers[fieldId] as string[]) || []
    const newValues = checked
      ? [...currentValues, optionValue]
      : currentValues.filter((v) => v !== optionValue)
    onFieldChange(fieldId, newValues)
  }

  const inputErrorClass = 'border-red-300 focus:ring-red-500 focus:border-red-500'
  const inputNormalClass = 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Job Details</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <input
            type="text"
            value={jobAddress}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="123 Main Street"
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${inputNormalClass}`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Postcode / ZIP</label>
          <input
            type="text"
            value={jobPostcode}
            onChange={(e) => onPostcodeChange(e.target.value)}
            placeholder="SW1A 1AA"
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${inputNormalClass}`}
          />
        </div>

        {/* Quantity field - shown when measurement model asks for customer quantity */}
        {measurementModel?.type === 'per_unit' && measurementModel.askCustomerForQuantity && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {measurementModel.unitLabel || getUnitLabel(measurementModel.unit)}
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={jobQuantity ?? ''}
              onChange={(e) => onQuantityChange(e.target.value ? Number(e.target.value) : null)}
              placeholder={`Enter ${measurementModel.unit || 'quantity'}`}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${inputNormalClass}`}
            />
            <p className="mt-1 text-xs text-gray-500">
              This helps us provide a more accurate estimate
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project Description <span className="text-red-500">*</span>
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Please describe your project requirements, including any specific needs, timeline, or questions you have..."
            rows={4}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${inputNormalClass}`}
          />
          <p className="mt-1 text-xs text-gray-500">
            The more detail you provide, the more accurate your quote will be.
          </p>
        </div>

        {fields.map((field) => {
          const hasError = touched[field.fieldId] && errors[field.fieldId]
          const fieldClass = hasError ? inputErrorClass : inputNormalClass

          return (
            <div key={field.fieldId}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>

              {/* Text input */}
              {field.type === 'text' && (
                <input
                  type="text"
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  placeholder={field.placeholder}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${fieldClass}`}
                />
              )}

              {/* Textarea */}
              {field.type === 'textarea' && (
                <textarea
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  placeholder={field.placeholder}
                  rows={3}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${fieldClass}`}
                />
              )}

              {/* Number input */}
              {field.type === 'number' && (
                <input
                  type="number"
                  value={(answers[field.fieldId] as number) ?? ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value ? Number(e.target.value) : '')}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  placeholder={field.placeholder}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${fieldClass}`}
                />
              )}

              {/* Select dropdown */}
              {field.type === 'select' && field.options && (
                <select
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${fieldClass}`}
                >
                  <option value="">Select...</option>
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Radio buttons */}
              {field.type === 'radio' && field.options && (
                <div className="space-y-2 mt-1">
                  {field.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={field.fieldId}
                        value={opt.value}
                        checked={(answers[field.fieldId] as string) === opt.value}
                        onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Checkbox (multi-select) */}
              {field.type === 'checkbox' && field.options && (
                <div className="space-y-2 mt-1">
                  {field.options.map((opt) => {
                    const currentValues = (answers[field.fieldId] as string[]) || []
                    return (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={currentValues.includes(opt.value)}
                          onChange={(e) => handleCheckboxChange(field.fieldId, opt.value, e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    )
                  })}
                </div>
              )}

              {/* Boolean (single checkbox) */}
              {field.type === 'boolean' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(answers[field.fieldId] as boolean) || false}
                    onChange={(e) => onFieldChange(field.fieldId, e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-600">{field.helpText || 'Yes'}</span>
                </label>
              )}

              {/* Help text */}
              {field.helpText && field.type !== 'boolean' && (
                <p className="text-xs text-gray-500 mt-1">{field.helpText}</p>
              )}

              {/* Error message */}
              {hasError && (
                <p className="text-xs text-red-600 mt-1">{errors[field.fieldId]}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-3 mt-6">
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
        )}
        <button
          onClick={handleContinue}
          className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

function FileUploadStep({
  tenantKey,
  files,
  setFiles,
  minPhotos,
  maxPhotos,
  maxDocs,
  photoGuidance,
  onBack,
  onNext,
}: {
  tenantKey: string
  files: UploadedFile[]
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>
  minPhotos: number
  maxPhotos: number
  maxDocs: number
  photoGuidance: string | null
  onBack: () => void
  onNext: () => void
}) {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const photoCount = files.filter((f) => f.file.type.startsWith('image/')).length
  const docCount = files.filter((f) => f.file.type === 'application/pdf').length
  const canAddPhotos = photoCount < maxPhotos
  const canAddDocs = docCount < maxDocs

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || [])
    if (selectedFiles.length === 0) return

    setIsUploading(true)

    for (const file of selectedFiles) {
      // Check file type
      const isImage = file.type.startsWith('image/')
      const isDoc = file.type === 'application/pdf'

      if (!isImage && !isDoc) {
        continue // Skip unsupported files
      }

      // Check limits
      if (isImage && photoCount >= maxPhotos) continue
      if (isDoc && docCount >= maxDocs) continue

      // Create preview
      const previewUrl = URL.createObjectURL(file)
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // Add to list with pending status
      const newFile: UploadedFile = {
        id: tempId,
        assetId: '',
        file,
        previewUrl,
        status: 'pending',
        progress: 0,
      }

      setFiles((prev) => [...prev, newFile])

      // Start upload
      try {
        // 1. Initialize upload
        const initResponse = await fetch('/api/public/uploads/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantKey,
            files: [{ fileName: file.name, contentType: file.type, sizeBytes: file.size }],
          }),
        })

        const initData = await initResponse.json()

        if (!initResponse.ok || !initData.uploads?.[0]) {
          throw new Error(initData.error?.message || 'Failed to initialize upload')
        }

        const { assetId, uploadUrl } = initData.uploads[0]

        // Update with assetId
        setFiles((prev) =>
          prev.map((f) =>
            f.id === tempId ? { ...f, assetId, status: 'uploading' as const } : f
          )
        )

        // 2. Upload file to R2 (or fallback endpoint)
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        })

        if (!uploadResponse.ok) {
          throw new Error('Upload failed')
        }

        // Mark as complete
        setFiles((prev) =>
          prev.map((f) =>
            f.id === tempId ? { ...f, status: 'complete' as const, progress: 100 } : f
          )
        )
      } catch (err) {
        // Mark as error
        setFiles((prev) =>
          prev.map((f) =>
            f.id === tempId
              ? { ...f, status: 'error' as const, error: err instanceof Error ? err.message : 'Upload failed' }
              : f
          )
        )
      }
    }

    setIsUploading(false)
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleRemove(fileId: string) {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === fileId)
      if (file) {
        URL.revokeObjectURL(file.previewUrl)
      }
      return prev.filter((f) => f.id !== fileId)
    })
  }

  const hasMinPhotos = photoCount >= minPhotos
  const canContinue = hasMinPhotos && !isUploading && files.every((f) => f.status !== 'uploading')

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Photos & Documents</h3>
      <p className="text-sm text-gray-600 mb-2">
        {minPhotos > 0
          ? `Add at least ${minPhotos} photo${minPhotos > 1 ? 's' : ''} of the job`
          : 'Add photos or documents (optional)'}
      </p>

      {/* Photo guidance from service configuration */}
      {photoGuidance && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">{photoGuidance}</p>
        </div>
      )}

      {/* File grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {files.map((file) => (
          <div
            key={file.id}
            className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden"
          >
            {file.file.type.startsWith('image/') ? (
              <img
                src={file.previewUrl}
                alt={file.file.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <span className="text-2xl">📄</span>
                  <p className="text-xs text-gray-500 mt-1 px-1 truncate">{file.file.name}</p>
                </div>
              </div>
            )}

            {/* Status overlay */}
            {file.status === 'uploading' && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
              </div>
            )}

            {file.status === 'error' && (
              <div className="absolute inset-0 bg-red-500 bg-opacity-75 flex items-center justify-center">
                <span className="text-white text-xs px-2 text-center">{file.error}</span>
              </div>
            )}

            {/* Remove button */}
            {file.status !== 'uploading' && (
              <button
                onClick={() => handleRemove(file.id)}
                className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 rounded-full text-white text-sm flex items-center justify-center hover:bg-opacity-75"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Add button */}
        {(canAddPhotos || canAddDocs) && (
          <label className="aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-50">
            <input
              ref={fileInputRef}
              type="file"
              accept={[
                ...(canAddPhotos ? ['image/jpeg', 'image/png', 'image/webp'] : []),
                ...(canAddDocs ? ['application/pdf'] : []),
              ].join(',')}
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="text-center">
              <span className="text-2xl text-gray-400">+</span>
              <p className="text-xs text-gray-400 mt-1">Add</p>
            </div>
          </label>
        )}
      </div>

      {/* Status text */}
      <p className="text-xs text-gray-500 mb-4">
        {photoCount} of {maxPhotos} photos
        {maxDocs > 0 && ` | ${docCount} of ${maxDocs} documents`}
      </p>

      {/* Validation message */}
      {!hasMinPhotos && minPhotos > 0 && (
        <p className="text-xs text-amber-600 mb-4">
          Please add at least {minPhotos} photo{minPhotos > 1 ? 's' : ''} to continue
        </p>
      )}

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

function ContactStep({
  name,
  email,
  phone,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onBack,
  onSubmit,
}: {
  name: string
  email: string
  phone: string
  onNameChange: (value: string) => void
  onEmailChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onBack: () => void
  onSubmit: () => void
}) {
  const isValid = name.trim() && email.trim() && email.includes('@')

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Contact Details</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="John Smith"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="john@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="+44 7700 900000"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!isValid}
          className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Get Quote
        </button>
      </div>
    </div>
  )
}

function SubmittingState() {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
      <p className="text-gray-500 text-sm">Submitting your request...</p>
    </div>
  )
}

function SuccessState({ quoteUrl }: { quoteUrl: string }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <span className="text-green-600 text-2xl">✓</span>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Request Submitted!</h3>
      <p className="text-sm text-gray-600 mb-6">
        We&apos;re preparing your quote. You&apos;ll receive it shortly.
      </p>
      <a
        href={quoteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        View Your Quote
      </a>
    </div>
  )
}
