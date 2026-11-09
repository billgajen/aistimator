/**
 * Every pack is self-consistent data (T-140/T-141): the fields a step,
 * multiplier or formula references exist, and condition values are among
 * the field's options. A typo here silently drops a line from every quote.
 */
import { describe, it, expect } from 'vitest'
import { extractFormulaIdentifiers } from '@estimator/shared'
import { listPacks } from '@/lib/vertical-packs'

for (const pack of listPacks()) {
  describe(`pack ${pack.id}`, () => {
    for (const svc of pack.services) {
      it(svc.name, () => {
        const fields = new Map(svc.draft.suggestedFields.map((f) => [f.fieldId, f]))
        const signals = new Set(svc.draft.expectedSignals.map((s) => s.signalKey))
        const checkCondition = (fieldId: string, value: unknown, where: string) => {
          const field = fields.get(fieldId)
          expect(field, `${where}: field ${fieldId}`).toBeTruthy()
          if (field?.options?.length && value !== undefined) expect(field.options, where).toContain(value)
        }
        for (const step of svc.draft.pricing.workSteps) {
          if (step.when) checkCondition(step.when.fieldId, step.when.equals ?? step.when.value, step.id)
          if (step.triggerSignal) expect(signals.has(step.triggerSignal), `${step.id} trigger`).toBe(true)
          const qs = step.quantitySource
          if (qs?.type === 'form_field') expect(fields.has(qs.fieldId!), `${step.id} quantity field`).toBe(true)
          if (qs?.type === 'ai_signal') expect(signals.has(qs.signalKey!), `${step.id} signal`).toBe(true)
          if (qs?.type === 'derived') {
            for (const id of extractFormulaIdentifiers(qs.formula!) || []) {
              expect(fields.has(id) || signals.has(id), `${step.id} formula ${id}`).toBe(true)
            }
          }
        }
        for (const m of svc.multipliers || []) {
          if (m.when.fieldId) checkCondition(m.when.fieldId, m.when.equals ?? m.when.value, 'multiplier')
        }
        for (const a of svc.addons || []) expect(a.price).toBeGreaterThan(0)
        // A catalogue field (blank = none) must never be enforced as critical
        for (const step of svc.draft.pricing.workSteps) {
          const qs = step.quantitySource
          if (qs?.type === 'form_field' && qs.missingMeansZero) {
            expect(fields.get(qs.fieldId!)?.criticalForPricing, `${qs.fieldId} is optional`).toBeFalsy()
          }
        }
      })
    }
  })
}
