/**
 * T-194 in the app: areas (a name and the rooms covered), the plan check, the business's earlier area
 * names, and the 3D viewer it opens.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppCreateQuoteRequest, RoomScanPayload } from '@qolumns/shared'
import { ApiError } from '../lib/api'
import { rememberAreaName, AREA_NAMES_KEPT } from '../lib/area-names'
import { viewerAddress } from '../lib/model-viewer'
import { createOutbox, scanForRequest, type DraftRequest, type DraftRoom } from '../lib/outbox'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')

function phone(refuseScan: boolean) {
  const creates: AppCreateQuoteRequest[] = []
  const outbox = createOutbox({
    api: {
      async startUpload() {
        return { assetId: 'asset', uploadUrl: 'https://storage.test/photo' }
      },
      async startModelUpload() {
        return { modelId: '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b', uploadUrl: 'https://storage.test/model' }
      },
      async createQuote(body) {
        creates.push(body)
        if (refuseScan && body.scan !== undefined) throw new ApiError(403, 'ROOM_SCAN_NOT_IN_PLAN', 'Room scan is part of Pro.')
        return { quoteId: 'qte_1', status: 'queued' } as never
      },
    },
    tenantKey: async () => 'tkey',
    store: { read: async () => null, write: async () => {} },
    files: { async put() {}, async remove() {} },
    saveQuoteLink: async () => {},
    owner: () => 'user-1',
    now: () => 1_000_000,
    newId: (() => {
      let n = 0
      return () => `id-${++n}`
    })(),
  })
  return { creates, outbox }
}

const area = (extra: Partial<DraftRoom> = {}): DraftRoom => ({ name: 'Ground floor', roomsCovered: 3, walls: [{ widthM: 4, heightM: 2.5 }], openings: [], floors: [], ...extra })
const request = (rooms: DraftRoom[]): DraftRequest => ({ serviceId: 'svc_1', customer: { name: 'Jordan Reyes' }, job: { answers: [] }, scan: scanForRequest(rooms, 'iPhone (LiDAR)')! })

describe('T-194: an area goes with its name and the rooms it covers', () => {
  it('the scan sent carries both', () => {
    const scan = scanForRequest([area(), area({ name: 'Landing', roomsCovered: 1 })])!
    expect(scan.rooms.map((r) => [r.name, r.roomsCovered])).toEqual([
      ['Ground floor', 3],
      ['Landing', 1],
    ])
  })

  it('is asked straight after the scan, with the business’s own earlier names to pick from', () => {
    const summary = read('src/components/RoomScanSummary.tsx')
    expect(summary).toContain('What is this area called?')
    expect(summary).toContain('How many rooms does this cover?')
    const screen = read('app/(tabs)/new.tsx')
    expect(screen).toContain("'Scan another area'")
    expect(screen).toContain('names: areaNames')
    expect(screen).toContain('SCAN_TIP')
  })
})

describe('T-194: the business’s earlier names, and nothing else', () => {
  it('most recent first, once whatever its case, the oldest dropped', () => {
    expect(rememberAreaName(['Kitchen', 'Landing'], 'landing')).toEqual(['landing', 'Kitchen'])
    expect(rememberAreaName([], '  Back   bedroom ')).toEqual(['Back bedroom'])
    expect(rememberAreaName(['A'], '  ')).toEqual(['A'])
    const many = Array.from({ length: AREA_NAMES_KEPT }, (_, i) => `Area ${i}`)
    expect(rememberAreaName(many, 'New')).toHaveLength(AREA_NAMES_KEPT)
    // no words are suggested that the business did not type
    expect(read('src/lib/area-names.ts')).not.toMatch(/'(Kitchen|Bedroom|Hallway|Living room)'/)
  })
})

describe('T-194: room scan needs the plan; a quote is never lost over it', () => {
  it('a quote refused only for its scan goes again without it', async () => {
    const { creates, outbox } = phone(true)
    const draft = outbox.start()!
    outbox.queue(draft.id, request([area()]), [])
    for (let i = 0; i < 4; i++) await outbox.pump()
    expect(creates).toHaveLength(2)
    expect(creates[0]!.scan).toBeDefined()
    expect(creates[1]!.scan).toBeUndefined()
    expect(creates[1]!.customer.name).toBe('Jordan Reyes')
  })

  it('with the plan, it goes once, with the scan', async () => {
    const { creates, outbox } = phone(false)
    const draft = outbox.start()!
    outbox.queue(draft.id, request([area()]), [])
    for (let i = 0; i < 4; i++) await outbox.pump()
    expect(creates).toHaveLength(1)
    expect((creates[0]!.scan as RoomScanPayload).rooms[0]!.roomsCovered).toBe(3)
  })
})

describe('T-194: the 3D viewer is the web’s, opened in the in-app browser', () => {
  it('its address carries the model’s signed address after "#", never to a server', () => {
    const address = viewerAddress('https://example.test/', 'https://acct.r2.cloudflarestorage.com/b/t/room-models/a.usdz?X-Amz-Signature=abc&X-Amz-Expires=600', 'Ground floor')
    expect(address.startsWith('https://example.test/room-model#src=')).toBe(true)
    const hash = new URLSearchParams(address.split('#')[1])
    expect(hash.get('src')).toBe('https://acct.r2.cloudflarestorage.com/b/t/room-models/a.usdz?X-Amz-Signature=abc&X-Amz-Expires=600')
    expect(hash.get('name')).toBe('Ground floor')
  })

  it('"Scan again" and "Add an area" on the quote screen, until it is approved', () => {
    const screen = read('app/quote/[id].tsx')
    expect(screen).toContain('api.rescan(quote.id')
    expect(screen).toContain('quote.roomScan.canScanAgain')
    expect(screen).not.toContain('previewModel')
  })
})
