/**
 * T-139 (AD-029): identification signals — labels read by vision, decoded by
 * code. Synthetic pack data only: nothing here mirrors a real trade's tables.
 */

import { describe, it, expect } from 'vitest'
import {
  decodeTranscription,
  matchPossibleValue,
  resolveIdentification,
  computeEstimateGrade,
  extractFormulaIdentifiers,
  type ExpectedSignalConfig,
  type ExtractedSignal,
  type IdentificationSpec,
  type IdentificationDecodeRule,
  type WorkStepConfig,
} from '@estimator/shared'
import {
  identificationTargets,
  identifyFromLabels,
  applyIdentifications,
  weakenUnreadGuesses,
  pricingReferencedKeys,
  checkIdentifications,
  identificationProvenance,
  identificationQuestion,
  buildIdentificationPrompt,
} from '../ai/identification'
import { evaluateQualityGate } from '../agents/quality-gate'
import { buildTakeoff } from '../takeoff'
import type { PricingResult } from '../pricing/rules-engine'

const SIZE_SPEC: IdentificationSpec = {
  readFrom: 'the unit\'s rating plate',
  transcribe: 'the model number',
  decode: [
    { pattern: '^[A-Z]{2}(\\d{2})', map: { '24': 'Small', '36': 'Medium', '48': 'Large' }, label: 'size code in the model number' },
  ],
}

const SIZE_SIGNAL: ExpectedSignalConfig = {
  signalKey: 'unit_size',
  type: 'enum',
  possibleValues: ['Small', 'Medium', 'Large'],
  description: 'size of the unit',
  identify: SIZE_SPEC,
}

const CAPACITY_SIGNAL: ExpectedSignalConfig = {
  signalKey: 'capacity',
  type: 'number',
  description: 'rated capacity',
  identify: {
    readFrom: 'the label',
    decode: [{ pattern: 'X(\\d{3})', scale: 1 / 12, decimals: 1, label: 'capacity digits' }],
  },
}

describe('decodeTranscription (code decodes, AI only transcribes)', () => {
  it('maps a captured code through the pack table', () => {
    expect(decodeTranscription('AB36-120', SIZE_SPEC.decode!)?.value).toBe('Medium')
  })

  it('scales numeric codes', () => {
    expect(decodeTranscription('MODEL X036 Q', CAPACITY_SIGNAL.identify!.decode!)?.value).toBe(3)
  })

  it('first matching rule wins; unmapped codes fall through', () => {
    const rules: IdentificationDecodeRule[] = [
      { pattern: '^[A-Z]{2}(\\d{2})', map: { '99': 'Huge' } },
      { pattern: '(\\d{2})-', map: { '36': 'Medium' } },
    ]
    expect(decodeTranscription('AB36-1', rules)?.value).toBe('Medium')
  })

  it('skips malformed patterns instead of throwing', () => {
    expect(decodeTranscription('AB36', [{ pattern: '([', map: {} }, { pattern: 'AB(\\d+)' }])?.value).toBe('36')
  })

  it('returns null when nothing matches', () => {
    expect(decodeTranscription('nothing here', SIZE_SPEC.decode!)).toBeNull()
  })
})

describe('matchPossibleValue', () => {
  it('snaps case, spaces and underscores onto the allowed value', () => {
    expect(matchPossibleValue('natural_gas', ['Natural gas', 'Propane'])).toBe('Natural gas')
    expect(matchPossibleValue('PROPANE', ['Natural gas', 'Propane'])).toBe('Propane')
  })
  it('rejects values outside the list and passes through without one', () => {
    expect(matchPossibleValue('Diesel', ['Natural gas', 'Propane'])).toBeNull()
    expect(matchPossibleValue('anything', undefined)).toBe('anything')
  })
})

