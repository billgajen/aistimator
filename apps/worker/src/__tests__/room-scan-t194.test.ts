/**
 * T-194: the worker's side of "scans drive prices".
 *   - a line priced from the scan records which size it was (`scanMeasure`), so the card can say so;
 *   - a line priced from an AI signal the business set to come from the scan says "scan", not "answer";
 *   - a scanned quantity is a stated quantity, so it is never measured from photos (order of trust, AD-028).
 */
import { describe, expect, it } from 'vitest'
import { mergeScanAnswers, scanAnswers, type RoomScanPayload } from '@qolumns/shared'
import { buildTakeoff } from '../takeoff'
import { humanStatedQuantityKeys } from '../quantity-sources'

type Trace = Parameters<typeof buildTakeoff>[0]['trace']
type Signals = NonNullable<Parameters<typeof buildTakeoff>[0]['structuredSignals']>

const scan: RoomScanPayload = {
  version: 1,
  rooms: [{ name: 'Ground floor', roomsCovered: 2, walls: [{ widthM: 4, heightM: 2.5 }, { widthM: 3, heightM: 2.5 }, { widthM: 4, heightM: 2.5 }, { widthM: 3, heightM: 2.5 }], openings: [], floors: [] }],
}

describe('T-194: a line priced by the scan says which size priced it', () => {
  it('a question filled by the scan: its line carries the measure', () => {
    const trace = { trace: [{ type: 'work_step', id: 'rooms', description: 'Rooms', amount: 750, signalsUsed: [{ key: 'room_count', value: 2 }], quantitySource: 'form_field' }] } as unknown as Trace
    const workSteps = [{ id: 'rooms', name: 'Interior room', description: '', costType: 'per_unit' as const, defaultCost: 375, optional: false, quantitySource: { type: 'form_field' as const, fieldId: 'room_count' } }]
    const [line] = buildTakeoff({ trace, structuredSignals: null, workSteps, scanned: { fieldIds: new Set(['room_count']), evidence: 'Scanned on site with LiDAR: 2 rooms', measures: new Map([['room_count', 'room_count' as const]]) } })
    expect(line).toMatchObject({ source: 'scan', scanMeasure: 'room_count', quantity: 2 })
  })

  it('an AI signal the scan filled says it was the scan, with the measure', () => {
    const trace = { trace: [{ type: 'work_step', id: 'walls', description: 'Walls', amount: 860, signalsUsed: [{ key: 'wall_area_sqft', value: 344.4 }], quantitySource: 'ai_signal' }] } as unknown as Trace
    const workSteps = [{ id: 'walls', name: 'Walls', description: '', costType: 'per_unit' as const, defaultCost: 2.5, optional: false, unitLabel: 'sqft', quantitySource: { type: 'ai_signal' as const, signalKey: 'wall_area_sqft' } }]
    const structuredSignals = { signals: [{ key: 'wall_area_sqft', value: 344.4, confidence: 1, source: 'form', basis: 'scanned', evidence: 'Scanned on site with LiDAR: 1 room' }] } as unknown as Signals
    const scanned = { fieldIds: new Set(['wall_area_sqft']), evidence: 'Scanned on site with LiDAR: 1 room', measures: new Map([['wall_area_sqft', 'wall_area_net' as const]]) }
    expect(buildTakeoff({ trace, structuredSignals, workSteps, scanned })[0]).toMatchObject({ method: 'From the on-site room scan', source: 'scan', scanMeasure: 'wall_area_net' })
    // the same signal typed on site is the business's answer
    const typed = { signals: [{ key: 'wall_area_sqft', value: 300, confidence: 1, source: 'form', evidence: 'Customer-provided' }] } as unknown as Signals
    expect(buildTakeoff({ trace, structuredSignals: typed, workSteps, scanned })[0]).toMatchObject({ source: 'answer' })
    expect(buildTakeoff({ trace, structuredSignals: typed, workSteps, scanned })[0]!.scanMeasure).toBeUndefined()
  })
})

describe('T-194: order of trust in the worker', () => {
  it('a scanned quantity is an answer, so it is never measured from photos', () => {
    const filled = scanAnswers({ scan, expectedSignals: [{ signalKey: 'room_count', scan: { measure: 'room_count' } }, { signalKey: 'wall_area_sqm', unit: 'sqm', scan: { measure: 'wall_area_gross' } }] })
    const { answers } = mergeScanAnswers([], filled)
    expect(answers).toEqual([{ fieldId: 'room_count', value: 2 }, { fieldId: 'wall_area_sqm', value: 35 }])
    expect([...humanStatedQuantityKeys(['wall_area_sqm'], answers, [])]).toEqual(['wall_area_sqm'])
  })

  it('a number the business typed beats the scan, and the line is not called scanned', () => {
    const filled = scanAnswers({ scan, expectedSignals: [{ signalKey: 'room_count', scan: { measure: 'room_count' } }] })
    const merged = mergeScanAnswers([{ fieldId: 'room_count', value: '3' }], filled)
    expect(merged.answers).toEqual([{ fieldId: 'room_count', value: '3' }])
    expect(merged.scanned.has('room_count')).toBe(false)
  })
})
