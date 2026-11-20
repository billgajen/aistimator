/**
 * T-193: what a room scan measured, in the business's units — one summary
 * for every screen that shows a scan (the app straight after scanning, the
 * app's quote screen, the dashboard, the approval page, the customer's quote
 * page and the PDF), and the floor plan they all draw.
 *
 * The areas come from `summarizeRoomScan` (room-scan.ts), the same figures
 * that price the quote, so what a screen says was measured is what was
 * priced. Pure: no IO, no trade knowledge.
 *
 * T-194: a scan is an area (a room, a floor, or the whole house) covering a
 * number of rooms. The walls are shown as a person would draw them: pieces
 * that run on in one line are one wall, tiny returns are grouped, and the
 * walls are lettered round the space (the plan shows the same letters). The
 * ceiling height is the most common wall height, not the tallest. All of it
 * is display: every total and every priced quantity is exactly as before,
 * and it is worked out from the stored geometry, so older scans read better
 * too. Which sizes priced the quote is said by one function
 * (`scanPricedLines`), read from the quote's own lines.
 */

import { formatNumber } from './format'
import { CUSTOMER_METHOD } from './quantity-source'
import type { UnitSystem } from './regions/types'
import {
  parseRoomScan,
  roomsCoveredBy,
  summarizeRoomScan,
  ROOM_SCAN_FIELD,
  SCAN_MEASURES,
  type PlanPoint,
  type RoomScanOpening,
  type RoomScanPayload,
  type RoomScanRoom,
  type ScanMeasure,
} from './room-scan'
import { fromCanonical, normalizeUnit, unitDisplayLabel } from './units'

// ---------------------------------------------------------------------------
// Units: one function decides them, from the business's region
// ---------------------------------------------------------------------------

export interface ScanUnits {
  system: UnitSystem
  /** Unit ids (units.ts) */
  area: 'sqft' | 'sqm'
  length: 'ft' | 'm'
  /** What a person reads after the number */
  areaLabel: string
  lengthLabel: string
}

/** sq ft and ft for an imperial business, m² and m for a metric one */
export function scanUnits(system: UnitSystem): ScanUnits {
  return system === 'imperial'
    ? { system, area: 'sqft', length: 'ft', areaLabel: 'sq ft', lengthLabel: 'ft' }
    : { system, area: 'sqm', length: 'm', areaLabel: 'm²', lengthLabel: 'm' }
}

const one = (n: number) => Math.round(n * 10) / 10
const toArea = (sqm: number, units: ScanUnits) => one(fromCanonical(sqm, 'area', units.area) ?? sqm)
const toLength = (m: number, units: ScanUnits) => one(fromCanonical(m, 'length', units.length) ?? m)

export function formatScanArea(value: number, units: ScanUnits, locale = 'en-US'): string {
  return `${formatNumber(value, locale, 1)} ${units.areaLabel}`
}

export function formatScanLength(value: number, units: ScanUnits, locale = 'en-US'): string {
  return `${formatNumber(value, locale, 1)} ${units.lengthLabel}`
}

/** "3.6 × 2.4 m" */
export function formatScanSize(width: number, height: number, units: ScanUnits, locale = 'en-US'): string {
  return `${formatNumber(width, locale, 1)} × ${formatNumber(height, locale, 1)} ${units.lengthLabel}`
}

export type ScanOpeningType = RoomScanOpening['type']

/** "Door 0.9 × 2 m" style words for an opening type */
export const OPENING_WORDS: Record<ScanOpeningType, string> = { door: 'Door', window: 'Window', opening: 'Opening' }

// ---------------------------------------------------------------------------
// The walls as a person reads them (T-194). Display only.
// ---------------------------------------------------------------------------

/** Walls shorter than this are returns round a corner or a pillar, grouped rather than lettered (metres) */
export const SMALL_RETURN_M = 0.3

/** How close two pieces must be to be one wall: same height, same line, end to end (metres, and the sine of the angle) */
const JOIN = { heightM: 0.05, gapM: 0.1, offLineM: 0.05, sinAngle: 0.035 }

type Located = { start: PlanPoint; end: PlanPoint }

/** One wall as shown: pieces that run on in one line are joined; `letter` is null for a small return */
export interface LaidOutWall {
  letter: string | null
  widthM: number
  heightM: number
  start?: PlanPoint
  end?: PlanPoint
}

