/**
 * T-193: room scan results the business can use (sizes, floor plan, 3D model), and room scan on Pro.
 *
 * The known room: 4 m × 3 m, walls 2.5 m high, one door 0.9 × 2.0 m and one window 1.2 × 1.0 m.
 *   walls gross 14 m × 2.5 m = 35 m², less 1.8 + 1.2 = 3 m² → 32 m² net; floor 12 m²; perimeter 14 m.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  businessSources,
  customerRoomScanView,
  floorPlanSvg,
  getPlan,
  offeredPlans,
  parseRoomScan,
  PLAN_COLOR,
  roomScanOfAnswers,
  roomScanReport,
  roomScanView,
  scanAnswers,
  scannedNote,
  scanUnits,
  summarizeRoomScan,
  ROOM_SCAN_FIELD,
  type RoomScanPayload,
  type RoomScanRoom,
} from '@qolumns/shared'
import { roomScanPlanLine } from '@/lib/marketing/plan-claims'

vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  generateUploadUrl: async (key: string) => `https://storage.test/put/${key}`,
  generateDownloadUrl: async (key: string) => `https://storage.test/get/${key}`,
}))

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const MODEL = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b'

/** The known room, with its walls' and openings' positions (a scan since T-193) */
function knownRoom(extra: Partial<RoomScanRoom> = {}): RoomScanRoom {
  return {
    name: 'Living room',
    walls: [
      { widthM: 4, heightM: 2.5, start: [0, 0], end: [4, 0] },
      { widthM: 3, heightM: 2.5, start: [4, 0], end: [4, 3] },
      { widthM: 4, heightM: 2.5, start: [4, 3], end: [0, 3] },
      { widthM: 3, heightM: 2.5, start: [0, 3], end: [0, 0] },
    ],
    openings: [
      { type: 'door', widthM: 0.9, heightM: 2, start: [1, 0], end: [1.9, 0] },
      { type: 'window', widthM: 1.2, heightM: 1, start: [4, 1], end: [4, 2.2] },
    ],
    floors: [{ polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
    ceilingHeightM: 2.5,
    ...extra,
  }
}

const scanOf = (...rooms: RoomScanRoom[]): RoomScanPayload => ({ version: 1, rooms })

/** The same room as a scan from before T-193: sizes only, no positions, no ceiling, no model */
function olderRoom(): RoomScanRoom {
  const room = knownRoom()
  return {
    name: room.name,
    walls: room.walls.map((w) => ({ widthM: w.widthM, heightM: w.heightM })),
    openings: room.openings.map((o) => ({ type: o.type, widthM: o.widthM, heightM: o.heightM })),
    floors: room.floors,
  }
}

describe('T-193: one summary of a scan, per room and for the whole job', () => {
  it('a known room, in metric: m² and m', () => {
    const report = roomScanReport(scanOf(knownRoom()), 'metric')
    expect(report.units).toMatchObject({ areaLabel: 'm²', lengthLabel: 'm' })
    expect(report.rooms[0]).toMatchObject({
      name: 'Living room',
      floorArea: 12,
      wallAreaGross: 35,
      wallAreaNet: 32,
      ceilingHeight: 2.5,
      perimeter: 14,
      doors: 1,
      windows: 1,
      hasPlan: true,
    })
    expect(report.rooms[0]!.walls).toEqual([
      { width: 4, height: 2.5 },
      { width: 3, height: 2.5 },
      { width: 4, height: 2.5 },
      { width: 3, height: 2.5 },
    ])
    expect(report.rooms[0]!.openings).toEqual([
      { type: 'door', width: 0.9, height: 2 },
      { type: 'window', width: 1.2, height: 1 },
    ])
  })

  it('the same room for an imperial business: sq ft and ft', () => {
    const report = roomScanReport(scanOf(knownRoom()), 'imperial')
    expect(report.units).toMatchObject({ area: 'sqft', length: 'ft', areaLabel: 'sq ft', lengthLabel: 'ft' })
    // 12 m² = 129.17 sq ft; 35 m² = 376.74; 32 m² = 344.45; 14 m = 45.93 ft; 2.5 m = 8.20 ft
    expect(report.rooms[0]).toMatchObject({ floorArea: 129.2, wallAreaGross: 376.7, wallAreaNet: 344.4, perimeter: 45.9, ceilingHeight: 8.2 })
    expect(report.rooms[0]!.walls[0]).toEqual({ width: 13.1, height: 8.2 })
  })

  it('units come from one function, by the business’s unit system', () => {
    expect(scanUnits('imperial')).toEqual({ system: 'imperial', area: 'sqft', length: 'ft', areaLabel: 'sq ft', lengthLabel: 'ft' })
    expect(scanUnits('metric')).toEqual({ system: 'metric', area: 'sqm', length: 'm', areaLabel: 'm²', lengthLabel: 'm' })
  })

  it('the whole job adds the rooms up, from the same figures that price the quote', () => {
    const two = scanOf(knownRoom(), knownRoom({ name: 'Bedroom' }))
    const report = roomScanReport(two, 'metric')
    expect(report.total).toEqual({ rooms: 2, floorArea: 24, wallAreaGross: 70, wallAreaNet: 64, perimeter: 28, doors: 2, windows: 2 })
    const priced = summarizeRoomScan(two)
    expect([priced.floorAreaSqm, priced.wallAreaGrossSqm, priced.wallAreaNetSqm]).toEqual([report.total.floorArea, report.total.wallAreaGross, report.total.wallAreaNet])
  })

  it('no pricing maths changed: the positions, the ceiling and the model change no quantity a scan fills', () => {
    const signals = [
      { signalKey: 'wall_area', unit: 'sqft', scan: { measure: 'wall_area_net' as const } },
      { signalKey: 'floor_area', unit: 'sqm', scan: { measure: 'floor_area' as const } },
    ]
    const withPositions = scanAnswers({ scan: scanOf(knownRoom({ modelId: MODEL })), expectedSignals: signals })
    const without = scanAnswers({ scan: scanOf(olderRoom()), expectedSignals: signals })
    expect(withPositions).toEqual(without)
    expect(withPositions).toEqual([
      { fieldId: 'wall_area', value: 344.4 },
      { fieldId: 'floor_area', value: 12 },
    ])
  })

  it('the ceiling height is the tallest wall when the scan does not say it', () => {
    const room = knownRoom({ ceilingHeightM: undefined })
    room.walls[1] = { ...room.walls[1]!, heightM: 2.7 }
    expect(roomScanReport(scanOf(room), 'metric').rooms[0]!.ceilingHeight).toBe(2.7)
  })
})

describe('T-193: what the scan carries, checked on the server', () => {
  it('positions, the ceiling and the model id are kept', () => {
    const parsed = parseRoomScan(scanOf(knownRoom({ modelId: MODEL })))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const room = parsed.scan.rooms[0]!
    expect(room.walls[0]).toEqual({ widthM: 4, heightM: 2.5, start: [0, 0], end: [4, 0] })
    expect(room.openings[0]).toEqual({ type: 'door', widthM: 0.9, heightM: 2, start: [1, 0], end: [1.9, 0] })
    expect(room.ceilingHeightM).toBe(2.5)
    expect(room.modelId).toBe(MODEL)
  })

  it('a model id that is not one the server makes, a bad point, or a silly ceiling is left off; the sizes still count', () => {
    const bad = knownRoom({ modelId: '../other-business/room' as string, ceilingHeightM: 999 })
    bad.walls[0] = { ...bad.walls[0]!, start: [Number.NaN, 0] as [number, number] }
    bad.walls[1] = { ...bad.walls[1]!, end: [1, 2, 3] as unknown as [number, number] }
    const parsed = parseRoomScan(scanOf(bad))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const room = parsed.scan.rooms[0]!
    expect(room.modelId).toBeUndefined()
    expect(room.ceilingHeightM).toBeUndefined()
    expect(room.walls[0]).toEqual({ widthM: 4, heightM: 2.5 })
    expect(room.walls[1]).toEqual({ widthM: 3, heightM: 2.5 })
    expect(summarizeRoomScan(parsed.scan).wallAreaNetSqm).toBe(32)
  })

  it('the stored scan is read back from the request’s answers, and checked again', () => {
    expect(roomScanOfAnswers([{ fieldId: 'x', value: 1 }, { fieldId: ROOM_SCAN_FIELD, value: scanOf(knownRoom()) }])?.rooms).toHaveLength(1)
    expect(roomScanOfAnswers([{ fieldId: ROOM_SCAN_FIELD, value: { version: 9 } }])).toBeNull()
    expect(roomScanOfAnswers(null)).toBeNull()
  })
})

describe('T-193: the floor plan', () => {
  const svg = floorPlanSvg(knownRoom(), 'metric', { title: 'Living <room>' })!

  it('top-down: every wall with its length beside it, the door and the window marked, a key', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.match(new RegExp(`stroke="${PLAN_COLOR.wall}"`, 'g'))).toHaveLength(4)
    expect(svg.match(/>4 m</g)).toHaveLength(2)
    expect(svg.match(/>3 m</g)).toHaveLength(2)
    expect(svg).toContain(`stroke="${PLAN_COLOR.door}"`)
    expect(svg).toContain(`stroke="${PLAN_COLOR.window}"`)
    expect(svg).toContain('>Door<')
    expect(svg).toContain('>Window<')
  })

  it('in the business’s units', () => {
    expect(floorPlanSvg(knownRoom(), 'imperial')).toContain('>13.1 ft<')
  })

  it('the room’s name is escaped, and only numbers go in otherwise', () => {
    expect(svg).toContain('aria-label="Floor plan of Living &lt;room&gt;"')
    expect(svg).not.toContain('<room>')
  })

  it('an older scan (no positions) has no plan and no model, and still has its sizes', () => {
    expect(floorPlanSvg(olderRoom(), 'metric')).toBeNull()
    const view = roomScanView(scanOf(olderRoom()), 'metric')
    expect(view.rooms[0]).toMatchObject({ floorArea: 12, wallAreaNet: 32, hasPlan: false, ceilingHeight: 2.5 })
    expect(view.rooms[0]!.planSvg).toBeUndefined()
    expect(view.rooms[0]!.modelId).toBeUndefined()
    const customer = customerRoomScanView(scanOf(olderRoom()), 'metric')
    expect(customer.rooms[0]).toEqual({ name: 'Living room', floorArea: '12 m²', wallArea: '32 m²' })
  })
})

