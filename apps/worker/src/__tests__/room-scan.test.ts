/**
 * T-138 (AD-028): LiDAR room scans → quantities, computed by code.
 */
import { describe, it, expect } from 'vitest'
import {
  parseRoomScan,
  summarizeRoomScan,
  scanMeasureValue,
  scanAnswers,
  scanEvidence,
  polygonArea,
  computeEstimateGrade,
  type RoomScanPayload,
} from '@estimator/shared'
import { buildTakeoff } from '../takeoff'

// Two rooms: a 4 × 3 m room (2.4 m walls, one door, one window) and a 3 × 3 m room (one door)
const SCAN: RoomScanPayload = {
  version: 1,
  device: 'iPhone 15 Pro',
  rooms: [
    {
      name: 'Bedroom',
      walls: [
        { widthM: 4, heightM: 2.4 },
        { widthM: 3, heightM: 2.4 },
        { widthM: 4, heightM: 2.4 },
        { widthM: 3, heightM: 2.4 },
      ],
      openings: [
        { type: 'door', widthM: 0.8, heightM: 2 },
        { type: 'window', widthM: 1.2, heightM: 1 },
      ],
      floors: [{ polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
    },
    {
      walls: [
        { widthM: 3, heightM: 2.4 },
        { widthM: 3, heightM: 2.4 },
        { widthM: 3, heightM: 2.4 },
        { widthM: 3, heightM: 2.4 },
      ],
      openings: [{ type: 'door', widthM: 0.8, heightM: 2 }],
      floors: [{ widthM: 3, lengthM: 3 }],
    },
  ],
}

describe('geometry', () => {
  it('polygon area (shoelace)', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(12)
    expect(polygonArea([[0, 0], [0, 3], [4, 3], [4, 0]])).toBe(12) // orientation-free
  })

  it('summarises walls net of openings, floors, perimeter, counts', () => {
    const s = summarizeRoomScan(SCAN)
    // gross: 14 × 2.4 + 12 × 2.4 = 62.4; openings 1.6 + 1.2 + 1.6 = 4.4
    expect(s).toEqual({ rooms: 2, wallAreaGrossSqm: 62.4, wallAreaNetSqm: 58, floorAreaSqm: 21, perimeterM: 26, doors: 2, windows: 1 })
  })

  it('a polygon in the wrong plane (area ~0) falls back to width × length', () => {
    const flat = summarizeRoomScan({
      version: 1,
      rooms: [{ walls: [{ widthM: 3, heightM: 2.4 }], openings: [], floors: [{ polygon: [[0, 0], [3, 0], [3, 0], [0, 0]], widthM: 3, lengthM: 4 }] }],
    })
    expect(flat.floorAreaSqm).toBe(12)
  })

  it('converts into the signal unit once (AD-030)', () => {
    const s = summarizeRoomScan(SCAN)
    expect(scanMeasureValue(s, 'wall_area_net', 'sqm')).toBe(58)
    expect(scanMeasureValue(s, 'wall_area_net', 'sqft')).toBeCloseTo(624.3, 1)
    expect(scanMeasureValue(s, 'perimeter', 'ft')).toBeCloseTo(85.3, 1)
    expect(scanMeasureValue(s, 'room_count', 'room')).toBe(2)
    expect(scanMeasureValue(s, 'floor_area', 'ft')).toBeNull() // wrong kind of unit
  })
})

describe('parseRoomScan (untrusted input)', () => {
  it('accepts a valid scan', () => {
    expect(parseRoomScan(SCAN)).toMatchObject({ ok: true })
  })
  it.each([
    [null, 'scan must be an object'],
    [{ version: 2, rooms: [] }, 'unsupported scan version'],
    [{ version: 1, rooms: [] }, 'scan has no rooms'],
    [{ version: 1, rooms: [{ walls: [], openings: [], floors: [] }] }, 'room 1 has no walls'],
    [{ version: 1, rooms: [{ walls: [{ widthM: -1, heightM: 2 }], openings: [], floors: [] }] }, 'room 1 has an invalid wall'],
    [{ version: 1, rooms: [{ walls: [{ widthM: 500, heightM: 2 }], openings: [], floors: [] }] }, 'room 1 has an invalid wall'],
    [{ version: 1, rooms: [{ walls: [{ widthM: 3, heightM: 2 }], openings: [{ type: 'skylight', widthM: 1, heightM: 1 }], floors: [] }] }, 'room 1 has an invalid opening'],
  ])('rejects %j', (raw, error) => {
    expect(parseRoomScan(raw)).toEqual({ ok: false, error })
  })
  it('caps room count and drops junk polygon points', () => {
    const many = { version: 1, rooms: Array.from({ length: 41 }, () => SCAN.rooms[0]) }
    expect(parseRoomScan(many)).toMatchObject({ ok: false })
    const junk = parseRoomScan({ version: 1, rooms: [{ walls: [{ widthM: 3, heightM: 2 }], openings: [], floors: [{ polygon: [[0, 0], ['x', 1], [1, 1]] }] }] })
    expect(junk.ok && junk.scan.rooms[0]!.floors[0]!.polygon).toBeFalsy()
  })
})

describe('scanAnswers (pack mapping)', () => {
  const expected = [
    { signalKey: 'room_count', scan: { measure: 'room_count' as const } },
    { signalKey: 'wall_area_sqft', unit: 'sqft', scan: { measure: 'wall_area_net' as const } },
    { signalKey: 'prep_level' },
  ]

  it('fills the field mapped to each scan signal', () => {
    expect(
      scanAnswers({ scan: SCAN, expectedSignals: expected, fields: [{ fieldId: 'rooms', mapsToSignal: 'room_count' }] })
    ).toEqual([
      { fieldId: 'rooms', value: 2 },
      { fieldId: 'wall_area_sqft', value: 624.3 },
    ])
  })

  it('never overwrites what a person typed', () => {
    expect(
      scanAnswers({ scan: SCAN, expectedSignals: expected, existingAnswers: [{ fieldId: 'room_count', value: 3 }] }).map((a) => a.fieldId)
    ).toEqual(['wall_area_sqft'])
  })

  it('audit line names the device and rooms', () => {
    expect(scanEvidence(summarizeRoomScan(SCAN), 'iPhone 15 Pro')).toBe('Scanned on site with LiDAR (iPhone 15 Pro): 2 rooms')
  })
})

describe('grade and takeoff', () => {
  it('a scanned quantity is Grade A eligible', () => {
    expect(computeEstimateGrade([{ signalKey: 'wall_area_sqft', basis: 'scanned', confidence: 1 }]).grade).toBe('A')
  })

  it('a form-field line filled by the scan cites it', () => {
    const trace = { trace: [{ type: 'work_step', id: 'rooms', description: 'Rooms', amount: 750, signalsUsed: [{ key: 'room_count', value: 2 }], quantitySource: 'form_field' }] } as unknown as Parameters<typeof buildTakeoff>[0]['trace']
    const workSteps = [{ id: 'rooms', name: 'Rooms', description: '', costType: 'per_unit' as const, defaultCost: 375, optional: false, quantitySource: { type: 'form_field' as const, fieldId: 'room_count' } }]
    const scanned = buildTakeoff({ trace, structuredSignals: null, workSteps, scanned: { fieldIds: new Set(['room_count']), evidence: 'Scanned on site with LiDAR: 2 rooms' } })
    expect(scanned[0]!.method).toBe('From the on-site room scan')
    expect(scanned[0]!.evidence).toBe('Scanned on site with LiDAR: 2 rooms')
    expect(buildTakeoff({ trace, structuredSignals: null, workSteps })[0]!.method).toBe('Quantity provided by you')
  })
})
