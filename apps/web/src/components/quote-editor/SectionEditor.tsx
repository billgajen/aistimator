'use client'

import { useRef, useEffect, useCallback } from 'react'

/**
 * Auto-resizing textarea for text sections (scope summary, notes)
 */
export function TextSectionEditor({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [value])

  return (
    <div>
      <label className="block text-sm font-semibold text-text-primary mb-2">{label}</label>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full px-3 py-2.5 text-sm text-text-primary bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
      />
    </div>
  )
}

/**
 * Editable list of strings (assumptions, exclusions, notes list)
 */
export function ListSectionEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
}) {
  const addItem = useCallback(() => {
    onChange([...items, ''])
  }, [items, onChange])

  const removeItem = useCallback(
    (index: number) => {
      onChange(items.filter((_, i) => i !== index))
    },
    [items, onChange]
  )

  const updateItem = useCallback(
    (index: number, value: string) => {
      const next = [...items]
      next[index] = value
      onChange(next)
    },
    [items, onChange]
  )

  return (
    <div>
      <label className="block text-sm font-semibold text-text-primary mb-2">{label}</label>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              placeholder={placeholder || `Item ${index + 1}`}
              className="flex-1 px-3 py-2 text-sm text-text-primary bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-text-muted hover:text-danger transition-colors"
              title="Remove"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addItem}
        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light rounded-lg transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add item
      </button>
    </div>
  )
}
