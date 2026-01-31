/**
 * Main Widget Component
 *
 * A multi-step form for submitting quote requests.
 */

import { useState, useEffect, useRef } from 'preact/hooks'
import type { WidgetData, FormData, QuoteResponse, ServiceOption, FieldConfig, ServiceMediaConfig } from './types'

interface WidgetProps {
  tenantKey: string
  serviceId?: string
  apiUrl?: string
  onClose: () => void
  inline: boolean
}

type Step = 'loading' | 'service' | 'details' | 'photos' | 'contact' | 'submitting' | 'success' | 'error'
type FieldValue = string | number | boolean | string[]

interface UploadedPhoto {
  assetId: string
  file: File
  previewUrl: string
  angleId?: string // Which required angle this photo satisfies (if any)
}

const DEFAULT_API_URL = ''

// Validation helper
function validateRequiredFields(
  fields: FieldConfig[],
  answers: Record<string, FieldValue>
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    // Validate both required and criticalForPricing fields
    if (!field.required && !field.criticalForPricing) continue

    const value = answers[field.fieldId]

    if (value === undefined || value === null || value === '') {
      errors[field.fieldId] = field.criticalForPricing
        ? `${field.label} is important for accurate pricing`
        : `${field.label} is required`
      continue
    }

    // Check array types (checkbox multi-select)
    if (Array.isArray(value) && value.length === 0) {
      errors[field.fieldId] = field.criticalForPricing
        ? `${field.label} is important for accurate pricing`
        : `${field.label} is required`
      continue
    }
  }

  return errors
}

