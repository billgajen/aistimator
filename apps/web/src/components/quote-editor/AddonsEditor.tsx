'use client'

import { useCallback } from 'react'

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '\u00a3', USD: '$', EUR: '\u20ac', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
}

export interface AddonItem {
  id: string
  label: string
  price: number
}

interface AddonsEditorProps {
  items: AddonItem[]
  currency: string
  onChange: (items: AddonItem[]) => void
}

export default function AddonsEditor({ items, currency, onChange }: AddonsEditorProps) {
  const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '

  const handleAdd = useCallback(() => {
    onChange([...items, { id: `addon-${Date.now()}`, label: '', price: 0 }])
  }, [items, onChange])

  const handleRemove = useCallback((id: string) => {
    onChange(items.filter((item) => item.id !== id))
  }, [items, onChange])

  const handleUpdate = useCallback((id: string, updates: Partial<AddonItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }, [items, onChange])

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">Optional Extras</h3>
      <p className="text-xs text-text-muted mb-3">
        Add-ons shown to the customer as optional extras they can request.
      </p>

      {items.length > 0 && (
        <div className="space-y-2 mb-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <input
                type="text"
                value={item.label}
                onChange={(e) => handleUpdate(item.id, { label: e.target.value })}
                placeholder="Extra label..."
                className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <div className="flex items-center gap-1">
                <span className="text-sm text-text-muted">{symbol}</span>
                <input
                  type="number"
                  value={item.price || ''}
                  onChange={(e) => handleUpdate(item.id, { price: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-24 px-3 py-2 text-sm border border-border rounded-lg bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-right"
                />
              </div>
              <button
                onClick={() => handleRemove(item.id)}
                className="p-2 text-text-muted hover:text-danger transition-colors"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleAdd}
        className="text-sm text-primary font-medium hover:text-primary-hover transition-colors"
      >
        + Add extra
      </button>
    </div>
  )
}
