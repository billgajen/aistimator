/**
 * T-193: what a room scan measured, in the business's units — one summary
 * for every screen that shows a scan (the app straight after scanning, the
 * app's quote screen, the dashboard, the approval page, the customer's quote
 * page and the PDF), and the floor plan they all draw.
 *
 * The areas come from `summarizeRoomScan` (room-scan.ts), the same figures
 * that price the quote, so what a screen says was measured is what was
 * priced. Pure: no IO, no trade knowledge.
 */

import { formatNumber } from './format'
import type { UnitSystem } from './regions/types'
import { parseRoomScan, summarizeRoomScan, ROOM_SCAN_FIELD, type PlanPoint, type RoomScanOpening, type RoomScanPayload, type RoomScanRoom } from './room-scan'
import { fromCanonical } from './units'

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

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export type ScanOpeningType = RoomScanOpening['type']

export interface ScanRoomReport {
  name: string
  /** In `units.area`; null when the scan found no floor */
  floorArea: number | null
  wallAreaGross: number
  /** Walls less their doors, windows and openings */
  wallAreaNet: number
  /** In `units.length`; null when unknown */
  ceilingHeight: number | null
  perimeter: number
  walls: Array<{ width: number; height: number }>
  openings: Array<{ type: ScanOpeningType; width: number; height: number }>
  doors: number
  windows: number
  /** The scan has the walls' positions, so a floor plan can be drawn (scans since T-193) */
  hasPlan: boolean
  /** The room's 3D model, when one was uploaded */
  modelId?: string
}

export interface ScanReport {
  units: ScanUnits
  rooms: ScanRoomReport[]
  /** The whole job: every room added up */
  total: {
    rooms: number
    floorArea: number | null
    wallAreaGross: number
    wallAreaNet: number
    perimeter: number
    doors: number
    windows: number
  }
}

/** The tallest wall: RoomPlan's walls run floor to ceiling */
function ceilingOf(room: RoomScanRoom): number | null {
  if (room.ceilingHeightM && room.ceilingHeightM > 0) return room.ceilingHeightM
  const tallest = Math.max(0, ...room.walls.map((w) => w.heightM))
  return tallest > 0 ? tallest : null
}

/** A room's name as people read it: its own, or "Room 2" by its place in the scan */
export function scanRoomName(room: RoomScanRoom, index: number): string {
  return room.name?.trim() || `Room ${index + 1}`
}

export function hasFloorPlan(room: RoomScanRoom): boolean {
  return room.walls.filter((w) => w.start && w.end).length >= 2
}

