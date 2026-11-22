/**
 * T-194: room scan that earns its place — scans drive prices, areas, clean walls and plan, the 3D viewer, rescan.
 *
 * The owner's test scan (quote on 20 Nov): a hallway, the stairs and a living room walked as one scan.
 * 18 walls (long walls in several pieces, three small returns), 4 doors and a window, every wall 2.47 m
 * (8.1 ft) but the stairwell's, 3.69 m (12.1 ft), turned about 17° off square. Here it covers 2 rooms.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canScanAgain,
  ceilingHeightOf,
  customerRoomScanView,
  floorPlanSvg,
  labelsOverlap,
  mergeScanAnswers,
  parseRoomScan,
  roomScanReport,
  roomScanView,
  scanAnswers,
  scanDifferenceLine,
  scanPricedLines,
  stepScanMeasure,
  summarizeRoomScan,
  wallLayout,
  withStepScanMeasure,
  ROOM_SCAN_FIELD,
  SCAN_FILL_CHOICES,
  type ExpectedSignalConfig,
  type PlanLabelBox,
  type PlanPoint,
  type RoomScanPayload,
  type RoomScanRoom,
} from '@qolumns/shared'
import { answersWithNewScan, answersWithScan } from '@/lib/room-scan-intake'
import { modelSourceAllowed } from '@/lib/room-model-source'
import { fitDistance, framingDistance, viewerHeight } from '@/components/room-scan/RoomModelViewer'
import { listPacks } from '@/lib/vertical-packs'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const H = 2.47
const STAIRS = 3.69
const TILT = (17 * Math.PI) / 180
const turn = ([x, z]: PlanPoint): PlanPoint => [3 + x * Math.cos(TILT) - z * Math.sin(TILT), -2 + x * Math.sin(TILT) + z * Math.cos(TILT)]
const wall = (a: PlanPoint, b: PlanPoint, heightM = H) => ({ widthM: Math.hypot(b[0] - a[0], b[1] - a[1]), heightM, start: turn(a), end: turn(b) })
const opening = (type: 'door' | 'window', a: PlanPoint, b: PlanPoint, heightM: number) => ({ type, widthM: Math.hypot(b[0] - a[0], b[1] - a[1]), heightM, start: turn(a), end: turn(b) })

/** The owner's scan shape: hallway, stairs and living room as one area */
function ownersArea(roomsCovered?: number): RoomScanRoom {
  return {
    name: 'Hallway, stairs and living room',
    walls: [
      // the top wall in three pieces
      wall([-1.2, 0], [0.6, 0]),
      wall([0.6, 0], [2.4, 0]),
      wall([2.4, 0], [5, 0]),
      // the right wall in two
      wall([5, 0], [5, 2.1]),
      wall([5, 2.1], [5, 4.2]),
      // the bottom wall in two
      wall([5, 4.2], [2.9, 4.2]),
      wall([2.9, 4.2], [0.8, 4.2]),
      // two small returns into the hallway
      wall([0.8, 4.2], [0.8, 4.45]),
      wall([0.8, 4.45], [0.6, 4.45]),
      // the hallway
      wall([0.6, 4.45], [0.6, 5.7]),
      wall([0.6, 5.7], [0.6, 7]),
      wall([0.6, 7], [-1.2, 7]),
      // the stairwell wall, full height
      wall([-1.2, 7], [-1.2, 3.2], STAIRS),
      // the left wall in two
      wall([-1.2, 3.2], [-1.2, 1.6]),
      wall([-1.2, 1.6], [-1.2, 0]),
      // the stairs' own walls, and a small return at their foot
      wall([-1.2, 3.2], [-0.2, 3.2]),
      wall([-0.2, 3.2], [-0.2, 5.8]),
      wall([-0.2, 5.8], [0, 5.8]),
    ],
    openings: [
      opening('door', [-0.6, 7], [0.3, 7], 2.03),
      opening('door', [2, 4.2], [1.2, 4.2], 2.03),
      opening('door', [5, 1], [5, 1.8], 2.03),
      opening('door', [3.2, 0], [4, 0], 2.03),
      opening('window', [5, 2.6], [5, 3.8], 1.2),
    ],
    floors: [{ polygon: ([[-1.2, 0], [5, 0], [5, 4.2], [0.6, 4.2], [0.6, 7], [-1.2, 7]] as PlanPoint[]).map(turn) }],
    // what the scanner sent: its tallest wall
    ceilingHeightM: STAIRS,
    ...(roomsCovered !== undefined && { roomsCovered }),
  }
}
const scanOf = (...rooms: RoomScanRoom[]): RoomScanPayload => ({ version: 1, rooms })

