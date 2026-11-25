'use client'

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import { currencySymbol as sharedCurrencySymbol, getRegion, reviewModeOf, pricingChecks } from '@qolumns/shared'
import type { ReviewMode } from '@qolumns/shared'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { AIDraftBadge } from '@/components/AIDraftBadge'
import { WorkStepEditor } from '@/components/WorkStepEditor'
import { SuggestedFieldEditor } from '@/components/SuggestedFieldEditor'
import { BulkServiceUpload } from '@/components/services/BulkServiceUpload'
import { TemplatePicker } from '@/components/services/TemplatePicker'
import { AIDraftRefinementPanel } from '@/components/services/AIDraftRefinementPanel'
import { PricingComposer } from '@/components/services/PricingComposer'
import { draftAddonsToConfig } from '@/lib/draft-addons'
import { PricingTest } from '@/components/services/PricingTest'
import { PricingFlagsNote } from '@/components/services/PricingFlagsNote'
import { nameWarnings } from '@/lib/service-name-warnings'
import { MAX_PHOTOS_REQUIRED, photosRequired } from '@/lib/photos-required'
import { AmountSymbol, amountBoxPadding } from '@/components/services/AmountSymbol'
import { CLEARED_MEDIA, CLEAR_KEEPS, REGENERATE_KEEPS, clearEmpties, clearLoosens, draftToSave, handMadeDraft, isAiDraft, isHandMade, lineNeedsQuestion, linesNeverCharged, looseReferences, regenerateReplaces, syncQuestions } from '@/lib/service-questions'
import type {
  Service,
  ServiceMediaConfig,
  ServiceDraftConfig,
  WorkStepConfig,
  ExpectedSignalConfig,
  AddonConfig,
  MultiplierConfig,
  PricingRules,
  RegionCode,
} from '@qolumns/shared'

export const dynamic = 'force-dynamic'

/** T-147: the three ways an estimate reaches the customer */
const REVIEW_MODE_OPTIONS: { value: ReviewMode; label: string; help: string }[] = [
  {
    value: 'show_then_confirm',
    label: 'Show the estimate, then I confirm it',
    help: 'The customer sees the estimate straight away, marked as an estimate you will confirm. They can accept once you approve it.',
  },
  {
    value: 'hold_until_approved',
    label: 'Hold until I approve',
    help: 'The customer sees “Your estimate is being prepared” and no price until you approve it.',
  },
  {
    value: 'auto_send',
    label: 'Send automatically',
    help: 'The estimate goes to the customer straight away and they can accept it. You don’t review it first.',
  },
]

type WizardStep = 'basic' | 'scope' | 'fields' | 'pricing' | 'test'

const WIZARD_STEPS: WizardStep[] = ['basic', 'scope', 'fields', 'pricing', 'test']

interface ServiceFormData {
  name: string
  description: string
  /** T-146: send quotes without business review (default off) */
  /** T-147: show, then confirm (default) / hold until approved / send automatically */
  reviewMode: ReviewMode
  scopeIncludes: string[]
  scopeExcludes: string[]
  defaultAssumptions: string[]
  mediaConfig: ServiceMediaConfig
  workSteps: WorkStepConfig[]
  expectedSignals: ExpectedSignalConfig[]
  suggestedFields: ServiceDraftConfig['suggestedFields']
  // Pricing rules (moved from standalone pricing page)
  baseFee: number
  minimumCharge: number
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
}

const defaultFormData: ServiceFormData = {
  name: '',
  description: '',
  reviewMode: 'show_then_confirm',
  scopeIncludes: [],
  scopeExcludes: [],
  defaultAssumptions: [],
  mediaConfig: {
    minPhotos: 1,
    maxPhotos: 8,
    photoGuidance: null,
  },
  workSteps: [],
  expectedSignals: [],
  suggestedFields: [],
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
}

