/**
 * LiDAR room scans (T-138, AD-028) — pure geometry, no IO.
 *
 * The business app scans rooms on site (Apple RoomPlan) and sends the raw
 * geometry: walls, openings and floors in METRES (AD-030: geometry is
 * metric). Code — never a model — turns it into quantities, then into the
 * unit each expected signal declares. A scanned quantity is measured ground
 * truth: it ranks with a confirmed answer (Grade A eligible) and is never
 * re-measured from photos.
 *
 * Which quantity feeds which signal is pack data (`ExpectedSignalConfig.scan`);
 * nothing here knows a trade.
 */

import { fromCanonical, normalizeUnit, unitKind } from './units'

/**
 * T-193: a point on the floor plane, in metres: [x, z] in the scan's own
 * frame (RoomPlan's y is up, so x and z span the floor). Seen from above, x
 * runs right and z runs down.
 */
export type PlanPoint = [number, number]

export interface RoomScanWall {
  widthM: number
  heightM: number
  /** T-193: where the wall runs on the floor plan (its two ends). Scans before T-193 have none. */
  start?: PlanPoint
  end?: PlanPoint
}

export interface RoomScanOpening {
  type: 'door' | 'window' | 'opening'
  widthM: number
  heightM: number
  /** T-193: where it sits on the floor plan (its two ends, along its wall) */
  start?: PlanPoint
  end?: PlanPoint
}

export interface RoomScanFloor {
  /** Floor outline corners in metres (x, z on the floor plane), when RoomPlan provides it */
  polygon?: Array<[number, number]>
  /** Bounding dimensions when no polygon is available */
  widthM?: number
  lengthM?: number
}

export interface RoomScanRoom {
  name?: string
  walls: RoomScanWall[]
  openings: RoomScanOpening[]
  floors: RoomScanFloor[]
  /** T-193: floor to ceiling, metres (RoomPlan's walls run floor to ceiling: their tallest) */
  ceilingHeightM?: number
  /**
   * T-194: how many rooms this scan covers. A scan is an area: one room, a whole floor, or a hallway and
   * the room it opens into. The business says how many rooms it is (default 1), and `room_count` is the sum
   * across the scans. Scans before T-194 have none: 1 each, as they were priced.
   */
  roomsCovered?: number
  /**
   * T-193: the room's 3D model (RoomPlan's own USDZ export), uploaded privately. The server made this
   * id; the file is kept under the quote's own tenant (lib/room-models.ts), so an id alone opens nothing.
   */
  modelId?: string
}

export interface RoomScanPayload {
  version: 1
  rooms: RoomScanRoom[]
  /** e.g. "iPhone 15 Pro" — audit only */
  device?: string
  capturedAt?: string
}

/** Reserved answer id carrying the raw scan from the business app */
export const ROOM_SCAN_FIELD = '_room_scan'

/** Quantities a scan can produce (generic geometry, not trade terms) */
export type ScanMeasure =
  | 'room_count'
  | 'wall_area_net'
  | 'wall_area_gross'
  | 'floor_area'
  | 'ceiling_area'
  | 'perimeter'
  | 'door_count'
  | 'window_count'

export const SCAN_MEASURES: readonly ScanMeasure[] = [
  'room_count', 'wall_area_net', 'wall_area_gross', 'floor_area', 'ceiling_area', 'perimeter', 'door_count', 'window_count',
]

/** Pack data on an expected signal: this signal can be filled from a room scan. */
export interface ScanSpec {
  measure: ScanMeasure
}

export interface RoomScanSummary {
  rooms: number
  wallAreaGrossSqm: number
  wallAreaNetSqm: number
  floorAreaSqm: number
  perimeterM: number
  doors: number
  windows: number
}

/** Plausibility limits: one residential scan, not a stadium */
const LIMITS = { rooms: 40, walls: 40, openings: 60, maxDimM: 60 }

/** T-193: the shape of a model id the server hands out (a UUID) */
export const ROOM_MODEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** Shoelace area of a floor polygon (absolute), m² */
export function polygonArea(points: Array<[number, number]>): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!
    const [x2, z2] = points[(i + 1) % points.length]!
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

/**
 * Validate an untrusted scan payload (it arrives over the network). Returns a
 * cleaned copy, or an error message. Dimensions must be positive and within
 * a house-sized bound; counts are capped.
 */