describe('resolveIdentification', () => {
  const base = { signalKey: 'unit_size', spec: SIZE_SPEC, signalType: 'enum' as const, possibleValues: SIZE_SIGNAL.possibleValues }

  it('decoded transcription beats the model reading, with evidence', () => {
    const r = resolveIdentification({
      ...base,
      reading: { targetKey: 'unit_size', legible: true, transcribed: 'AB36-120', value: 'Large', photo: 2 },
    })
    expect(r).toMatchObject({ value: 'Medium', method: 'decoded', confidence: 0.9 })
    expect(r!.evidence).toBe('Read from the unit\'s rating plate (photo 2): "AB36-120" → Medium (size code in the model number)')
  })

  it('falls back to the model reading only when it is an allowed value', () => {
    const read = resolveIdentification({ ...base, reading: { targetKey: 'unit_size', legible: true, transcribed: 'ZZ', value: 'large' } })
    expect(read).toMatchObject({ value: 'Large', method: 'read', confidence: 0.75 })
    expect(resolveIdentification({ ...base, reading: { targetKey: 'unit_size', legible: true, value: 'Gigantic' } })).toBeNull()
  })

  it('illegible or missing readings resolve to nothing', () => {
    expect(resolveIdentification({ ...base, reading: { targetKey: 'unit_size', legible: false, value: 'Small' } })).toBeNull()
    expect(resolveIdentification({ ...base, reading: undefined })).toBeNull()
  })

  it('numbers must be positive; transcriptions are clipped', () => {
    const r = resolveIdentification({
      signalKey: 'capacity',
      spec: CAPACITY_SIGNAL.identify!,
      signalType: 'number',
      reading: { targetKey: 'capacity', legible: true, transcribed: `X048 ${'y'.repeat(200)}` },
    })
    expect(r!.value).toBe(4)
    expect(r!.transcribed!.length).toBeLessThanOrEqual(80)
    expect(
      resolveIdentification({ signalKey: 'capacity', spec: { readFrom: 'the label' }, signalType: 'number', reading: { targetKey: 'capacity', legible: true, value: '-3' } })
    ).toBeNull()
  })
})

describe('identifyFromLabels', () => {
  const targets = identificationTargets([SIZE_SIGNAL, CAPACITY_SIGNAL, { signalKey: 'other', type: 'number', description: 'x' }])
  const images = [{ mimeType: 'image/jpeg', base64: 'x' }]

  it('only signals with an identify spec are targets; the prompt names where to look', () => {
    expect(targets.map((t) => t.signalKey)).toEqual(['unit_size', 'capacity'])
    const prompt = buildIdentificationPrompt(targets)
    expect(prompt).toContain('the unit\'s rating plate')
    expect(prompt).toContain('Allowed values: "Small", "Medium", "Large"')
  })

  it('resolves each target from the readings', async () => {
    const outcome = await identifyFromLabels({
      ai: null,
      images,
      targets,
      run: async () => ({
        readings: [
          { targetKey: 'unit_size', legible: true, transcribed: 'AB48' },
          { targetKey: 'capacity', legible: false },
        ],
      }),
    })
    expect(outcome.resolved.map((r) => [r.signalKey, r.value])).toEqual([['unit_size', 'Large']])
  })

  it('a failed call yields nothing and never throws', async () => {
    const outcome = await identifyFromLabels({ ai: null, images, targets, run: async () => { throw new Error('down') } })
    expect(outcome.resolved).toEqual([])
  })

  it('a slow read is aborted at the cap and yields nothing (the customer is asked)', async () => {
    let aborted = false
    const outcome = await identifyFromLabels({
      ai: null,
      images,
      targets,
      timeoutMs: 20,
      run: (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => { aborted = true })
          setTimeout(() => resolve({ readings: [{ targetKey: 'unit_size', legible: true, transcribed: 'AB48' }] }), 300)
        }),
    })
    expect(outcome.resolved).toEqual([])
    expect(aborted).toBe(true)
  })

  it('no photos or no targets: no call', async () => {
    let called = false
    await identifyFromLabels({ ai: null, images: [], targets, run: async () => { called = true; return { readings: [] } } })
    expect(called).toBe(false)
  })
})

