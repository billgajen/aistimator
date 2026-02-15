'use client'

import { useCallback } from 'react'

export interface RecommendationItem {
  signalKey: string
  signalValue: string | number | boolean
  workDescription: string
  costBreakdown: string
  confidence: number
  evidence: string
  isEstimate: boolean
}

interface RecommendationsEditorProps {
  items: RecommendationItem[]
  onChange: (items: RecommendationItem[]) => void
}

export default function RecommendationsEditor({ items, onChange }: RecommendationsEditorProps) {
  const handleRemove = useCallback((index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }, [items, onChange])

  const handleUpdate = useCallback((index: number, updates: Partial<RecommendationItem>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...updates } : item)))
  }, [items, onChange])

  if (items.length === 0) return null

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-1">Potential Additional Work</h3>
      <p className="text-xs text-text-muted mb-3">
        AI-recommended work based on the customer&apos;s request. Remove items that aren&apos;t relevant.
      </p>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={`${item.signalKey}-${index}`}
            className="border border-border rounded-lg p-3 bg-background"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <input
                type="text"
                value={item.workDescription}
                onChange={(e) => handleUpdate(index, { workDescription: e.target.value })}
                className="flex-1 px-2 py-1 text-sm font-medium border border-border rounded bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                onClick={() => handleRemove(index)}
                className="p-1.5 text-text-muted hover:text-danger transition-colors flex-shrink-0"
                title="Remove recommendation"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <input
              type="text"
              value={item.costBreakdown}
              onChange={(e) => handleUpdate(index, { costBreakdown: e.target.value })}
              placeholder="Description of what's involved..."
              className="w-full px-2 py-1 text-xs border border-border rounded bg-surface text-text-secondary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-1"
            />
            <p className="text-xs text-text-muted italic">{item.evidence}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