export function parseRoomScan(raw: unknown): { ok: true; scan: RoomScanPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'scan must be an object' }
  const r = raw as Record<string, unknown>
  if (r.version !== 1) return { ok: false, error: 'unsupported scan version' }
  if (!Array.isArray(r.rooms) || r.rooms.length === 0) return { ok: false, error: 'scan has no rooms' }
  if (r.rooms.length > LIMITS.rooms) return { ok: false, error: `at most ${LIMITS.rooms} rooms per scan` }
  const dim = (n: unknown) => positive(n) && n <= LIMITS.maxDimM
  // T-193: a floor-plan point; one that is not a pair of plausible numbers is left off (the sizes still count)
  const point = (p: unknown): PlanPoint | null =>
    Array.isArray(p) && p.length === 2 && p.every((c) => typeof c === 'number' && Number.isFinite(c) && Math.abs(c) <= LIMITS.maxDimM)
      ? [p[0] as number, p[1] as number]
      : null
  const ends = (o: Record<string, unknown>): { start: PlanPoint; end: PlanPoint } | Record<string, never> => {
    const start = point(o.start)
    const end = point(o.end)
    return start && end ? { start, end } : {}
  }

  const rooms: RoomScanRoom[] = []
  for (const [i, roomRaw] of r.rooms.entries()) {
    const room = (roomRaw || {}) as Record<string, unknown>
    const walls = Array.isArray(room.walls) ? room.walls : []
    const openings = Array.isArray(room.openings) ? room.openings : []
    const floors = Array.isArray(room.floors) ? room.floors : []
    if (walls.length === 0) return { ok: false, error: `room ${i + 1} has no walls` }
    if (walls.length > LIMITS.walls || openings.length > LIMITS.openings) return { ok: false, error: `room ${i + 1} is too complex` }
    const cleanWalls: RoomScanWall[] = []
    for (const w of walls as Array<Record<string, unknown>>) {
      if (!dim(w?.widthM) || !dim(w?.heightM)) return { ok: false, error: `room ${i + 1} has an invalid wall` }
      cleanWalls.push({ widthM: w.widthM as number, heightM: w.heightM as number, ...ends(w) })
    }
    const cleanOpenings: RoomScanOpening[] = []
    for (const o of openings as Array<Record<string, unknown>>) {
      const type = o?.type === 'door' || o?.type === 'window' || o?.type === 'opening' ? o.type : null
      if (!type || !dim(o.widthM) || !dim(o.heightM)) return { ok: false, error: `room ${i + 1} has an invalid opening` }
      cleanOpenings.push({ type, widthM: o.widthM as number, heightM: o.heightM as number, ...ends(o) })
    }
    const cleanFloors: RoomScanFloor[] = []
    for (const f of floors as Array<Record<string, unknown>>) {
      const polygon = Array.isArray(f?.polygon)
        ? (f.polygon as unknown[]).filter(
            (p): p is [number, number] =>
              Array.isArray(p) && p.length === 2 && p.every((c) => typeof c === 'number' && Number.isFinite(c) && Math.abs(c) <= LIMITS.maxDimM)
          )
        : undefined
      cleanFloors.push({
        ...(polygon && polygon.length >= 3 && { polygon }),
        ...(dim(f?.widthM) && { widthM: f.widthM as number }),
        ...(dim(f?.lengthM) && { lengthM: f.lengthM as number }),
      })
    }
    rooms.push({
      ...(typeof room.name === 'string' && { name: room.name.slice(0, 60) }),
      walls: cleanWalls,
      openings: cleanOpenings,
      floors: cleanFloors,
      ...(dim(room.ceilingHeightM) && { ceilingHeightM: room.ceilingHeightM as number }),
      ...(Number.isInteger(room.roomsCovered) && (room.roomsCovered as number) >= 1 && (room.roomsCovered as number) <= LIMITS.rooms && { roomsCovered: room.roomsCovered as number }),
      ...(typeof room.modelId === 'string' && ROOM_MODEL_ID.test(room.modelId) && { modelId: room.modelId }),
    })
  }
  return {
    ok: true,
    scan: {
      version: 1,
      rooms,
      ...(typeof r.device === 'string' && { device: r.device.slice(0, 60) }),
      ...(typeof r.capturedAt === 'string' && { capturedAt: r.capturedAt.slice(0, 40) }),
    },
  }
}

/** T-194: the rooms one scanned area stands for (1 for a scan made before areas) */
export function roomsCoveredBy(room: RoomScanRoom): number {
  return Number.isInteger(room.roomsCovered) && (room.roomsCovered as number) >= 1 ? (room.roomsCovered as number) : 1
}