describe('applyIdentifications / weakenUnreadGuesses', () => {
  it('replaces a vision guess, never a customer answer', () => {
    const signals: ExtractedSignal[] = [
      { key: 'unit_size', value: 'Small', confidence: 0.8, source: 'vision' },
      { key: 'capacity', value: 2, confidence: 1, source: 'form' },
    ]
    applyIdentifications(signals, [
      { signalKey: 'unit_size', value: 'Large', method: 'decoded', confidence: 0.9, evidence: 'e' },
      { signalKey: 'capacity', value: 5, method: 'read', confidence: 0.75, evidence: 'e' },
    ])
    expect(signals[0]).toMatchObject({ value: 'Large', basis: 'identified', confidence: 0.9 })
    expect(signals[1]).toMatchObject({ value: 2, source: 'form' })
  })

  it('a guess from appearance alone is weakened when the label was unreadable', () => {
    const signals: ExtractedSignal[] = [{ key: 'unit_size', value: 'Small', confidence: 0.8, source: 'vision' }]
    const weakened = weakenUnreadGuesses(signals, identificationTargets([SIZE_SIGNAL]), [])
    expect(weakened).toEqual(['unit_size'])
    expect(signals[0]!.confidence).toBe(0.4)
    expect(signals[0]!.evidence).toContain('Not readable on the unit\'s rating plate')
  })
})

describe('checks, grade and questions', () => {
  const steps: WorkStepConfig[] = [
    { id: 's_large', name: 'Large unit', description: '', costType: 'fixed', defaultCost: 900, optional: true, triggerSignal: 'unit_size', triggerCondition: { operator: 'equals', value: 'Large' } },
    { id: 's_cap', name: 'Per capacity', description: '', costType: 'per_unit', defaultCost: 10, optional: false, quantitySource: { type: 'derived', formula: 'capacity * 2' } },
  ]
  const referenced = pricingReferencedKeys(steps, extractFormulaIdentifiers)
  const targets = identificationTargets([SIZE_SIGNAL, CAPACITY_SIGNAL, { ...SIZE_SIGNAL, signalKey: 'unpriced' }])

  it('finds keys the pricing reads (triggers and formula identifiers)', () => {
    expect([...referenced].sort()).toEqual(['capacity', 'unit_size'])
  })

  it('states: identified / confirmed / weak / unknown; unpriced targets ignored', () => {
    const checks = checkIdentifications(targets, referenced, [
      { key: 'unit_size', value: 'Large', confidence: 0.9, source: 'vision', basis: 'identified' },
      { key: 'capacity', value: 3, confidence: 1, source: 'form' },
    ])
    expect(checks.map((c) => [c.target.signalKey, c.state])).toEqual([
      ['unit_size', 'identified'],
      ['capacity', 'confirmed'],
    ])
    const weak = checkIdentifications(targets, referenced, [{ key: 'unit_size', value: 'Large', confidence: 0.4, source: 'vision' }])
    expect(weak[0]!.state).toBe('weak')
    expect(weak[1]!.state).toBe('unknown')
    const offList = checkIdentifications(targets, referenced, [{ key: 'unit_size', value: 'Huge', confidence: 1, source: 'form' }])
    expect(offList[0]!.state).toBe('unknown')
  })

  it('grades: identified → B, confirmed → A, weak/unknown → C', () => {
    const grade = (state: 'identified' | 'confirmed' | 'weak' | 'unknown') =>
      computeEstimateGrade([
        identificationProvenance({
          target: targets[0]!,
          state,
          signal: { key: 'unit_size', value: 'Large', confidence: state === 'weak' ? 0.4 : 0.9, source: 'vision' },
        }),
      ]).grade
    expect(grade('identified')).toBe('B')
    expect(grade('confirmed')).toBe('A')
    expect(grade('weak')).toBe('C')
    expect(grade('unknown')).toBe('C')
  })

  it('identified → one-tap confirmation with evidence and the options as corrections', () => {
    const q = identificationQuestion(
      { target: targets[0]!, state: 'identified', signal: { key: 'unit_size', value: 'Large', confidence: 0.9, source: 'vision', evidence: 'Read from…' } },
      0
    )!
    expect(q).toMatchObject({ type: 'confirm_value', aiValue: 'Large', evidence: 'Read from…', options: ['Small', 'Medium', 'Large'] })
    expect(q.question).toBe('Size of the unit: we read Large from the unit\'s rating plate. Is that right?')
  })

  it('unknown → direct question naming where the value is printed', () => {
    const q = identificationQuestion({ target: targets[1]!, state: 'unknown' }, 1)!
    expect(q.type).toBeUndefined()
    expect(q.question).toBe('Rated capacity? It is usually printed on the label.')
    expect(identificationQuestion({ target: targets[0]!, state: 'confirmed' }, 2)).toBeNull()
  })
})