/** The owner's interior painting quote: priced per room, from the number typed on site */
const roomCount: ExpectedSignalConfig = { signalKey: 'room_count', type: 'number', description: 'Rooms', scan: { measure: 'room_count' } }

describe('T-194: the owner’s scan shape', () => {
  it('is what the owner saw: 18 walls, 4 doors, one wall 12.1 ft', () => {
    const area = ownersArea()
    expect(area.walls).toHaveLength(18)
    expect(area.openings.filter((o) => o.type === 'door')).toHaveLength(4)
    expect(roomScanReport(scanOf(area), 'imperial').rooms[0]!.openings.filter((o) => o.height > 6)).toHaveLength(4)
    expect(area.walls.filter((w) => w.heightM === STAIRS)).toHaveLength(1)
  })
})

describe('T-194: order of trust for one quantity (AD-028)', () => {
  const filled = (rooms?: number) => scanAnswers({ scan: scanOf(ownersArea(rooms)), expectedSignals: [roomCount] })

  it('1. a number the business typed is used, and the app says the scan differs', () => {
    const merged = mergeScanAnswers([{ fieldId: 'room_count', value: '2' }], filled())
    expect(merged.answers).toEqual([{ fieldId: 'room_count', value: '2' }])
    expect(merged.scanned.size).toBe(0)
    expect(merged.differences).toEqual([{ fieldId: 'room_count', typed: 2, scanned: 1, measure: 'room_count' }])
    expect(scanDifferenceLine(merged.differences[0]!)).toBe('The scan covers 1 room. You entered 2.')
  })

  it('2. the scan fills what was left blank, and is credited where the typed number is its own', () => {
    expect(mergeScanAnswers([], filled(2))).toMatchObject({ answers: [{ fieldId: 'room_count', value: 2 }], differences: [] })
    expect([...mergeScanAnswers([], filled(2)).scanned]).toEqual([['room_count', 'room_count']])
    expect([...mergeScanAnswers([{ fieldId: 'room_count', value: '2' }], filled(2)).scanned.keys()]).toEqual(['room_count'])
  })

  it('3. a customer’s answers are never touched: only a quote the app made reads a scan', () => {
    const worker = read('apps/worker/src/quote-processor.ts')
    expect(worker).toContain("quoteRequest.source_json?.type === 'app' ? parseRoomScan(rawScan) : null")
    expect(worker).toContain('mergeScanAnswers(quoteRequest.job_answers, filled)')
    const rescan = read('apps/web/src/app/api/app/quotes/[quoteId]/scan/route.ts')
    expect(rescan).toContain("(requestRow.source_json as { type?: string } | null)?.type !== 'app'")
  })

  it('4. a scanned quantity is an answer, so it is never measured from photos', () => {
    // the scan's answers are merged (1.1) before the measurement engine asks which quantities were stated
    const worker = read('apps/worker/src/quote-processor.ts')
    expect(worker.indexOf('mergeScanAnswers(quoteRequest.job_answers, filled)')).toBeLessThan(worker.indexOf('humanStatedQuantityKeys('))
  })

  it('only { fieldId, value } is stored with the answers', () => {
    const stored = answersWithScan([], scanOf(ownersArea(2)), { expected_signals: [roomCount] })
    expect(stored[0]).toEqual({ fieldId: 'room_count', value: 2 })
    expect(stored[1]!.fieldId).toBe(ROOM_SCAN_FIELD)
  })
})