/** Totals across every scanned area (metric); `rooms` is the rooms they cover (T-194). Pure. */
export function summarizeRoomScan(scan: RoomScanPayload): RoomScanSummary {
  let gross = 0
  let openingArea = 0
  let floor = 0
  let perimeter = 0
  let doors = 0
  let windows = 0
  let rooms = 0
  for (const room of scan.rooms) {
    rooms += roomsCoveredBy(room)
    for (const w of room.walls) {
      gross += w.widthM * w.heightM
      perimeter += w.widthM
    }
    for (const o of room.openings) {
      openingArea += o.widthM * o.heightM
      if (o.type === 'door') doors += 1
      if (o.type === 'window') windows += 1
    }
    for (const f of room.floors) {
      // A polygon in the wrong plane collapses to ~0: fall back to the bounds
      const polygon = f.polygon && f.polygon.length >= 3 ? polygonArea(f.polygon) : 0
      if (polygon >= 0.01) floor += polygon
      else if (f.widthM && f.lengthM) floor += f.widthM * f.lengthM
    }
  }
  return {
    rooms,
    wallAreaGrossSqm: round(gross),
    wallAreaNetSqm: round(Math.max(0, gross - openingArea)),
    floorAreaSqm: round(floor),
    perimeterM: round(perimeter, 2),
    doors,
    windows,
  }
}

/**
 * One measure in the signal's unit (AD-030: convert once, where the
 * quantity is emitted). Counts ignore the unit; areas and lengths convert
 * from metric into it. Null when the scan can't produce it (no floors, or a
 * unit of the wrong kind).
 */
export function scanMeasureValue(summary: RoomScanSummary, measure: ScanMeasure, unit?: string): number | null {
  const area = (sqm: number) => {
    if (sqm <= 0) return null
    const target = normalizeUnit(unit) ?? 'sqm'
    if (unitKind(target) !== 'area') return null
    const v = fromCanonical(sqm, 'area', target)
    return v === null ? null : round(v)
  }
  const length = (m: number) => {
    if (m <= 0) return null
    const target = normalizeUnit(unit) ?? 'm'
    if (unitKind(target) !== 'length') return null
    const v = fromCanonical(m, 'length', target)
    return v === null ? null : round(v)
  }
  switch (measure) {
    case 'room_count':
      return summary.rooms
    case 'door_count':
      return summary.doors
    case 'window_count':
      return summary.windows
    case 'wall_area_net':
      return area(summary.wallAreaNetSqm)
    case 'wall_area_gross':
      return area(summary.wallAreaGrossSqm)
    case 'floor_area':
    case 'ceiling_area':
      return area(summary.floorAreaSqm)
    case 'perimeter':
      return length(summary.perimeterM)
    default:
      return null
  }
}

export interface ScanAnswer {
  fieldId: string
  value: number
  /** T-194: what the scan measured for it, and the signal it fills (never stored with the answers: see `mergeScanAnswers`) */
  measure: ScanMeasure
  signalKey: string
}

/**
 * Answers a scan fills (pure): for every expected signal with a scan spec,
 * the form field that maps to it (explicit `mapsToSignal`, else a field
 * whose id IS the signal key, else the signal key itself — the same keying
 * clarification answers use). Fields already answered are left alone: what
 * a person typed on site wins.
 */
export function scanAnswers(opts: {
  scan: RoomScanPayload
  expectedSignals: Array<{ signalKey: string; unit?: string; scan?: ScanSpec }>
  fields?: Array<{ fieldId: string; mapsToSignal?: string }>
  existingAnswers?: Array<{ fieldId: string; value: unknown }>
}): ScanAnswer[] {
  const summary = summarizeRoomScan(opts.scan)
  const answered = new Set(
    (opts.existingAnswers || [])
      .filter((a) => a.value !== undefined && a.value !== null && String(a.value).trim() !== '')
      .map((a) => a.fieldId)
  )
  const out: ScanAnswer[] = []
  for (const es of opts.expectedSignals) {
    if (!es.scan || !SCAN_MEASURES.includes(es.scan.measure)) continue
    const value = scanMeasureValue(summary, es.scan.measure, es.unit)
    if (value === null || value <= 0) continue
    const field =
      opts.fields?.find((f) => f.mapsToSignal === es.signalKey) ?? opts.fields?.find((f) => f.fieldId === es.signalKey)
    const fieldId = field?.fieldId ?? es.signalKey
    if (answered.has(fieldId) || out.some((o) => o.fieldId === fieldId)) continue
    out.push({ fieldId, value, measure: es.scan.measure, signalKey: es.signalKey })
  }
  return out
}

