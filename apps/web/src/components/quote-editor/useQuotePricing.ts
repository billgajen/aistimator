import { useState, useCallback, useMemo } from 'react'
import { roundMoney, splitMinimum, minimumTopUp, minimumEntry, withoutMinimumNote } from '@qolumns/shared'
import type { QuotePricing } from '@qolumns/shared'

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

/**
 * T-157: amounts show and save with at most 2 decimals. That includes quotes
 * stored before the engine rounded its lines (18 x 34.6 = 622.8000000000001):
 * they are rounded as they load, so nothing raw reaches the screen or the save.
 * The server rounds again on save; it also drops stale label maths there.
 *
 * T-165: the minimum charge is a floor, not an item. A quote that carries a
 * minimum does not show it among the lines: `items` are the job's own lines,
 * and the floor is kept beside them. As the lines change, the top-up is worked
 * out again (`minimum.topUp`), so the subtotal stays at the minimum while the
 * lines total less, and follows the lines once they total more. The business
 * can remove the floor from this quote (`removeMinimum`); it then stays
 * removed whatever they edit. A quote that carries no minimum never gets one.
 */
export function useQuotePricing({ initialPricing, currency }: UseQuotePricingOptions) {
  const [loaded] = useState(() => splitMinimum(initialPricing.breakdown))
  // The business's minimum charge on this quote; null when it carries none or it was removed
  const [floor, setFloor] = useState<number | null>(loaded.minimum?.minimumCharge ?? null)
  const [items, setItems] = useState<LineItem[]>(() =>
    loaded.lines.map((b, i) => ({
      id: `item-${i}`,
      label: b.label,
      amount: roundMoney(b.amount),
      autoRecommended: b.autoRecommended,
      recommendationReason: b.recommendationReason,
    }))
  )
  // The engine used to repeat the minimum sentence among the notes: it is shown once, by the total
  const [pricingNotes, setPricingNotes] = useState<string[]>(() => withoutMinimumNote(initialPricing.notes))
  const [availableAddons, setAvailableAddonsRaw] = useState(() =>
    (initialPricing.availableAddons || []).map((a) => ({ ...a, price: roundMoney(a.price) }))
  )
  const setAvailableAddons = useCallback((next: NonNullable<QuotePricing['availableAddons']>) => {
    setAvailableAddonsRaw(next.map((a) => ({ ...a, price: roundMoney(a.price) })))
  }, [])

  // Tax comes from the server — we show a preview but server recalculates
  const taxRate = initialPricing.taxRate || 0
  const taxLabel = initialPricing.taxLabel || 'Tax'

  const linesTotal = useMemo(
    () => roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
    [items]
  )
  const topUp = floor === null ? 0 : minimumTopUp(linesTotal, floor)
  const subtotal = roundMoney(linesTotal + topUp)
  /** The floor as the editor shows it: null when none applies right now */
  const minimum = floor !== null && topUp > 0 ? { minimumCharge: floor, topUp } : null
  const minimumRemoved = loaded.minimum !== null && floor === null
  const removeMinimum = useCallback(() => setFloor(null), [])
  const restoreMinimum = useCallback(() => setFloor(loaded.minimum?.minimumCharge ?? null), [loaded])

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
      prev.map((item) =>
        item.id === id
          ? { ...item, ...updates, ...(updates.amount !== undefined && { amount: roundMoney(updates.amount) }) }
          : item
      )
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
      breakdown: [
        ...items.map((item) => ({
          label: item.label,
          amount: item.amount,
          ...(item.autoRecommended && { autoRecommended: true }),
          ...(item.recommendationReason && { recommendationReason: item.recommendationReason }),
        })),
        // The top-up is its own entry, marked as the minimum, so lines + entry = subtotal
        ...(floor !== null && topUp > 0 ? [minimumEntry(topUp, floor)] : []),
      ],
      notes: pricingNotes.length > 0 ? pricingNotes : undefined,
      availableAddons: availableAddons.length > 0 ? availableAddons : undefined,
    }
  }, [currency, subtotal, taxLabel, taxRate, taxAmount, total, items, pricingNotes, availableAddons, floor, topUp])

  return {
    items,
    linesTotal,
    minimum,
    minimumRemoved,
    removeMinimum,
    restoreMinimum,
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
