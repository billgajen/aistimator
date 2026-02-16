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

// ============================================================================
// CONVERSATIONAL CHAT COMPONENT
// ============================================================================

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  images?: string[] // preview URLs for user-uploaded images
}

interface ChatUploadedFile {
  assetId: string
  previewUrl: string
  fileName: string
  status: 'uploading' | 'complete' | 'error'
}

function ConversationalChat({
  tenantKey,
  widgetData,
  serviceId,
  onComplete,
}: {
  tenantKey: string
  widgetData: WidgetData
  serviceId?: string | null
  onComplete: (result: QuoteResponse) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [extractedFields, setExtractedFields] = useState<Record<string, unknown>>({})
  const [fieldAnswers, setFieldAnswers] = useState<Array<{ fieldId: string; value: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<ChatUploadedFile[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Track which service the conversation has resolved to
  const hasMultipleServices = widgetData.services.length > 1
  const initialServiceId = serviceId || (!hasMultipleServices ? widgetData.services[0]?.id : null)
  const resolvedServiceIdRef = useRef<string | null>(initialServiceId || null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Send opening message on mount
  useEffect(() => {
    const serviceName = initialServiceId
      ? widgetData.services.find(s => s.id === initialServiceId)?.name
      : null
    setMessages([{
      role: 'assistant',
      text: serviceName
        ? `Hi! I'm here to help you get a quote for ${serviceName}. Tell me about what you need and I'll gather the details.`
        : `Hi! Welcome! I can help you get a quote. What service are you looking for? We offer ${widgetData.services.map(s => s.name).join(', ')}.`,
    }])
  }, [widgetData, initialServiceId])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue

      const previewUrl = URL.createObjectURL(file)
      const tempId = `temp-${Date.now()}`

      setUploadedFiles(prev => [...prev, { assetId: tempId, previewUrl, fileName: file.name, status: 'uploading' }])

      try {
        const initRes = await fetch('/api/public/uploads/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantKey,
            files: [{ fileName: file.name, contentType: file.type, sizeBytes: file.size }],
          }),
        })
        const initData = await initRes.json()
        if (!initRes.ok || !initData.uploads?.[0]) throw new Error('Upload init failed')

        const { assetId, uploadUrl } = initData.uploads[0]

        const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
        if (!uploadRes.ok) throw new Error('Upload failed')

        setUploadedFiles(prev => prev.map(f => f.assetId === tempId ? { ...f, assetId, status: 'complete' as const } : f))
        setMessages(prev => [...prev, { role: 'user', text: `📷 ${file.name}`, images: [previewUrl] }])
      } catch {
        setUploadedFiles(prev => prev.map(f => f.assetId === tempId ? { ...f, status: 'error' as const } : f))
        setMessages(prev => [...prev, { role: 'assistant', text: 'Failed to upload the image. Please try again.' }])
      }
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return

    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    setSending(true)

    try {
      const res = await fetch('/api/public/widget/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          serviceId: resolvedServiceIdRef.current || undefined,
          message: text,
          conversationHistory: messages.map(m => ({
            role: m.role,
            content: m.text,
          })),
          extractedFields,
          fieldAnswers,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' }])
        setSending(false)
        return
      }

      setMessages(prev => [...prev, { role: 'assistant', text: data.reply }])
      if (data.extractedFields) {
        setExtractedFields(data.extractedFields)
        // Update resolved service when AI identifies which service the customer wants
        if (!resolvedServiceIdRef.current) {
          let matched: typeof widgetData.services[0] | undefined
          // First: check extractedFields.serviceId from AI
          if (data.extractedFields.serviceId) {
            const sid = data.extractedFields.serviceId as string
            matched = widgetData.services.find(s => s.id === sid)
              || widgetData.services.find(s => s.name.toLowerCase() === sid.toLowerCase())
          }
          // Fallback: scan the AI reply + user message for service name mentions
          if (!matched) {
            const combinedText = (text + ' ' + data.reply).toLowerCase()
            // Sort by name length descending so "Manicure & Pedicure" matches before "Spa Package"
            const sortedServices = [...widgetData.services].sort((a, b) => b.name.length - a.name.length)
            for (const svc of sortedServices) {
              if (combinedText.includes(svc.name.toLowerCase())) {
                matched = svc
                break
              }
            }
          }
          if (matched) {
            resolvedServiceIdRef.current = matched.id
          }
        }
      }
      // Accumulate field answers across turns
      if (data.fieldAnswers) {
        setFieldAnswers(prev => {
          const map = new Map(prev.map(fa => [fa.fieldId, fa.value]))
          for (const fa of data.fieldAnswers) {
            map.set(fa.fieldId, fa.value)
          }
          return Array.from(map, ([fieldId, value]) => ({ fieldId, value }))
        })
      }

      // If conversation is complete, submit the quote
      if (data.isComplete && data.formData) {
        setSubmitting(true)
        const completedAssetIds = uploadedFiles.filter(f => f.status === 'complete').map(f => f.assetId)
        const quoteRes = await fetch('/api/public/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data.formData,
            assetIds: completedAssetIds,
            tenantKey,
            source: { type: 'widget', mode: 'conversational' },
          }),
        })
        const quoteData = await quoteRes.json()
        if (quoteRes.ok) {
          onComplete(quoteData)
        } else {
          setMessages(prev => [...prev, { role: 'assistant', text: `I've gathered all the details but there was an issue submitting: ${quoteData.error?.message || 'Unknown error'}. Please try again.` }])
          setSubmitting(false)
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Connection error. Please try again.' }])
    } finally {
      setSending(false)
    }
  }

  if (submitting) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: '12px' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#6b7280', fontSize: '14px' }}>Submitting your quote request...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '500px' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
            }}
          >
            {msg.images && msg.images.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px', justifyContent: 'flex-end' }}>
                {msg.images.map((url, j) => (
                  <img key={j} src={url} alt="Upload" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: '8px' }} />
                ))}
              </div>
            )}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '12px',
                fontSize: '14px',
                lineHeight: '1.4',
                ...(msg.role === 'user'
                  ? { background: '#3b82f6', color: 'white', borderBottomRightRadius: '4px' }
                  : { background: '#f3f4f6', color: '#111827', borderBottomLeftRadius: '4px' }),
              }}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ alignSelf: 'flex-start', padding: '10px 14px', borderRadius: '12px', background: '#f3f4f6', color: '#9ca3af', fontSize: '14px' }}>
            Typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload previews */}
      {uploadedFiles.length > 0 && (
        <div style={{ padding: '8px 16px 0', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {uploadedFiles.map((f, i) => (
            <div key={i} style={{ position: 'relative', width: 48, height: 48 }}>
              <img src={f.previewUrl} alt={f.fileName} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '6px', opacity: f.status === 'uploading' ? 0.5 : 1 }} />
              {f.status === 'uploading' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 16, height: 16, border: '2px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                </div>
              )}
              {f.status === 'error' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.3)', borderRadius: '6px', fontSize: '16px' }}>!</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ borderTop: '1px solid #e5e7eb', padding: '12px 16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Add photos"
          style={{
            padding: '8px',
            background: 'none',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            color: '#6b7280',
          }}
        >
          📷
        </button>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Type your message..."
          disabled={sending}
          style={{
            flex: 1,
            padding: '10px 14px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{
            padding: '10px 20px',
            background: sending || !input.trim() ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: sending || !input.trim() ? 'default' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ============================================================================
// MAIN EMBED PAGE
// ============================================================================

export default function EmbedPage({ params }: EmbedPageProps) {
  const { tenantKey } = params
  const searchParams = useSearchParams()
  const serviceId = searchParams.get('serviceId')
  const displayMode = searchParams.get('mode')

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
      {/* Progress indicator — form mode only */}
      {displayMode !== 'conversational' && showProgress && (
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

      {/* Conversational mode — replaces the form steps */}
      {displayMode === 'conversational' && widgetData && step !== 'loading' && step !== 'error' && step !== 'success' && step !== 'submitting' && (
        <ConversationalChat
          tenantKey={tenantKey}
          widgetData={widgetData}
          serviceId={serviceId}
          onComplete={(result) => {
            setQuoteResult(result)
            setStep('success')
          }}
        />
      )}

      {/* Standard form steps — only shown when NOT in conversational mode */}
      {displayMode !== 'conversational' && step === 'service' && widgetData && (
        <ServiceStep
          tenantName={widgetData.tenantName}
          services={widgetData.services}
          onSelect={(id) => {
            setSelectedService(id)
            setStep('details')
          }}
        />
      )}
      {displayMode !== 'conversational' && step === 'details' && widgetData && (
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
      {displayMode !== 'conversational' && step === 'files' && widgetData && (
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
      {displayMode !== 'conversational' && step === 'contact' && (
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
      {displayMode !== 'conversational' && step === 'submitting' && <SubmittingState />}
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
                      ? 'bg-primary text-white'
                      : isActive
                        ? 'bg-primary text-white'
                        : 'bg-gray-200 text-text-muted'
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
                    isActive || isCompleted ? 'text-primary font-medium' : 'text-text-muted'
                  }`}
                >
                  {label}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    index < currentStep ? 'bg-primary' : 'bg-gray-200'
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
      <p className="text-text-muted text-sm">Loading...</p>
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
      <p className="text-text-secondary mb-4">{message || 'Something went wrong'}</p>

      {suggestedService && onSelectSuggested && (
        <div className="mb-4">
          <button
            onClick={onSelectSuggested}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover"
          >
            Switch to &quot;{suggestedService.name}&quot; and Submit
          </button>
        </div>
      )}

      <button
        onClick={onRetry}
        className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50"
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
      <h2 className="text-lg font-semibold text-text-primary mb-1">{tenantName}</h2>
      <p className="text-sm text-text-muted mb-4">Select a service to get started</p>
      <div className="space-y-2">
        {services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect(service.id)}
            className="w-full text-left px-4 py-3 border border-border rounded-lg hover:border-blue-500 hover:bg-primary-light transition-colors"
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
  const inputNormalClass = 'border-border focus:ring-primary/30 focus:border-primary'

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-text-primary mb-4">Job Details</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Address</label>
          <input
            type="text"
            value={jobAddress}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="123 Main Street"
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${inputNormalClass}`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Postcode / ZIP</label>
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
            <label className="block text-sm font-medium text-text-secondary mb-1">
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
            <p className="mt-1 text-xs text-text-muted">
              This helps us provide a more accurate estimate
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Project Description <span className="text-red-500">*</span>
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Please describe your project requirements, including any specific needs, timeline, or questions you have..."
            rows={4}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 ${inputNormalClass}`}
          />
          <p className="mt-1 text-xs text-text-muted">
            The more detail you provide, the more accurate your quote will be.
          </p>
        </div>

        {fields.map((field) => {
          const hasError = touched[field.fieldId] && errors[field.fieldId]
          const fieldClass = hasError ? inputErrorClass : inputNormalClass

          return (
            <div key={field.fieldId}>
              <label className="block text-sm font-medium text-text-secondary mb-1">
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
                        className="w-4 h-4 text-primary border-border focus:ring-primary/30"
                      />
                      <span className="text-sm text-text-secondary">{opt.label}</span>
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
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                        />
                        <span className="text-sm text-text-secondary">{opt.label}</span>
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
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span className="text-sm text-text-secondary">{field.helpText || 'Yes'}</span>
                </label>
              )}

              {/* Help text */}
              {field.helpText && field.type !== 'boolean' && (
                <p className="text-xs text-text-muted mt-1">{field.helpText}</p>
              )}

              {/* Error message */}
              {hasError && (
                <p className="text-xs text-danger mt-1">{errors[field.fieldId]}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-3 mt-6">
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
        )}
        <button
          onClick={handleContinue}
          className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover"
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
      <h3 className="text-lg font-semibold text-text-primary mb-2">Photos & Documents</h3>
      <p className="text-sm text-text-secondary mb-2">
        {minPhotos > 0
          ? `Add at least ${minPhotos} photo${minPhotos > 1 ? 's' : ''} of the job`
          : 'Add photos or documents (optional)'}
      </p>

      {/* Photo guidance from service configuration */}
      {photoGuidance && (
        <div className="mb-4 p-3 bg-primary-light border border-primary/20 rounded-lg">
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
                  <p className="text-xs text-text-muted mt-1 px-1 truncate">{file.file.name}</p>
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
          <label className="aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-gray-50">
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
              <span className="text-2xl text-text-muted">+</span>
              <p className="text-xs text-text-muted mt-1">Add</p>
            </div>
          </label>
        )}
      </div>

      {/* Status text */}
      <p className="text-xs text-text-muted mb-4">
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
          className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
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
      <h3 className="text-lg font-semibold text-text-primary mb-4">Your Contact Details</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="John Smith"
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="john@example.com"
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Phone (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="+44 7700 900000"
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!isValid}
          className="flex-1 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
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
      <p className="text-text-muted text-sm">Submitting your request...</p>
    </div>
  )
}

function SuccessState({ quoteUrl }: { quoteUrl: string }) {
  return (
    <div className="text-center py-12 px-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <span className="text-secondary text-2xl">✓</span>
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">Request Submitted!</h3>
      <p className="text-sm text-text-secondary mb-6">
        We&apos;re preparing your quote. You&apos;ll receive it shortly.
      </p>
      <a
        href={quoteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover"
      >
        View Your Quote
      </a>
    </div>
  )
}
