'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { formatMoney } from '@estimator/shared'
import { useSearchParams } from 'next/navigation'
import { assessImageQuality } from '@/lib/image-quality'
import { brandStyleVars } from '@/lib/color'
import { useTurnstile } from '@/components/embed/useTurnstile'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

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
  /** Guided capture slots (T-107) — returned by the public widget config API */
  requiredAngles?: Array<{ id: string; label: string; guidance?: string }>
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
  /** T-133: regional copy + locale (absent on older API responses) */
  region?: {
    code: string
    locale: string
    postalCodeLabel: string
    postalCodeExample: string
  }
  /** Tenant branding — primary colour override + short-lived logo URL */
  branding?: {
    primaryColor?: string | null
    logoUrl?: string | null
    tagline?: string | null
    showPoweredBy?: boolean
  }
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
  status: 'pending' | 'uploading' | 'complete' | 'error' | 'needs_review'
  progress: number
  error?: string
  /** Which guided-capture slot this photo fills (T-107) */
  angleId?: string
  /** Soft quality issues awaiting the customer's decision (T-107) */
  qualityIssues?: string[]
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
  const { containerRef: turnstileRef, getToken: getTurnstileToken } = useTurnstile(TURNSTILE_SITE_KEY)

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
        // Token must be fetched while the chat UI (and its Turnstile
        // container) is still mounted — the spinner view replaces it
        const turnstileToken = await getTurnstileToken()
        setSubmitting(true)
        const completedAssetIds = uploadedFiles.filter(f => f.status === 'complete').map(f => f.assetId)
        const quoteRes = await fetch('/api/public/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...data.formData,
            assetIds: completedAssetIds,
            tenantKey,
            turnstileToken: turnstileToken || undefined,
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
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-primary" />
        <p className="text-sm text-text-secondary">Submitting your quote request...</p>
      </div>
    )
  }

  return (
    <div className="flex h-[500px] flex-col">
      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[80%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}
          >
            {msg.images && msg.images.length > 0 && (
              <div className="mb-1 flex justify-end gap-1">
                {msg.images.map((url, j) => (
                  <img key={j} src={url} alt="Upload" className="h-20 w-20 rounded-warm-lg object-cover" />
                ))}
              </div>
            )}
            <div
              className={`px-3.5 py-2.5 text-sm leading-snug ${
                msg.role === 'user'
                  ? 'rounded-warm-lg rounded-br-sm bg-primary text-on-primary'
                  : 'rounded-warm-lg rounded-bl-sm bg-mist text-text-primary'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="self-start rounded-warm-lg rounded-bl-sm bg-mist px-3.5 py-2.5 text-sm text-text-muted">
            Typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload previews */}
      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-2">
          {uploadedFiles.map((f, i) => (
            <div key={i} className="relative h-12 w-12">
              <img
                src={f.previewUrl}
                alt={f.fileName}
                className={`h-12 w-12 rounded-lg object-cover ${f.status === 'uploading' ? 'opacity-50' : ''}`}
              />
              {f.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                </div>
              )}
              {f.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg text-base" style={{ background: 'rgba(239,68,68,0.3)' }}>!</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Turnstile challenge mounts here only if Cloudflare requires interaction */}
      <div ref={turnstileRef} className="flex justify-center empty:hidden" />

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Add photos"
          className="rounded-warm-lg border border-border p-2 text-lg leading-none text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
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
          className="flex-1 rounded-warm-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="rounded-warm-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-default disabled:bg-text-muted"
        >
          Send
        </button>
      </div>
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
  const [honeypot, setHoneypot] = useState('')
  const { containerRef: turnstileRef, getToken: getTurnstileToken } = useTurnstile(TURNSTILE_SITE_KEY)

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
      const turnstileToken = await getTurnstileToken()
      const response = await fetch('/api/public/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantKey,
          turnstileToken: turnstileToken || undefined,
          website: honeypot || undefined,
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
      className="min-h-full bg-background font-body p-3 sm:px-6 sm:py-10"
      style={brandStyleVars(widgetData?.branding?.primaryColor)}
    >
      <div className="max-w-xl mx-auto bg-white rounded-warm-2xl border border-border shadow-warm-lg overflow-hidden pb-2">
      {/* Widget letterhead — shown in both form and conversational modes */}
      {widgetData && step !== 'loading' && step !== 'error' && step !== 'success' && (
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary mb-0.5">Instant estimate</p>
            <h2 className="font-display text-lg font-bold text-text-primary leading-tight">{widgetData.tenantName}</h2>
            {widgetData.branding?.tagline && (
              <p className="mt-0.5 text-xs text-text-muted">{widgetData.branding.tagline}</p>
            )}
          </div>
          {widgetData.branding?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
            <img
              src={widgetData.branding.logoUrl}
              alt=""
              className="h-9 max-w-[120px] object-contain object-right"
            />
          )}
        </div>
      )}

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
          postalCodeLabel={widgetData.region?.postalCodeLabel || 'Postcode'}
          postalCodeExample={widgetData.region?.postalCodeExample || 'SW1A 1AA'}
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
          requiredAngles={serviceMediaConfig?.requiredAngles ?? []}
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
        <SuccessState quoteUrl={quoteResult.quoteViewUrl} quoteId={quoteResult.quoteId} locale={widgetData?.region?.locale} />
      )}

      {/* Honeypot — off-screen, never shown to humans */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0, height: 0, overflow: 'hidden' }}>
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      {/* Turnstile challenge mounts here only if Cloudflare requires interaction */}
      <div ref={turnstileRef} className="flex justify-center empty:hidden px-6 pb-2" />
      </div>
      {widgetData?.branding?.showPoweredBy !== false && (
        <div className="max-w-xl mx-auto mt-4 flex items-center justify-center gap-3">
          <div className="tape-rule w-12 opacity-50" />
          <span className="figure text-[10px] text-text-muted">Powered by Aistimator</span>
          <div className="tape-rule w-12 opacity-50" />
        </div>
      )}
    </div>
  )
}

// Step Components

function ProgressIndicator({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="px-6 pt-5 pb-3">
      <div className="flex items-center gap-3">
        {steps.map((label, index) => {
          const isActive = index === currentStep
          const isCompleted = index < currentStep
          return (
            <div key={label} className="flex items-center gap-3 flex-1 last:flex-none">
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-primary text-on-primary ring-2 ring-tape/50 ring-offset-1'
                      : isCompleted
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface border border-border text-text-muted'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
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
                  className={`text-xs font-semibold uppercase tracking-[0.08em] ${
                    isActive ? 'text-primary' : isCompleted ? 'text-text-secondary' : 'text-text-muted'
                  }`}
                >
                  {label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={index < currentStep ? 'flex-1 h-[3px] rounded-full bg-primary/70' : 'flex-1 tape-rule opacity-60'} />
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
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
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
            className="px-5 py-3 text-sm font-semibold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover transition"
          >
            Switch to &quot;{suggestedService.name}&quot; and Submit
          </button>
        </div>
      )}

      <button
        onClick={onRetry}
        className="px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition"
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
      <h2 className="font-display text-xl font-bold text-text-primary mb-1">{tenantName}</h2>
      <p className="text-sm text-text-muted mb-4">Select a service to get started</p>
      <div className="space-y-2">
        {services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect(service.id)}
            className="w-full text-left px-5 py-4 text-[15px] font-medium bg-white border border-border rounded-warm-lg hover:border-primary hover:bg-mint transition"
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
  postalCodeLabel,
  postalCodeExample,
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
  postalCodeLabel: string
  postalCodeExample: string
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

  const inputErrorClass = 'border-danger/50 bg-danger-light/30 focus:ring-danger/25 focus:border-danger'
  const inputNormalClass = 'border-border bg-background focus:ring-primary/25 focus:border-primary focus:bg-white'

  return (
    <div className="p-6">
      <h3 className="font-display text-xl font-bold text-text-primary mb-5">Job Details</h3>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1.5">Address</label>
            <input
              type="text"
              value={jobAddress}
              onChange={(e) => onAddressChange(e.target.value)}
              placeholder="123 Main Street"
              className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${inputNormalClass}`}
            />
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1.5">{postalCodeLabel}</label>
            <input
              type="text"
              value={jobPostcode}
              onChange={(e) => onPostcodeChange(e.target.value)}
              placeholder={postalCodeExample}
              className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${inputNormalClass}`}
            />
          </div>
        </div>

        {/* Quantity field - shown when measurement model asks for customer quantity */}
        {measurementModel?.type === 'per_unit' && measurementModel.askCustomerForQuantity && (
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1.5">
              {measurementModel.unitLabel || getUnitLabel(measurementModel.unit)}
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={jobQuantity ?? ''}
              onChange={(e) => onQuantityChange(e.target.value ? Number(e.target.value) : null)}
              placeholder={`Enter ${measurementModel.unit || 'quantity'}`}
              className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${inputNormalClass}`}
            />
            <p className="mt-1 text-xs text-text-muted">
              This helps us provide a more accurate estimate
            </p>
          </div>
        )}

        <div>
          <label className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Project Description <span className="text-danger">*</span>
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Please describe your project requirements, including any specific needs, timeline, or questions you have..."
            rows={4}
            className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${inputNormalClass}`}
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
              <label className="block text-[13px] font-semibold text-text-primary mb-1.5">
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
                  className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
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
                  className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
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
                  className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
                />
              )}

              {/* Select dropdown */}
              {field.type === 'select' && field.options && (
                <select
                  value={(answers[field.fieldId] as string) || ''}
                  onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                  onBlur={() => handleFieldBlur(field.fieldId)}
                  className={`w-full px-4 py-3 text-[15px] border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 transition ${fieldClass}`}
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
                    <label key={opt.value} className="flex items-center gap-2.5 px-4 py-3 bg-white border border-border rounded-warm-lg cursor-pointer hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-mint transition">
                      <input
                        type="radio"
                        name={field.fieldId}
                        value={opt.value}
                        checked={(answers[field.fieldId] as string) === opt.value}
                        onChange={(e) => onFieldChange(field.fieldId, e.target.value)}
                        className="w-[18px] h-[18px] text-primary border-border-strong focus:ring-primary/25 accent-[#205E56]"
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
                      <label key={opt.value} className="flex items-center gap-2.5 px-4 py-3 bg-white border border-border rounded-warm-lg cursor-pointer hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-mint transition">
                        <input
                          type="checkbox"
                          checked={currentValues.includes(opt.value)}
                          onChange={(e) => handleCheckboxChange(field.fieldId, opt.value, e.target.checked)}
                          className="w-[18px] h-[18px] rounded border-border-strong text-primary focus:ring-primary/25 accent-[#205E56]"
                        />
                        <span className="text-sm text-text-secondary">{opt.label}</span>
                      </label>
                    )
                  })}
                </div>
              )}

              {/* Boolean (single checkbox) */}
              {field.type === 'boolean' && (
                <label className="flex items-center gap-2.5 px-4 py-3 bg-white border border-border rounded-warm-lg cursor-pointer hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-mint transition">
                  <input
                    type="checkbox"
                    checked={(answers[field.fieldId] as boolean) || false}
                    onChange={(e) => onFieldChange(field.fieldId, e.target.checked)}
                    className="w-[18px] h-[18px] rounded border-border-strong text-primary focus:ring-primary/25 accent-[#205E56]"
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
            className="px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition"
          >
            Back
          </button>
        )}
        <button
          onClick={handleContinue}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover active:scale-[0.995] transition"
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
  requiredAngles,
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
  requiredAngles: Array<{ id: string; label: string; guidance?: string }>
  onBack: () => void
  onNext: () => void
}) {
  const [isUploading, setIsUploading] = useState(false)
  const [rejectMessage, setRejectMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Which guided-capture slot the next selected file should fill (T-107)
  const pendingAngleRef = useRef<string | null>(null)

  const photoCount = files.filter((f) => f.file.type.startsWith('image/')).length
  const docCount = files.filter((f) => f.file.type === 'application/pdf').length
  const canAddPhotos = photoCount < maxPhotos
  const canAddDocs = docCount < maxDocs

  async function startUpload(tempId: string, file: File) {
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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || [])
    const angleId = pendingAngleRef.current
    pendingAngleRef.current = null
    if (selectedFiles.length === 0) return

    setIsUploading(true)
    setRejectMessage(null)

    let currentPhotoCount = photoCount
    let currentDocCount = docCount
    let isFirst = true

    for (const file of selectedFiles) {
      // Check file type
      const isImage = file.type.startsWith('image/')
      const isDoc = file.type === 'application/pdf'
      const fileAngleId = isImage && isFirst ? (angleId ?? undefined) : undefined
      isFirst = false

      if (!isImage && !isDoc) {
        continue // Skip unsupported files
      }

      // Check limits
      if (isImage && currentPhotoCount >= maxPhotos) continue
      if (isDoc && currentDocCount >= maxDocs) continue
      if (isImage) currentPhotoCount++
      if (isDoc) currentDocCount++

      // Quality pre-check for photos (T-107): hard-reject tiny images,
      // hold soft issues (blur/exposure) for the customer's decision
      let qualityIssues: string[] | undefined
      if (isImage) {
        const quality = await assessImageQuality(file)
        if (!quality.ok) {
          setRejectMessage(quality.issues[0]?.message || 'This photo could not be used.')
          currentPhotoCount--
          continue
        }
        if (quality.issues.length > 0) {
          qualityIssues = quality.issues.map((i) => i.message)
        }
      }

      // Create preview
      const previewUrl = URL.createObjectURL(file)
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // Add to list — photos with soft quality issues wait for the customer's
      // decision (retake vs use anyway) before uploading
      const newFile: UploadedFile = {
        id: tempId,
        assetId: '',
        file,
        previewUrl,
        status: qualityIssues ? 'needs_review' : 'pending',
        progress: 0,
        angleId: fileAngleId,
        qualityIssues,
      }

      setFiles((prev) => [...prev, newFile])

      if (!qualityIssues) {
        await startUpload(tempId, file)
      }
    }

    setIsUploading(false)
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleUseAnyway(fileId: string) {
    const target = files.find((f) => f.id === fileId)
    if (!target) return
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, status: 'pending' as const } : f))
    )
    startUpload(fileId, target.file)
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

  function openPickerForAngle(angleId: string | null) {
    pendingAngleRef.current = angleId
    fileInputRef.current?.click()
  }

  const filledAngleIds = new Set(
    files.filter((f) => f.angleId && f.status !== 'error').map((f) => f.angleId)
  )
  const hasGuidedCapture = requiredAngles.length > 0

  const settledPhotoCount = files.filter(
    (f) => f.file.type.startsWith('image/') && (f.status === 'complete' || f.status === 'uploading' || f.status === 'pending')
  ).length
  const hasUnresolvedReview = files.some((f) => f.status === 'needs_review')
  const hasMinPhotos = settledPhotoCount >= minPhotos
  const canContinue =
    hasMinPhotos && !isUploading && !hasUnresolvedReview && files.every((f) => f.status !== 'uploading')

  return (
    <div className="p-6">
      <h3 className="font-display text-xl font-bold text-text-primary mb-2">Photos & Documents</h3>
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

      {/* Guided capture slots (T-107): one card per configured angle */}
      {hasGuidedCapture && (
        <div className="mb-4">
          <p className="text-xs font-medium text-text-secondary mb-2">
            For the most accurate quote, we need these shots ({filledAngleIds.size} of{' '}
            {requiredAngles.length} added):
          </p>
          <div className="space-y-2">
            {requiredAngles.map((angle) => {
              const filled = filledAngleIds.has(angle.id)
              const slotFile = files.find((f) => f.angleId === angle.id && f.status !== 'error')
              return (
                <button
                  key={angle.id}
                  type="button"
                  onClick={() => !filled && canAddPhotos && openPickerForAngle(angle.id)}
                  disabled={filled || !canAddPhotos}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    filled
                      ? 'border-green-300 bg-green-50'
                      : 'border-dashed border-border-strong hover:border-primary/60 hover:bg-mint/50'
                  }`}
                >
                  {filled && slotFile ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={slotFile.previewUrl}
                      alt={angle.label}
                      className="w-10 h-10 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <span className="w-10 h-10 rounded-warm-lg bg-surface flex items-center justify-center flex-shrink-0 text-lg">
                      📷
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-primary">
                      {angle.label}
                      {filled && <span className="ml-2 text-green-600">✓</span>}
                    </span>
                    {angle.guidance && !filled && (
                      <span className="block text-xs text-text-muted">{angle.guidance}</span>
                    )}
                  </span>
                  {!filled && <span className="text-xs font-medium text-primary flex-shrink-0">Add photo</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Hard-rejected photo message (too small etc.) */}
      {rejectMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{rejectMessage}</p>
        </div>
      )}

      {/* File grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {files.map((file) => (
          <div
            key={file.id}
            className="relative aspect-square bg-surface rounded-warm-lg overflow-hidden"
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

            {/* Quality review overlay (T-107): retake vs use anyway */}
            {file.status === 'needs_review' && (
              <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center p-1.5 text-center">
                <span className="text-amber-300 text-[10px] leading-tight mb-1.5">
                  {file.qualityIssues?.[0] || 'This photo may be hard to analyse.'}
                </span>
                <button
                  onClick={() => handleRemove(file.id)}
                  className="w-full mb-1 px-1 py-1 bg-white text-ink rounded text-[10px] font-semibold hover:bg-surface"
                >
                  Retake
                </button>
                <button
                  onClick={() => handleUseAnyway(file.id)}
                  className="w-full px-1 py-1 bg-transparent border border-white/60 text-white rounded text-[10px] hover:bg-white/10"
                >
                  Use anyway
                </button>
              </div>
            )}

            {/* Remove button */}
            {file.status !== 'uploading' && file.status !== 'needs_review' && (
              <button
                onClick={() => handleRemove(file.id)}
                className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 rounded-full text-white text-sm flex items-center justify-center hover:bg-opacity-75"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* Add button (shared input also serves the guided slots) */}
        <label
          className={`aspect-square bg-surface rounded-warm-lg border-2 border-dashed border-border-strong items-center justify-center cursor-pointer hover:bg-surface ${
            canAddPhotos || canAddDocs ? 'flex' : 'hidden'
          }`}
        >
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
          className="px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover active:scale-[0.995] disabled:opacity-50 disabled:cursor-not-allowed transition"
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
      <h3 className="font-display text-xl font-bold text-text-primary mb-5">Your Contact Details</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="John Smith"
            className="w-full px-4 py-3 text-[15px] bg-white border border-border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition"
          />
        </div>

        <div>
          <label className="block text-[13px] font-semibold text-text-primary mb-1.5">
            Email <span className="text-danger">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="john@example.com"
            className="w-full px-4 py-3 text-[15px] bg-white border border-border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition"
          />
        </div>

        <div>
          <label className="block text-[13px] font-semibold text-text-primary mb-1.5">Phone (optional)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="+44 7700 900000"
            className="w-full px-4 py-3 text-[15px] bg-white border border-border rounded-warm-lg placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition"
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="px-5 py-3 text-sm font-semibold text-text-secondary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition"
        >
          Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!isValid}
          className="flex-1 px-4 py-3.5 text-[15px] font-display font-bold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover active:scale-[0.995] disabled:opacity-50 disabled:cursor-not-allowed transition"
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
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
      <p className="text-text-muted text-sm">Submitting your request...</p>
    </div>
  )
}

