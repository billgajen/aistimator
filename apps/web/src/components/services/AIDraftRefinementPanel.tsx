'use client'

import { useState, useRef, type DragEvent, type KeyboardEvent } from 'react'
import type { ServiceDraftConfig } from '@estimator/shared'

interface AIDraftRefinementPanelProps {
  formData: {
    name: string
    description: string
    scopeIncludes: string[]
    scopeExcludes: string[]
    defaultAssumptions: string[]
    workSteps: ServiceDraftConfig['pricing']['workSteps']
    suggestedFields: ServiceDraftConfig['suggestedFields']
    expectedSignals: ServiceDraftConfig['expectedSignals']
    baseFee: number
    minimumCharge: number
  }
  aiDraft: ServiceDraftConfig | null
  onApplyDraft: (draft: Partial<ServiceDraftConfig>) => void
}

type ActiveTab = 'upload' | 'chat'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const ACCEPTED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx'

export function AIDraftRefinementPanel({
  formData,
  aiDraft,
  onApplyDraft,
}: AIDraftRefinementPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat')

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Build current config from form data for AI context
  const buildCurrentConfig = (): ServiceDraftConfig => ({
    scope: {
      included: formData.scopeIncludes,
      excluded: formData.scopeExcludes,
      assumptions: formData.defaultAssumptions,
    },
    media: aiDraft?.media || {
      minPhotos: 1,
      maxPhotos: 8,
      photoGuidance: 'Please upload clear photos.',
    },
    pricing: {
      pricingModel: aiDraft?.pricing.pricingModel || 'fixed',
      unitType: aiDraft?.pricing.unitType || null,
      baseFee: formData.baseFee,
      minimumCharge: formData.minimumCharge,
      workSteps: formData.workSteps,
      addOns: aiDraft?.pricing.addOns || [],
      siteVisit: aiDraft?.pricing.siteVisit || {
        alwaysRecommend: false,
        confidenceBelowPct: 60,
        estimateAbove: 1000,
      },
    },
    expectedSignals: formData.expectedSignals,
    suggestedFields: formData.suggestedFields,
  })

  // Upload document for pricing extraction
  const handleFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError('Unsupported file type. Use PDF, images, or Word docs.')
      return
    }

    setUploadError(null)
    setUploadSuccess(null)
    setUploading(true)

    try {
      // Init upload
      const initRes = await fetch('/api/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ fileName: file.name, contentType: file.type, sizeBytes: file.size }],
        }),
      })

      const initData = await initRes.json()
      if (!initRes.ok) throw new Error(initData.error?.message || 'Upload failed')

      const { assetId, uploadUrl, method } = initData.uploads[0]

      // Upload to R2
      await fetch(uploadUrl, { method, headers: { 'Content-Type': file.type }, body: file })

      // Extract pricing
      const extractRes = await fetch('/api/services/ai-draft/extract-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId,
          serviceName: formData.name,
          serviceDescription: formData.description,
        }),
      })

      const extractData = await extractRes.json()
      if (!extractRes.ok) throw new Error(extractData.error?.message || 'Extraction failed')

      // Apply extracted pricing to form
      onApplyDraft(extractData.draft)

      const stepCount = extractData.draft.pricing?.workSteps?.length || 0
      const fieldCount = extractData.draft.suggestedFields?.length || 0
      setUploadSuccess(`Extracted ${stepCount} pricing items${fieldCount > 0 ? ` and ${fieldCount} questions` : ''} from document.`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to extract pricing')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // Chat refinement
  const sendMessage = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return

    setChatInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setChatLoading(true)

    try {
      const res = await fetch('/api/services/ai-draft/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          currentConfig: buildCurrentConfig(),
          conversationHistory,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Refinement failed')

      setMessages(prev => [...prev, { role: 'assistant', content: data.explanation }])
      setConversationHistory(data.conversationHistory || [])

      // Apply the updated config
      onApplyDraft(data.updatedConfig)

      // Scroll to bottom
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
      }])
    } finally {
      setChatLoading(false)
    }
  }

  const handleChatKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center gap-2 rounded-lg border border-tertiary/30 bg-tertiary-light p-3 text-left text-sm text-tertiary hover:bg-tertiary-light/80"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="font-medium">AI Refinement</span>
        <span className="text-tertiary/70">— Upload docs or chat to adjust pricing</span>
        <svg className="ml-auto h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-tertiary/30 bg-tertiary-light/50">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-tertiary/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-sm font-semibold text-tertiary">AI Refinement</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex rounded-lg bg-background/80 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'chat' ? 'bg-white text-tertiary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'upload' ? 'bg-white text-tertiary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Upload Doc
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-text-muted hover:text-text-primary"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-4">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div>
            <p className="mb-3 text-xs text-text-muted">
              Upload a pricing document to extract pricing items for this service.
            </p>

            {uploading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-tertiary border-t-transparent" />
                <span className="text-sm text-text-secondary">Extracting pricing from document...</span>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                  dragOver ? 'border-primary bg-primary-light' : 'border-border hover:border-primary/50'
                }`}
              >
                <svg className="mb-2 h-6 w-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-xs font-medium text-text-primary">Drop a pricing document</span>
                <span className="mt-0.5 text-xs text-text-muted">PDF, image, or Word doc</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {uploadError && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger-light p-2 text-xs text-danger">
                {uploadError}
              </div>
            )}

            {uploadSuccess && (
              <div className="mt-3 rounded-lg border border-secondary/30 bg-secondary-light p-2 text-xs text-secondary">
                {uploadSuccess}
              </div>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div>
            {messages.length === 0 && (
              <div className="mb-3">
                <p className="text-xs text-text-muted">
                  Tell AI how to adjust the pricing. Examples:
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    'Add a line item for scaffolding at $50/unit',
                    'Set minimum charge to $150',
                    'Add a 10% discount option for returning customers',
                  ].map((example, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setChatInput(example)}
                      className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-text-secondary hover:border-primary hover:text-primary"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.length > 0 && (
              <div className="mb-3 max-h-48 space-y-2 overflow-y-auto">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      msg.role === 'user'
                        ? 'ml-8 bg-primary text-white'
                        : 'mr-8 bg-background text-text-secondary'
                    }`}
                  >
                    {msg.content}
                  </div>
                ))}
                {chatLoading && (
                  <div className="mr-8 flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-xs text-text-muted">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-tertiary border-t-transparent" />
                    Thinking...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="e.g., Add a line item for cleanup at $30 fixed..."
                disabled={chatLoading}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!chatInput.trim() || chatLoading}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
