import { useState, useCallback, useMemo } from 'react'
import type { QuotePricing } from '@estimator/shared'

export interface LineItem {
  id: string
  label: string
  amount: number
  autoRecommended?: boolean
  recommendationReason?: string
}

interface UseQuotePricingOptions {
  initialPricing: QuotePricing
  currency: string
}

export function useQuotePricing({ initialPricing, currency }: UseQuotePricingOptions) {
  const [items, setItems] = useState<LineItem[]>(() =>
    initialPricing.breakdown.map((b, i) => ({
      id: `item-${i}`,
      label: b.label,
      amount: b.amount,
      autoRecommended: b.autoRecommended,
      recommendationReason: b.recommendationReason,
    }))
  )
  const [pricingNotes, setPricingNotes] = useState<string[]>(initialPricing.notes || [])
  const [availableAddons, setAvailableAddons] = useState(initialPricing.availableAddons || [])

  // Tax comes from the server — we show a preview but server recalculates
  const taxRate = initialPricing.taxRate || 0
  const taxLabel = initialPricing.taxLabel || 'Tax'

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.amount, 0),
    [items]
  )

  const taxAmount = useMemo(
    () => (taxRate > 0 ? Math.round(subtotal * (taxRate / 100) * 100) / 100 : 0),
    [subtotal, taxRate]
  )

  const total = useMemo(
    () => Math.round((subtotal + taxAmount) * 100) / 100,
    [subtotal, taxAmount]
  )

  const addItem = useCallback(() => {
    setItems((prev) => [
      ...prev,
      { id: `item-${Date.now()}`, label: '', amount: 0 },
    ])
  }, [])

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const updateItem = useCallback((id: string, updates: Partial<LineItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    )
  }, [])

  const reorderItems = useCallback((fromIndex: number, toIndex: number) => {
    setItems((prev) => {
      const next = [...prev]
      const removed = next.splice(fromIndex, 1)
      if (removed[0]) {
        next.splice(toIndex, 0, removed[0])
      }
      return next
    })
  }, [])

  const buildPricing = useCallback((): QuotePricing => {
    return {
      currency,
      subtotal,
      taxLabel: taxRate > 0 ? taxLabel : undefined,
      taxRate: taxRate > 0 ? taxRate : undefined,
      taxAmount,
      total,
      breakdown: items.map((item) => ({
        label: item.label,
        amount: item.amount,
        ...(item.autoRecommended && { autoRecommended: true }),
        ...(item.recommendationReason && { recommendationReason: item.recommendationReason }),
      })),
      notes: pricingNotes.length > 0 ? pricingNotes : undefined,
      availableAddons: availableAddons.length > 0 ? availableAddons : undefined,
    }
  }, [currency, subtotal, taxLabel, taxRate, taxAmount, total, items, pricingNotes, availableAddons])

  return {
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
  }
}
