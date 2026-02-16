'use client'

import { useState, useRef, type DragEvent } from 'react'
import type { ServiceDraftConfig } from '@estimator/shared'

interface ExtractedService {
  name: string
  description: string
  draft: ServiceDraftConfig
  selected: boolean
  /** How to create: 'one' keeps category as single service, 'separate' splits each work step into its own service */
  createMode: 'one' | 'separate'
}

interface BulkServiceUploadProps {
  open: boolean
  onClose: () => void
  onServicesCreated: () => void
}

type UploadState = 'idle' | 'uploading' | 'extracting' | 'review' | 'creating' | 'done' | 'error'

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const ACCEPTED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx'

/**
 * Build the list of services to create based on createMode.
 * 'one' → single service with all work steps as price breakdown.
 * 'separate' → each work step becomes its own standalone service.
 */
function buildServicesToCreate(
  extracted: ExtractedService[]
): Array<{ name: string; description: string; draft: ServiceDraftConfig }> {
  const result: Array<{ name: string; description: string; draft: ServiceDraftConfig }> = []

  for (const svc of extracted) {
    if (!svc.selected) continue

    if (svc.createMode === 'one') {
      // Keep as single service with all work steps
      result.push({ name: svc.name, description: svc.description, draft: svc.draft })
    } else {
      // Split: each work step becomes its own service
      for (const step of svc.draft.pricing.workSteps) {
        const singleStepDraft: ServiceDraftConfig = {
          ...svc.draft,
          pricing: {
            ...svc.draft.pricing,
            workSteps: [
              {
                ...step,
                id: 'step_1',
              },
            ],
          },
        }
        result.push({
          name: step.name,
          description: step.description || `${step.name} — part of ${svc.name}`,
          draft: singleStepDraft,
        })
      }
    }
  }

  return result
}