describe('T-194: an area covers rooms; room_count is the rooms covered, not the scans', () => {
  it('the owner’s one scan covering 2 rooms prices 2 rooms', () => {
    expect(summarizeRoomScan(scanOf(ownersArea(2))).rooms).toBe(2)
    expect(scanAnswers({ scan: scanOf(ownersArea(2)), expectedSignals: [roomCount] })[0]!.value).toBe(2)
  })

  it('a mix: one area of 2 rooms and one of 1 is 3 rooms; older scans count 1 each, as they were priced', () => {
    const room: RoomScanRoom = { walls: [{ widthM: 4, heightM: 2.5 }], openings: [], floors: [] }
    expect(summarizeRoomScan(scanOf(ownersArea(2), room)).rooms).toBe(3)
    expect(summarizeRoomScan(scanOf(room, room)).rooms).toBe(2)
    expect(roomScanReport(scanOf(ownersArea(2), room), 'metric').total).toMatchObject({ areas: 2, rooms: 3 })
  })

  it('rooms covered is checked like any size: a whole number from 1 to 40', () => {
    const parse = (n: unknown) => {
      const p = parseRoomScan(scanOf({ ...ownersArea(), roomsCovered: n as number }))
      return p.ok ? p.scan.rooms[0]!.roomsCovered : 'refused'
    }
    expect([parse(2), parse(40), parse(0), parse(41), parse(1.5), parse('3')]).toEqual([2, 40, undefined, undefined, undefined, undefined])
  })

  it('the name and rooms covered show where the scan does', () => {
    const view = roomScanView(scanOf(ownersArea(2)), 'imperial')
    expect(view.rooms[0]).toMatchObject({ name: 'Hallway, stairs and living room', roomsCovered: 2 })
    expect(customerRoomScanView(scanOf(ownersArea(2)), 'imperial').rooms[0]).toMatchObject({ name: 'Hallway, stairs and living room', roomsCovered: 2 })
    expect(read('apps/web/src/components/room-scan/RoomScanCard.tsx')).toContain('roomsCoveredWords(roomsCovered)')
    expect(read('apps/web/src/lib/pdf-template.ts')).toContain('roomsCoveredWords(room.roomsCovered)')
  })
})