describe('T-193: the customer sees each room’s floor and wall area, the plan and the model; no wall-by-wall list', () => {
  it('per room: name, floor area, wall area, plan, model id, and nothing else', () => {
    const view = customerRoomScanView(scanOf(knownRoom({ modelId: MODEL })), 'imperial')
    expect(Object.keys(view.rooms[0]!).sort()).toEqual(['floorArea', 'modelId', 'name', 'planSvg', 'wallArea'])
    expect(view.rooms[0]).toMatchObject({ floorArea: '129.2 sq ft', wallArea: '344.4 sq ft', modelId: MODEL })
  })

  it('the quote page shows it as "Measured on site", the PDF the sizes and the plan with no model', () => {
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('<MeasuredOnSite')
    const card = read('apps/web/src/components/room-scan/RoomScanCard.tsx')
    expect(card).toContain('Measured on site')
    const pdf = read('apps/web/src/lib/pdf-template.ts')
    expect(pdf).toContain('Measured on site')
    expect(pdf).toContain('room.planSvg')
    expect(pdf).not.toContain('modelId')
  })
})

describe('T-193: a price line from a scanned quantity says so, with the quantity and unit', () => {
  it('"Measured by room scan: 344.4 sq ft"', () => {
    const lines = [{ label: 'Walls', amount: 860, source: 'scan' }]
    const takeoff = [{ item: 'Walls', amount: 860, method: 'From the on-site room scan', source: 'scan', quantity: 344.4, unit: 'sqft' }]
    expect(businessSources(lines, takeoff)).toEqual(['Measured by room scan: 344.4 sq ft'])
  })

  it('a quote priced before the code was on the line reads it from the takeoff, with the quantity too', () => {
    const takeoff = [{ item: 'Floor', amount: 300, method: 'From the on-site room scan', quantity: 12, unit: 'sqm' }]
    expect(businessSources([{ label: 'Floor', amount: 300 }], takeoff)).toEqual(['Measured by room scan: 12 sqm'])
  })

  it('without a takeoff row (an added service) it says only that it was measured by the scan', () => {
    expect(businessSources([{ label: 'Walls', amount: 860, source: 'scan' }])).toEqual(['Measured by room scan'])
    expect(scannedNote(null)).toBe('Measured by room scan')
  })
})