/** Per room and for the whole job, in the business's units. Pure. */
export function roomScanReport(scan: RoomScanPayload, system: UnitSystem): ScanReport {
  const units = scanUnits(system)
  const rooms: ScanRoomReport[] = scan.rooms.map((room, i) => {
    const s = summarizeRoomScan({ version: 1, rooms: [room] })
    const ceiling = ceilingOf(room)
    return {
      name: scanRoomName(room, i),
      floorArea: s.floorAreaSqm > 0 ? toArea(s.floorAreaSqm, units) : null,
      wallAreaGross: toArea(s.wallAreaGrossSqm, units),
      wallAreaNet: toArea(s.wallAreaNetSqm, units),
      ceilingHeight: ceiling === null ? null : toLength(ceiling, units),
      perimeter: toLength(s.perimeterM, units),
      walls: room.walls.map((w) => ({ width: toLength(w.widthM, units), height: toLength(w.heightM, units) })),
      openings: room.openings.map((o) => ({ type: o.type, width: toLength(o.widthM, units), height: toLength(o.heightM, units) })),
      doors: s.doors,
      windows: s.windows,
      hasPlan: hasFloorPlan(room),
      ...(room.modelId && { modelId: room.modelId }),
    }
  })
  const all = summarizeRoomScan(scan)
  return {
    units,
    rooms,
    total: {
      rooms: all.rooms,
      floorArea: all.floorAreaSqm > 0 ? toArea(all.floorAreaSqm, units) : null,
      wallAreaGross: toArea(all.wallAreaGrossSqm, units),
      wallAreaNet: toArea(all.wallAreaNetSqm, units),
      perimeter: toLength(all.perimeterM, units),
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

/** "Door 0.9 × 2 m" style words for an opening type */
export const OPENING_WORDS: Record<ScanOpeningType, string> = { door: 'Door', window: 'Window', opening: 'Opening' }

/** "3.6 × 2.4 m" */
export function formatScanSize(width: number, height: number, units: ScanUnits, locale = 'en-US'): string {
  return `${formatNumber(width, locale, 1)} × ${formatNumber(height, locale, 1)} ${units.lengthLabel}`
}

// ---------------------------------------------------------------------------
// What each screen is given
// ---------------------------------------------------------------------------

/** The business's view of one room: every figure, the plan, and the model when there is one */
export interface ScanRoomView extends ScanRoomReport {
  /** The floor plan as an SVG document (floorPlanSvg); absent for a scan with no positions */
  planSvg?: string
}

export interface RoomScanView {
  units: ScanUnits
  rooms: ScanRoomView[]
  total: ScanReport['total']
}

/** The customer's view: each room's floor and wall area, the plan and the model. No wall-by-wall list. */
export interface CustomerScanRoom {
  name: string
  floorArea: string | null
  wallArea: string
  planSvg?: string
  modelId?: string
}

export interface CustomerRoomScanView {
  rooms: CustomerScanRoom[]
}

export function roomScanView(scan: RoomScanPayload, system: UnitSystem, locale = 'en-US'): RoomScanView {
  const report = roomScanReport(scan, system)
  return {
    units: report.units,
    total: report.total,
    rooms: report.rooms.map((room, i) => {
      const svg = floorPlanSvg(scan.rooms[i]!, system, { title: room.name, locale })
      return { ...room, ...(svg && { planSvg: svg }) }
    }),
  }
}

export function customerRoomScanView(scan: RoomScanPayload, system: UnitSystem, locale = 'en-US'): CustomerRoomScanView {
  const view = roomScanView(scan, system, locale)
  return {
    rooms: view.rooms.map((room) => ({
      name: room.name,
      floorArea: room.floorArea === null ? null : formatScanArea(room.floorArea, view.units, locale),
      wallArea: formatScanArea(room.wallAreaNet, view.units, locale),
      ...(room.planSvg && { planSvg: room.planSvg }),
      ...(room.modelId && { modelId: room.modelId }),
    })),
  }
}

// ---------------------------------------------------------------------------
// The floor plan: top-down, walls with their lengths, doors and windows marked
// ---------------------------------------------------------------------------

/** The plan's colours, all design tokens: ink walls, juniper doors, tertiary (amber ink) windows */
export const PLAN_COLOR = {
  wall: '#1B2823',
  label: '#4F5D57',
  door: '#205E56',
  window: '#7F5710',
  /** an open passage is a gap in the wall: the page's own paper */
  opening: '#FFFFFF',
} as const

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const n = (v: number) => (Math.round(v * 10) / 10).toString()

/**
 * The room seen from above, as a small SVG document: each wall drawn where it
 * stands with its length beside it, doors in juniper, windows in amber, open
 * passages as gaps, and a two-word key. Null when the scan has no positions
 * (scans before T-193). Only numbers and the escaped room name go in, so the
 * string is safe to put in a page.
 */
export function floorPlanSvg(room: RoomScanRoom, system: UnitSystem, opts: { title?: string; locale?: string; size?: number } = {}): string | null {
  if (!hasFloorPlan(room)) return null
  const units = scanUnits(system)
  const walls = room.walls.filter((w): w is typeof w & { start: PlanPoint; end: PlanPoint } => Boolean(w.start && w.end))
  const openings = room.openings.filter((o): o is typeof o & { start: PlanPoint; end: PlanPoint } => Boolean(o.start && o.end))
  const points = [...walls.flatMap((w) => [w.start, w.end]), ...openings.flatMap((o) => [o.start, o.end])]
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  const spanX = Math.max(...xs) - minX
  const spanZ = Math.max(...zs) - minZ
  const drawing = opts.size ?? 280
  const scale = drawing / Math.max(spanX, spanZ, 0.5)
  const pad = 56
  const key = 26
  const width = spanX * scale + pad * 2
  const height = spanZ * scale + pad * 2 + key
  const x = (v: number) => pad + (v - minX) * scale
  const y = (v: number) => pad + (v - minZ) * scale
  const centre: PlanPoint = [xs.reduce((a, b) => a + b, 0) / xs.length, zs.reduce((a, b) => a + b, 0) / zs.length]

  const wallLines = walls
    .map((w) => `<line x1="${n(x(w.start[0]))}" y1="${n(y(w.start[1]))}" x2="${n(x(w.end[0]))}" y2="${n(y(w.end[1]))}" stroke="${PLAN_COLOR.wall}" stroke-width="5" stroke-linecap="square"/>`)
    .join('')
  // Is a point on the floor inside the room? A ray to the right crosses its walls an odd number of times.
  const inside = (px: number, pz: number) => {
    let crossings = 0
    for (const w of walls) {
      const [ax, az] = w.start
      const [bx, bz] = w.end
      if (az > pz !== bz > pz && px < ax + ((pz - az) * (bx - ax)) / (bz - az)) crossings += 1
    }
    return crossings % 2 === 1
  }
  const placed: Array<{ x: number; y: number; w: number }> = []
  const clashes = (lx: number, ly: number, w: number) => placed.some((p) => Math.abs(p.x - lx) < (p.w + w) / 2 + 4 && Math.abs(p.y - ly) < 16)
  const labels = walls
    .map((w) => {
      const mx = (w.start[0] + w.end[0]) / 2
      const mz = (w.start[1] + w.end[1]) / 2
      const dx = w.end[0] - w.start[0]
      const dz = w.end[1] - w.start[1]
      const len = Math.hypot(dx, dz) || 1
      // outside the room: the side of the wall a step away from which is not in the room
      let nx = -dz / len
      let nz = dx / len
      const step = 0.15
      const outward = !inside(mx + nx * step, mz + nz * step)
      const otherOut = !inside(mx - nx * step, mz - nz * step)
      if (!outward && otherOut) {
        nx = -nx
        nz = -nz
      } else if (outward === otherOut && nx * (centre[0] - mx) + nz * (centre[1] - mz) > 0) {
        // no clear answer (an open wall): away from the room's middle
        nx = -nx
        nz = -nz
      }
      const label = formatScanLength(toLength(w.widthM, units), units, opts.locale)
      const textWidth = label.length * 6.8
      // clear of the wall: further out beside an upright wall, where the level text is wide across it
      let away = 12 + Math.abs(nx) * label.length * 3.4 + Math.abs(nz) * 7
      let lx = x(mx) + nx * away
      let ly = y(mz) + nz * away
      // two labels in one corner: the later one moves further out
      for (let tries = 0; tries < 4 && clashes(lx, ly, textWidth); tries++) {
        away += 14
        lx = x(mx) + nx * away
        ly = y(mz) + nz * away
      }
      placed.push({ x: lx, y: ly, w: textWidth })
      return `<text x="${n(lx)}" y="${n(ly)}" fill="${PLAN_COLOR.label}" font-size="12" font-family="ui-sans-serif, -apple-system, 'Instrument Sans', Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`
    })
    .join('')
  const openingLines = openings
    .map((o) => {
      const colour = o.type === 'door' ? PLAN_COLOR.door : o.type === 'window' ? PLAN_COLOR.window : PLAN_COLOR.opening
      return `<line x1="${n(x(o.start[0]))}" y1="${n(y(o.start[1]))}" x2="${n(x(o.end[0]))}" y2="${n(y(o.end[1]))}" stroke="${colour}" stroke-width="7" stroke-linecap="butt"/>`
    })
    .join('')
  const keyY = height - key / 2
  const has = (type: ScanOpeningType) => openings.some((o) => o.type === type)
  const keyItems: Array<[string, string]> = [
    ...(has('door') ? ([[PLAN_COLOR.door, OPENING_WORDS.door]] as Array<[string, string]>) : []),
    ...(has('window') ? ([[PLAN_COLOR.window, OPENING_WORDS.window]] as Array<[string, string]>) : []),
  ]
  const keyMarks = keyItems
    .map(([colour, word], i) => {
      const kx = pad + i * 86
      return `<rect x="${kx}" y="${n(keyY - 3)}" width="18" height="6" fill="${colour}"/><text x="${kx + 24}" y="${n(keyY)}" fill="${PLAN_COLOR.label}" font-size="12" font-family="ui-sans-serif, -apple-system, 'Instrument Sans', Arial, sans-serif" dominant-baseline="middle">${word}</text>`
    })
    .join('')
  const name = esc(`Floor plan${opts.title ? ` of ${opts.title}` : ''}`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}" role="img" aria-label="${name}">` +
    `<title>${name}</title>` +
    wallLines +
    openingLines +
    labels +
    keyMarks +
    `</svg>`
  )
}