describe('quality gate uses prebuilt identification questions', () => {
  const pricing = { currency: 'GBP', subtotal: 900, taxLabel: 'VAT', taxRate: 0, taxAmount: 0, total: 900, breakdown: [{ label: 'x', amount: 900 }], confidence: 0.8, notes: [] } as unknown as PricingResult

  it('asks the prebuilt question verbatim, without AI', async () => {
    const prebuilt = identificationQuestion({ target: identificationTargets([SIZE_SIGNAL])[0]!, state: 'unknown' }, 0)!
    const result = await evaluateQualityGate(
      {
        structuredSignals: { extractedAt: '', overallConfidence: 0.8, signals: [], siteVisitRecommended: false, lowConfidenceSignals: [] },
        fusionResult: null,
        pricing,
        clarificationCount: 0,
        serviceName: 'Test',
        hasPhotos: true,
        identificationQuestions: [prebuilt],
      },
      null
    )
    expect(result.action).toBe('ask_clarification')
    expect(result.questions).toEqual([prebuilt])
  })
})

describe('quality gate never asks to confirm an "unknown" value', () => {
  it('skips low-confidence signals whose value is unknown', async () => {
    const pricing = { currency: 'USD', subtotal: 300, taxLabel: 'Tax', taxRate: 0, taxAmount: 0, total: 300, breakdown: [{ label: 'x', amount: 300 }], confidence: 0.8, notes: [] } as unknown as PricingResult
    const result = await evaluateQualityGate(
      {
        structuredSignals: {
          extractedAt: '',
          overallConfidence: 0.8,
          signals: [{ key: 'condition_rating', value: 'unknown', confidence: 0.3, source: 'vision' }],
          siteVisitRecommended: false,
          lowConfidenceSignals: ['condition_rating'],
        },
        fusionResult: null,
        pricing,
        clarificationCount: 0,
        serviceName: 'Test',
        hasPhotos: true,
      },
      null
    )
    expect(result.action).toBe('send')
  })
})

describe('takeoff shows how a selected line was identified', () => {
  const steps: WorkStepConfig[] = [
    { id: 's_large', name: 'Large unit', description: '', costType: 'fixed', defaultCost: 900, optional: true, triggerSignal: 'unit_size', triggerCondition: { operator: 'equals', value: 'Large' } },
  ]
  const trace = {
    trace: [{ type: 'work_step', id: 's_large', description: 'Large unit', amount: 900, signalsUsed: [{ key: 'unit_size', value: 'Large' }], quantitySource: 'constant' }],
  } as unknown as Parameters<typeof buildTakeoff>[0]['trace']
  const signalsWith = (s: ExtractedSignal) => ({ extractedAt: '', overallConfidence: 1, signals: [s], siteVisitRecommended: false, lowConfidenceSignals: [] })

  it('identified → the label evidence', () => {
    const entries = buildTakeoff({ trace, workSteps: steps, structuredSignals: signalsWith({ key: 'unit_size', value: 'Large', confidence: 0.9, source: 'vision', basis: 'identified', evidence: 'Read from the plate: "AB48" → Large' }) })
    expect(entries[0]!.method).toBe('Read from the plate: "AB48" → Large')
  })

  it('confirmed by the customer → says so', () => {
    const entries = buildTakeoff({ trace, workSteps: steps, structuredSignals: signalsWith({ key: 'unit_size', value: 'Large', confidence: 1, source: 'form' }) })
    expect(entries[0]!.method).toBe('Selected for Large, as you confirmed')
  })

  it('a derived quantity line says it was calculated, not fixed', () => {
    const derivedTrace = {
      trace: [{ type: 'work_step', id: 'run', description: 'Run', amount: 630, signalsUsed: [{ key: 'run_length_ft', value: 35 }], quantitySource: 'derived' }],
    } as unknown as Parameters<typeof buildTakeoff>[0]['trace']
    const entries = buildTakeoff({
      trace: derivedTrace,
      workSteps: [{ id: 'run', name: 'Run', description: '', costType: 'per_unit', defaultCost: 18, optional: false, quantitySource: { type: 'derived', formula: 'max(0, run_length_ft - 25)' } }],
      structuredSignals: null,
    })
    expect(entries[0]!.method).toBe('Calculated from your answers')
  })
})