export function Widget({ tenantKey, serviceId: initialServiceId, apiUrl, onClose, inline }: WidgetProps) {
  const [step, setStep] = useState<Step>('loading')
  const [widgetData, setWidgetData] = useState<WidgetData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quoteResult, setQuoteResult] = useState<QuoteResponse | null>(null)

  // Form state
  const [selectedService, setSelectedService] = useState<string>(initialServiceId || '')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [jobAddress, setJobAddress] = useState('')
  const [jobPostcode, setJobPostcode] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [fieldAnswers, setFieldAnswers] = useState<Record<string, FieldValue>>({})
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([])

  const baseUrl = apiUrl || DEFAULT_API_URL

  // Load widget config on mount
  useEffect(() => {
    loadWidgetConfig()
  }, [tenantKey])

  async function loadWidgetConfig() {
    try {
      const response = await fetch(`${baseUrl}/api/public/widget/config?tenantKey=${tenantKey}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error?.message || 'Failed to load widget')
        setStep('error')
        return
      }

      setWidgetData(data)

      // Skip service selection if only one service or service pre-selected
      if (initialServiceId) {
        setSelectedService(initialServiceId)
        setStep('details')
      } else if (data.services.length === 1) {
        setSelectedService(data.services[0].id)
        setStep('details')
      } else {
        setStep('service')
      }
    } catch (err) {
      console.error('[Widget] Failed to load config:', err)
      setError('Failed to connect to server')
      setStep('error')
    }
  }

  async function handleSubmit() {
    if (!widgetData) return

    setStep('submitting')

    const formData: FormData = {
      serviceId: selectedService,
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone || undefined,
      },
      job: {
        address: jobAddress || undefined,
        postcodeOrZip: jobPostcode || undefined,
        answers: [
          // Include project description as a special field
          ...(jobDescription ? [{ fieldId: '_project_description', value: jobDescription }] : []),
          // Include other field answers
          ...Object.entries(fieldAnswers).map(([fieldId, value]) => ({
            fieldId,
            value,
          })),
        ],
      },
      assetIds: uploadedPhotos.map(p => p.assetId),
    }

    try {
      const response = await fetch(`${baseUrl}/api/public/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          ...formData,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error?.message || 'Failed to submit quote request')
        setStep('error')
        return
      }

      setQuoteResult(data)
      setStep('success')
    } catch (err) {
      console.error('[Widget] Failed to submit:', err)
      setError('Failed to submit quote request')
      setStep('error')
    }
  }

  function handleFieldChange(fieldId: string, value: FieldValue) {
    setFieldAnswers((prev) => ({ ...prev, [fieldId]: value }))
  }

  // Get current service config
  const currentService = widgetData?.services.find(s => s.id === selectedService)
  const mediaConfig = currentService?.mediaConfig
  const hasPhotoStep = mediaConfig && (mediaConfig.minPhotos > 0 || (mediaConfig.requiredAngles && mediaConfig.requiredAngles.length > 0))

  // Calculate progress
  const showProgress = ['service', 'details', 'photos', 'contact'].includes(step)
  const hasServiceStep = widgetData && widgetData.services.length > 1
  const progressSteps = hasServiceStep
    ? hasPhotoStep ? ['Service', 'Details', 'Photos', 'Contact'] : ['Service', 'Details', 'Contact']
    : hasPhotoStep ? ['Details', 'Photos', 'Contact'] : ['Details', 'Contact']
  const currentProgressIndex = (() => {
    const stepOrder = hasServiceStep
      ? hasPhotoStep ? ['service', 'details', 'photos', 'contact'] : ['service', 'details', 'contact']
      : hasPhotoStep ? ['details', 'photos', 'contact'] : ['details', 'contact']
    return stepOrder.indexOf(step)
  })()

  // Render based on step
  return (
    <div className={`estimator-widget ${inline ? 'estimator-widget-inline' : ''}`}>
      {/* Header */}
      {!inline && (
        <div className="estimator-header">
          <h2>{widgetData?.tenantName || 'Get a Quote'}</h2>
          <button className="estimator-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      )}

      <div className="estimator-body">
        {/* Progress indicator */}
        {showProgress && (
          <ProgressIndicator steps={progressSteps} currentStep={currentProgressIndex} />
        )}

        {step === 'loading' && <LoadingState />}
        {step === 'error' && <ErrorState message={error} onRetry={loadWidgetConfig} />}
        {step === 'service' && widgetData && (
          <ServiceStep
            services={widgetData.services}
            selected={selectedService}
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
            onFieldChange={handleFieldChange}
            onAddressChange={setJobAddress}
            onPostcodeChange={setJobPostcode}
            onDescriptionChange={setJobDescription}
            onBack={() => widgetData.services.length > 1 ? setStep('service') : null}
            onNext={() => setStep(hasPhotoStep ? 'photos' : 'contact')}
            showBack={widgetData.services.length > 1}
          />
        )}
        {step === 'photos' && widgetData && mediaConfig && (
          <PhotosStep
            mediaConfig={mediaConfig}
            photos={uploadedPhotos}
            tenantKey={tenantKey}
            baseUrl={baseUrl}
            onPhotosChange={setUploadedPhotos}
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
            onBack={() => setStep('details')}
            onSubmit={handleSubmit}
          />
        )}
        {step === 'submitting' && <SubmittingState />}
        {step === 'success' && quoteResult && (
          <SuccessState quoteUrl={quoteResult.quoteViewUrl} onClose={onClose} inline={inline} />
        )}
      </div>
    </div>
  )
}

// Progress Indicator Component
function ProgressIndicator({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="estimator-progress">
      {steps.map((label, index) => {
        const isActive = index === currentStep
        const isCompleted = index < currentStep

        return (
          <div key={label} className="estimator-progress-item">
            <div
              className={`estimator-progress-circle ${
                isCompleted ? 'completed' : isActive ? 'active' : ''
              }`}
            >
              {isCompleted ? (
                <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
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
            <span className={`estimator-progress-label ${isActive || isCompleted ? 'active' : ''}`}>
              {label}
            </span>
            {index < steps.length - 1 && (
              <div className={`estimator-progress-line ${index < currentStep ? 'completed' : ''}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// Step Components

function LoadingState() {
  return (
    <div className="estimator-loading">
      <div className="estimator-spinner"></div>
      <p>Loading...</p>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="estimator-error">
      <div className="estimator-error-icon">!</div>
      <p>{message || 'Something went wrong'}</p>
      <button className="estimator-btn estimator-btn-secondary" onClick={onRetry}>
        Try Again
      </button>
    </div>
  )
}

function ServiceStep({
  services,
  selected,
  onSelect,
}: {
  services: ServiceOption[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="estimator-step">
      <h3>Select a Service</h3>
      <div className="estimator-services">
        {services.map((service) => (
          <button
            key={service.id}
            className={`estimator-service-btn ${selected === service.id ? 'selected' : ''}`}
            onClick={() => onSelect(service.id)}
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
  onFieldChange,
  onAddressChange,
  onPostcodeChange,
  onDescriptionChange,
  onBack,
  onNext,
  showBack,
}: {
  fields: FieldConfig[]
  answers: Record<string, FieldValue>
  jobAddress: string
  jobPostcode: string
  jobDescription: string
  onFieldChange: (fieldId: string, value: FieldValue) => void
  onAddressChange: (value: string) => void
  onPostcodeChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onBack: () => void
  onNext: () => void
  showBack: boolean
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  function handleContinue() {
    const validationErrors = validateRequiredFields(fields, answers)
    setErrors(validationErrors)

    // Mark all fields as touched
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
    const field = fields.find((f) => f.fieldId === fieldId)
    if (field?.required || field?.criticalForPricing) {
      const value = answers[fieldId]
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        setErrors((prev) => ({
          ...prev,
          [fieldId]: field.criticalForPricing
            ? `${field.label} is important for accurate pricing`
            : `${field.label} is required`,
        }))
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

  return (
    <div className="estimator-step">
      <h3>Job Details</h3>

      <div className="estimator-field">
        <label>Address</label>
        <input
          type="text"
          value={jobAddress}
          onChange={(e) => onAddressChange((e.target as HTMLInputElement).value)}
          placeholder="123 Main Street"
        />
      </div>

      <div className="estimator-field">
        <label>Postcode / ZIP</label>
        <input
          type="text"
          value={jobPostcode}
          onChange={(e) => onPostcodeChange((e.target as HTMLInputElement).value)}
          placeholder="SW1A 1AA"
        />
      </div>

      <div className="estimator-field">
        <label>Project Description</label>
        <textarea
          value={jobDescription}
          onChange={(e) => onDescriptionChange((e.target as HTMLTextAreaElement).value)}
          placeholder="Describe your project requirements, what you need done, any specific details..."
          rows={4}
        />
        <small className="estimator-help">
          The more details you provide, the more accurate your quote will be.
        </small>
      </div>

      {fields.map((field) => {
        const hasError = touched[field.fieldId] && errors[field.fieldId]
        const isCritical = field.criticalForPricing

        return (
          <div key={field.fieldId} className={`estimator-field ${hasError ? 'has-error' : ''} ${isCritical ? 'critical' : ''}`}>
            <label>
              {field.label}
              {(field.required || isCritical) && <span className="estimator-required">*</span>}
              {isCritical && (
                <span className="estimator-critical-badge" style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.7rem',
                  padding: '0.125rem 0.375rem',
                  background: '#fef3c7',
                  color: '#92400e',
                  borderRadius: '0.25rem',
                  fontWeight: 500,
                }}>
                  Important for pricing
                </span>
              )}
            </label>

            {/* Text input */}
            {field.type === 'text' && (
              <input
                type="text"
                value={(answers[field.fieldId] as string) || ''}
                onChange={(e) => onFieldChange(field.fieldId, (e.target as HTMLInputElement).value)}
                onBlur={() => handleFieldBlur(field.fieldId)}
                placeholder={field.placeholder}
                className={hasError ? 'error' : ''}
              />
            )}

            {/* Textarea */}
            {field.type === 'textarea' && (
              <textarea
                value={(answers[field.fieldId] as string) || ''}
                onChange={(e) => onFieldChange(field.fieldId, (e.target as HTMLTextAreaElement).value)}
                onBlur={() => handleFieldBlur(field.fieldId)}
                placeholder={field.placeholder}
                rows={3}
                className={hasError ? 'error' : ''}
              />
            )}

            {/* Number input */}
            {field.type === 'number' && (
              <input
                type="number"
                value={(answers[field.fieldId] as number) ?? ''}
                onChange={(e) => {
                  const val = (e.target as HTMLInputElement).value
                  onFieldChange(field.fieldId, val ? Number(val) : '')
                }}
                onBlur={() => handleFieldBlur(field.fieldId)}
                placeholder={field.placeholder}
                className={hasError ? 'error' : ''}
              />
            )}

            {/* Select dropdown */}
            {field.type === 'select' && field.options && (
              <select
                value={(answers[field.fieldId] as string) || ''}
                onChange={(e) => onFieldChange(field.fieldId, (e.target as HTMLSelectElement).value)}
                onBlur={() => handleFieldBlur(field.fieldId)}
                className={hasError ? 'error' : ''}
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
              <div className="estimator-radio-group">
                {field.options.map((opt) => (
                  <label key={opt.value} className="estimator-radio">
                    <input
                      type="radio"
                      name={field.fieldId}
                      value={opt.value}
                      checked={(answers[field.fieldId] as string) === opt.value}
                      onChange={(e) => onFieldChange(field.fieldId, (e.target as HTMLInputElement).value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Checkbox (multi-select) */}
            {field.type === 'checkbox' && field.options && (
              <div className="estimator-checkbox-group">
                {field.options.map((opt) => {
                  const currentValues = (answers[field.fieldId] as string[]) || []
                  return (
                    <label key={opt.value} className="estimator-checkbox">
                      <input
                        type="checkbox"
                        checked={currentValues.includes(opt.value)}
                        onChange={(e) =>
                          handleCheckboxChange(field.fieldId, opt.value, (e.target as HTMLInputElement).checked)
                        }
                      />
                      <span>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            )}

            {/* Boolean (single checkbox) */}
            {field.type === 'boolean' && (
              <label className="estimator-checkbox">
                <input
                  type="checkbox"
                  checked={(answers[field.fieldId] as boolean) || false}
                  onChange={(e) => onFieldChange(field.fieldId, (e.target as HTMLInputElement).checked)}
                />
                <span>{field.helpText || 'Yes'}</span>
              </label>
            )}

            {/* Help text */}
            {field.helpText && field.type !== 'boolean' && (
              <small className="estimator-help">{field.helpText}</small>
            )}

            {/* Error message */}
            {hasError && <small className="estimator-field-error">{errors[field.fieldId]}</small>}
          </div>
        )
      })}

      <div className="estimator-actions">
        {showBack && (
          <button className="estimator-btn estimator-btn-secondary" onClick={onBack}>
            Back
          </button>
        )}
        <button className="estimator-btn estimator-btn-primary" onClick={handleContinue}>
          Continue
        </button>
      </div>
    </div>
  )
}

function PhotosStep({
  mediaConfig,
  photos,
  tenantKey,
  baseUrl,
  onPhotosChange,
  onBack,
  onNext,
}: {
  mediaConfig: ServiceMediaConfig
  photos: UploadedPhoto[]
  tenantKey: string
  baseUrl: string
  onPhotosChange: (photos: UploadedPhoto[]) => void
  onBack: () => void
  onNext: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const requiredAngles = mediaConfig.requiredAngles || []
  const minPhotos = mediaConfig.minPhotos || 0
  const maxPhotos = mediaConfig.maxPhotos || 8

  // Check which required angles are satisfied
  const satisfiedAngles = new Set(photos.map(p => p.angleId).filter(Boolean))
  const missingSatisfiedAngles = requiredAngles.filter(a => !satisfiedAngles.has(a.id))

  // Validation: need minimum photos AND all required angles
  const hasMinPhotos = photos.length >= minPhotos
  const hasAllRequiredAngles = missingSatisfiedAngles.length === 0
  const canProceed = hasMinPhotos && hasAllRequiredAngles

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    // Check max photos limit
    if (photos.length + files.length > maxPhotos) {
      setError(`Maximum ${maxPhotos} photos allowed`)
      return
    }

    setUploading(true)
    setError(null)

    try {
      // Prepare file metadata for upload init
      const fileInfos = Array.from(files).map(f => ({
        fileName: f.name,
        contentType: f.type,
        sizeBytes: f.size,
      }))

      // Initialize uploads
      const initRes = await fetch(`${baseUrl}/api/public/uploads/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantKey, files: fileInfos }),
      })

      if (!initRes.ok) {
        const data = await initRes.json()
        throw new Error(data.error?.message || 'Failed to initialize upload')
      }

      const { uploads } = await initRes.json()

      // Upload each file
      const newPhotos: UploadedPhoto[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const upload = uploads[i]

        if (!file || !upload) continue

        // Upload to signed URL
        await fetch(upload.uploadUrl, {
          method: upload.method,
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        })

        newPhotos.push({
          assetId: upload.assetId,
          file,
          previewUrl: URL.createObjectURL(file),
        })
      }

      onPhotosChange([...photos, ...newPhotos])
    } catch (err) {
      console.error('[Widget] Upload failed:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function handleRemovePhoto(index: number) {
    const newPhotos = [...photos]
    const removed = newPhotos.splice(index, 1)[0]
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl)
    }
    onPhotosChange(newPhotos)
  }

  function handleAssignAngle(photoIndex: number, angleId: string) {
    const newPhotos = [...photos]
    const photo = newPhotos[photoIndex]
    if (photo) {
      // Remove angle from any other photo first
      newPhotos.forEach(p => {
        if (p.angleId === angleId) p.angleId = undefined
      })
      photo.angleId = angleId
      onPhotosChange(newPhotos)
    }
  }

  return (
    <div className="estimator-step">
      <h3>Add Photos</h3>

      {mediaConfig.photoGuidance && (
        <p className="estimator-help" style={{ marginBottom: '1rem' }}>
          {mediaConfig.photoGuidance}
        </p>
      )}

      {/* Required angles checklist */}
      {requiredAngles.length > 0 && (
        <div className="estimator-required-angles" style={{ marginBottom: '1rem' }}>
          <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>Required photos:</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {requiredAngles.map(angle => {
              const isSatisfied = satisfiedAngles.has(angle.id)
              return (
                <li
                  key={angle.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.25rem 0',
                    color: isSatisfied ? '#16a34a' : '#6b7280',
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>{isSatisfied ? '✓' : '○'}</span>
                  <span>{angle.label}</span>
                  {angle.guidance && (
                    <span style={{ fontSize: '0.85em', color: '#9ca3af' }}>
                      - {angle.guidance}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Photo upload area */}
      <div
        className="estimator-photo-upload"
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '1rem',
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        {uploading ? (
          <div className="estimator-spinner" style={{ margin: '0 auto' }}></div>
        ) : (
          <>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              style={{ margin: '0 auto', color: '#9ca3af' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p style={{ marginTop: '0.5rem', color: '#6b7280' }}>
              Click to add photos
            </p>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
              {minPhotos > 0 ? `Minimum ${minPhotos} photo${minPhotos > 1 ? 's' : ''} required` : 'Optional but recommended'}
              {' · '}Maximum {maxPhotos}
            </p>
          </>
        )}
      </div>

      {error && (
        <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      {/* Photo previews */}
      {photos.length > 0 && (
        <div
          className="estimator-photo-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          {photos.map((photo, index) => (
            <div
              key={photo.assetId}
              style={{
                position: 'relative',
                aspectRatio: '1',
                borderRadius: '0.5rem',
                overflow: 'hidden',
                border: '1px solid #e5e7eb',
              }}
            >
              <img
                src={photo.previewUrl}
                alt={`Photo ${index + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                onClick={() => handleRemovePhoto(index)}
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
              {/* Angle assignment dropdown */}
              {requiredAngles.length > 0 && (
                <select
                  value={photo.angleId || ''}
                  onChange={(e) => handleAssignAngle(index, (e.target as HTMLSelectElement).value)}
                  style={{
                    position: 'absolute',
                    bottom: '4px',
                    left: '4px',
                    right: '4px',
                    fontSize: '0.75rem',
                    padding: '2px',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.9)',
                    border: '1px solid #d1d5db',
                  }}
                >
                  <option value="">Select type...</option>
                  {requiredAngles.map(angle => (
                    <option key={angle.id} value={angle.id}>
                      {angle.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="estimator-actions">
        <button className="estimator-btn estimator-btn-secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="estimator-btn estimator-btn-primary"
          onClick={onNext}
          disabled={!canProceed}
        >
          Continue
        </button>
      </div>

      {!canProceed && (
        <p style={{ fontSize: '0.85rem', color: '#6b7280', textAlign: 'center', marginTop: '0.5rem' }}>
          {!hasMinPhotos && `Please add at least ${minPhotos} photo${minPhotos > 1 ? 's' : ''}`}
          {hasMinPhotos && !hasAllRequiredAngles && `Please add all required photo types`}
        </p>
      )}
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
    <div className="estimator-step">
      <h3>Your Contact Details</h3>

      <div className="estimator-field">
        <label>
          Name <span className="estimator-required">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange((e.target as HTMLInputElement).value)}
          placeholder="John Smith"
        />
      </div>

      <div className="estimator-field">
        <label>
          Email <span className="estimator-required">*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange((e.target as HTMLInputElement).value)}
          placeholder="john@example.com"
        />
      </div>

      <div className="estimator-field">
        <label>Phone (optional)</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => onPhoneChange((e.target as HTMLInputElement).value)}
          placeholder="+44 7700 900000"
        />
      </div>

      <div className="estimator-actions">
        <button className="estimator-btn estimator-btn-secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="estimator-btn estimator-btn-primary"
          onClick={onSubmit}
          disabled={!isValid}
        >
          Get Quote
        </button>
      </div>
    </div>
  )
}

function SubmittingState() {
  return (
    <div className="estimator-loading">
      <div className="estimator-spinner"></div>
      <p>Submitting your request...</p>
    </div>
  )
}

function SuccessState({
  quoteUrl,
  onClose,
  inline,
}: {
  quoteUrl: string
  onClose: () => void
  inline: boolean
}) {
  return (
    <div className="estimator-success">
      <div className="estimator-success-icon">&#10003;</div>
      <h3>Request Submitted!</h3>
      <p>We're preparing your quote. You'll receive it shortly.</p>
      <a href={quoteUrl} className="estimator-btn estimator-btn-primary" target="_blank" rel="noopener">
        View Your Quote
      </a>
      {!inline && (
        <button className="estimator-btn estimator-btn-secondary" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  )
}