export interface WallLayout {
  /** In the order round the space, lettered A, B, C… (small returns are in the order too, unlettered) */
  walls: LaidOutWall[]
  /** The angle the plan is turned by so its longest wall is level (radians) */
  turn: number
  openings: Array<RoomScanOpening & Partial<Located>>
}

const sub = (a: PlanPoint, b: PlanPoint): PlanPoint => [a[0] - b[0], a[1] - b[1]]
const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])
const located = <T extends { start?: PlanPoint; end?: PlanPoint }>(w: T): w is T & Located => Boolean(w.start && w.end)

/** A, B … Z, AA, AB … */
export function wallLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** Two pieces of wall that are one wall: same height, in one line, meeting end to end. The joined wall, or null. */
function joinPair(a: LaidOutWall & Located, b: LaidOutWall & Located): (LaidOutWall & Located) | null {
  if (Math.abs(a.heightM - b.heightM) > JOIN.heightM) return null
  const da = sub(a.end, a.start)
  const db = sub(b.end, b.start)
  const la = Math.hypot(da[0], da[1])
  const lb = Math.hypot(db[0], db[1])
  if (la === 0 || lb === 0) return null
  if (Math.abs((da[0] * db[1] - da[1] * db[0]) / (la * lb)) > JOIN.sinAngle) return null
  // the ends that meet, and the far ends
  const pairs: Array<[PlanPoint, PlanPoint, PlanPoint, PlanPoint]> = [
    [a.end, b.start, a.start, b.end],
    [a.end, b.end, a.start, b.start],
    [a.start, b.start, a.end, b.end],
    [a.start, b.end, a.end, b.start],
  ]
  const [p, q, farA, farB] = pairs.reduce((best, c) => (dist(c[0], c[1]) < dist(best[0], best[1]) ? c : best))
  if (dist(p, q) > JOIN.gapM) return null
  // in one line: b's far end sits on a's line
  const off = Math.abs((da[0] * (farB[1] - a.start[1]) - da[1] * (farB[0] - a.start[0])) / la)
  if (off > JOIN.offLineM) return null
  // running on, not doubling back over each other
  const outA = sub(farA, p)
  const outB = sub(farB, q)
  if (outA[0] * outB[0] + outA[1] * outB[1] >= 0) return null
  const widthM = a.widthM + b.widthM
  return { letter: null, widthM, heightM: (a.widthM * a.heightM + b.widthM * b.heightM) / widthM, start: farA, end: farB }
}

const turnPoint = (p: PlanPoint, angle: number): PlanPoint => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}

/**
 * The walls of one scanned area as a person reads them, and the turn that puts its longest wall level.
 * Joined walls keep the summed width of their pieces, so the lengths add up to the same wall length.
 * Pure.
 */
export function wallLayout(room: RoomScanRoom): WallLayout {
  // 1. join pieces that run on in one line
  let pieces: Array<LaidOutWall & Located> = room.walls.filter(located).map((w) => ({ letter: null, widthM: w.widthM, heightM: w.heightM, start: w.start, end: w.end }))
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const joined = joinPair(pieces[i]!, pieces[j]!)
        if (joined) {
          pieces = [...pieces.slice(0, i), joined, ...pieces.slice(i + 1, j), ...pieces.slice(j + 1)]
          merged = true
          break outer
        }
      }
    }
  }
  // 2. turn the plan so its longest wall is level
  const longest = pieces.reduce<(LaidOutWall & Located) | null>((best, w) => (!best || dist(w.start, w.end) > dist(best.start, best.end) ? w : best), null)
  const turn = longest ? -Math.atan2(longest.end[1] - longest.start[1], longest.end[0] - longest.start[0]) : 0
  pieces = pieces.map((w) => ({ ...w, start: turnPoint(w.start, turn), end: turnPoint(w.end, turn) }))
  const openings = room.openings.map((o) => (located(o) ? { ...o, start: turnPoint(o.start, turn), end: turnPoint(o.end, turn) } : o))

  // 3. round the space: from the top wall, clockwise, each next wall the one that starts nearest where the last ended
  const ordered: Array<LaidOutWall & Located> = []
  const left = [...pieces]
  let exit: PlanPoint | null = null
  while (left.length > 0) {
    let index = 0
    if (exit === null) {
      // the top wall (smallest z on the plan), then its right-hand end
      index = left.reduce((best, w, i) => (Math.min(w.start[1], w.end[1]) + 1e-6 < Math.min(left[best]!.start[1], left[best]!.end[1]) ? i : best), 0)
      const w = left[index]!
      const flipped = w.start[0] > w.end[0]
      ordered.push(flipped ? { ...w, start: w.end, end: w.start } : w)
    } else {
      const from: PlanPoint = exit
      index = left.reduce((best, w, i) => (Math.min(dist(from, w.start), dist(from, w.end)) < Math.min(dist(from, left[best]!.start), dist(from, left[best]!.end)) ? i : best), 0)
      const w = left[index]!
      ordered.push(dist(from, w.end) < dist(from, w.start) ? { ...w, start: w.end, end: w.start } : w)
    }
    left.splice(index, 1)
    exit = ordered[ordered.length - 1]!.end
  }
  // walls without positions (a scan before T-193) keep their own order
  const all: LaidOutWall[] = [...ordered, ...room.walls.filter((w) => !located(w)).map((w) => ({ letter: null, widthM: w.widthM, heightM: w.heightM }))]
  let next = 0
  return {
    walls: all.map((w) => ({ ...w, letter: w.widthM < SMALL_RETURN_M ? null : wallLetter(next++) })),
    turn,
    openings,
  }
}

