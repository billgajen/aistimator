'use client'

import { useState } from 'react'
import type { QuotePricing, QuoteContent, SignalRecommendation, CrossServicePricing } from '@estimator/shared'
import { useQuotePricing } from './useQuotePricing'
import LineItemEditor from './LineItemEditor'
import AddonsEditor from './AddonsEditor'
import RecommendationsEditor from './RecommendationsEditor'
import { TextSectionEditor, ListSectionEditor } from './SectionEditor'

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '\u00a3', USD: '$', EUR: '\u20ac', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
}

interface QuoteEditorProps {
  quoteId: string
  initialPricing: QuotePricing
  initialContent: QuoteContent
  businessNotes: string | null
  version: number
  currency: string
  feedbackId?: string
  onSave: () => Promise<void>
  onCancel: () => void
}

export default function QuoteEditor({
  quoteId,
  initialPricing,
  initialContent,
  businessNotes: initialBusinessNotes,
  version,
  currency,
  feedbackId,
  onSave,
  onCancel,
}: QuoteEditorProps) {
  const {
    items,
    subtotal,
    taxAmount,
    taxLabel,
    taxRate,
    total,
    pricingNotes,
    availableAddons,
    addItem,
    removeItem,
    updateItem,
    reorderItems,
    setPricingNotes,
    setAvailableAddons,
    buildPricing,
  } = useQuotePricing({ initialPricing, currency })

  // Content state
  const extendedContent = initialContent as QuoteContent & {
    signalRecommendations?: SignalRecommendation[]
    crossServicePricing?: CrossServicePricing[]
  }
  const [scopeSummary, setScopeSummary] = useState(initialContent.scopeSummary || '')
  const [assumptions, setAssumptions] = useState<string[]>(initialContent.assumptions || [])
  const [exclusions, setExclusions] = useState<string[]>(initialContent.exclusions || [])
  const [notes, setNotes] = useState(initialContent.notes || '')
  const [businessNotes, setBusinessNotes] = useState(initialBusinessNotes || '')
  const [signalRecommendations, setSignalRecommendations] = useState<SignalRecommendation[]>(
    extendedContent.signalRecommendations || []
  )
  // Preserve cross-service pricing (not editable yet, but must not be lost on save)
  const [crossServicePricing] = useState<CrossServicePricing[]>(
    extendedContent.crossServicePricing || []
  )

  // Save state
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '

  const buildContent = () => ({
    scopeSummary: scopeSummary || undefined,
    assumptions: assumptions.length > 0 ? assumptions.filter(Boolean) : undefined,
    exclusions: exclusions.length > 0 ? exclusions.filter(Boolean) : undefined,
    notes: notes || undefined,
    validityDays: initialContent.validityDays,
    ...(signalRecommendations.length > 0 && { signalRecommendations }),
    ...(crossServicePricing.length > 0 && { crossServicePricing }),
  })

  const handleSave = async (sendToCustomer: boolean) => {
    setSaving(true)
    setSaveError(null)
    setConflict(false)

    try {
      const response = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          pricing_json: buildPricing(),
          content_json: buildContent(),
          business_notes: businessNotes || undefined,
          sendToCustomer,
          feedbackId,
        }),
      })

      if (response.status === 409) {
        setConflict(true)
        return
      }

      if (!response.ok) {
        const errData = await response.json()
        setSaveError(errData.error?.message || 'Failed to save')
        return
      }

      await onSave()
    } catch {
      setSaveError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="font-display text-xl font-extrabold text-text-primary">Editing Quote</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-text-primary bg-background border border-border rounded-lg hover:bg-surface disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save & Send'}
          </button>
        </div>
      </div>

      {/* Error / conflict messages */}
      {conflict && (
        <div className="mb-4 p-4 bg-tertiary-light border border-tertiary/20 rounded-lg text-sm text-text-primary">
          This quote was modified by someone else. Please reload and try again.
          <button onClick={onCancel} className="ml-2 text-primary font-medium">
            Reload
          </button>
        </div>
      )}

      {saveError && (
        <div className="mb-4 p-4 bg-danger-light border border-danger/20 rounded-lg text-sm text-danger">
          {saveError}
        </div>
      )}

      {/* Business notes */}
      <EditorSection>
        <TextSectionEditor
          label="Business Notes (only visible to you)"
          value={businessNotes}
          onChange={setBusinessNotes}
          placeholder="Add internal notes..."
        />
      </EditorSection>

      {/* Scope summary */}
      <EditorSection>
        <TextSectionEditor
          label="Scope of Work"
          value={scopeSummary}
          onChange={setScopeSummary}
          placeholder="Describe the scope of work..."
        />
      </EditorSection>

      {/* Line items */}
      <EditorSection>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Pricing Breakdown</h3>
        <LineItemEditor
          items={items}
          currency={currency}
          onUpdate={updateItem}
          onRemove={removeItem}
          onAdd={addItem}
          onReorder={reorderItems}
        />

        {/* Totals preview */}
        <div className="mt-4 pt-4 border-t border-border space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary">{symbol}{subtotal.toFixed(2)}</span>
          </div>
          {taxRate > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">{taxLabel} ({taxRate}%)</span>
              <span className="text-text-primary">{symbol}{taxAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold pt-2 border-t border-border">
            <span className="text-text-primary">Total</span>
            <span className="text-text-primary">{symbol}{total.toFixed(2)}</span>
          </div>
          <p className="text-xs text-text-muted">Tax is recalculated server-side on save.</p>
        </div>
      </EditorSection>

      {/* Optional Extras */}
      <EditorSection>
        <AddonsEditor
          items={availableAddons}
          currency={currency}
          onChange={setAvailableAddons}
        />
      </EditorSection>

      {/* Pricing Notes */}
      <EditorSection>
        <ListSectionEditor
          label="Pricing Notes"
          items={pricingNotes}
          onChange={setPricingNotes}
          placeholder="Add a pricing note..."
        />
      </EditorSection>

      {/* Assumptions */}
      <EditorSection>
        <ListSectionEditor
          label="Assumptions"
          items={assumptions}
          onChange={setAssumptions}
          placeholder="Add an assumption..."
        />
      </EditorSection>

      {/* Exclusions */}
      <EditorSection>
        <ListSectionEditor
          label="Exclusions"
          items={exclusions}
          onChange={setExclusions}
          placeholder="Add an exclusion..."
        />
      </EditorSection>

      {/* Notes */}
      <EditorSection>
        <TextSectionEditor
          label="Notes"
          value={notes}
          onChange={setNotes}
          placeholder="Additional notes for the customer..."
        />
      </EditorSection>

      {/* Potential Additional Work (signal recommendations) */}
      {signalRecommendations.length > 0 && (
        <EditorSection>
          <RecommendationsEditor
            items={signalRecommendations}
            onChange={setSignalRecommendations}
          />
        </EditorSection>
      )}

      {/* Bottom action bar (sticky on mobile) */}
      <div className="sticky bottom-0 bg-background border-t border-border -mx-5 sm:-mx-8 lg:-mx-10 px-5 sm:px-8 lg:px-10 py-4 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="px-5 py-2.5 text-sm font-semibold text-text-primary bg-background border border-border rounded-lg hover:bg-surface disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={saving}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save & Send'}
        </button>
      </div>
    </div>
  )
}

function EditorSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 bg-surface border border-border rounded-lg p-5">
      {children}
    </div>
  )
}
