'use client'

import { useState } from 'react'
import type { LineItem } from './useQuotePricing'
import { useSortable } from './useSortable'

interface LineItemEditorProps {
  items: LineItem[]
  currency: string
  onUpdate: (id: string, updates: Partial<LineItem>) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onReorder: (fromIndex: number, toIndex: number) => void
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '\u00a3', USD: '$', EUR: '\u20ac', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
}

export default function LineItemEditor({
  items,
  currency,
  onUpdate,
  onRemove,
  onAdd,
  onReorder,
}: LineItemEditorProps) {
  const symbol = CURRENCY_SYMBOLS[currency] || currency + ' '

  const { dragIndex, overIndex, getDragHandleProps, getItemProps, getPointerHandleProps } =
    useSortable({ onReorder, itemCount: items.length })

  return (
    <div data-sortable-container>
      <div className="space-y-2">
        {items.map((item, index) => (
          <LineItemRow
            key={item.id}
            item={item}
            index={index}
            symbol={symbol}
            isOver={overIndex === index && dragIndex !== index}
            dragHandleProps={{
              ...getDragHandleProps(index),
              ...getPointerHandleProps(index),
            }}
            itemProps={getItemProps(index)}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-3 flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary hover:bg-primary-light rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add line item
      </button>
    </div>
  )
}

function LineItemRow({
  item,
  index,
  symbol,
  isOver,
  dragHandleProps,
  itemProps,
  onUpdate,
  onRemove,
}: {
  item: LineItem
  index: number
  symbol: string
  isOver: boolean
  dragHandleProps: Record<string, unknown>
  itemProps: Record<string, unknown>
  onUpdate: (id: string, updates: Partial<LineItem>) => void
  onRemove: (id: string) => void
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <div
      data-sortable-item
      {...(itemProps as React.HTMLAttributes<HTMLDivElement>)}
      className={`flex items-center gap-2 rounded-lg border transition-colors ${
        isOver ? 'border-primary bg-primary-light' : 'border-border bg-background'
      }`}
    >
      {/* Drag handle — 44x44 tap target */}
      <div
        {...(dragHandleProps as React.HTMLAttributes<HTMLDivElement>)}
        className="flex items-center justify-center w-11 h-11 flex-shrink-0 text-text-muted hover:text-text-secondary select-none"
        title={`Drag to reorder (item ${index + 1})`}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </div>

      {/* Label input */}
      <input
        type="text"
        value={item.label}
        onChange={(e) => onUpdate(item.id, { label: e.target.value })}
        placeholder="Line item label"
        className="flex-1 min-w-0 px-2 py-2.5 text-sm text-text-primary bg-transparent border-none focus:outline-none focus:ring-0"
      />

      {/* Amount input */}
      <div className="flex items-center flex-shrink-0 w-28 px-2">
        <span className="text-sm text-text-muted mr-1">{symbol}</span>
        <input
          type="number"
          value={item.amount || ''}
          onChange={(e) => onUpdate(item.id, { amount: parseFloat(e.target.value) || 0 })}
          placeholder="0.00"
          step="0.01"
          min="0"
          className="w-full text-sm text-right text-text-primary bg-transparent border-none focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>

      {/* Remove button */}
      {confirmRemove ? (
        <div className="flex items-center gap-1 flex-shrink-0 pr-1">
          <button
            onClick={() => { onRemove(item.id); setConfirmRemove(false) }}
            className="px-2 py-1 text-xs font-medium text-danger bg-danger-light rounded hover:bg-danger/20 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmRemove(false)}
            className="px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmRemove(true)}
          className="flex items-center justify-center w-9 h-9 flex-shrink-0 text-text-muted hover:text-danger transition-colors"
          title="Remove item"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