/**
 * The ceiling height: the wall height that most of the wall area has (heights within 5 cm count as one),
 * not the tallest wall, which is often a stairwell. `tallest` is given only when a wall is clearly
 * taller (it matters for access). Metres; null when nothing is known.
 */
export function ceilingHeightOf(room: RoomScanRoom): { ceilingM: number | null; tallestM: number | null } {
  if (room.walls.length === 0) return { ceilingM: room.ceilingHeightM && room.ceilingHeightM > 0 ? room.ceilingHeightM : null, tallestM: null }
  const buckets = new Map<number, { area: number; heightArea: number }>()
  for (const w of room.walls) {
    const key = Math.round(w.heightM / 0.05)
    const b = buckets.get(key) ?? { area: 0, heightArea: 0 }
    b.area += w.widthM * w.heightM
    b.heightArea += w.widthM * w.heightM * w.heightM
    buckets.set(key, b)
  }
  const best = [...buckets.values()].reduce((a, b) => (b.area > a.area ? b : a))
  const ceilingM = best.heightArea / best.area
  const tallest = Math.max(...room.walls.map((w) => w.heightM))
  return { ceilingM, tallestM: tallest - ceilingM >= 0.1 ? tallest : null }
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export interface ScanWallReport {
  /** "A"; null for a small return (counted in `smallReturns`, not listed) */
  letter: string
  width: number
  height: number
}

export interface ScanRoomReport {
  /** The area's name: "Ground floor", "Kitchen" */
  name: string
  /** T-194: the rooms this scan covers (1 for a scan made before areas) */
  roomsCovered: number
  /** In `units.area`; null when the scan found no floor */
  floorArea: number | null
  wallAreaGross: number
  /** Walls less their doors, windows and openings */
  wallAreaNet: number
  /** In `units.length`: the most common wall height (ceilingHeightOf); null when unknown */
  ceilingHeight: number | null
  /** The tallest wall, only when it is clearly taller than the ceiling height */
  tallestWall: number | null
  /** The length of all the walls (was "Perimeter") */
  wallLength: number
  /** Less the width of the doors and open passages (for skirting and trim) */
  wallLengthLessDoors: number
  /** Lettered round the space; small returns are not listed (`smallReturns`) */
  walls: ScanWallReport[]
  smallReturns: { count: number; length: number } | null
  openings: Array<{ type: ScanOpeningType; width: number; height: number }>
  doors: number
  windows: number
  /** The scan has the walls' positions, so a floor plan can be drawn (scans since T-193) */
  hasPlan: boolean
  /** The area's 3D model, when one was uploaded */
  modelId?: string
}

export interface ScanReport {
  units: ScanUnits
  rooms: ScanRoomReport[]
  /** The whole job: every area added up */
  total: {
    /** How many scans (areas) */
    areas: number
    /** The rooms they cover (what `room_count` is filled with) */
    rooms: number
    floorArea: number | null
    wallAreaGross: number
    wallAreaNet: number
    wallLength: number
    wallLengthLessDoors: number
    doors: number
    windows: number
  }
}

/** A scanned area's name as people read it: its own, or "Room 2" by its place in the scan */
export function scanRoomName(room: RoomScanRoom, index: number): string {
  return room.name?.trim() || `Room ${index + 1}`
}

export function hasFloorPlan(room: RoomScanRoom): boolean {
  return room.walls.filter((w) => w.start && w.end).length >= 2
}

/** Doors and open passages: no skirting runs across them */
const doorwayWidth = (room: RoomScanRoom) => room.openings.filter((o) => o.type !== 'window').reduce((sum, o) => sum + o.widthM, 0)

/** Per area and for the whole job, in the business's units. Pure. */
export function roomScanReport(scan: RoomScanPayload, system: UnitSystem): ScanReport {
  const units = scanUnits(system)
  const rooms: ScanRoomReport[] = scan.rooms.map((room, i) => {
    const s = summarizeRoomScan({ version: 1, rooms: [room] })
    const { ceilingM, tallestM } = ceilingHeightOf(room)
    const layout = wallLayout(room)
    const small = layout.walls.filter((w) => w.letter === null)
    return {
      name: scanRoomName(room, i),
      roomsCovered: roomsCoveredBy(room),
      floorArea: s.floorAreaSqm > 0 ? toArea(s.floorAreaSqm, units) : null,
      wallAreaGross: toArea(s.wallAreaGrossSqm, units),
      wallAreaNet: toArea(s.wallAreaNetSqm, units),
      ceilingHeight: ceilingM === null ? null : toLength(ceilingM, units),
      tallestWall: tallestM === null ? null : toLength(tallestM, units),
      wallLength: toLength(s.perimeterM, units),
      wallLengthLessDoors: toLength(Math.max(0, s.perimeterM - doorwayWidth(room)), units),
      walls: layout.walls.filter((w): w is LaidOutWall & { letter: string } => w.letter !== null).map((w) => ({ letter: w.letter, width: toLength(w.widthM, units), height: toLength(w.heightM, units) })),
      smallReturns: small.length > 0 ? { count: small.length, length: toLength(small.reduce((sum, w) => sum + w.widthM, 0), units) } : null,
      openings: room.openings.map((o) => ({ type: o.type, width: toLength(o.widthM, units), height: toLength(o.heightM, units) })),
      doors: s.doors,
      windows: s.windows,
      hasPlan: hasFloorPlan(room),
      ...(room.modelId && { modelId: room.modelId }),
    }
  })
  const all = summarizeRoomScan(scan)
  const doorways = scan.rooms.reduce((sum, r) => sum + doorwayWidth(r), 0)
  return {
    units,
    rooms,
    total: {
      areas: scan.rooms.length,
      rooms: all.rooms,
      floorArea: all.floorAreaSqm > 0 ? toArea(all.floorAreaSqm, units) : null,
      wallAreaGross: toArea(all.wallAreaGrossSqm, units),
      wallAreaNet: toArea(all.wallAreaNetSqm, units),
      wallLength: toLength(all.perimeterM, units),
      wallLengthLessDoors: toLength(Math.max(0, all.perimeterM - doorways), units),
      doors: all.doors,
      windows: all.windows,
    },
  }
}

/** The scan stored with a request (its `_room_scan` answer), checked again; null when there is none */
export function roomScanOfAnswers(jobAnswers: unknown): RoomScanPayload | null {
  if (!Array.isArray(jobAnswers)) return null
  const answer = jobAnswers.find((a) => a && typeof a === 'object' && (a as { fieldId?: unknown }).fieldId === ROOM_SCAN_FIELD) as { value?: unknown } | undefined
  if (!answer) return null
  const parsed = parseRoomScan(answer.value)
  return parsed.ok ? parsed.scan : null
}

// ---------------------------------------------------------------------------
// Which sizes priced the quote (T-194): one answer, read from the quote's lines
// ---------------------------------------------------------------------------

/** A price line whose quantity the room scan gave */
export interface ScanPricedLine {
  item: string
  quantity: number | null
  /** The line's own unit ("room", "sqft") */
  unit: string | null
  /** Which size it was; null on a line priced before T-194 */
  measure: ScanMeasure | null
}

export interface ScanPricing {
  /** 'scan': the scan set at least one line; 'none': the quote is priced and no line used it; 'unknown': not priced yet */
  kind: 'scan' | 'none' | 'unknown'
  lines: ScanPricedLine[]
  /** The card's sentence, in plain words; null while the quote is not priced */
  sentence: string | null
}

const isMeasure = (v: unknown): v is ScanMeasure => typeof v === 'string' && (SCAN_MEASURES as readonly string[]).includes(v)

/** "2 rooms", "344.4 sq ft" */
export function scanQuantityWords(quantity: number, unit: string | null, locale = 'en-US'): string {
  const figure = formatNumber(quantity, locale, 1)
  if (!unit) return figure
  if (normalizeUnit(unit)) return `${figure} ${unitDisplayLabel(unit)}`
  const word = unit.trim()
  return `${figure} ${quantity === 1 || /s$/i.test(word) ? word : `${word}s`}`
}

/**
 * Which of the scan's sizes set a price line on this quote, from the quote's takeoff (its lines with
 * their sources, T-183). The one place that says it: the business's card and the customer's block both
 * read it, so neither says the sizes priced a quote they did not.
 */
export function scanPricedLines(takeoff: unknown, locale = 'en-US'): ScanPricing {
  if (!Array.isArray(takeoff) || takeoff.length === 0) return { kind: 'unknown', lines: [], sentence: null }
  const lines: ScanPricedLine[] = takeoff
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .filter((row) => row.source === 'scan' || (row.source === undefined && row.method === CUSTOMER_METHOD.scan))
    .map((row) => ({
      item: typeof row.item === 'string' ? row.item : '',
      quantity: typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : null,
      unit: typeof row.unit === 'string' && row.unit.trim() ? row.unit : null,
      measure: isMeasure(row.scanMeasure) ? row.scanMeasure : null,
    }))
  if (lines.length === 0) {
    return { kind: 'none', lines, sentence: 'The price does not depend on these sizes. They are here for planning the job.' }
  }
  const parts = lines.map((l) => (l.quantity === null ? l.item : `${l.item}, ${scanQuantityWords(l.quantity, l.unit, locale)}`))
  return { kind: 'scan', lines, sentence: `These sizes priced the quote: ${parts.join('; ')}.` }
}

// ---------------------------------------------------------------------------
// What each screen is given
// ---------------------------------------------------------------------------

/** The business's view of one area: every figure, the plan, and the model when there is one */
export interface ScanRoomView extends ScanRoomReport {
  /** The floor plan as an SVG document (floorPlanSvg); absent for a scan with no positions */
  planSvg?: string
}

export interface RoomScanView {
  units: ScanUnits
  rooms: ScanRoomView[]
  total: ScanReport['total']
  /** T-194: which sizes priced the quote (absent where the quote's lines are not known, as straight after a scan) */
  pricing?: ScanPricing
}

/** One figure the customer is shown */
export interface CustomerScanFigure {
  label: string
  value: string
}

/**
 * The customer's view of one area: its name, the plan and the model, and only the sizes that priced the
 * quote (T-194). Where none did, the wall area and ceiling height. No wall-by-wall list.
 */
export interface CustomerScanRoom {
  name: string
  roomsCovered: number
  figures: CustomerScanFigure[]
  planSvg?: string
  modelId?: string
}

export interface CustomerRoomScanView {
  rooms: CustomerScanRoom[]
  /** The lines the scan priced, in words ("Interior painting, 2 rooms"); empty when none did */
  priced: string[]
}

export function roomScanView(scan: RoomScanPayload, system: UnitSystem, locale = 'en-US', opts: { takeoff?: unknown } = {}): RoomScanView {
  const report = roomScanReport(scan, system)
  return {
    units: report.units,
    total: report.total,
    rooms: report.rooms.map((room, i) => {
      const svg = floorPlanSvg(scan.rooms[i]!, system, { title: room.name, locale })
      return { ...room, ...(svg && { planSvg: svg }) }
    }),
    ...(opts.takeoff !== undefined && { pricing: scanPricedLines(opts.takeoff, locale) }),
  }
}

/** One area's figure for a size the quote was priced by */
function figureFor(room: ScanRoomView, measure: ScanMeasure, units: ScanUnits, locale: string): CustomerScanFigure | null {
  switch (measure) {
    case 'room_count':
      return { label: 'Rooms', value: formatNumber(room.roomsCovered, locale, 0) }
    case 'wall_area_net':
      return { label: 'Wall area less doors and windows', value: formatScanArea(room.wallAreaNet, units, locale) }
    case 'wall_area_gross':
      return { label: 'Wall area', value: formatScanArea(room.wallAreaGross, units, locale) }
    case 'floor_area':
      return room.floorArea === null ? null : { label: 'Floor area', value: formatScanArea(room.floorArea, units, locale) }
    case 'ceiling_area':
      return room.floorArea === null ? null : { label: 'Ceiling area', value: formatScanArea(room.floorArea, units, locale) }
    case 'perimeter':
      return { label: 'Wall length', value: formatScanLength(room.wallLength, units, locale) }
    case 'door_count':
      return { label: 'Doors', value: formatNumber(room.doors, locale, 0) }
    case 'window_count':
      return { label: 'Windows', value: formatNumber(room.windows, locale, 0) }
    default:
      return null
  }
}

export function customerRoomScanView(scan: RoomScanPayload, system: UnitSystem, locale = 'en-US', opts: { takeoff?: unknown } = {}): CustomerRoomScanView {
  const view = roomScanView(scan, system, locale, { takeoff: opts.takeoff ?? [] })
  const pricing = view.pricing!
  const measures = [...new Set(pricing.lines.map((l) => l.measure).filter((m): m is ScanMeasure => m !== null))]
  return {
    priced: pricing.lines.map((l) => (l.quantity === null ? l.item : `${l.item}, ${scanQuantityWords(l.quantity, l.unit, locale)}`)),
    rooms: view.rooms.map((room) => {
      // the sizes that priced the quote; where none did (or it is not known which), the walls and the ceiling height
      const priced = measures.map((m) => figureFor(room, m, view.units, locale)).filter((f): f is CustomerScanFigure => f !== null)
      const figures =
        priced.length > 0
          ? priced
          : [
              { label: 'Wall area', value: formatScanArea(room.wallAreaNet, view.units, locale) },
              ...(room.ceilingHeight === null ? [] : [{ label: 'Ceiling height', value: formatScanLength(room.ceilingHeight, view.units, locale) }]),
            ]
      return {
        name: room.name,
        roomsCovered: room.roomsCovered,
        figures,
        ...(room.planSvg && { planSvg: room.planSvg }),
        ...(room.modelId && { modelId: room.modelId }),
      }
    }),
  }
}

/** "Covers 2 rooms" (nothing for one room) */
export function roomsCoveredWords(n: number): string | null {
  return n > 1 ? `Covers ${n} rooms` : null
}

// ---------------------------------------------------------------------------
// The floor plan: top-down, walls lettered with their lengths, doors and windows marked
// ---------------------------------------------------------------------------

/** The plan's colours, all design tokens: ink walls, juniper doors, tertiary (amber ink) windows */
export const PLAN_COLOR = {
  wall: '#1B2823',
  label: '#4F5D57',
  letter: '#1B2823',
  door: '#205E56',
  window: '#7F5710',
  /** an open passage is a gap in the wall (the page's own paper) with a dashed line across it */
  opening: '#FFFFFF',
  openingMark: '#808781',
} as const

/**
 * T-194: the 3D viewer's colours, design tokens as numbers for three.js: an ink stage (the viewer is the
 * one place a model is shown, and a light model on a light page was lost), light walls with ink-grey
 * edges, a mint floor, the brand colour for doors and windows (the page's own `--color-primary` when it
 * has one), and furniture in the field grey.
 */
export const MODEL_COLOR = {
  stage: 0x1b2823,
  wall: 0xf4f1ea,
  edge: 0x4f5d57,
  floor: 0xdfede5,
  door: 0x205e56,
  window: 0x205e56,
  opening: 0xffffff,
  object: 0x808781,
} as const

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const n = (v: number) => (Math.round(v * 10) / 10).toString()
const FONT = `font-family="ui-sans-serif, -apple-system, 'Instrument Sans', Arial, sans-serif"`

/** A label's box on the plan, in drawing units */
export interface PlanLabelBox {
  x: number
  y: number
  w: number
  h: number
  text: string
}

/** Do two label boxes overlap (with a small margin)? */
export function labelsOverlap(a: PlanLabelBox, b: PlanLabelBox, margin = 2): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + margin
}

