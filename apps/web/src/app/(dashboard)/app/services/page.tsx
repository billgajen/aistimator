'use client'

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { AIDraftBadge } from '@/components/AIDraftBadge'
import { WorkStepEditor } from '@/components/WorkStepEditor'
import { SuggestedFieldEditor } from '@/components/SuggestedFieldEditor'
import { BulkServiceUpload } from '@/components/services/BulkServiceUpload'
import { AIDraftRefinementPanel } from '@/components/services/AIDraftRefinementPanel'
import type {
  Service,
  DocumentType,
  ServiceMediaConfig,
  ServiceDraftConfig,
  WorkStepConfig,
  ExpectedSignalConfig,
  SuggestedField,
  AddonConfig,
  MultiplierConfig,
  PricingRules,
} from '@estimator/shared'

export const dynamic = 'force-dynamic'

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'instant_estimate', label: 'Instant Estimate' },
  { value: 'formal_quote', label: 'Formal Quote' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'sow', label: 'Statement of Work' },
]

type WizardStep = 'basic' | 'scope' | 'fields' | 'pricing' | 'test'

const WIZARD_STEPS: WizardStep[] = ['basic', 'scope', 'fields', 'pricing', 'test']

interface ServiceFormData {
  name: string
  description: string
  documentTypeDefault: DocumentType
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
  documentTypeDefault: 'instant_estimate',
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
 * Derive a canonical signal key from a field label and type
 *
 * This ensures form fields and AI use the SAME signal keys - no matching needed.
 *
 * Examples:
 * - "How many papers?" (number) → paper_count
 * - "Number of Leaks" (number) → leak_count
 * - "Approximate Age of Roof" (number) → roof_age
 * - "Is the leak causing interior damage?" (boolean) → has_interior_damage
 * - "Type of Roofing Material" (dropdown) → roofing_material_type
 * - "Number of Papers" (number) → paper_count
 */
function deriveSignalKey(label: string, fieldType: string): string {
  // Normalize label: lowercase, remove punctuation
  let normalized = label.toLowerCase()
    .replace(/[?!.,'"]/g, '')
    .trim()

  // Remove common question prefixes/fillers
  const prefixPatterns = [
    /^how many\s+/i,
    /^number of\s+/i,
    /^what is the\s+/i,
    /^what is your\s+/i,
    /^what are the\s+/i,
    /^what\s+/i,
    /^how\s+/i,
    /^is the\s+/i,
    /^is there\s+/i,
    /^do you have\s+/i,
    /^does the\s+/i,
    /^are there\s+/i,
    /^please enter\s+/i,
    /^please provide\s+/i,
    /^approximate\s+/i,
    /^estimated\s+/i,
    /^total\s+/i,
  ]

  for (const pattern of prefixPatterns) {
    normalized = normalized.replace(pattern, '')
  }

  // Split into words and filter stop words
  const words = normalized.split(/\s+/)
  const stopWords = new Set([
    'the', 'a', 'an', 'of', 'is', 'are', 'your', 'do', 'you', 'have',
    'need', 'needed', 'required', 'for', 'to', 'in', 'on', 'at', 'by',
    'this', 'that', 'these', 'those', 'any', 'some'
  ])

  const meaningfulWords = words
    .filter(w => !stopWords.has(w) && w.length > 1)
    .slice(0, 3) // Take up to 3 meaningful words

  if (meaningfulWords.length === 0) {
    // Fallback: just use the first word
    const firstWord = words[0] || 'field'
    return firstWord.replace(/s$/, '') // singularize
  }

  // Singularize common plurals in the core concept
  const singularize = (word: string): string => {
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y'
    if (word.endsWith('es') && !word.endsWith('ss')) return word.slice(0, -2)
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
    return word
  }

  // Build the core concept (first 2 words usually)
  const coreWords = meaningfulWords.slice(0, 2).map(singularize)
  const core = coreWords.join('_')

  // Add appropriate suffix based on field type
  switch (fieldType) {
    case 'number': {
      // Check if it already has a numeric suffix
      const numericSuffixes = ['count', 'quantity', 'number', 'total', 'amount', 'age', 'area', 'sqft', 'size']
      const hasNumericSuffix = numericSuffixes.some(s => core.endsWith(s) || core.includes(`_${s}`))

      // Check for specific patterns
      if (core.includes('age') || normalized.includes('age')) {
        return core.includes('age') ? core : `${core}_age`
      }
      if (core.includes('area') || core.includes('sqft') || normalized.includes('sqft') || normalized.includes('square')) {
        return core.includes('area') ? core : `${core}_area`
      }

      // Default: add _count for numbers
      return hasNumericSuffix ? core : `${core}_count`
    }

    case 'dropdown':
    case 'radio': {
      // Check if it already has a type-like suffix
      const typeSuffixes = ['type', 'kind', 'style', 'category', 'material', 'condition', 'status']
      const hasTypeSuffix = typeSuffixes.some(s => core.endsWith(s) || core.includes(`_${s}`))

      // Check for specific patterns
      if (normalized.includes('condition')) {
        return core.includes('condition') ? core : `${core}_condition`
      }
      if (normalized.includes('material')) {
        return core.includes('material') ? core : `${core}_material`
      }

      // Default: add _type for dropdowns
      return hasTypeSuffix ? core : `${core}_type`
    }

    case 'checkbox': {
      // For checkboxes, check what makes sense
      const boolPrefixes = ['is', 'has', 'can', 'does', 'will', 'should']
      const startsWithBool = boolPrefixes.some(p => core.startsWith(p) || core.startsWith(`${p}_`))

      return startsWithBool ? core : `has_${core}`
    }

    case 'boolean': {
      // For yes/no toggles
      const boolPrefixes = ['is', 'has', 'can', 'does', 'will', 'should']
      const startsWithBool = boolPrefixes.some(p => core.startsWith(p) || core.startsWith(`${p}_`))

      // Check for specific patterns
      if (normalized.includes('damage') || normalized.includes('damaged')) {
        return core.includes('has_') ? core : `has_${core.replace('damage', 'damage')}`
      }
      if (normalized.includes('required') || normalized.includes('needed')) {
        return `${core.replace('_required', '').replace('_needed', '')}_required`
      }

      return startsWithBool ? core : `has_${core}`
    }

    case 'text':
    case 'textarea':
    default:
      // For text fields, just use the core concept
      return core.endsWith('description') ? core : (core.length > 0 ? core : 'description')
  }
}

/**
 * Convert a form field to an expected signal
 * This auto-generates signal configuration from customer questions
 *
 * Uses deriveSignalKey() to ensure canonical, consistent signal keys
 * that both form and AI will use - eliminating the need for synonym matching.
 */
function fieldToSignal(field: SuggestedField): ExpectedSignalConfig {
  // Derive canonical signal key from label and type
  const signalKey = deriveSignalKey(field.label, field.type)

  // Map field type to signal type
  const typeMap: Record<SuggestedField['type'], ExpectedSignalConfig['type']> = {
    'number': 'number',
    'boolean': 'boolean',
    'dropdown': 'enum',
    'radio': 'enum',
    'checkbox': 'enum',
    'text': 'string',
    'textarea': 'string',
  }

  return {
    signalKey,
    type: typeMap[field.type] || 'string',
    description: field.label,
    possibleValues: field.options,
  }
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
    <div className="min-h-[80px] rounded-lg border border-border p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
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
 * Services Page
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

  // AI Draft state
  const [aiDraft, setAiDraft] = useState<ServiceDraftConfig | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // Bulk upload state
  const [showBulkUpload, setShowBulkUpload] = useState(false)

  // Quote Simulator state
  const [simulatorValues, setSimulatorValues] = useState<Record<string, string | number | boolean>>({})
  const [simulatorResult, setSimulatorResult] = useState<{
    lineItems: Array<{ name: string; amount: number; calculation: string; quantitySource?: string }>
    subtotal: number
    warnings: string[]
  } | null>(null)

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
    setShowModal(true)
  }

  const openEditModal = (service: Service) => {
    setEditingService(service)
    // Extract pricing rules from service
    const pricingRules = (service.pricing_rules || {}) as Partial<PricingRules>
    setFormData({
      name: service.name,
      description: service.description || '',
      documentTypeDefault: service.document_type_default,
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
    setAiDraft(service.draft_config || null)
    setDraftError(null)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingService(null)
    setFormData(defaultFormData)
    setActiveStep('basic')
    setNameError(null)
    setAiDraft(null)
    setDraftError(null)
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
          documentType: formData.documentTypeDefault,
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
    setAiDraft(null)
    setFormData((prev) => ({
      ...prev,
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
    }))
  }

  /**
   * Run Quote Simulator to preview pricing calculations
   */
  const runSimulator = () => {
    const lineItems: Array<{ name: string; amount: number; calculation: string; quantitySource?: string }> = []
    const warnings: string[] = []
    let subtotal = 0

    // Add base fee if configured
    if (formData.baseFee > 0) {
      lineItems.push({
        name: 'Base Fee',
        amount: formData.baseFee,
        calculation: `Fixed: $${formData.baseFee.toFixed(2)}`,
        quantitySource: 'constant',
      })
      subtotal += formData.baseFee
    }

    for (const step of formData.workSteps) {
      // Check trigger condition for optional steps
      if (step.optional && step.triggerSignal) {
        const triggerValue = simulatorValues[step.triggerSignal]
        if (step.triggerCondition) {
          const { operator, value: conditionValue } = step.triggerCondition
          let shouldTrigger = false

          switch (operator) {
            case 'exists':
              shouldTrigger = triggerValue !== undefined && triggerValue !== ''
              break
            case 'not_exists':
              shouldTrigger = triggerValue === undefined || triggerValue === ''
              break
            case 'equals':
              shouldTrigger = String(triggerValue) === String(conditionValue)
              break
            case 'gt':
              shouldTrigger = Number(triggerValue) > Number(conditionValue)
              break
            case 'gte':
              shouldTrigger = Number(triggerValue) >= Number(conditionValue)
              break
            case 'lt':
              shouldTrigger = Number(triggerValue) < Number(conditionValue)
              break
            case 'lte':
              shouldTrigger = Number(triggerValue) <= Number(conditionValue)
              break
          }

          if (!shouldTrigger) {
            continue // Skip this optional step
          }
        } else {
          // If no condition, trigger if signal has any truthy value
          if (!triggerValue) {
            continue
          }
        }
      }

      // Calculate amount based on cost type
      let amount = step.defaultCost
      let calculation = `Fixed: $${step.defaultCost.toFixed(2)}`
      let quantitySource: string | undefined

      if (step.costType === 'per_unit' || step.costType === 'per_hour') {
        let quantity = 1
        const unitLabel = step.unitLabel || (step.costType === 'per_hour' ? 'hours' : 'units')

        if (step.quantitySource) {
          switch (step.quantitySource.type) {
            case 'form_field': {
              const fieldValue = simulatorValues[step.quantitySource.fieldId || '']
              if (typeof fieldValue === 'number') {
                quantity = fieldValue
              } else if (typeof fieldValue === 'string') {
                const parsed = parseFloat(fieldValue)
                if (!isNaN(parsed)) {
                  quantity = parsed
                }
              }
              quantitySource = 'form_field'
              break
            }
            case 'constant':
              quantity = step.quantitySource.value || 1
              quantitySource = 'constant'
              break
            case 'ai_signal':
              quantity = 1 // In simulator, AI signals default to 1
              quantitySource = 'ai_signal'
              warnings.push(`"${step.name}" uses AI signal - actual quantity will be extracted from photos`)
              break
          }
        } else {
          warnings.push(`"${step.name}" has no quantity source configured - using quantity 1`)
          quantitySource = 'missing'
        }

        amount = quantity * step.defaultCost
        calculation = `${quantity} ${unitLabel} × $${step.defaultCost.toFixed(2)} = $${amount.toFixed(2)}`
      }

      lineItems.push({
        name: step.name || 'Unnamed',
        amount,
        calculation,
        quantitySource,
      })
      subtotal += amount
    }

    // Apply multipliers
    let multiplierAdjustment = 0
    for (const mult of formData.multipliers) {
      if (mult.when.fieldId && mult.when.equals) {
        const fieldValue = simulatorValues[mult.when.fieldId]
        if (String(fieldValue) === String(mult.when.equals)) {
          const adjustment = subtotal * (mult.multiplier - 1)
          multiplierAdjustment += adjustment
          const pct = Math.round((mult.multiplier - 1) * 100)
          const field = formData.suggestedFields.find(f => f.fieldId === mult.when.fieldId)
          lineItems.push({
            name: `${field?.label || mult.when.fieldId} = ${mult.when.equals}`,
            amount: adjustment,
            calculation: pct >= 0 ? `+${pct}% adjustment` : `${pct}% adjustment`,
            quantitySource: 'multiplier',
          })
        }
      }
    }
    subtotal += multiplierAdjustment

    // Apply minimum charge
    if (formData.minimumCharge > 0 && subtotal < formData.minimumCharge) {
      const adjustment = formData.minimumCharge - subtotal
      lineItems.push({
        name: 'Minimum Charge Adjustment',
        amount: adjustment,
        calculation: `Minimum $${formData.minimumCharge.toFixed(2)}`,
        quantitySource: 'constant',
      })
      subtotal = formData.minimumCharge
    }

    setSimulatorResult({ lineItems, subtotal, warnings })
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

  // Warning: No pricing items
  if (formData.workSteps.length === 0 && formData.baseFee === 0) {
    validationWarnings.push('No pricing configured - quotes will be $0')
  }

  // Warning: Service name implies repair but no repair work steps configured
  const nameImpliesRepair = /repair|fix|replace/i.test(formData.name)
  const hasRepairStep = formData.workSteps.some(s =>
    /repair|fix|replace/i.test(s.name || '')
  )
  if (nameImpliesRepair && !hasRepairStep && formData.workSteps.length > 0) {
    validationWarnings.push(
      `Service name includes "Repair" but no repair work steps configured. Customers expect repair pricing.`
    )
  }

  const canPublish = validationErrors.length === 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitIntentRef.current) return
    submitIntentRef.current = false

    if (!isLastStep) return
    if (!formData.name.trim()) return

    setSaving(true)
    try {
      // Build pricing rules object
      const pricingRules = {
        baseFee: formData.baseFee,
        minimumCharge: formData.minimumCharge,
        addons: formData.addons,
        multipliers: formData.multipliers,
        workSteps: formData.workSteps,
      }

      if (editingService) {
        // Update existing service
        const res = await fetch(`/api/services/${editingService.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description || null,
            documentTypeDefault: formData.documentTypeDefault,
            scopeIncludes: formData.scopeIncludes,
            scopeExcludes: formData.scopeExcludes,
            defaultAssumptions: formData.defaultAssumptions,
            mediaConfig: formData.mediaConfig,
            workSteps: formData.workSteps,
            expectedSignals: formData.expectedSignals,
            pricingRules,
            draftConfig: aiDraft
              ? { ...aiDraft, suggestedFields: formData.suggestedFields }
              : null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to update service')

        setServices((prev) =>
          prev.map((s) => (s.id === editingService.id ? data.service : s))
        )
      } else {
        // Create new service
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description || null,
            documentTypeDefault: formData.documentTypeDefault,
            scopeIncludes: formData.scopeIncludes,
            scopeExcludes: formData.scopeExcludes,
            defaultAssumptions: formData.defaultAssumptions,
            mediaConfig: formData.mediaConfig,
            workSteps: formData.workSteps,
            expectedSignals: formData.expectedSignals,
            pricingRules,
            draftConfig: aiDraft
              ? { ...aiDraft, suggestedFields: formData.suggestedFields }
              : null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to create service')

        setServices((prev) => [data.service, ...prev])
      }
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
        description="Define the services you offer to customers"
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowBulkUpload(true)}
              className="inline-flex items-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Services
            </button>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <p className="text-sm text-danger">{error}</p>
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
        </div>
      ) : (
        /* Services list */
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Service
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Document Type
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-widest text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((service) => (
                <tr key={service.id} className={`transition-colors hover:bg-surface ${!service.active ? 'opacity-60' : ''}`}>
                  <td className="whitespace-nowrap px-6 py-5">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-text-primary">{service.name}</div>
                      {service.draft_config && <AIDraftBadge compact />}
                    </div>
                    {service.description && (
                      <div className="mt-0.5 max-w-xs truncate text-sm text-text-muted">{service.description}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-5 text-sm text-text-secondary">
                    {DOCUMENT_TYPES.find((d) => d.value === service.document_type_default)?.label ||
                      service.document_type_default}
                  </td>
                  <td className="whitespace-nowrap px-6 py-5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        service.active
                          ? 'bg-secondary-light text-secondary'
                          : 'border border-border text-text-muted'
                      }`}
                    >
                      {service.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-5 text-right">
                    <button
                      onClick={() => openEditModal(service)}
                      className="mr-4 text-sm font-medium text-text-primary underline-offset-4 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(service)}
                      className="mr-4 text-sm font-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
                    >
                      {service.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteService(service)}
                      className="text-sm font-medium text-danger underline-offset-4 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <h2 className="font-display text-xl font-bold text-text-primary">
                {editingService ? 'Edit Service' : 'Add Service'}
              </h2>
              <button
                onClick={closeModal}
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

            {/* Step Indicators */}
            <div className="border-b border-border bg-surface/50 px-6 py-4">
              <nav className="flex items-center justify-between">
                {steps.map((step, index) => (
                  <div key={step.id} className="flex items-center">
                    <div className="flex items-center">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                          activeStep === step.id
                            ? 'bg-primary text-white'
                            : WIZARD_STEPS.indexOf(activeStep) > index
                            ? 'bg-secondary text-white'
                            : 'border-2 border-border bg-background text-text-muted'
                        }`}
                      >
                        {WIZARD_STEPS.indexOf(activeStep) > index ? (
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
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
                        className={`ml-2.5 text-sm font-semibold ${
                          activeStep === step.id ? 'text-text-primary' : 'text-text-muted'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {index < steps.length - 1 && (
                      <div
                        className={`mx-4 h-0.5 w-8 rounded-full transition-colors ${
                          WIZARD_STEPS.indexOf(activeStep) > index ? 'bg-secondary' : 'bg-border'
                        }`}
                      />
                    )}
                  </div>
                ))}
              </nav>
            </div>

            <form onSubmit={handleSubmit}>
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
                            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                            : 'border-border focus:border-primary focus:ring-primary/30'
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
                        className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <p className="mt-1 text-xs text-text-muted">
                        A good description helps AI generate better defaults for the next steps
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-text-secondary">
                        Default Document Type
                      </label>
                      <select
                        value={formData.documentTypeDefault}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            documentTypeDefault: e.target.value as DocumentType,
                          })
                        }
                        className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        {DOCUMENT_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* AI Draft Generation Indicator */}
                    {draftError && (
                      <div className="rounded-lg border border-danger/30 bg-danger-light p-3 text-sm text-danger">
                        {draftError}
                      </div>
                    )}

                    {generatingDraft && (
                      <div className="flex items-center gap-2 rounded-lg border border-tertiary/30 bg-tertiary-light p-3">
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
                      <div className="flex items-center justify-between rounded-lg border border-tertiary/30 bg-tertiary-light p-3">
                        <div className="flex items-center gap-2">
                          <AIDraftBadge compact />
                          <span className="text-sm text-tertiary">
                            Pre-filled from AI draft. You can edit any field.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={generateAIDraft}
                            disabled={generatingDraft}
                            className="text-sm text-tertiary hover:text-purple-900"
                          >
                            Regenerate
                          </button>
                          <button
                            type="button"
                            onClick={clearAIDraft}
                            className="text-sm text-text-secondary hover:text-text-primary"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}

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

                    <h3 className="text-base font-medium text-text-primary">Photo Requirements</h3>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-text-secondary">
                          Minimum Photos Required
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={20}
                          value={formData.mediaConfig.minPhotos}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              mediaConfig: {
                                ...formData.mediaConfig,
                                minPhotos: parseInt(e.target.value) || 0,
                              },
                            })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                          className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
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
                                maxPhotos: parseInt(e.target.value) || 8,
                              },
                            })
                          }
                          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                          className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                        className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                )}

                {/* Pricing Setup Step */}
                {activeStep === 'pricing' && (
                  <div className="space-y-6">
                    {/* AI Draft Badge */}
                    {aiDraft && (
                      <div className="flex items-center justify-between rounded-lg border border-tertiary/30 bg-tertiary-light p-3">
                        <div className="flex items-center gap-2">
                          <AIDraftBadge compact />
                          <span className="text-sm text-tertiary">
                            Pre-filled from AI draft. You can edit any item.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Base Pricing */}
                    <div className="rounded-lg border border-border p-4">
                      <h3 className="mb-3 text-base font-medium text-text-primary">Base Pricing</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-sm text-text-secondary">Base Fee</label>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-muted">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={formData.baseFee}
                              onChange={(e) => setFormData({ ...formData, baseFee: parseFloat(e.target.value) || 0 })}
                              className="w-full rounded-lg border border-border py-2 pl-7 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </div>
                          <p className="mt-1 text-xs text-text-muted">Starting price for all quotes</p>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm text-text-secondary">Minimum Charge</label>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-muted">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={formData.minimumCharge}
                              onChange={(e) => setFormData({ ...formData, minimumCharge: parseFloat(e.target.value) || 0 })}
                              className="w-full rounded-lg border border-border py-2 pl-7 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                                  className="w-40 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                                    className="w-40 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                                    className="w-32 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                                  className="w-28 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                                  className="w-16 rounded-lg border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <div className="relative w-28">
                                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-text-muted">$</span>
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
                                  className="w-full rounded-lg border border-border py-2 pl-7 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                      <div className="flex items-center justify-between rounded-lg border border-tertiary/30 bg-tertiary-light p-3">
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
                          // Auto-generate expected signals from form fields
                          const autoSignals = fields
                            .filter(f => f.label.trim()) // Only fields with labels
                            .map(fieldToSignal)

                          // Also set mapsToSignal on each field to match
                          const fieldsWithMapping = fields.map(f => ({
                            ...f,
                            mapsToSignal: f.label.trim() ? fieldToSignal(f).signalKey : undefined,
                          }))

                          setFormData(prev => ({
                            ...prev,
                            suggestedFields: fieldsWithMapping,
                            expectedSignals: autoSignals,
                          }))
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Test & Publish Step */}
                {activeStep === 'test' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-base font-medium text-text-primary">Test Your Pricing</h3>
                      <p className="mb-3 text-sm text-text-muted">
                        Enter sample values to see how your pricing works before publishing.
                      </p>
                    </div>

                    {/* Sample Input Section */}
                    <div className="rounded-lg border border-border p-4">
                      <h4 className="mb-3 text-sm font-medium text-text-primary">Sample Values</h4>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {formData.suggestedFields.filter(f => f.type === 'number').map((field) => (
                          <div key={field.fieldId}>
                            <label className="mb-1 block text-sm text-text-secondary">
                              {field.label}
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={simulatorValues[field.fieldId] as number || ''}
                              onChange={(e) => {
                                setSimulatorValues(prev => ({
                                  ...prev,
                                  [field.fieldId]: parseFloat(e.target.value) || 0,
                                }))
                                setSimulatorResult(null)
                              }}
                              placeholder="0"
                              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </div>
                        ))}
                        {formData.suggestedFields.filter(f => f.type === 'dropdown' || f.type === 'radio').map((field) => (
                          <div key={field.fieldId}>
                            <label className="mb-1 block text-sm text-text-secondary">
                              {field.label}
                            </label>
                            <select
                              value={simulatorValues[field.fieldId] as string || ''}
                              onChange={(e) => {
                                setSimulatorValues(prev => ({
                                  ...prev,
                                  [field.fieldId]: e.target.value,
                                }))
                                setSimulatorResult(null)
                              }}
                              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                              <option value="">Select...</option>
                              {field.options?.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                        {formData.suggestedFields.filter(f => f.type === 'boolean').map((field) => (
                          <div key={field.fieldId} className="flex items-center pt-6">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(simulatorValues[field.fieldId])}
                                onChange={(e) => {
                                  setSimulatorValues(prev => ({
                                    ...prev,
                                    [field.fieldId]: e.target.checked,
                                  }))
                                  setSimulatorResult(null)
                                }}
                                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                              />
                              <span className="text-sm text-text-secondary">{field.label}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                      {formData.suggestedFields.length === 0 && (
                        <p className="text-sm text-text-muted">
                          No customer questions defined. Go back to add questions that affect pricing.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={runSimulator}
                        className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
                      >
                        Calculate Preview
                      </button>
                    </div>

                    {/* Preview Results */}
                    {simulatorResult && (
                      <div className="rounded-lg border border-border bg-background p-4">
                        <h4 className="mb-3 text-sm font-medium text-text-primary">Preview Breakdown</h4>
                        <div className="space-y-2">
                          {simulatorResult.lineItems.map((item, index) => (
                            <div key={index} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-text-primary">{item.name}</span>
                                {item.quantitySource === 'form_field' && (
                                  <span className="rounded bg-primary-light px-1.5 py-0.5 text-xs text-primary">form</span>
                                )}
                                {item.quantitySource === 'constant' && (
                                  <span className="rounded bg-secondary-light px-1.5 py-0.5 text-xs text-secondary">fixed</span>
                                )}
                                {item.quantitySource === 'ai_signal' && (
                                  <span className="rounded bg-tertiary-light px-1.5 py-0.5 text-xs font-semibold text-tertiary">AI</span>
                                )}
                                {item.quantitySource === 'missing' && (
                                  <span className="rounded bg-danger-light px-1.5 py-0.5 text-xs text-danger">no source</span>
                                )}
                              </div>
                              <div className="text-right">
                                <span className="font-medium text-text-primary">${item.amount.toFixed(2)}</span>
                                <span className="ml-2 text-text-muted">({item.calculation})</span>
                              </div>
                            </div>
                          ))}
                          {simulatorResult.lineItems.length === 0 && (
                            <p className="text-sm text-text-muted">No pricing items configured.</p>
                          )}
                          <div className="mt-2 border-t border-border pt-2">
                            <div className="flex items-center justify-between font-medium">
                              <span className="text-text-primary">Total</span>
                              <span className="text-lg text-text-primary">${simulatorResult.subtotal.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Warnings */}
                        {simulatorResult.warnings.length > 0 && (
                          <div className="mt-4 rounded-lg bg-tertiary-light p-3">
                            <h5 className="mb-1 text-sm font-medium text-tertiary">Warnings</h5>
                            <ul className="space-y-1">
                              {simulatorResult.warnings.map((warning, index) => (
                                <li key={index} className="text-sm text-tertiary">• {warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

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

                          {simulatorResult && (
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
                      {!simulatorResult && validationErrors.length === 0 && (
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
                    <button
                      type="submit"
                      disabled={saving || !formData.name.trim() || !canPublish}
                      onClick={() => { submitIntentRef.current = true }}
                      className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!canPublish ? 'Fix validation errors before publishing' : undefined}
                    >
                      {saving ? 'Saving...' : editingService ? 'Save Changes' : 'Create Service'}
                    </button>
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
    </div>
  )
}