/** T-194: an answer typed on site that is not what the scan measured (the typed number is used) */
export interface ScanDifference {
  fieldId: string
  typed: number
  scanned: number
  measure: ScanMeasure
}

/**
 * T-194 (AD-028): the order of trust for one quantity on a quote the business made on site.
 *   1. a number the business typed: always used, even when the scan says otherwise (`differences`);
 *   2. the room scan: fills what was left blank, and is credited where the typed number is the scan's own;
 *   3. the customer's answer: a scan is only ever made by the business, so a customer's quote has none,
 *      and its answers are untouched (the worker honours a scan only on a quote the app made);
 *   4. photo measurement: a quantity in the answers is never measured from photos
 *      (`humanStatedQuantityKeys` in the worker), so a scanned one never is.
 * Pure: returns the answers to price from (`{fieldId, value}` only), which of them the scan gave, and
 * where a typed number and the scan differ.
 */
export function mergeScanAnswers(
  answers: ReadonlyArray<{ fieldId: string; value: unknown }>,
  filled: readonly ScanAnswer[]
): { answers: Array<{ fieldId: string; value: unknown }>; scanned: Map<string, ScanMeasure>; differences: ScanDifference[] } {
  let out = answers.map((a) => ({ fieldId: a.fieldId, value: a.value }))
  const scanned = new Map<string, ScanMeasure>()
  const differences: ScanDifference[] = []
  for (const answer of filled) {
    const existing = out.find((a) => a.fieldId === answer.fieldId)
    const blank = !existing || existing.value === undefined || existing.value === null || String(existing.value).trim() === ''
    if (blank) {
      out = [...out.filter((a) => a.fieldId !== answer.fieldId), { fieldId: answer.fieldId, value: answer.value }]
      scanned.set(answer.fieldId, answer.measure)
      continue
    }
    const typed = Number(String(existing.value).replace(/,/g, ''))
    if (typed === answer.value) scanned.set(answer.fieldId, answer.measure)
    else if (Number.isFinite(typed)) differences.push({ fieldId: answer.fieldId, typed, scanned: answer.value, measure: answer.measure })
  }
  return { answers: out, scanned, differences }
}

/**
 * T-194: each measure in plain words, as the service editor offers them ("When you scan on site, fill
 * this from:") and as the app explains a difference. `perimeter` is the length of the walls.
 */
export const SCAN_MEASURE_WORDS: Record<ScanMeasure, string> = {
  wall_area_net: 'Wall area less doors and windows',
  wall_area_gross: 'Wall area',
  ceiling_area: 'Ceiling area',
  floor_area: 'Floor area',
  perimeter: 'Wall length',
  door_count: 'Doors',
  window_count: 'Windows',
  room_count: 'Rooms',
}

/** The kind of quantity a measure is: a count, an area, or a length (AD-030 converts the last two) */
export function scanMeasureKind(measure: ScanMeasure): 'count' | 'area' | 'length' {
  if (measure === 'perimeter') return 'length'
  if (measure === 'room_count' || measure === 'door_count' || measure === 'window_count') return 'count'
  return 'area'
}

/** Customer-facing audit line for a scanned quantity */
export function scanEvidence(summary: RoomScanSummary, device?: string): string {
  return `Scanned on site with LiDAR${device ? ` (${device})` : ''}: ${summary.rooms} room${summary.rooms === 1 ? '' : 's'}`
}

/**
 * T-194: the scan's sentence for the app when a typed number and the scan differ. The typed number is used.
 * "The scan covers 1 room. You entered 2."
 */
export function scanDifferenceLine(d: ScanDifference, unitLabel?: string): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US')
  if (d.measure === 'room_count') return `The scan covers ${n(d.scanned)} room${d.scanned === 1 ? '' : 's'}. You entered ${n(d.typed)}.`
  const unit = unitLabel ? ` ${unitLabel}` : ''
  return `The scan measured ${n(d.scanned)}${unit} (${SCAN_MEASURE_WORDS[d.measure].toLowerCase()}). You entered ${n(d.typed)}${unit}.`
}

/**
 * T-194: can the business still scan this quote again, or add an area? Until it is approved: a quote the
 * business made waits for its approval (pending_review), or for its own answers (awaiting_clarification).
 * After approval the customer has the quote, and its sizes stay as they were sent.
 */
export function canScanAgain(quote: { status: string; approvedAt?: string | null }): boolean {
  return !quote.approvedAt && (quote.status === 'pending_review' || quote.status === 'awaiting_clarification')
}