const textWidth = (text: string, size: number) => text.length * size * 0.58

/** Does a line from a to b pass through a label's box (Liang–Barsky)? */
export function lineCrossesBox(a: [number, number], b: [number, number], box: PlanLabelBox, margin = 2): boolean {
  const [x0, y0] = a
  const dx = b[0] - x0
  const dy = b[1] - y0
  const minX = box.x - box.w / 2 - margin
  const maxX = box.x + box.w / 2 + margin
  const minY = box.y - box.h / 2 - margin
  const maxY = box.y + box.h / 2 + margin
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [[-dx, x0 - minX], [dx, maxX - x0], [-dy, y0 - minY], [dy, maxY - y0]] as Array<[number, number]>) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

/**
 * The area seen from above, as a small SVG document: turned so its longest wall is level; each wall
 * drawn where it stands with its letter and length beside it (a short wall keeps its letter and drops its
 * length, so no two labels overlap); doors in juniper, windows in amber, open passages as dashed gaps;
 * and a key. Null when the scan has no positions (scans before T-193). Only numbers, letters and the
 * escaped name go in, so the string is safe to put in a page. `labels` (when asked) returns the label
 * boxes, for the tests.
 */
export function floorPlanSvg(
  room: RoomScanRoom,
  system: UnitSystem,
  opts: { title?: string; locale?: string; size?: number; labels?: PlanLabelBox[] } = {}
): string | null {
  if (!hasFloorPlan(room)) return null
  const units = scanUnits(system)
  const layout = wallLayout(room)
  const walls = layout.walls.filter(located)
  const openings = layout.openings.filter(located)
  const points = [...walls.flatMap((w) => [w.start, w.end]), ...openings.flatMap((o) => [o.start, o.end])]
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const spanX = Math.max(...xs) - minX
  const spanZ = Math.max(...zs) - minZ
  const drawing = opts.size ?? 320
  const scale = drawing / Math.max(spanX, spanZ, 0.5)
  const x = (v: number) => (v - minX) * scale
  const y = (v: number) => (v - minZ) * scale
  const centre: PlanPoint = [xs.reduce((a, b) => a + b, 0) / xs.length, zs.reduce((a, b) => a + b, 0) / zs.length]

  // Is a point on the floor inside the area? A ray to the right crosses its walls an odd number of times.
  const inside = (px: number, pz: number) => {
    let crossings = 0
    for (const w of walls) {
      const [ax, az] = w.start
      const [bx, bz] = w.end
      if (az > pz !== bz > pz && px < ax + ((pz - az) * (bx - ax)) / (bz - az)) crossings += 1
    }
    return crossings % 2 === 1
  }

  // Labels: letter and length outside the wall; further out, or the letter alone, until it clashes with none
  const size = 14
  const placed: PlanLabelBox[] = []
  const drawnWalls = walls.map((w) => [[x(w.start[0]), y(w.start[1])], [x(w.end[0]), y(w.end[1])]] as [[number, number], [number, number]])
  const clear = (box: PlanLabelBox) => !placed.some((p) => labelsOverlap(p, box)) && !drawnWalls.some(([a, b]) => lineCrossesBox(a, b, box))
  const labelMarks: string[] = []
  for (const w of walls) {
    if (!w.letter) continue
    const mx = (w.start[0] + w.end[0]) / 2
    const mz = (w.start[1] + w.end[1]) / 2
    const dx = w.end[0] - w.start[0]
    const dz = w.end[1] - w.start[1]
    const len = Math.hypot(dx, dz) || 1
    let nx = -dz / len
    let nz = dx / len
    const step = 0.15
    const outward = !inside(mx + nx * step, mz + nz * step)
    const otherOut = !inside(mx - nx * step, mz - nz * step)
    if ((!outward && otherOut) || (outward === otherOut && nx * (centre[0] - mx) + nz * (centre[1] - mz) > 0)) {
      nx = -nx
      nz = -nz
    }
    const full = `${w.letter}  ${formatScanLength(toLength(w.widthM, units), units, opts.locale)}`
    const drawnLength = len * scale
    // a wall too short on the drawing for its length to sit beside it keeps only its letter
    const texts = textWidth(full, size) <= drawnLength + 12 ? [full, w.letter] : [w.letter]
    let chosen: PlanLabelBox | null = null
    for (const text of texts) {
      const tw = textWidth(text, size)
      // beside the middle of the wall, then further out, then slid along it
      for (let k = 0; k < 8 && !chosen; k++) {
        for (const slide of [0, -0.25, 0.25]) {
          const away = 10 + k * 9 + Math.abs(nx) * tw * 0.5 + Math.abs(nz) * size * 0.5
          const box = { x: x(mx + dx * slide) + nx * away, y: y(mz + dz * slide) + nz * away, w: tw, h: size + 2, text }
          if (clear(box)) {
            chosen = box
            break
          }
        }
      }
      if (chosen) break
    }
    if (!chosen) {
      // crowded on all sides: the letter alone, pushed out until it is clear
      const tw = textWidth(w.letter, size)
      for (let k = 8; !chosen; k++) {
        const box = { x: x(mx) + nx * (10 + k * 9), y: y(mz) + nz * (10 + k * 9), w: tw, h: size + 2, text: w.letter }
        if (clear(box) || (k > 60 && !placed.some((p) => labelsOverlap(p, box))) || k > 120) chosen = box
      }
    }
    placed.push(chosen)
    const [letter, ...rest] = chosen.text.split('  ')
    labelMarks.push(
      `<text x="${n(chosen.x)}" y="${n(chosen.y)}" font-size="${size}" ${FONT} text-anchor="middle" dominant-baseline="middle"><tspan fill="${PLAN_COLOR.letter}" font-weight="700">${esc(letter!)}</tspan>${rest.length ? `<tspan fill="${PLAN_COLOR.label}"> ${esc(rest.join(' '))}</tspan>` : ''}</text>`
    )
  }
  if (opts.labels) opts.labels.push(...placed)

  const wallLines = walls
    .map((w) => `<line x1="${n(x(w.start[0]))}" y1="${n(y(w.start[1]))}" x2="${n(x(w.end[0]))}" y2="${n(y(w.end[1]))}" stroke="${PLAN_COLOR.wall}" stroke-width="5" stroke-linecap="square"/>`)
    .join('')
  const openingLines = openings
    .map((o) => {
      const line = (colour: string, width: number, extra = '') =>
        `<line x1="${n(x(o.start[0]))}" y1="${n(y(o.start[1]))}" x2="${n(x(o.end[0]))}" y2="${n(y(o.end[1]))}" stroke="${colour}" stroke-width="${width}" stroke-linecap="butt"${extra}/>`
      if (o.type === 'opening') return line(PLAN_COLOR.opening, 7) + line(PLAN_COLOR.openingMark, 1.5, ' stroke-dasharray="3 3"')
      return line(o.type === 'door' ? PLAN_COLOR.door : PLAN_COLOR.window, 7)
    })
    .join('')

  // The drawing and its labels, with a margin, from the top left
  const margin = 10
  const boxes = [...placed.map((p) => [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2]), [0, 0, spanX * scale, spanZ * scale]]
  const left = Math.min(...boxes.map((b) => b[0]!)) - margin
  const top = Math.min(...boxes.map((b) => b[1]!)) - margin
  const right = Math.max(...boxes.map((b) => b[2]!)) + margin
  const bottom = Math.max(...boxes.map((b) => b[3]!)) + margin
  const has = (type: ScanOpeningType) => openings.some((o) => o.type === type)
  const keyItems: Array<[ScanOpeningType, string]> = (['door', 'window', 'opening'] as const).filter(has).map((t) => [t, OPENING_WORDS[t]])
  const key = keyItems.length > 0 ? 28 : 0
  const width = Math.max(right - left, keyItems.length * 92 + margin * 2)
  const height = bottom - top + key
  const keyY = bottom - top + key / 2
  const keyMarks = keyItems
    .map(([type, word], i) => {
      const kx = margin + i * 92
      const swatch =
        type === 'opening'
          ? `<line x1="${kx}" y1="${n(keyY)}" x2="${kx + 18}" y2="${n(keyY)}" stroke="${PLAN_COLOR.openingMark}" stroke-width="1.5" stroke-dasharray="3 3"/>`
          : `<rect x="${kx}" y="${n(keyY - 3)}" width="18" height="6" fill="${type === 'door' ? PLAN_COLOR.door : PLAN_COLOR.window}"/>`
      return `${swatch}<text x="${kx + 24}" y="${n(keyY)}" fill="${PLAN_COLOR.label}" font-size="${size}" ${FONT} dominant-baseline="middle">${word}</text>`
    })
    .join('')
  const name = esc(`Floor plan${opts.title ? ` of ${opts.title}` : ''}`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}" role="img" aria-label="${name}">` +
    `<title>${name}</title>` +
    `<g transform="translate(${n(-left)} ${n(-top)})">` +
    wallLines +
    openingLines +
    labelMarks.join('') +
    `</g>` +
    keyMarks +
    `</svg>`
  )
}