export function BulkServiceUpload({ open, onClose, onServicesCreated }: BulkServiceUploadProps) {
  const [state, setState] = useState<UploadState>('idle')
  const [services, setServices] = useState<ExtractedService[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)
  const [totalToCreate, setTotalToCreate] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const handleFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Unsupported file type. Please upload a PDF, image, or Word document.')
      return
    }

    setError(null)
    setState('uploading')

    try {
      // 1. Init upload
      const initRes = await fetch('/api/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ fileName: file.name, contentType: file.type, sizeBytes: file.size }],
        }),
      })

      const initData = await initRes.json()
      if (!initRes.ok) throw new Error(initData.error?.message || 'Upload init failed')

      const { assetId, uploadUrl, method } = initData.uploads[0]

      // 2. Upload file to R2
      await fetch(uploadUrl, {
        method,
        headers: { 'Content-Type': file.type },
        body: file,
      })

      // 3. Extract services from document
      setState('extracting')
      const extractRes = await fetch('/api/services/ai-draft/extract-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })

      const extractData = await extractRes.json()
      if (!extractRes.ok) throw new Error(extractData.error?.message || 'Extraction failed')

      if (!extractData.services || extractData.services.length === 0) {
        setError('No services found in the document. Try a different file.')
        setState('idle')
        return
      }

      setServices(
        extractData.services.map((svc: { name: string; description: string; draft: ServiceDraftConfig }) => ({
          ...svc,
          selected: true,
          createMode: 'one' as const,
        }))
      )
      setState('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
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

  const toggleService = (index: number) => {
    setServices(prev => prev.map((s, i) => i === index ? { ...s, selected: !s.selected } : s))
  }

  const setCreateMode = (index: number, mode: 'one' | 'separate') => {
    setServices(prev => prev.map((s, i) => i === index ? { ...s, createMode: mode } : s))
  }

  const createServices = async () => {
    const toCreate = buildServicesToCreate(services)
    if (toCreate.length === 0) return

    setState('creating')
    setCreatedCount(0)
    setTotalToCreate(toCreate.length)
    let created = 0

    for (const svc of toCreate) {
      try {
        const pricingRules = {
          baseFee: svc.draft.pricing.baseFee,
          minimumCharge: svc.draft.pricing.minimumCharge,
          addons: [],
          multipliers: [],
          workSteps: svc.draft.pricing.workSteps,
        }

        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: svc.name,
            description: svc.description,
            documentTypeDefault: 'instant_estimate',
            scopeIncludes: svc.draft.scope.included,
            scopeExcludes: svc.draft.scope.excluded,
            defaultAssumptions: svc.draft.scope.assumptions,
            mediaConfig: {
              minPhotos: svc.draft.media.minPhotos,
              maxPhotos: svc.draft.media.maxPhotos,
              photoGuidance: svc.draft.media.photoGuidance,
            },
            workSteps: svc.draft.pricing.workSteps,
            expectedSignals: svc.draft.expectedSignals,
            pricingRules,
            draftConfig: svc.draft,
          }),
        })

        if (res.ok) {
          created++
          setCreatedCount(created)
        }
      } catch {
        // Continue creating other services even if one fails
      }
    }

    setState('done')
    onServicesCreated()
  }

  const handleClose = () => {
    setState('idle')
    setServices([])
    setError(null)
    setCreatedCount(0)
    setTotalToCreate(0)
    onClose()
  }

  // Count total services that will be created (accounting for separate mode splits)
  const totalServiceCount = buildServicesToCreate(services).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 className="font-display text-xl font-bold text-text-primary">Upload Services</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* Idle: File drop zone */}
          {(state === 'idle' || state === 'error') && (
            <div>
              <p className="mb-4 text-sm text-text-secondary">
                Upload a pricing document (PDF, image, or Word doc) containing your services and pricing.
                AI will extract each service with its pricing structure.
              </p>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
                  dragOver
                    ? 'border-primary bg-primary-light'
                    : 'border-border hover:border-primary/50 hover:bg-surface'
                }`}
              >
                <svg className="mb-3 h-10 w-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="text-sm font-medium text-text-primary">
                  Drop your pricing document here
                </span>
                <span className="mt-1 text-xs text-text-muted">
                  or click to browse — PDF, JPG, PNG, Word
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger-light p-3 text-sm text-danger">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Uploading / Extracting */}
          {(state === 'uploading' || state === 'extracting') && (
            <div className="flex flex-col items-center py-12">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="mt-4 text-sm font-medium text-text-primary">
                {state === 'uploading' ? 'Uploading document...' : 'AI is extracting services...'}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {state === 'extracting' && 'This may take 10-20 seconds for large documents'}
              </p>
            </div>
          )}

          {/* Review extracted services */}
          {state === 'review' && (
            <div>
              <p className="mb-4 text-sm text-text-secondary">
                Found <span className="font-semibold text-text-primary">{services.length}</span> categories.
                For each, choose whether to create one service or separate services per item:
              </p>

              <div className="space-y-4">
                {services.map((svc, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border transition-colors ${
                      svc.selected ? 'border-primary' : 'border-border opacity-60'
                    }`}
                  >
                    {/* Category header */}
                    <label className="flex cursor-pointer items-start gap-3 p-4">
                      <input
                        type="checkbox"
                        checked={svc.selected}
                        onChange={() => toggleService(index)}
                        className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-text-primary">{svc.name}</div>
                        {svc.description && (
                          <div className="mt-0.5 text-sm text-text-muted">{svc.description}</div>
                        )}
                      </div>
                    </label>

                    {/* Work steps preview + create mode toggle */}
                    {svc.selected && (
                      <div className="border-t border-border bg-surface/50 px-4 py-3">
                        {/* Items list */}
                        <div className="mb-3 space-y-1">
                          {svc.draft.pricing.workSteps.map((step, si) => (
                            <div key={si} className="flex items-center justify-between text-sm">
                              <span className="text-text-secondary">{step.name}</span>
                              <span className="font-medium text-text-primary">
                                ${step.defaultCost}
                                {step.costType === 'per_unit' && '/unit'}
                                {step.costType === 'per_hour' && '/hr'}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Create mode toggle — only show if there are multiple work steps */}
                        {svc.draft.pricing.workSteps.length > 1 && (
                          <div className="flex gap-2 rounded-lg bg-background p-1">
                            <button
                              type="button"
                              onClick={() => setCreateMode(index, 'one')}
                              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                svc.createMode === 'one'
                                  ? 'bg-primary text-white shadow-sm'
                                  : 'text-text-muted hover:text-text-secondary'
                              }`}
                            >
                              One service with {svc.draft.pricing.workSteps.length} items in breakdown
                            </button>
                            <button
                              type="button"
                              onClick={() => setCreateMode(index, 'separate')}
                              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                svc.createMode === 'separate'
                                  ? 'bg-primary text-white shadow-sm'
                                  : 'text-text-muted hover:text-text-secondary'
                              }`}
                            >
                              {svc.draft.pricing.workSteps.length} separate services
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creating services */}
          {state === 'creating' && (
            <div className="flex flex-col items-center py-12">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p className="mt-4 text-sm font-medium text-text-primary">
                Creating services... ({createdCount}/{totalToCreate})
              </p>
            </div>
          )}

          {/* Done */}
          {state === 'done' && (
            <div className="flex flex-col items-center py-12">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary-light">
                <svg className="h-8 w-8 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="mt-4 text-sm font-medium text-text-primary">
                Created {createdCount} service{createdCount !== 1 ? 's' : ''} successfully
              </p>
              <p className="mt-1 text-xs text-text-muted">
                You can edit each service individually from the list
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border bg-surface/50 px-6 py-4">
          {state === 'review' && (
            <>
              <button
                onClick={handleClose}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={createServices}
                disabled={totalServiceCount === 0}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create {totalServiceCount} Service{totalServiceCount !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {state === 'done' && (
            <button
              onClick={handleClose}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Done
            </button>
          )}
          {(state === 'idle' || state === 'error') && (
            <button
              onClick={handleClose}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