describe('T-193: the 3D model is private to its quote', async () => {
  const { roomModelKey, scanHasModel, signedRoomModelUrl, startModelUpload, ROOM_MODEL_MAX_BYTES } = await import('@/lib/room-models')
  const answers = [{ fieldId: ROOM_SCAN_FIELD, value: scanOf(knownRoom({ modelId: MODEL })) }]

  it('kept in the business’s own folder, at an id the server made', async () => {
    expect(roomModelKey('tenant-a', MODEL)).toBe(`tenant-a/room-models/${MODEL}.usdz`)
    const started = await startModelUpload('tenant-a', 2048)
    expect(started.ok).toBe(true)
    if (started.ok) {
      expect(started.modelId).toMatch(/^[0-9a-f-]{36}$/)
      expect(started.uploadUrl).toBe(`https://storage.test/put/tenant-a/room-models/${started.modelId}.usdz`)
    }
    expect((await startModelUpload('tenant-a', 0)).ok).toBe(false)
    expect((await startModelUpload('tenant-a', 1.5)).ok).toBe(false)
    expect((await startModelUpload('tenant-a', ROOM_MODEL_MAX_BYTES + 1)).ok).toBe(false)
  })

  it('an address is signed only for a model in that quote’s own scan, under that quote’s tenant', async () => {
    expect(scanHasModel(answers, MODEL)).toBe(true)
    expect(scanHasModel(answers, '2b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b')).toBe(false)
    expect(scanHasModel(answers, '../x')).toBe(false)
    expect(await signedRoomModelUrl({ tenantId: 'tenant-a', jobAnswers: answers }, MODEL)).toBe(`https://storage.test/get/tenant-a/room-models/${MODEL}.usdz`)
    expect(await signedRoomModelUrl({ tenantId: 'tenant-a', jobAnswers: [] }, MODEL)).toBeNull()
  })

  it('each address route checks who is asking before anything is signed', () => {
    const dashboard = read('apps/web/src/app/api/quotes/[quoteId]/room-models/[modelId]/route.ts')
    expect(dashboard).toContain('requireTenant()')
    expect(dashboard).toContain(".eq('tenant_id', auth.tenantId)")
    const customer = read('apps/web/src/app/api/public/quotes/[quoteId]/room-models/[modelId]/route.ts')
    expect(customer).toContain('quoteTokenFilter(tokenHash)')
    expect(customer).toContain('token_expires_at')
    const approval = read('apps/web/src/app/api/public/approval/[token]/room-models/[modelId]/route.ts')
    expect(approval).toContain('approvalQuoteScan(')
    const link = read('apps/web/src/lib/approval-link.ts')
    const scanReader = link.slice(link.indexOf('export async function approvalQuoteScan'))
    expect(scanReader.indexOf("!== 'valid') return null")).toBeGreaterThan(0)
    expect(scanReader.indexOf("!== 'valid') return null")).toBeLessThan(scanReader.indexOf(".from('quotes')"))
    const upload = read('apps/web/src/app/api/app/room-models/route.ts')
    expect(upload).toContain('startModelUpload(auth.tenantId')
  })

  it('the viewer loads nothing until it is opened, and the 3D library is its own piece of the page', () => {
    const viewer = read('apps/web/src/components/room-scan/RoomModelViewer.tsx')
    expect(viewer).not.toMatch(/^import .*from 'three/m)
    expect(viewer).toContain("import('three')")
    expect(viewer).toContain("import('three/examples/jsm/loaders/USDLoader.js')")
    expect(viewer.indexOf('await fetch(addressPath')).toBeLessThan(viewer.indexOf("import('three')"))
    // a model that will not load leaves the sizes and the plan alone
    expect(viewer).toContain('The 3D model could not be shown here. The sizes and the floor plan are unaffected.')
    expect(viewer).toContain('rel="ar"')
  })
})

describe('T-193: room scan is a Pro feature (the owner’s decision)', () => {
  it('Pro and Business include it; Starter does not; prices and limits are unchanged', () => {
    expect(getPlan('plan_us_pro')!.features.lidar_scanning).toBe(true)
    expect(getPlan('plan_us_business')!.features.lidar_scanning).toBe(true)
    expect(getPlan('plan_us_starter')!.features.lidar_scanning).toBe(false)
    expect(offeredPlans().map((p) => [p.id, p.monthlyPrice.USD, p.annualPrice?.USD, p.quoteLimit])).toEqual([
      ['plan_us_starter', 4900, 49000, 50],
      ['plan_us_pro', 9900, 99000, 200],
      ['plan_us_business', 19900, 199000, 600],
    ])
  })

  it('Features says which plan has it, from the plan definitions', () => {
    expect(roomScanPlanLine()).toBe('Included in Pro.')
    expect(read('apps/web/src/app/features/page.tsx')).toContain('roomScanPlanLine()')
  })
})
