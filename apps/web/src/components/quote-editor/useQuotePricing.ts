import { useState, useCallback, useMemo } from 'react'
import { roundMoney, splitMinimum, minimumTopUp, minimumEntry, withoutMinimumNote, addedSections, MAX_ADDED_SECTIONS } from '@qolumns/shared'
import type { QuotePricing, QuoteSection, SectionAnswer } from '@qolumns/shared'

export interface LineItem {
  id: string
  label: string
  amount: number
  autoRecommended?: boolean
  recommendationReason?: string
}

/** T-179: an added service as the editor holds it: its own lines and its own floor */
export interface EditorSection {
  serviceId: string
  serviceName: string
  addedBy: 'customer' | 'business'
  addedAt: string
  taxExempt: boolean
  answers?: SectionAnswer[]
  /** That service's minimum charge on this quote; null when it carries none */
  floor: number | null
  items: LineItem[]
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

  // T-179: service sections on a combined quote. Each keeps its own lines and
  // its own floor (AD-048); the totals below add them to the main service's.
  const [sections, setSections] = useState<EditorSection[]>(() =>
    addedSections(initialPricing).map((section, index) => {
      const split = splitMinimum(section.breakdown)
      return {
        serviceId: section.serviceId,
        serviceName: section.serviceName,
        addedBy: section.addedBy,
        addedAt: section.addedAt,
        taxExempt: section.taxExempt === true,
        answers: section.answers,
        floor: split.minimum?.minimumCharge ?? null,
        items: split.lines.map((line, i) => ({ id: `section-${index}-${i}`, label: line.label, amount: roundMoney(line.amount) })),
      }
    })
  )
  const sectionTotals = useMemo(
    () =>
      sections.map((section) => {
        const lines = roundMoney(section.items.reduce((sum, item) => sum + item.amount, 0))
        const sectionTopUp = section.floor === null ? 0 : minimumTopUp(lines, section.floor)
        return { serviceId: section.serviceId, lines, topUp: sectionTopUp, subtotal: roundMoney(lines + sectionTopUp) }
      }),
    [sections]
  )
  const mainSubtotalValue = subtotal
  const combinedSubtotal = roundMoney(mainSubtotalValue + sectionTotals.reduce((sum, t) => sum + t.subtotal, 0))
  // Was the main service taxed when the quote was priced? (A preview only: the server works tax out again on save.)
  const [mainTaxable] = useState(() => {
    if (!(taxRate > 0)) return false
    const before = addedSections(initialPricing)
    if (before.length === 0) return true
    const sectionsTaxable = before.filter((sec) => !sec.taxExempt).reduce((sum, sec) => sum + sec.subtotal, 0)
    return roundMoney((initialPricing.taxAmount || 0) / (taxRate / 100)) - sectionsTaxable > 0.005
  })

  const taxAmount = useMemo(() => {
    if (!(taxRate > 0)) return 0
    const taxable = (mainTaxable ? mainSubtotalValue : 0) + sections.reduce((sum, section, i) => sum + (section.taxExempt ? 0 : sectionTotals[i]?.subtotal ?? 0), 0)
    return Math.round(taxable * (taxRate / 100) * 100) / 100
  }, [mainSubtotalValue, taxRate, mainTaxable, sections, sectionTotals])

  const total = useMemo(
    () => Math.round((combinedSubtotal + taxAmount) * 100) / 100,
    [combinedSubtotal, taxAmount]
  )

  const addSection = useCallback((section: Omit<QuoteSection, 'addedBy' | 'addedAt'>) => {
    setSections((prev) => {
      if (prev.length >= MAX_ADDED_SECTIONS || prev.some((existing) => existing.serviceId === section.serviceId)) return prev
      const split = splitMinimum(section.breakdown)
      return [
        ...prev,
        {
          serviceId: section.serviceId,
          serviceName: section.serviceName,
          addedBy: 'business' as const,
          addedAt: new Date().toISOString(),
          taxExempt: section.taxExempt === true,
          answers: section.answers,
          floor: split.minimum?.minimumCharge ?? null,
          items: split.lines.map((line, i) => ({ id: `section-${Date.now()}-${i}`, label: line.label, amount: roundMoney(line.amount) })),
        },
      ]
    })
  }, [])
  const removeSection = useCallback((serviceId: string) => setSections((prev) => prev.filter((section) => section.serviceId !== serviceId)), [])
  const updateSectionItems = useCallback((serviceId: string, change: (items: LineItem[]) => LineItem[]) => {
    setSections((prev) => prev.map((section) => (section.serviceId === serviceId ? { ...section, items: change(section.items) } : section)))
  }, [])

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
      subtotal: combinedSubtotal,
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
      // T-179: the added services, each with its lines and (while it applies) its own minimum entry
      ...(sections.length > 0 && {
        sections: sections.map((section, i) => {
          const totals = sectionTotals[i]
          const breakdown = [
            ...section.items.map((item) => ({ label: item.label, amount: item.amount })),
            ...(section.floor !== null && totals && totals.topUp > 0 ? [minimumEntry(totals.topUp, section.floor)] : []),
          ]
          return {
            serviceId: section.serviceId,
            serviceName: section.serviceName,
            breakdown,
            subtotal: totals?.subtotal ?? 0,
            ...(section.taxExempt && { taxExempt: true }),
            addedBy: section.addedBy,
            addedAt: section.addedAt,
            ...(section.answers && { answers: section.answers }),
          }
        }),
      }),
    } as QuotePricing
  }, [currency, combinedSubtotal, taxLabel, taxRate, taxAmount, total, items, pricingNotes, availableAddons, floor, topUp, sections, sectionTotals])

  return {
    items,
    linesTotal,
    minimum,
    minimumRemoved,
    removeMinimum,
    restoreMinimum,
    subtotal: combinedSubtotal,
    /** T-179: the main service's own subtotal (the same as `subtotal` on a single-service quote) */
    mainSubtotal: mainSubtotalValue,
    sections,
    sectionTotals,
    addSection,
    removeSection,
    updateSectionItems,
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
