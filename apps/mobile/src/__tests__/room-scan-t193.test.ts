/**
 * T-193: a scanned room's 3D model rides with the quote, and never costs the scan or the quote.
 *
 * The sending queue with a pretend phone (as in onsite-t182): storage, files and the network are handed
 * in, so "storage refuses the model" or "the signal drops" is one line.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppCreateQuoteRequest, RoomScanPayload, RoomScanRoom } from '@qolumns/shared'
import { ApiError } from '../lib/api'
import { createOutbox, MAX_MODEL_TRIES, modelsSettled, scanForRequest, withRoomModels, type DraftRequest, type DraftRoom } from '../lib/outbox'

const OFFLINE = () => new ApiError(0, 'NETWORK', 'No signal')
const MODEL_ID = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b'

function phone() {
  const world = {
    online: true,
    modelFails: [] as ApiError[],
    modelStarts: [] as number[],
    puts: [] as Array<[string, string]>,
    removed: [] as string[],
    creates: [] as AppCreateQuoteRequest[],
    ids: 0,
  }
  const outbox = createOutbox({
    api: {
      async startUpload() {
        return { assetId: 'asset', uploadUrl: 'https://storage.test/photo' }
      },
      async startModelUpload(sizeBytes) {
        if (!world.online) throw OFFLINE()
        const fail = world.modelFails.shift()
        if (fail) throw fail
        world.modelStarts.push(sizeBytes)
        return { modelId: MODEL_ID, uploadUrl: 'https://storage.test/model' }
      },
      async createQuote(body) {
        if (!world.online) throw OFFLINE()
        world.creates.push(body)
        return { quoteId: 'qte_1', status: 'queued' } as never
      },
    },
    tenantKey: async () => 'tkey',
    store: { read: async () => null, write: async () => {} },
    files: {
      async put(url, file) {
        if (!world.online) throw OFFLINE()
        world.puts.push([url, file.contentType])
      },
      async remove(uri) {
        world.removed.push(uri)
      },
    },
    saveQuoteLink: async () => {},
    owner: () => 'user-1',
    now: () => 1_000_000,
    newId: () => `id-${++world.ids}`,
  })
  return { world, outbox }
}

const geometry: RoomScanRoom = {
  name: 'Room 1',
  walls: [{ widthM: 4, heightM: 2.5, start: [0, 0], end: [4, 0] }],
  openings: [],
  floors: [],
  ceilingHeightM: 2.5,
}
const scannedRoom = (): DraftRoom => ({ ...geometry, model: { uri: 'file:///docs/room-models/a.usdz', sizeBytes: 4096, state: 'waiting' } })
const request = (rooms: DraftRoom[]): DraftRequest => ({
  serviceId: 'svc_1',
  customer: { name: 'Dana Whitfield' },
  job: { answers: [] },
  scan: scanForRequest(rooms, 'iPhone (LiDAR)')!,
})

async function settle(outbox: ReturnType<typeof phone>['outbox']) {
  for (let i = 0; i < 6; i++) await outbox.pump()
}

describe('T-193: the scan that is sent carries geometry only', () => {
  it('nothing that lives on the phone goes in the scan', () => {
    const scan = scanForRequest([scannedRoom()], 'iPhone (LiDAR)')!
    expect(JSON.stringify(scan)).not.toContain('file://')
    expect(scan.rooms[0]).toEqual(geometry)
    expect(scanForRequest([])).toBeNull()
  })

  it('an uploaded model’s id goes on its own room, in the draft’s order', () => {
    const rooms: DraftRoom[] = [{ ...scannedRoom(), model: { uri: 'a', sizeBytes: 1, state: 'done', modelId: MODEL_ID } }, { ...geometry, name: 'Room 2' }]
    const sent = withRoomModels(request(rooms), rooms).scan as RoomScanPayload
    expect(sent.rooms.map((r) => r.modelId)).toEqual([MODEL_ID, undefined])
    expect(modelsSettled(rooms)).toBe(true)
    expect(modelsSettled([scannedRoom()])).toBe(false)
  })
})

describe('T-193: the model uploads like a photo, before the quote is sent', () => {
  it('uploaded as a USDZ of its real size; the quote carries its id; the file leaves the phone after', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    outbox.setRooms(draft.id, [scannedRoom()])
    outbox.queue(draft.id, request([scannedRoom()]), [])
    await settle(outbox)
    expect(world.modelStarts).toEqual([4096])
    expect(world.puts).toEqual([['https://storage.test/model', 'model/vnd.usdz+zip']])
    expect((world.creates[0]!.scan as RoomScanPayload).rooms[0]!.modelId).toBe(MODEL_ID)
    expect(world.removed).toContain('file:///docs/room-models/a.usdz')
  })

  it('storage turns the model down: the quote goes without it, with the scan', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    world.modelFails.push(new ApiError(400, 'FILE_TOO_LARGE', 'Too large'))
    outbox.setRooms(draft.id, [scannedRoom()])
    outbox.queue(draft.id, request([scannedRoom()]), [])
    await settle(outbox)
    expect(world.creates).toHaveLength(1)
    const sent = world.creates[0]!.scan as RoomScanPayload
    expect(sent.rooms[0]!.modelId).toBeUndefined()
    expect(sent.rooms[0]!.walls).toEqual(geometry.walls)
  })

  it(`a model that keeps failing is left out after ${MAX_MODEL_TRIES} tries; the quote is never held on it`, async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    for (let i = 0; i < MAX_MODEL_TRIES; i++) world.modelFails.push(new ApiError(503, 'STORAGE_UNAVAILABLE', 'Busy'))
    outbox.setRooms(draft.id, [scannedRoom()])
    outbox.queue(draft.id, request([scannedRoom()]), [])
    await settle(outbox)
    expect(world.creates).toHaveLength(1)
    expect((world.creates[0]!.scan as RoomScanPayload).rooms[0]!.modelId).toBeUndefined()
  })

  it('no signal: the model waits with the quote and no try is counted (T-182’s offline rules)', async () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    outbox.setRooms(draft.id, [scannedRoom()])
    world.online = false
    outbox.queue(draft.id, request([scannedRoom()]), [])
    await settle(outbox)
    const waiting = outbox.find(draft.id)!
    expect(waiting.rooms[0]!.model).toMatchObject({ state: 'waiting' })
    expect(waiting.rooms[0]!.model!.tries ?? 0).toBe(0)
    expect(world.creates).toHaveLength(0)
    world.online = true
    await settle(outbox)
    expect((world.creates[0]!.scan as RoomScanPayload).rooms[0]!.modelId).toBe(MODEL_ID)
  })

  it('a room scanned again or removed has its old model file deleted', () => {
    const { world, outbox } = phone()
    const draft = outbox.start()!
    outbox.setRooms(draft.id, [scannedRoom()])
    outbox.setRooms(draft.id, [{ ...scannedRoom(), model: { uri: 'file:///docs/room-models/b.usdz', sizeBytes: 10, state: 'waiting' } }])
    expect(world.removed).toEqual(['file:///docs/room-models/a.usdz'])
    outbox.setRooms(draft.id, [])
    expect(world.removed).toEqual(['file:///docs/room-models/a.usdz', 'file:///docs/room-models/b.usdz'])
  })
})

describe('T-193: the screens', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')

  it('straight after a scan the sizes are shown, with "Scan again"; the quote screen has a "Room scan" card above the price', () => {
    const scanScreen = read('app/(tabs)/new.tsx')
    expect(scanScreen).toContain('<RoomScanSummary')
    expect(scanScreen).toContain('onScanAgain')
    const quote = read('app/quote/[id].tsx')
    expect(quote.indexOf('<RoomScanCard')).toBeGreaterThan(0)
    expect(quote.indexOf('<RoomScanCard')).toBeLessThan(quote.indexOf('{/* 4. The price'))
  })

  it('the model opens in iOS Quick Look; a model that will not open leaves the sizes', () => {
    const native = read('modules/room-scan/ios/RoomScanModule.swift')
    expect(native).toContain('QLPreviewController')
    expect(native).toContain('exportOptions: .parametric')
    // the scan is returned whether or not the export worked
    expect(native).toMatch(/if let model = Self\.exportModel\(processedResult\) \{[\s\S]*?\}\n\s*DispatchQueue\.main\.async \{ self\.finish\(\.success\(room\)\) \}/)
    expect(read('app/quote/[id].tsx')).toContain('The 3D model could not be shown. The sizes are unaffected.')
  })
})