function SuccessState({
  quoteUrl,
  quoteId,
  locale = 'en-GB',
}: {
  quoteUrl: string
  quoteId: string
  locale?: string
}) {
  // T-108: poll quote status while the customer is still here — if the quote
  // needs a quick confirmation, route them to it in-flow instead of waiting
  // for an email they may never open.
  const [liveStatus, setLiveStatus] = useState<string | null>(null)
  // T-109: provisional range shown the moment pricing is computed
  const [range, setRange] = useState<{ low: number; high: number; currency: string } | null>(null)

  const token = (() => {
    try {
      return new URL(quoteUrl, window.location.origin).searchParams.get('token')
    } catch {
      return null
    }
  })()
  const clarifyUrl = token ? `/q/${quoteId}/clarify?token=${token}` : null

  // Queue processing: past the poll window we stop and promise the email instead
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let polls = 0
    // ~5 min — photo-measured quotes can take ~2.5 min on the queue
    const maxPolls = 100

    const interval = setInterval(async () => {
      polls++
      if (polls > maxPolls) {
        clearInterval(interval)
        if (!cancelled) setTimedOut(true)
        return
      }
      try {
        const res = await fetch(`/api/public/quotes/${quoteId}?token=${token}&poll=1`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (data.provisional?.rangeLow) {
          setRange({
            low: data.provisional.rangeLow,
            high: data.provisional.rangeHigh,
            currency: data.pricing?.currency || 'GBP',
          })
        }
        if (['awaiting_clarification', 'pending_review', 'sent', 'viewed', 'failed'].includes(data.status)) {
          setLiveStatus(data.status)
          if (['sent', 'viewed', 'failed'].includes(data.status)) clearInterval(interval)
        }
      } catch {
        // Polling is best-effort; email remains the fallback channel
      }
    }, 3000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [quoteId, token])

  // T-133: Intl formatting in the tenant's locale, whole units for a range
  const rangeDisplay = range
    ? `${formatMoney(range.low, range.currency, locale, { decimals: 0 })} – ${formatMoney(range.high, range.currency, locale, { decimals: 0 })}`
    : null

  // Quote needs a quick confirmation — bring the customer to it now
  if (liveStatus === 'awaiting_clarification' && clarifyUrl) {
    return (
      <div className="text-center py-12 px-6">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">✋</span>
        </div>
        <h3 className="font-display text-xl font-bold text-text-primary mb-2">One quick check</h3>
        {rangeDisplay && (
          <p className="font-display text-2xl font-bold text-text-primary mb-2">{rangeDisplay}</p>
        )}
        <p className="text-sm text-text-secondary mb-6">
          {rangeDisplay
            ? 'That’s our estimated range — confirm a couple of details to get your exact quote in seconds.'
            : 'We’ve analysed your request — just confirm a couple of details and your quote will be ready in seconds.'}
        </p>
        <a
          href={clarifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-6 py-3 font-semibold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover transition"
        >
          Confirm Details
        </a>
      </div>
    )
  }

  // Quote under business review — show the range so the customer isn't left with nothing
  if (liveStatus === 'pending_review' && rangeDisplay) {
    return (
      <div className="text-center py-12 px-6">
        <div className="w-16 h-16 bg-mint rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-secondary text-2xl">✓</span>
        </div>
        <h3 className="font-display text-xl font-bold text-text-primary mb-2">Your estimated range</h3>
        <p className="font-display text-2xl font-bold text-text-primary mb-2">{rangeDisplay}</p>
        <p className="text-sm text-text-secondary mb-6">
          We&apos;re double-checking the details — your final quote will arrive by email shortly.
        </p>
        <a
          href={quoteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-6 py-3 font-semibold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover transition"
        >
          View Estimate
        </a>
      </div>
    )
  }

  const isReady = liveStatus === 'sent' || liveStatus === 'viewed'

  if (isReady) {
    return (
      <div className="text-center py-12 px-6 animate-fade-in-up">
        <div className="w-16 h-16 bg-mint rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-secondary text-2xl">✓</span>
        </div>
        <h3 className="font-display text-xl font-bold text-text-primary mb-2">Your estimate is ready</h3>
        <p className="text-sm text-text-secondary mb-6">Your personalised estimate has been prepared — take a look.</p>
        <a
          href={quoteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-6 py-3 font-semibold bg-primary text-on-primary rounded-warm-lg hover:bg-primary-hover transition"
        >
          View Your Estimate
        </a>
      </div>
    )
  }

  // Failed, held for the business (no range to show) or unusually slow —
  // the request is safe; email is the channel now
  if (liveStatus === 'failed' || liveStatus === 'pending_review' || timedOut) {
    return (
      <div className="text-center py-12 px-6">
        <div className="w-16 h-16 bg-mint rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-secondary text-2xl">✓</span>
        </div>
        <h3 className="font-display text-xl font-bold text-text-primary mb-2">We have your request</h3>
        <p className="text-sm text-text-secondary">
          {liveStatus === 'pending_review'
            ? 'The business is checking the details and will email your estimate shortly.'
            : liveStatus === 'failed'
              ? 'The business will send your estimate by email shortly — nothing more needed from you.'
              : 'This one is taking longer than usual. We’ll email you the link the moment it’s ready.'}
        </p>
      </div>
    )
  }

  // Queued / generating: the worker is pricing it now
  return (
    <div className="text-center py-12 px-6" role="status" aria-live="polite">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Request received</p>
      <h3 className="font-display text-xl font-bold text-text-primary">Preparing your estimate</h3>
      <div className="tape-rule tape-measuring w-48 mx-auto my-6" aria-hidden="true" />
      <p className="text-sm text-text-secondary mb-6 max-w-xs mx-auto">
        This usually takes a minute or two. Keep this open — or we’ll email you the link when it’s ready.
      </p>
      <a
        href={quoteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
      >
        Open the estimate page
      </a>
    </div>
  )
}
