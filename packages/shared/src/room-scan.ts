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

export interface RoomScanWall {
  widthM: number
  heightM: number
}

export interface RoomScanOpening {
  type: 'door' | 'window' | 'opening'
  widthM: number
  heightM: number
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
      cleanWalls.push({ widthM: w.widthM as number, heightM: w.heightM as number })
    }
    const cleanOpenings: RoomScanOpening[] = []
    for (const o of openings as Array<Record<string, unknown>>) {
      const type = o?.type === 'door' || o?.type === 'window' || o?.type === 'opening' ? o.type : null
      if (!type || !dim(o.widthM) || !dim(o.heightM)) return { ok: false, error: `room ${i + 1} has an invalid opening` }
      cleanOpenings.push({ type, widthM: o.widthM as number, heightM: o.heightM as number })
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

/** Totals across every scanned room (metric). Pure. */
export function summarizeRoomScan(scan: RoomScanPayload): RoomScanSummary {
  let gross = 0
  let openingArea = 0
  let floor = 0
  let perimeter = 0
  let doors = 0
  let windows = 0
  for (const room of scan.rooms) {
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
    rooms: scan.rooms.length,
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
    out.push({ fieldId, value })
  }
  return out
}

/** Customer-facing audit line for a scanned quantity */
export function scanEvidence(summary: RoomScanSummary, device?: string): string {
  return `Scanned on site with LiDAR${device ? ` (${device})` : ''}: ${summary.rooms} room${summary.rooms === 1 ? '' : 's'}`
}