describe('T-194: walls as a person reads them (display only)', () => {
  const report = roomScanReport(scanOf(ownersArea(2)), 'imperial')
  const area = report.rooms[0]!

  it('pieces in one line, end to end, of one height are one wall; small returns are grouped', () => {
    // 18 pieces: top 3 → 1, right 2 → 1, bottom 2 → 1, hallway 2 → 1, left 2 → 1 (the stairwell wall is taller: its own)
    expect(area.walls).toHaveLength(9)
    expect(area.smallReturns).toEqual({ count: 3, length: 2.1 })
    expect(area.walls.map((w) => w.letter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
    // A is the top wall, the full 6.2 m (20.3 ft), lettered round from there
    expect(area.walls[0]).toEqual({ letter: 'A', width: 20.3, height: 8.1 })
  })

  it('every total and priced quantity is exactly as before', () => {
    const before = summarizeRoomScan(scanOf(ownersArea(2)))
    const joinedLength = wallLayout(ownersArea(2)).walls.reduce((sum, w) => sum + w.widthM, 0)
    expect(joinedLength).toBeCloseTo(ownersArea().walls.reduce((sum, w) => sum + w.widthM, 0), 9)
    expect(scanAnswers({ scan: scanOf(ownersArea(2)), expectedSignals: [{ ...roomCount, signalKey: 'walls', unit: 'sqm', scan: { measure: 'wall_area_net' } }] })[0]!.value).toBe(before.wallAreaNetSqm)
  })

  it('the ceiling height is the most common wall height by area, with the tallest wall beside it', () => {
    expect(ceilingHeightOf(ownersArea()).ceilingM).toBeCloseTo(H, 6)
    expect(area.ceilingHeight).toBe(8.1)
    expect(area.tallestWall).toBe(12.1)
    // a room with one height has no "tallest wall"
    expect(roomScanReport(scanOf({ walls: [{ widthM: 4, heightM: 2.5 }, { widthM: 3, heightM: 2.5 }], openings: [], floors: [] }), 'metric').rooms[0]!.tallestWall).toBeNull()
  })

  it('"Wall length" (was Perimeter) and "Wall length less doors"', () => {
    // 30.2 m (99.1 ft) of wall; 4 doors of 0.9 + 0.8 + 0.8 + 0.8 m = 3.3 m less: 26.9 m (88.3 ft)
    expect(area.wallLength).toBe(99.1)
    expect(area.wallLengthLessDoors).toBe(88.3)
    expect(read('apps/web/src/components/room-scan/RoomScanCard.tsx')).not.toContain('Perimeter')
  })
})

describe('T-194: the floor plan', () => {
  const labels: PlanLabelBox[] = []
  const svg = floorPlanSvg(ownersArea(2), 'imperial', { title: 'Hallway', labels })!

  it('is turned so its longest wall is level', () => {
    const layout = wallLayout(ownersArea())
    const longest = layout.walls.filter((w) => w.start && w.end).reduce((a, b) => (b.widthM > a.widthM ? b : a))
    expect(Math.abs(longest.end![1] - longest.start![1])).toBeLessThan(1e-9)
  })

  it('no two labels overlap; a short wall keeps its letter and drops its length', () => {
    expect(labels).toHaveLength(9)
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(labelsOverlap(labels[i]!, labels[j]!, 0), `${labels[i]!.text} / ${labels[j]!.text}`).toBe(false)
    // a 1-ft piece in a tight corner: the letter alone
    const tight: RoomScanRoom = { walls: [wall([0, 0], [4, 0]), wall([4, 0], [4, 0.35]), wall([4, 0.35], [4.35, 0.35]), wall([4.35, 0.35], [4.35, 3]), wall([4.35, 3], [0, 3]), wall([0, 3], [0, 0])], openings: [], floors: [] }
    const tightLabels: PlanLabelBox[] = []
    floorPlanSvg(tight, 'metric', { labels: tightLabels })
    expect(tightLabels.some((l) => /^[A-Z]$/.test(l.text))).toBe(true)
    for (let i = 0; i < tightLabels.length; i++) for (let j = i + 1; j < tightLabels.length; j++) expect(labelsOverlap(tightLabels[i]!, tightLabels[j]!, 0)).toBe(false)
  })

  it('shows the same letters as the wall list, and marks doors and windows', () => {
    const letters = roomScanReport(scanOf(ownersArea(2)), 'imperial').rooms[0]!.walls.map((w) => w.letter)
    for (const letter of letters) expect(svg).toContain(`font-weight="700">${letter}</tspan>`)
    expect(svg).toContain('>Door<')
    expect(svg).toContain('>Window<')
  })

  it('an open passage is marked, with its own key', () => {
    const open = floorPlanSvg({ ...ownersArea(), openings: [opening('window', [5, 2.6], [5, 3.8], 1.2), { ...opening('door', [0.6, 4.6], [0.6, 5.4], 2.03), type: 'opening' }] }, 'metric')!
    expect(open).toContain('stroke-dasharray="3 3"')
    expect(open).toContain('>Opening<')
  })

  it('is larger on a phone and opens larger with a tap', () => {
    const plan = read('apps/web/src/components/room-scan/PlanView.tsx')
    expect(plan).toContain('[&>svg]:w-full')
    expect(plan).toContain('showModal()')
    expect(read('apps/mobile/src/components/RoomScanSummary.tsx')).toContain('maximumZoomScale={4}')
  })
})

describe('T-194: one answer to "which sizes priced the quote"', () => {
  const owners = [
    { item: 'Base fee', amount: 75, method: 'Standard charge for every job', source: 'fixed' },
    { item: 'Interior room', quantity: 2, unit: 'room', rate: 375, amount: 750, method: 'Quantity provided by you', source: 'answer' },
  ]

  it('the owner’s quote ("$375 × 2 rooms · Your answer"): the price does not depend on the sizes', () => {
    const priced = scanPricedLines(owners)
    expect(priced.kind).toBe('none')
    expect(priced.sentence).toBe('The price does not depend on these sizes. They are here for planning the job.')
    expect(priced.sentence).not.toContain('priced the quote')
  })

  it('a line the scan priced is named, with its quantity', () => {
    const scanned = [owners[0], { ...owners[1], method: 'From the on-site room scan', source: 'scan', scanMeasure: 'room_count' }]
    expect(scanPricedLines(scanned)).toMatchObject({ kind: 'scan', lines: [{ item: 'Interior room', quantity: 2, unit: 'room', measure: 'room_count' }], sentence: 'These sizes priced the quote: Interior room, 2 rooms.' })
    // a quote priced before T-194 has no measure on the line, and is still told
    expect(scanPricedLines([{ item: 'Walls', quantity: 344.4, unit: 'sqft', amount: 860, method: 'From the on-site room scan' }])).toMatchObject({ kind: 'scan', sentence: 'These sizes priced the quote: Walls, 344.4 sq ft.' })
  })

  it('before it is priced, nothing is claimed', () => {
    expect(scanPricedLines(undefined)).toEqual({ kind: 'unknown', lines: [], sentence: null })
  })

  it('the business’s card and the app’s card read it; no screen says the sizes priced it on its own', () => {
    expect(read('apps/web/src/components/room-scan/RoomScanCard.tsx')).toContain('view.pricing?.sentence')
    expect(read('apps/mobile/src/components/RoomScanSummary.tsx')).toContain('view.pricing?.sentence')
    for (const file of ['apps/mobile/src/components/RoomScanSummary.tsx', 'apps/web/src/components/room-scan/RoomScanCard.tsx']) expect(read(file)).not.toContain('These sizes priced the quote')
    for (const route of ['apps/web/src/app/api/quotes/[quoteId]/route.ts', 'apps/web/src/app/api/app/quotes/[quoteId]/route.ts', 'apps/web/src/lib/approval-link.ts']) expect(read(route)).toMatch(/roomScanView\([^)]*\{ takeoff:/)
  })
})

describe('T-194: the customer’s block shows only the sizes that priced the quote', () => {
  it('none priced: wall area and ceiling height, and no floor area', () => {
    const view = customerRoomScanView(scanOf(ownersArea(2)), 'imperial', 'en-US', { takeoff: [{ item: 'Interior room', quantity: 2, unit: 'room', amount: 750, method: 'Quantity provided by you', source: 'answer' }] })
    expect(view.priced).toEqual([])
    expect(view.rooms[0]!.figures.map((f) => f.label)).toEqual(['Wall area', 'Ceiling height'])
    expect(view.rooms[0]!.figures[1]!.value).toBe('8.1 ft')
  })

  it('floor area priced: floor area shown; rooms priced: the rooms', () => {
    const floor = customerRoomScanView(scanOf(ownersArea(2)), 'metric', 'en-US', { takeoff: [{ item: 'Flooring', quantity: 30, unit: 'sqm', amount: 900, method: 'From the on-site room scan', source: 'scan', scanMeasure: 'floor_area' }] })
    expect(floor.rooms[0]!.figures.map((f) => f.label)).toEqual(['Floor area'])
    // in the line's own unit, as the price line writes it
    expect(floor.priced).toEqual(['Flooring, 30 sqm'])
    const rooms = customerRoomScanView(scanOf(ownersArea(2)), 'metric', 'en-US', { takeoff: [{ item: 'Interior room', quantity: 2, unit: 'room', amount: 750, method: 'From the on-site room scan', source: 'scan', scanMeasure: 'room_count' }] })
    expect(rooms.rooms[0]!.figures).toEqual([{ label: 'Rooms', value: '2' }])
  })

  it('no wall list for the customer', () => {
    const view = customerRoomScanView(scanOf(ownersArea(2)), 'metric')
    expect(JSON.stringify(view)).not.toContain('"walls"')
  })
})

describe('T-194: scanning again after the estimate', () => {
  const service = { expected_signals: [roomCount] }

  it('what the old scan filled goes; what the business typed stays; the new scan fills the rest', () => {
    const before = answersWithScan([{ fieldId: 'notes', value: 'Two coats' }], scanOf(ownersArea(1)), service)
    expect(before.find((a) => a.fieldId === 'room_count')!.value).toBe(1)
    const after = answersWithNewScan(before, scanOf(ownersArea(1)), scanOf(ownersArea(2)), service)
    expect(after.find((a) => a.fieldId === 'room_count')!.value).toBe(2)
    expect(after.find((a) => a.fieldId === 'notes')!.value).toBe('Two coats')
    expect(after.filter((a) => a.fieldId === ROOM_SCAN_FIELD)).toHaveLength(1)
    // a number typed on site is kept, whatever is scanned
    const typed = answersWithNewScan([{ fieldId: 'room_count', value: '3' }, { fieldId: ROOM_SCAN_FIELD, value: scanOf(ownersArea(1)) }], scanOf(ownersArea(1)), scanOf(ownersArea(2)), service)
    expect(typed.find((a) => a.fieldId === 'room_count')!.value).toBe('3')
  })

  it('until the quote is approved; after approval it is gone', () => {
    expect(canScanAgain({ status: 'pending_review' })).toBe(true)
    expect(canScanAgain({ status: 'awaiting_clarification' })).toBe(true)
    expect(canScanAgain({ status: 'pending_review', approvedAt: '2026-11-20T10:00:00Z' })).toBe(false)
    for (const status of ['sent', 'viewed', 'accepted', 'paid', 'queued', 'generating']) expect(canScanAgain({ status })).toBe(false)
    const screen = read('apps/mobile/app/quote/[id].tsx')
    expect(screen).toContain('quote.roomScan.canScanAgain &&')
    expect(screen).toContain('onAddArea')
  })

  it('it is priced again through the answer-and-reprice path, and a changed answer is the answer now', () => {
    const route = read('apps/web/src/app/api/app/quotes/[quoteId]/scan/route.ts')
    expect(route).toContain('if (!(await repriceQuoteNow(job))) await enqueueQuoteJob(job)')
    expect(read('apps/worker/src/quote-processor.ts')).toContain('} else if (reprice && existingSignal.value !== value) {')
  })
})

describe('T-194: room scan needs a plan with it (Pro and Business)', () => {
  it('the server refuses a scan from a business without it, before anything is stored', () => {
    for (const path of ['apps/web/src/app/api/app/quotes/route.ts', 'apps/web/src/app/api/app/quotes/[quoteId]/scan/route.ts']) {
      const route = read(path)
      // T-199: the one rule decides (`canUse(…, 'room_scan')`), asked directly or through planHasRoomScan
      const asked = route.search(/planHasRoomScan\(|canUse\(access, 'room_scan'\)/)
      expect(asked, path).toBeGreaterThan(0)
      expect(route).toContain('SCAN_NOT_IN_PLAN }, { status: 403 }')
      expect(asked).toBeLessThan(route.search(/createQuoteSubmission\(|\.update\(\{ job_answers/))
    }
    expect(read('apps/web/src/lib/room-scan-intake.ts')).toContain("businessCan(supabase, tenantId, 'room_scan')")
  })

  it('the app says it is part of Pro, with no price and no purchase link', () => {
    const screen = read('apps/mobile/app/(tabs)/new.tsx')
    expect(screen).toContain("'Room scan is part of Pro'")
    expect(screen).toContain('form.boot.roomScan !== false')
    expect(read('apps/web/src/app/api/app/bootstrap/route.ts')).toContain("roomScan: canUse(access, 'room_scan')")
  })
})

describe('T-194: the service editor — "When you scan on site, fill this from:"', () => {
  const fields = [{ fieldId: 'rooms', mapsToSignal: 'room_count' }]

  it('offers every measure in plain words, and nothing', () => {
    expect(SCAN_FILL_CHOICES.map((c) => c.label)).toEqual(['Nothing (type it in)', 'Wall area less doors and windows', 'Wall area', 'Ceiling area', 'Floor area', 'Wall length', 'Doors', 'Windows', 'Rooms'])
  })

  it('is stored as the signal’s scan spec, with a unit of the right kind (AD-030)', () => {
    const step = { quantitySource: { type: 'form_field' as const, fieldId: 'rooms' }, unitLabel: 'room' }
    const signals = withStepScanMeasure(step, 'room_count', [], fields, 'imperial')
    expect(signals).toEqual([{ signalKey: 'room_count', type: 'number', description: 'Rooms', scan: { measure: 'room_count' } }])
    expect(stepScanMeasure(step, signals, fields)).toBe('room_count')
    const area = withStepScanMeasure({ quantitySource: { type: 'ai_signal', signalKey: 'wall_area_sqft' }, unitLabel: 'sq ft' }, 'wall_area_net', [{ signalKey: 'wall_area_sqft', type: 'number', description: 'Walls' }], [], 'imperial')
    expect(area[0]).toMatchObject({ unit: 'sqft', scan: { measure: 'wall_area_net' } })
    expect(withStepScanMeasure({ quantitySource: { type: 'form_field', fieldId: 'trim' } }, 'perimeter', [], [], 'metric')[0]).toMatchObject({ signalKey: 'trim', unit: 'm' })
    // "nothing" takes it off again, and leaves the signal
    expect(withStepScanMeasure(step, null, signals, fields, 'imperial')).toEqual([{ signalKey: 'room_count', type: 'number', description: 'Rooms' }])
  })

  it('shows on any line charged by a quantity, in the editor', () => {
    const editor = read('apps/web/src/components/WorkStepEditor.tsx')
    expect(editor).toContain('When you scan on site, fill this from:')
    expect(editor).toContain('stepTakesScan(step)')
    expect(read('apps/web/src/app/(dashboard)/app/services/page.tsx')).toContain('onExpectedSignalsChange={(signals) => setFormData({ ...formData, expectedSignals: signals })}')
  })
})

describe('T-194: packs — every signal a scan can honestly measure has its scan spec', () => {
  it('interior painting stays per room, filled by the rooms covered; nothing else a scan can measure honestly', () => {
    const specs = listPacks().flatMap((pack) =>
      pack.services.flatMap((t) => (t.draft.expectedSignals ?? []).filter((s) => s.scan).map((s) => `${pack.id}/${t.name}/${s.signalKey}=${s.scan!.measure}`))
    )
    // Exterior wall area is outside (a room scan measures inside); wallpaper's wall count is the walls to paper,
    // not every wall; the other trades price equipment, not sizes.
    expect(specs.sort()).toEqual(expect.arrayContaining([expect.stringMatching(/room_count=room_count$/)]))
    expect(specs.every((s) => s.endsWith('room_count=room_count'))).toBe(true)
    expect(specs).toHaveLength(2)
  })
})

describe('T-194: the 3D viewer', () => {
  it('fills about 80% of the view, from a three-quarter angle above; taller on a phone', () => {
    // a sphere of radius 1 in a 40° view fills 80% of the narrower side
    const d = framingDistance(1, 40, 1.5)
    expect(1 / (d * Math.sin((20 * Math.PI) / 180))).toBeCloseTo(0.8, 6)
    expect(framingDistance(1, 40, 0.6)).toBeGreaterThan(d)
    // a wide, low room's box, seen from above at three quarters, fills 80% of the view, centred
    const corners: Array<[number, number, number]> = []
    for (const x of [-3, 3]) for (const y of [-1.2, 1.2]) for (const z of [-2, 2]) corners.push([x, y, z])
    const dir: [number, number, number] = [1, 0.9, 1.15]
    const at = fitDistance(corners, dir, 40, 1.6)
    expect(at).toBeLessThan(framingDistance(Math.hypot(3, 1.2, 2), 40, 1.6))
    expect(fitDistance(corners, dir, 40, 1.6, 0.9)).toBeLessThan(at)
    expect(viewerHeight(390, 844)).toBeGreaterThan(390)
    expect(viewerHeight(1200, 900)).toBeLessThan(1200 * 0.7)
    const viewer = read('apps/web/src/components/room-scan/RoomModelViewer.tsx')
    expect(viewer).toContain('Reset view')
    expect(viewer).toContain('Full screen')
  })

  it('a dark stage, light walls with edges, a tinted floor, doors and windows in the brand colour; never pale on pale', () => {
    const viewer = read('apps/web/src/components/room-scan/RoomModelViewer.tsx')
    expect(viewer).toContain('renderer.setClearColor(MODEL_COLOR.stage, 1)')
    expect(viewer).toContain('new THREE.EdgesGeometry(')
    expect(viewer).toContain("getPropertyValue('--color-primary-rgb')")
    expect(read('Docs/design/system.md')).toContain('3D viewer')
  })

  it('no AR anywhere; the app opens this same viewer, not Quick Look', () => {
    for (const file of ['apps/web/src/components/room-scan/RoomModelViewer.tsx', 'apps/web/src/components/room-scan/RoomScanCard.tsx', 'apps/web/src/app/q/[quoteId]/page.tsx']) {
      expect(read(file)).not.toContain('rel="ar"')
      expect(read(file)).not.toContain('Open in AR')
    }
    expect(read('apps/mobile/modules/room-scan/ios/RoomScanModule.swift')).not.toContain('QuickLook')
    expect(read('apps/mobile/src/lib/model-viewer.ts')).toContain('/room-model#src=')
  })

  it('the app’s viewer page opens only our own storage’s addresses', () => {
    const opts = { storageHost: 'acct.r2.cloudflarestorage.com', pageOrigin: 'https://example.test' }
    expect(modelSourceAllowed('https://acct.r2.cloudflarestorage.com/bucket/t/room-models/a.usdz?X-Amz-Signature=1', opts)).toBe(true)
    expect(modelSourceAllowed('https://bucket.acct.r2.cloudflarestorage.com/t/a.usdz', opts)).toBe(true)
    expect(modelSourceAllowed('https://example.test/model.usdz', opts)).toBe(true)
    for (const bad of ['http://acct.r2.cloudflarestorage.com/a', 'https://evil.test/a.usdz', 'https://acct.r2.cloudflarestorage.com.evil.test/a', 'javascript:alert(1)', 'https://u:p@acct.r2.cloudflarestorage.com/a', ''])
      expect(modelSourceAllowed(bad, opts), bad).toBe(false)
  })

  it('loads only when opened, with an address signed for the quote; sizes and plan stay if it fails', () => {
    const viewer = read('apps/web/src/components/room-scan/RoomModelViewer.tsx')
    expect(viewer).not.toMatch(/^import .*from 'three/m)
    expect(viewer.indexOf('await fetch(addressPath')).toBeLessThan(viewer.indexOf("import('three')"))
    expect(viewer).toContain('The sizes and the floor plan are unaffected.')
  })
})