function generateAddonId(): string {
  return `addon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Tag Input Component for array fields
 */
function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder: string
}) {
  const [inputValue, setInputValue] = useState('')

  const addTag = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInputValue('')
  }

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1)
    }
  }

  return (
    <div className="min-h-[80px] rounded-lg border border-border p-2 focus-within:border-primary focus-within:ring-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-light px-2 py-1 text-sm text-primary"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(index)}
              className="text-primary hover:text-primary"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => inputValue && addTag(inputValue)}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="min-w-[150px] flex-1 border-none p-1 text-sm outline-none"
        />
      </div>
    </div>
  )
}

/**
 * Services page (T-160: "Services" again, at /app/services; T-152 had named it "Prices", and /app/prices redirects here)
 *
 * Manage the services offered by the tenant.
 */
export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [formData, setFormData] = useState<ServiceFormData>(defaultFormData)
  const [saving, setSaving] = useState(false)
  const [activeStep, setActiveStep] = useState<WizardStep>('basic')
  const [nameError, setNameError] = useState<string | null>(null)
  const submitIntentRef = useRef(false)
  // T-204: the second button on "Test & Publish" for a service that is switched off
  const switchOnRef = useRef(false)

  // AI Draft state
  const [aiDraft, setAiDraft] = useState<ServiceDraftConfig | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  // T-201: "Regenerate" asks first, and says what it will replace
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  // T-202: "Clear" asks first too, and says what it will empty
  const [confirmClear, setConfirmClear] = useState(false)
  // T-201: the keys of the questions the open service was saved with. They never change (lib/service-questions).
  const savedFieldIds = useRef<Set<string>>(new Set())
  // T-201: a service just added from a template. It is switched off until its example prices are checked.
  const [addedOff, setAddedOff] = useState<{ id: string; name: string } | null>(null)

  // Tenant currency for the pricing composer (verification finding: £ tenants saw $)
  const [currencySymbol, setCurrencySymbol] = useState('$')
  // T-189: the business's region decides which trade templates "Add from a template" lists (as in setup)
  const [region, setRegion] = useState<RegionCode>(getRegion(undefined).code)
  const [showTemplates, setShowTemplates] = useState(false)
  useEffect(() => {
    fetch('/api/tenant')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const currency = data?.tenant?.currency
        // T-133: Intl symbol for any ISO currency
        if (currency) setCurrencySymbol(sharedCurrencySymbol(currency, getRegion(data?.tenant?.region).locale))
        if (data?.tenant) setRegion(getRegion(data.tenant.region).code)
      })
      .catch(() => {})
  }, [])

  // Bulk upload state
  const [showBulkUpload, setShowBulkUpload] = useState(false)

  // Quote Simulator state
  // T-204: the test price comes from the worker's own pipeline (components/services/PricingTest)
  const [pricingTested, setPricingTested] = useState(false)

  const fetchServices = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/services')
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to fetch services')
      }

      setServices(data.services)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch services')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServices()
  }, [fetchServices])

  const openCreateModal = () => {
    setEditingService(null)
    setFormData(defaultFormData)
    setActiveStep('basic')
    setNameError(null)
    setAiDraft(null)
    setDraftError(null)
    setConfirmRegenerate(false)
    setConfirmClear(false)
    savedFieldIds.current = new Set()
    setShowModal(true)
  }

  const openEditModal = (service: Service) => {
    setEditingService(service)
    // Extract pricing rules from service
    const pricingRules = (service.pricing_rules || {}) as Partial<PricingRules>
    setFormData({
      name: service.name,
      description: service.description || '',
      reviewMode: reviewModeOf(service),
      scopeIncludes: service.scope_includes || [],
      scopeExcludes: service.scope_excludes || [],
      defaultAssumptions: service.default_assumptions || [],
      mediaConfig: service.media_config || {
        minPhotos: 1,
        maxPhotos: 8,
        photoGuidance: null,
      },
      workSteps: service.work_steps || [],
      expectedSignals: service.expected_signals || [],
      suggestedFields: service.draft_config?.suggestedFields || [],
      // Pricing fields from pricing_rules
      baseFee: pricingRules.baseFee || 0,
      minimumCharge: pricingRules.minimumCharge || 0,
      addons: pricingRules.addons || [],
      multipliers: pricingRules.multipliers || [],
    })
    setActiveStep('basic')
    setNameError(null)
    // T-201: a draft the editor wrote for a hand-made service only holds its questions; it is not an "AI Draft"
    setAiDraft(isAiDraft(service.draft_config) ? service.draft_config : null)
    setDraftError(null)
    setConfirmRegenerate(false)
    setConfirmClear(false)
    savedFieldIds.current = new Set((service.draft_config?.suggestedFields || []).map((f) => f.fieldId).filter(Boolean))
    setShowModal(true)
  }

  const closeModal = () => {
    setPricingTested(false)
    setShowModal(false)
    setEditingService(null)
    setFormData(defaultFormData)
    setActiveStep('basic')
    setNameError(null)
    setAiDraft(null)
    setDraftError(null)
    setConfirmRegenerate(false)
    setConfirmClear(false)
  }

  /**
   * Generate AI draft for the service
   */
  const generateAIDraft = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      setDraftError('Service name and description are required to generate AI draft')
      return
    }

    setGeneratingDraft(true)
    setDraftError(null)

    try {
      const res = await fetch('/api/services/ai-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: formData.name,
          description: formData.description,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to generate AI draft')
      }

      const draft = data.draft as ServiceDraftConfig
      setAiDraft(draft)

      // Apply draft to form data
      setFormData((prev) => ({
        ...prev,
        scopeIncludes: draft.scope.included,
        scopeExcludes: draft.scope.excluded,
        defaultAssumptions: draft.scope.assumptions,
        mediaConfig: {
          minPhotos: draft.media.minPhotos,
          maxPhotos: draft.media.maxPhotos,
          photoGuidance: draft.media.photoGuidance,
          requiredAngles: draft.media.requiredAngles,
        },
        workSteps: draft.pricing.workSteps,
        // The draft's add-ons used to be dropped here, so a drafted "Attic
        // access surcharge" never reached the saved service (production test
        // 2026-11-09). They land in the Add-ons list for the owner to review.
        addons: draftAddonsToConfig(draft.pricing.addOns, generateAddonId),
        expectedSignals: draft.expectedSignals,
        suggestedFields: draft.suggestedFields,
      }))
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to generate AI draft')
    } finally {
      setGeneratingDraft(false)
    }
  }

  /**
   * Apply a partial draft update to form data (used by AI refinement)
   */
  const applyDraftToForm = (draft: Partial<ServiceDraftConfig>) => {
    setFormData((prev) => ({
      ...prev,
      ...(draft.scope && {
        scopeIncludes: draft.scope.included ?? prev.scopeIncludes,
        scopeExcludes: draft.scope.excluded ?? prev.scopeExcludes,
        defaultAssumptions: draft.scope.assumptions ?? prev.defaultAssumptions,
      }),
      ...(draft.media && {
        mediaConfig: {
          minPhotos: draft.media.minPhotos ?? prev.mediaConfig.minPhotos,
          maxPhotos: draft.media.maxPhotos ?? prev.mediaConfig.maxPhotos,
          photoGuidance: draft.media.photoGuidance ?? prev.mediaConfig.photoGuidance,
          requiredAngles: draft.media.requiredAngles,
        },
      }),
      ...(draft.pricing && {
        workSteps: draft.pricing.workSteps ?? prev.workSteps,
        baseFee: draft.pricing.baseFee ?? prev.baseFee,
        minimumCharge: draft.pricing.minimumCharge ?? prev.minimumCharge,
      }),
      ...(draft.expectedSignals && { expectedSignals: draft.expectedSignals }),
      ...(draft.suggestedFields && { suggestedFields: draft.suggestedFields }),
    }))

    // Also update the aiDraft state so it reflects current state
    if (aiDraft) {
      setAiDraft((prev) => prev ? { ...prev, ...draft } : prev)
    }
  }

  /**
   * Clear AI draft and reset to defaults
   */
  const clearAIDraft = () => {
    setConfirmClear(false)
    setAiDraft(null)
    setFormData((prev) => ({
      ...prev,
      scopeIncludes: [],
      scopeExcludes: [],
      defaultAssumptions: [],
      // T-202: what it empties is listed to the business first by clearEmpties (lib/service-questions.ts)
      mediaConfig: { ...CLEARED_MEDIA },
      workSteps: [],
      expectedSignals: [],
      suggestedFields: [],
    }))
  }

  /**
   * The service as saving writes it. "Test & Publish" sends the same thing to be priced (T-204), so
   * what the business tests is what it saves.
   */
  const serviceBody = () => {
    // T-201: a service made by hand keeps its questions too. They live in the draft, and it had
    // none, so they were lost on save; now the editor writes it one (lib/service-questions).
    const draftConfig = draftToSave(aiDraft ?? (isHandMade(editingService?.draft_config) ? editingService?.draft_config : null), formData)
    return {
      name: formData.name,
      description: formData.description || null,
      autoSend: formData.reviewMode === 'auto_send',
      holdUntilApproved: formData.reviewMode === 'hold_until_approved',
      scopeIncludes: formData.scopeIncludes,
      scopeExcludes: formData.scopeExcludes,
      defaultAssumptions: formData.defaultAssumptions,
      mediaConfig: { ...formData.mediaConfig, minPhotos: photosRequired(formData.mediaConfig.minPhotos) },
      workSteps: formData.workSteps,
      expectedSignals: formData.expectedSignals,
      pricingRules: {
        baseFee: formData.baseFee,
        minimumCharge: formData.minimumCharge,
        addons: formData.addons,
        multipliers: formData.multipliers,
        workSteps: formData.workSteps,
      },
      draftConfig,
    }
  }

  const goToNextStep = async () => {
    // Validate before moving forward
    if (activeStep === 'basic') {
      if (!formData.name.trim()) {
        setNameError('Service name is required')
        return
      }

      // When creating new service and description is provided, auto-generate AI draft
      if (!editingService && formData.description.trim() && !aiDraft && !generatingDraft) {
        await generateAIDraft()
      }
    }

    setNameError(null)
    const currentIndex = WIZARD_STEPS.indexOf(activeStep)
    const nextStep = WIZARD_STEPS[currentIndex + 1]
    if (nextStep) {
      setActiveStep(nextStep)
    }
  }

  const goToPreviousStep = () => {
    const currentIndex = WIZARD_STEPS.indexOf(activeStep)
    const prevStep = WIZARD_STEPS[currentIndex - 1]
    if (prevStep) {
      setActiveStep(prevStep)
    }
  }

  const isFirstStep = activeStep === 'basic'
  const isLastStep = activeStep === 'test'

  // Compute validation errors that block publishing
  const validationErrors: string[] = []
  const validationWarnings: string[] = []

  // Hard Error: Per-unit items must have quantity source
  const itemsWithoutQuantity = formData.workSteps.filter(
    s => (s.costType === 'per_unit' || s.costType === 'per_hour') && !s.quantitySource
  )
  if (itemsWithoutQuantity.length > 0) {
    itemsWithoutQuantity.forEach(item => {
      validationErrors.push(`"${item.name || 'Unnamed item'}" needs a quantity link`)
    })
  }

  // Hard Error: Invalid field references in quantity source
  const fieldIds = new Set(formData.suggestedFields.map(f => f.fieldId))
  formData.workSteps.forEach(step => {
    if (step.quantitySource?.type === 'form_field' && step.quantitySource.fieldId) {
      if (!fieldIds.has(step.quantitySource.fieldId)) {
        validationErrors.push(`"${step.name}" links to a question that doesn't exist`)
      }
    }
  })

  // T-201, hard error: a line ticked "Only include when condition is met" with no question can never be charged
  linesNeverCharged(formData.workSteps).forEach((step) => validationErrors.push(lineNeedsQuestion(step)))

  // T-201, warning: an adjustment or a condition that points at a question the service no longer has
  validationWarnings.push(...looseReferences(formData))

  // Warning: No pricing items
  if (formData.workSteps.length === 0 && formData.baseFee === 0) {
    validationWarnings.push(`No pricing configured - quotes will be ${currencySymbol}0`)
  }

  // T-204: a name that promises a kind of work no price line covers. Whole words only, and the
  // warning names the word it found ("Replacement" is not "Repair").
  validationWarnings.push(...nameWarnings(formData.name, formData.workSteps))

  // T-204: flags that stay visible and never block saving: a question that changes no price
  // line, and a line whose words say it depends on something but which nothing decides
  const pricingFlags = pricingChecks({ workSteps: formData.workSteps, fields: formData.suggestedFields, multipliers: formData.multipliers })

  const canPublish = validationErrors.length === 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitIntentRef.current) return
    submitIntentRef.current = false

    if (!isLastStep) return
    if (!formData.name.trim()) return

    setSaving(true)
    const switchOn = switchOnRef.current
    switchOnRef.current = false
    try {
      const body = serviceBody()

      if (editingService) {
        // Update existing service (T-204: "Save and switch on" also makes it active)
        const res = await fetch(`/api/services/${editingService.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(switchOn ? { ...body, active: true } : body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to update service')

        setServices((prev) =>
          prev.map((s) => (s.id === editingService.id ? data.service : s))
        )
        if (data.service?.active) setAddedOff((note) => (note?.id === editingService.id ? null : note))
      } else {
        // Create new service
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to create service')

        setServices((prev) => [data.service, ...prev])
      }
      // T-152: saving a service's prices here is the business checking them
      // (the "Check your prices" setup step on Home)
      void fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricesChecked: true }),
      }).catch(() => undefined)
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (service: Service) => {
    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !service.active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Failed to update service')

      setServices((prev) => prev.map((s) => (s.id === service.id ? data.service : s)))
      if (data.service?.active) setAddedOff((note) => (note?.id === service.id ? null : note))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service')
    }
  }

  const deleteService = async (service: Service) => {
    if (!confirm(`Are you sure you want to delete "${service.name}"?`)) return

    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Failed to delete service')

      setServices((prev) => prev.filter((s) => s.id !== service.id))
      setAddedOff((note) => (note?.id === service.id ? null : note))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete service')
    }
  }

  const steps: { id: WizardStep; label: string; number: number }[] = [
    { id: 'basic', label: 'Basic Info', number: 1 },
    { id: 'scope', label: 'Scope & Photos', number: 2 },
    { id: 'fields', label: 'Customer Questions', number: 3 },
    { id: 'pricing', label: 'Pricing Setup', number: 4 },
    { id: 'test', label: 'Test & Publish', number: 5 },
  ]

  return (
    <div>
      <PageHeader
        title="Services"
        description="Your services and what you charge for each"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowBulkUpload(true)}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
            >
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Services
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              data-testid="add-from-template"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
            >
              Add from a template
            </button>
            <button
              onClick={openCreateModal}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Service
            </button>
          </div>
        }
      />

      {/* Error message */}
      {error && (
        <div className="mb-4 rounded-lg bg-danger-light p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-danger" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <p className="text-sm text-danger">{error}</p>
            </div>
            <button onClick={() => setError(null)} aria-label="Dismiss this message" className="-my-2 ml-auto inline-flex h-11 w-11 items-center justify-center text-danger hover:text-danger">
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

      {/* T-201: a service added from a template is off until its example prices are checked */}
      {addedOff && !showModal && (
        <div className="mb-4 rounded-lg border border-tertiary-line border-l-4 border-l-tertiary bg-background p-4" role="status" data-testid="template-added-note">
          <p className="text-sm font-semibold text-tertiary">&quot;{addedOff.name}&quot; was added and is switched off.</p>
          <p className="mt-1 text-sm text-text-secondary">
            Its prices are examples, not yours. Check them, save, then press &quot;Enable&quot; beside it. Customers cannot ask for it until you do.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                const service = services.find((s) => s.id === addedOff.id)
                if (!service) return
                openEditModal(service)
                setActiveStep('pricing')
              }}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface"
            >
              Check its prices
            </button>
            <button
              type="button"
              onClick={() => setAddedOff(null)}
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
            >
              Hide this note
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : services.length === 0 ? (
        /* Empty state */
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-background p-12 text-center">
          <div className="mb-5 rounded-xl border border-border bg-surface p-4">
            <svg
              className="h-8 w-8 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-text-primary">No services yet</h3>
          <p className="mt-2 max-w-md text-sm text-text-secondary">
            Add your first service to start configuring pricing and receiving quotes.
          </p>
          <button
            onClick={openCreateModal}
            className="mt-6 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Add your first service
          </button>
          <button
            onClick={() => setShowTemplates(true)}
            className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-text-secondary underline underline-offset-2 hover:text-text-primary"
          >
            Or add one from a template
          </button>
        </div>
      ) : (
        /* Services list. T-169: one row per service that stacks on a phone, so
           Edit, Disable and Delete are always on screen. Delete sits apart
           from the other two, behind a rule, and is the only red one. */
        <div className="rounded-xl border border-border bg-background">
          <div className="hidden border-b border-border px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-muted md:grid md:grid-cols-[minmax(0,1fr)_6rem_auto] md:gap-x-6" aria-hidden="true">
            <span>Service</span>
            <span>Status</span>
            <span className="w-[17rem] text-right">Actions</span>
          </div>
        <ul className="divide-y divide-border" data-testid="services-list">
          {services.map((service) => (
            <li
              key={service.id}
              className="flex flex-col gap-3 px-4 py-4 md:grid md:grid-cols-[minmax(0,1fr)_6rem_auto] md:items-center md:gap-x-6 md:px-6"
              data-testid="service-row"
              data-active={service.active ? 'true' : 'false'}
            >
              <div className={`min-w-0 ${!service.active ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-text-primary">{service.name}</span>
                  {isAiDraft(service.draft_config) && <AIDraftBadge compact />}
                </div>
                {service.description && <p className="mt-0.5 truncate text-sm text-text-muted">{service.description}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary md:contents">
                <span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      service.active ? 'bg-secondary-light text-secondary' : 'border border-tertiary-line bg-background text-tertiary'
                    }`}
                    data-testid="service-state"
                  >
                    {service.active ? 'Active' : 'Inactive'}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2 md:w-[17rem] md:justify-end">
                <button
                  onClick={() => openEditModal(service)}
                  aria-label={`Edit ${service.name}`}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface md:min-h-[36px] md:px-3"
                  data-testid="service-edit"
                >
                  Edit
                </button>
                <button
                  onClick={() => toggleActive(service)}
                  aria-label={`${service.active ? 'Disable' : 'Enable'} ${service.name}`}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface hover:text-text-primary md:min-h-[36px] md:px-3"
                  data-testid="service-toggle"
                >
                  {service.active ? 'Disable' : 'Enable'}
                </button>
                {/* Delete: pushed to the far side, behind a rule */}
                <span className="ml-auto flex items-center border-l border-border-strong pl-3 md:ml-2">
                  <button
                    onClick={() => deleteService(service)}
                    aria-label={`Delete ${service.name}`}
                    className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger-light md:min-h-[36px]"
                    data-testid="service-delete"
                  >
                    Delete
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-[3px] p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-background shadow-document">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary mb-0.5">Service setup</p>
                <h2 className="font-display text-xl font-bold text-text-primary">
                  {editingService ? 'Edit service' : 'New service'}
                </h2>
              </div>
              <button
                onClick={closeModal}
                aria-label="Close"
                data-testid="service-modal-close"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Step Indicators — one quiet line: numbers always, label only where it matters */}
            <div className="border-b border-border px-6 pt-4 pb-3">
              <nav className="flex items-center gap-2.5" aria-label="Setup steps">
                {steps.map((step, index) => {
                  const isActive = activeStep === step.id
                  const isDone = WIZARD_STEPS.indexOf(activeStep) > index
                  return (
                    <div key={step.id} className={`flex items-center gap-2.5 ${index < steps.length - 1 ? 'flex-1' : ''}`}>
                      <div className="flex items-center gap-2 shrink-0" title={step.label}>
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
                            isActive
                              ? 'bg-primary text-white ring-2 ring-primary ring-offset-1'
                              : isDone
                                ? 'bg-primary text-white'
                                : 'border border-border bg-surface text-text-muted'
                          }`}
                        >
                          {isDone ? (
                            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : (
                            step.number
                          )}
                        </span>
                        <span
                          className={`whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.08em] ${
                            isActive ? 'text-primary' : 'hidden'
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                      {index < steps.length - 1 && (
                        <div className={isDone ? 'flex-1 h-[3px] rounded-full bg-primary/60' : 'flex-1 tape-rule opacity-50'} />
                      )}
                    </div>
                  )
                })}
              </nav>
            </div>

            <form onSubmit={handleSubmit} data-testid="service-form">
              <div className="p-6">
                {/* AI Refinement Panel — shown on steps 2-4 when AI draft exists */}
                {aiDraft && activeStep !== 'basic' && activeStep !== 'test' && (
                  <div className="mb-6">
                    <AIDraftRefinementPanel
                      formData={formData}
                      aiDraft={aiDraft}
                      onApplyDraft={applyDraftToForm}
                    />
                  </div>
                )}

                {/* Basic Info Step */}
                {activeStep === 'basic' && (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Service Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => {
                          setFormData({ ...formData, name: e.target.value })
                          if (nameError && e.target.value.trim()) {
                            setNameError(null)
                          }
                        }}
                        placeholder="e.g., Kitchen Renovation"
                        className={`w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 ${
                          nameError
                            ? 'border-danger focus:border-danger focus:ring-danger'
                            : 'border-border focus:border-primary'
                        }`}
                        required
                        autoFocus
                      />
                      {nameError && (
                        <p className="mt-1 text-sm text-danger">{nameError}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Description
                      </label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Describe what this service includes. AI will use this to generate sensible defaults for scope, pricing, and form fields."
                        rows={4}
                        className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2"
                      />
                      <p className="mt-1 text-xs text-text-muted">
                        A good description helps AI generate better defaults for the next steps
                      </p>
                    </div>

                    {/* T-147: how new estimates reach the customer */}
                    <fieldset>
                      <legend className="mb-1.5 block text-sm font-medium text-text-primary">
                        When a customer asks for an estimate
                      </legend>
                      <div className="space-y-2">
                        {REVIEW_MODE_OPTIONS.map((option) => (
                          <label
                            key={option.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition ${
                              formData.reviewMode === option.value
                                ? 'border-primary bg-mint/40'
                                : 'border-border bg-background hover:border-border-strong'
                            }`}
                          >
                            <input
                              type="radio"
                              name="reviewMode"
                              value={option.value}
                              checked={formData.reviewMode === option.value}
                              onChange={() => setFormData({ ...formData, reviewMode: option.value })}
                              className="mt-0.5 h-4 w-4 border-border text-primary"
                            />
                            <span>
                              <span className="block text-sm font-medium text-text-primary">{option.label}</span>
                              <span className="mt-0.5 block text-xs text-text-muted">{option.help}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* AI Draft Generation Indicator */}
                    {draftError && (
                      <div className="rounded-lg border border-danger/30 bg-danger-light p-3 text-sm text-danger">
                        {draftError}
                      </div>
                    )}

                    {generatingDraft && (
                      <div className="flex items-center gap-2 rounded-lg border bg-tertiary-light p-3">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-tertiary border-t-transparent" />
                        <span className="text-sm text-tertiary">
                          Generating AI draft configuration...
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Scope & Photos Step */}
                {activeStep === 'scope' && (
                  <div className="space-y-6">
                    {/* AI Draft Badge for Scope section */}
                    {aiDraft && (
                      <div className="flex items-center justify-between rounded-lg border bg-tertiary-light p-3">
                        <div className="flex items-center gap-2">
                          <AIDraftBadge compact />
                          <span className="text-sm text-tertiary">
                            Pre-filled from AI draft. You can edit any field.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmClear(false)
                              setConfirmRegenerate(true)
                            }}
                            disabled={generatingDraft || confirmRegenerate}
                            className="text-sm text-tertiary hover:text-text-primary"
                            data-testid="regenerate"
                          >
                            {generatingDraft ? 'Writing a new draft…' : 'Regenerate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmRegenerate(false)
                              setConfirmClear(true)
                            }}
                            disabled={generatingDraft || confirmClear}
                            className="text-sm text-text-secondary hover:text-text-primary"
                            data-testid="clear-draft"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}

                    {/* T-201: Regenerate asks first and names what it replaces. "Cancel" changes nothing. */}
                    {aiDraft && confirmRegenerate && (
                      <div className="rounded-lg border border-border-strong bg-background p-4" role="alertdialog" aria-labelledby="regenerate-title" data-testid="regenerate-confirm">
                        <h3 id="regenerate-title" className="text-sm font-bold text-text-primary">Replace this service&apos;s setup with a new draft?</h3>
                        <p className="mt-1 text-sm text-text-secondary">A new draft is written from the service name and description. It replaces:</p>
                        <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-text-primary">
                          {regenerateReplaces(formData).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                        <p className="mt-2 text-sm text-text-secondary">{REGENERATE_KEEPS} Nothing is saved until you press &quot;{editingService ? 'Save Changes' : 'Create Service'}&quot;.</p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmRegenerate(false)
                              void generateAIDraft()
                            }}
                            className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                            data-testid="regenerate-yes"
                          >
                            Replace with a new draft
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRegenerate(false)}
                            className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface"
                            data-testid="regenerate-cancel"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {/* T-202: "Clear" asks first and names what it empties, the same way. "Cancel" changes nothing. */}
                    {aiDraft && confirmClear && (
                      <div className="rounded-lg border border-border-strong bg-background p-4" role="alertdialog" aria-labelledby="clear-title" data-testid="clear-confirm">
                        <h3 id="clear-title" className="text-sm font-bold text-text-primary">Empty this service&apos;s setup?</h3>
                        <p className="mt-1 text-sm text-text-secondary">Nothing is written in its place. It empties:</p>
                        <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-text-primary">
                          {clearEmpties(formData).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                        {clearLoosens(formData) && <p className="mt-2 text-sm text-text-primary" data-testid="clear-loosens">{clearLoosens(formData)}</p>}
                        <p className="mt-2 text-sm text-text-secondary">{CLEAR_KEEPS} Nothing is saved until you press &quot;{editingService ? 'Save Changes' : 'Create Service'}&quot;.</p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={clearAIDraft}
                            className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                            data-testid="clear-yes"
                          >
                            Empty the setup
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClear(false)}
                            className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface"
                            data-testid="clear-cancel"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {draftError && <p className="rounded-lg border border-danger/30 bg-danger-light p-3 text-sm text-danger" role="alert">{draftError}</p>}

                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        What&apos;s Typically Included
                      </label>
                      <TagInput
                        tags={formData.scopeIncludes}
                        onChange={(tags) => setFormData({ ...formData, scopeIncludes: tags })}
                        placeholder="Press Enter to add (e.g., Labor, Materials, Cleanup)"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        What&apos;s Typically Excluded
                      </label>
                      <TagInput
                        tags={formData.scopeExcludes}
                        onChange={(tags) => setFormData({ ...formData, scopeExcludes: tags })}
                        placeholder="Press Enter to add (e.g., Permits, Electrical work)"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Standard Assumptions
                      </label>
                      <TagInput
                        tags={formData.defaultAssumptions}
                        onChange={(tags) => setFormData({ ...formData, defaultAssumptions: tags })}
                        placeholder="Press Enter to add (e.g., Clear site access, Standard hours)"
                      />
                    </div>

                    <hr className="my-4" />

                    <h3 className="text-base font-medium text-text-primary">Photos</h3>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="photos-required" className="mb-1 block text-sm font-medium text-text-secondary">
                          Photos required
                        </label>
                        <input
                          id="photos-required"
                          data-testid="photos-required"
                          type="number"
                          min={0}
                          max={MAX_PHOTOS_REQUIRED}
                          value={formData.mediaConfig.minPhotos}
                          onChange={(e) => {
                            // T-204: 0 to 8, and never more than the most a customer may add
                            const required = photosRequired(e.target.value, 0)
                            setFormData({
                              ...formData,
                              mediaConfig: {
                                ...formData.mediaConfig,
                                minPhotos: required,
                                maxPhotos: Math.max(formData.mediaConfig.maxPhotos, required, 1),
                              },
                            })
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                          aria-describedby="photos-required-hint"
                          className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2"
                        />
                        <p id="photos-required-hint" className="mt-1 text-xs text-text-muted">
                          {formData.mediaConfig.minPhotos > 0
                            ? `A customer must add at least ${formData.mediaConfig.minPhotos} photo${formData.mediaConfig.minPhotos > 1 ? 's' : ''} before they can send a request.`
                            : 'Photos are optional: a customer can send a request without any.'}{' '}
                          0 to {MAX_PHOTOS_REQUIRED}.
                        </p>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-text-secondary">
                          Maximum Photos Allowed
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={formData.mediaConfig.maxPhotos}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              mediaConfig: {
                                ...formData.mediaConfig,
                                maxPhotos: Math.max(parseInt(e.target.value) || 8, formData.mediaConfig.minPhotos, 1),
                              },
                            })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                          className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Photo Guidance for Customers
                      </label>
                      <textarea
                        value={formData.mediaConfig.photoGuidance || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            mediaConfig: {
                              ...formData.mediaConfig,
                              photoGuidance: e.target.value || null,
                            },
                          })
                        }
                        placeholder="e.g., Please include photos of the area from multiple angles, any damage or problem areas, and any obstacles."
                        rows={3}
                        className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2"
                      />
                    </div>
                  </div>
                )}

                {/* Pricing Setup Step */}
                {activeStep === 'pricing' && (
                  <div className="space-y-6">
                    {/* T-201: a template's service, just added and still off */}
                    {editingService && addedOff?.id === editingService.id && !editingService.active && (
                      <p className="rounded-lg border border-tertiary-line border-l-4 border-l-tertiary bg-background p-3 text-sm text-text-primary" data-testid="template-prices-note">
                        These are the template&apos;s example prices. Change them to yours. The service stays <span className="font-semibold text-tertiary">switched off</span> until you press &quot;Save and switch on&quot; on the last step, or &quot;Enable&quot; on &quot;Services&quot;.
                      </p>
                    )}
                    {/* AI Draft Badge */}
                    {aiDraft && (
                      <div className="flex items-center justify-between rounded-lg border bg-tertiary-light p-3">
                        <div className="flex items-center gap-2">
                          <AIDraftBadge compact />
                          <span className="text-sm text-tertiary">
                            Pre-filled from AI draft. You can edit any item.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Plain-language pricing composer (T-104) — the default way to set pricing */}
                    <PricingComposer
                      serviceName={formData.name}
                      serviceDescription={formData.description}
                      currencySymbol={currencySymbol}
                      current={{
                        baseFee: formData.baseFee,
                        minimumCharge: formData.minimumCharge,
                        workSteps: formData.workSteps,
                        addons: formData.addons,
                        multipliers: formData.multipliers,
                        suggestedFields: formData.suggestedFields,
                        expectedSignals: formData.expectedSignals,
                        // T-201: a service made by hand is sent too, so "anything you don't mention stays" holds for it
                        currentConfig: aiDraft
                          ? {
                              ...aiDraft,
                              pricing: {
                                ...aiDraft.pricing,
                                baseFee: formData.baseFee,
                                minimumCharge: formData.minimumCharge,
                                workSteps: formData.workSteps,
                              },
                              expectedSignals: formData.expectedSignals,
                              suggestedFields: formData.suggestedFields,
                            }
                          : handMadeDraft(formData),
                      }}
                      onApply={(result) => {
                        applyDraftToForm(result.updatedConfig)
                        setFormData((prev) => ({
                          ...prev,
                          addons: result.addons.length > 0 ? result.addons : prev.addons,
                          multipliers:
                            result.multipliers.length > 0 ? result.multipliers : prev.multipliers,
                        }))
                      }}
                    />

                    <p className="text-center text-xs font-medium uppercase tracking-wide text-text-muted">
                      Or fine-tune manually
                    </p>

                    {/* Base Pricing */}
                    <div className="rounded-lg border border-border p-4">
                      <h3 className="mb-3 text-base font-medium text-text-primary">Base Pricing</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-sm text-text-secondary">Base Fee</label>
                          <div className="relative">
                            <AmountSymbol symbol={currencySymbol} />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={formData.baseFee}
                              onChange={(e) => setFormData({ ...formData, baseFee: parseFloat(e.target.value) || 0 })}
                              className={`w-full rounded-lg border border-border py-2 ${amountBoxPadding(currencySymbol)} pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2`}
                            />
                          </div>
                          <p className="mt-1 text-xs text-text-muted">Starting price for all quotes</p>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm text-text-secondary">Minimum Charge</label>
                          <div className="relative">
                            <AmountSymbol symbol={currencySymbol} />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={formData.minimumCharge}
                              onChange={(e) => setFormData({ ...formData, minimumCharge: parseFloat(e.target.value) || 0 })}
                              className={`w-full rounded-lg border border-border py-2 ${amountBoxPadding(currencySymbol)} pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2`}
                            />
                          </div>
                          <p className="mt-1 text-xs text-text-muted">Minimum quote amount</p>
                        </div>
                      </div>
                    </div>

                    {/* Price Breakdown (Work Steps) */}
                    <div>
                      <h3 className="text-base font-medium text-text-primary">Price Breakdown</h3>
                      <p className="mb-3 text-sm text-text-muted">
                        Define how you charge for this service. Each item appears as a line on the quote.
                      </p>
                      <WorkStepEditor
                        workSteps={formData.workSteps}
                        onChange={(steps) => setFormData({ ...formData, workSteps: steps })}
                        expectedSignals={formData.expectedSignals}
                        suggestedFields={formData.suggestedFields}
                        onExpectedSignalsChange={(signals) => setFormData({ ...formData, expectedSignals: signals })}
                        unitSystem={getRegion(region).unitSystem}
                        currencySymbol={currencySymbol}
                      />
                    </div>

                    {/* Adjustments (Multipliers) */}
                    <div className="rounded-lg border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h3 className="text-base font-medium text-text-primary">Adjustments</h3>
                          <p className="text-sm text-text-muted">Increase or decrease price based on customer answers</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            multipliers: [...formData.multipliers, { when: { fieldId: '', equals: '' }, multiplier: 1 }]
                          })}
                          className="inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-background"
                        >
                          <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add
                        </button>
                      </div>

                      {formData.multipliers.length === 0 ? (
                        <p className="py-4 text-center text-sm text-text-muted">
                          No adjustments configured. Example: &quot;When frequency is weekly, reduce by 15%&quot;
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {formData.multipliers.map((mult, index) => {
                            const selectedField = formData.suggestedFields.find(f => f.fieldId === mult.when.fieldId)
                            const fieldOptions = selectedField?.options || []

                            return (
                              <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="text-text-muted">When</span>
                                <select
                                  value={mult.when.fieldId}
                                  onChange={(e) => {
                                    const newMultipliers = [...formData.multipliers]
                                    newMultipliers[index] = { ...mult, when: { ...mult.when, fieldId: e.target.value } }
                                    setFormData({ ...formData, multipliers: newMultipliers })
                                  }}
                                  className="w-40 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2"
                                >
                                  <option value="">Select question...</option>
                                  {formData.suggestedFields.map((field) => (
                                    <option key={field.fieldId} value={field.fieldId}>{field.label}</option>
                                  ))}
                                </select>
                                <span className="text-text-muted">=</span>
                                {fieldOptions.length > 0 ? (
                                  <select
                                    value={String(mult.when.equals || '')}
                                    onChange={(e) => {
                                      const newMultipliers = [...formData.multipliers]
                                      newMultipliers[index] = { ...mult, when: { ...mult.when, equals: e.target.value } }
                                      setFormData({ ...formData, multipliers: newMultipliers })
                                    }}
                                    className="w-40 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2"
                                  >
                                    <option value="">Select value...</option>
                                    {fieldOptions.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    value={String(mult.when.equals || '')}
                                    onChange={(e) => {
                                      const newMultipliers = [...formData.multipliers]
                                      newMultipliers[index] = { ...mult, when: { ...mult.when, equals: e.target.value } }
                                      setFormData({ ...formData, multipliers: newMultipliers })
                                    }}
                                    placeholder="value"
                                    className="w-32 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2"
                                  />
                                )}
                                <span className="text-text-muted">→</span>
                                <select
                                  value={mult.multiplier >= 1 ? 'increase' : 'decrease'}
                                  onChange={(e) => {
                                    const newMultipliers = [...formData.multipliers]
                                    const absValue = Math.abs(mult.multiplier - 1) * 100
                                    const newMult = e.target.value === 'increase' ? 1 + absValue / 100 : 1 - absValue / 100
                                    newMultipliers[index] = { ...mult, multiplier: newMult }
                                    setFormData({ ...formData, multipliers: newMultipliers })
                                  }}
                                  className="w-28 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2"
                                >
                                  <option value="increase">Increase</option>
                                  <option value="decrease">Reduce</option>
                                </select>
                                <span className="text-text-muted">by</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={Math.round(Math.abs(mult.multiplier - 1) * 100)}
                                  onChange={(e) => {
                                    const newMultipliers = [...formData.multipliers]
                                    const pct = parseFloat(e.target.value) || 0
                                    const newMult = mult.multiplier >= 1 ? 1 + pct / 100 : 1 - pct / 100
                                    newMultipliers[index] = { ...mult, multiplier: newMult }
                                    setFormData({ ...formData, multipliers: newMultipliers })
                                  }}
                                  className="w-16 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2"
                                />
                                <span className="text-text-muted">%</span>
                                <button
                                  type="button"
                                  onClick={() => setFormData({ ...formData, multipliers: formData.multipliers.filter((_, i) => i !== index) })}
                                  className="text-text-muted hover:text-danger"
                                >
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Add-ons */}
                    <div className="rounded-lg border border-border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h3 className="text-base font-medium text-text-primary">Add-ons</h3>
                          <p className="text-sm text-text-muted">Optional extras that AI will suggest based on customer needs</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            addons: [...formData.addons, { id: generateAddonId(), label: '', price: 0 }]
                          })}
                          className="inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-background"
                        >
                          <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add
                        </button>
                      </div>

                      {formData.addons.length === 0 ? (
                        <p className="py-4 text-center text-sm text-text-muted">
                          No add-ons configured. Name them clearly (e.g., &quot;Deep Carpet Cleaning&quot;) and AI will suggest them when relevant.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {formData.addons.map((addon, index) => (
                            <div key={addon.id} className="flex items-center gap-3">
                              <input
                                type="text"
                                value={addon.label}
                                onChange={(e) => {
                                  const newAddons = [...formData.addons]
                                  newAddons[index] = { ...addon, label: e.target.value }
                                  setFormData({ ...formData, addons: newAddons })
                                }}
                                placeholder="Add-on name (e.g., Deep Carpet Cleaning)"
                                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
                              />
                              <div className="relative w-28">
                                <AmountSymbol symbol={currencySymbol} />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={addon.price}
                                  onChange={(e) => {
                                    const newAddons = [...formData.addons]
                                    newAddons[index] = { ...addon, price: parseFloat(e.target.value) || 0 }
                                    setFormData({ ...formData, addons: newAddons })
                                  }}
                                  className={`w-full rounded-lg border border-border py-2 ${amountBoxPadding(currencySymbol)} pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2`}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => setFormData({ ...formData, addons: formData.addons.filter((_, i) => i !== index) })}
                                className="text-text-muted hover:text-danger"
                              >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Widget Fields Step */}
                {activeStep === 'fields' && (
                  <div className="space-y-6">
                    {/* AI Draft Badge */}
                    {aiDraft && (
                      <div className="flex items-center justify-between rounded-lg border bg-tertiary-light p-3">
                        <div className="flex items-center gap-2">
                          <AIDraftBadge compact />
                          <span className="text-sm text-tertiary">
                            Pre-filled from AI draft. You can edit any field.
                          </span>
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="text-base font-medium text-text-primary">Customer Questions</h3>
                      <p className="mb-3 text-sm text-text-muted">
                        What information do you need from customers to give an accurate quote?
                      </p>
                      <SuggestedFieldEditor
                        fields={formData.suggestedFields}
                        onChange={(fields) => {
                          // T-201: a question keeps its keys when its label changes, and the facts no
                          // question wrote are left alone (lib/service-questions)
                          setFormData(prev => {
                            const synced = syncQuestions({
                              fields,
                              previousFields: prev.suggestedFields,
                              previousSignals: prev.expectedSignals,
                              savedFieldIds: savedFieldIds.current,
                              workSteps: prev.workSteps,
                              multipliers: prev.multipliers,
                            })
                            return { ...prev, suggestedFields: synced.fields, expectedSignals: synced.signals }
                          })
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Test & Publish Step */}
                {activeStep === 'test' && (
                  <div className="space-y-6">
                    {/* T-204: priced by the worker's own pipeline, so the test is what a customer gets */}
                    <PricingTest
                      service={{ ...serviceBody(), suggestedFields: formData.suggestedFields }}
                      serviceId={editingService?.id}
                      currencySymbol={currencySymbol}
                      onTested={setPricingTested}
                    />

                    {/* Validation Summary */}
                    <div className={`rounded-lg border p-4 ${validationErrors.length > 0 ? 'border-danger/20 bg-danger-light' : 'border-border'}`}>
                      <h4 className="mb-3 text-sm font-medium text-text-primary">
                        {validationErrors.length > 0 ? 'Fix Before Publishing' : 'Ready to Publish'}
                      </h4>

                      {/* Hard Errors */}
                      {validationErrors.length > 0 && (
                        <div className="mb-4 space-y-2">
                          {validationErrors.map((err, index) => (
                            <div key={index} className="flex items-start gap-2 text-sm text-danger">
                              <svg className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              {err}
                            </div>
                          ))}
                          <p className="mt-2 text-xs text-danger">
                            Go back to Pricing Setup to fix these issues.
                          </p>
                        </div>
                      )}

                      {/* Warnings */}
                      {validationWarnings.length > 0 && (
                        <div className="mb-4 space-y-2">
                          {validationWarnings.map((warn, index) => (
                            <div key={index} className="flex items-start gap-2 text-sm text-tertiary">
                              <svg className="mt-0.5 h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              {warn}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* T-204: flags. They stay visible and never block saving. */}
                      {pricingFlags.length > 0 && (
                        <div className="mb-4">
                          <PricingFlagsNote
                            flags={pricingFlags}
                            title="Worth a look before you publish"
                            hint={'You can still save. Link a line to a question on "Pricing Setup", or describe the price again.'}
                          />
                        </div>
                      )}

                      {/* Success checks */}
                      {validationErrors.length === 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm text-secondary">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            All pricing items properly configured
                          </div>

                          {formData.suggestedFields.filter(f => f.type === 'number').length > 0 && (
                            <div className="flex items-center gap-2 text-sm text-secondary">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Customer questions linked to pricing
                            </div>
                          )}

                          {pricingTested && (
                            <div className="flex items-center gap-2 text-sm text-secondary">
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Pricing tested with sample values
                            </div>
                          )}
                        </div>
                      )}

                      {/* Test reminder if not run */}
                      {!pricingTested && validationErrors.length === 0 && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-text-muted">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Consider running a test to verify pricing
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer - Wizard Navigation */}
              <div className="flex justify-between border-t border-border bg-surface/50 px-6 py-4">
                <div>
                  {isFirstStep ? (
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goToPreviousStep}
                      className="inline-flex items-center rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                    >
                      <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </button>
                  )}
                </div>
                <div>
                  {isLastStep ? (
                    editingService && !editingService.active ? (
                      // T-204: a service that is switched off can be saved as it is, or saved and switched on
                      <div className="flex flex-wrap items-center justify-end gap-3">
                        <span className="text-sm font-semibold text-tertiary" data-testid="save-off-note">This service is switched off.</span>
                        <button
                          type="submit"
                          disabled={saving || !formData.name.trim() || !canPublish}
                          onClick={() => { submitIntentRef.current = true; switchOnRef.current = false }}
                          className="rounded-lg border border-field bg-background px-5 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                          title={!canPublish ? 'Fix validation errors before publishing' : undefined}
                          data-testid="save-keep-off"
                        >
                          {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button
                          type="submit"
                          disabled={saving || !formData.name.trim() || !canPublish}
                          onClick={() => { submitIntentRef.current = true; switchOnRef.current = true }}
                          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                          title={!canPublish ? 'Fix validation errors before publishing' : undefined}
                          data-testid="save-switch-on"
                        >
                          {saving ? 'Saving...' : 'Save and switch on'}
                        </button>
                      </div>
                    ) : (
                    <button
                      type="submit"
                      disabled={saving || !formData.name.trim() || !canPublish}
                      onClick={() => { submitIntentRef.current = true; switchOnRef.current = false }}
                      className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!canPublish ? 'Fix validation errors before publishing' : undefined}
                    >
                      {saving ? 'Saving...' : editingService ? 'Save Changes' : 'Create Service'}
                    </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={goToNextStep}
                      disabled={generatingDraft}
                      className="inline-flex items-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      {generatingDraft ? (
                        <>
                          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Generating...
                        </>
                      ) : (
                        <>
                          Next
                          <svg className="ml-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Upload Modal */}
      <BulkServiceUpload
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onServicesCreated={fetchServices}
      />

      {/* T-189: a trade template's service, added after setup. It opens at its prices, which are a starting point.
          T-201: it is added switched off, and the page says so until the business switches it on. */}
      <TemplatePicker
        open={showTemplates}
        region={region}
        ownedNames={services.map((s) => s.name)}
        money={(n) => `${currencySymbol}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`}
        onClose={() => setShowTemplates(false)}
        onAdded={(service) => {
          setShowTemplates(false)
          // T-201: it was added switched off; the note stays until it is switched on
          setAddedOff({ id: service.id, name: service.name })
          fetchServices()
          openEditModal(service)
          setActiveStep('pricing')
        }}
      />
    </div>
  )
}
