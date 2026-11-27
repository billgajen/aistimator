/**
 * T-182: the on-site quote that is being written and sent (pure, no React
 * Native imports; the phone's storage, files and network are handed in).
 *
 * What it promises:
 *   - A photo starts uploading the moment it is taken, in the background,
 *     while the trade answers the service's questions.
 *   - Everything typed and every photo is saved on the phone as it happens.
 *     Closing the app, a dead battery or a lost signal loses nothing.
 *   - "Price this job" never fails for want of a signal. The quote waits in
 *     the queue and is sent by itself when the phone is back online.
 *   - A quote is never made twice. Each draft has one id, sent with every
 *     attempt; the server answers the quote it already made (POST
 *     /api/app/quotes, `clientRequestId`).
 *
 * A safeguard on the server (a rate limit) is waited out, for as long as the
 * server asks; it is never worked around.
 *
 * T-193: a scanned room's 3D model is uploaded like a photo, before the quote
 * is sent, and its id goes on the room. It is never allowed to cost the scan
 * or the quote: a model that storage refuses, or that fails three times, is
 * left out, and the quote goes without it.
 */

import type { AppCreateQuoteRequest, AppCreateQuoteResponse, RoomScanPayload, RoomScanRoom } from '@qolumns/shared'
import { toApiError, type ApiError } from './api'
import { clamp01, toNumber } from './numbers'
import type { RawAnswers } from './answers'

// ---------------------------------------------------------------------------
// What is kept
// ---------------------------------------------------------------------------

/** waiting: not uploaded yet · uploading · done · refused: the server will not take this file */
export type PhotoState = 'waiting' | 'uploading' | 'done' | 'refused'

export interface DraftPhoto {
  id: string
  /** The photo's own copy in the app's documents (kept until the quote is made) */
  uri: string
  fileName: string
  contentType: string
  /** The file's real size: the upload address is signed for exactly this */
  sizeBytes: number
  /** The guided angle it answers, or null for an extra photo */
  angleId: string | null
  state: PhotoState
  /** 0 to 1 while uploading */
  progress: number
  assetId?: string
  /** Why it was refused, in the server's words */
  error?: string
  /** How many times storage turned the upload down (an address that ran out is asked for again) */
  refusals?: number
}

/** editing: still being written · queued: "Price this job" was pressed · sending: the request is on its way */
export type SendState = 'editing' | 'queued' | 'sending'

/** Why a draft is not moving, in a form the screen can word */
export interface DraftProblem {
  kind: 'offline' | 'busy' | 'signin' | 'refused'
  message: string
}

export type DraftRequest = Omit<AppCreateQuoteRequest, 'assetIds' | 'clientRequestId'>

/**
 * T-193: a room's 3D model on the phone. waiting · uploading · done (it has its id) · dropped: it could
 * not be uploaded and the quote goes without it (the scan itself is kept).
 */
export interface RoomModelFile {
  uri: string
  sizeBytes: number
  state: 'waiting' | 'uploading' | 'done' | 'dropped'
  modelId?: string
  /** Failed tries; at MAX_MODEL_TRIES it is dropped */
  tries?: number
}

/** A scanned room as the draft keeps it: the scan's geometry, and its model file when there is one */
export type DraftRoom = RoomScanRoom & { model?: RoomModelFile }

export const ROOM_MODEL_CONTENT_TYPE = 'model/vnd.usdz+zip'

/** A model that fails this many times is left out (the quote never waits on it for long) */
export const MAX_MODEL_TRIES = 3

/** The scan as it is sent: the rooms' geometry only, nothing that lives on the phone */
export function scanForRequest(rooms: readonly DraftRoom[], device?: string): RoomScanPayload | null {
  if (rooms.length === 0) return null
  return {
    version: 1,
    rooms: rooms.map((room) => {
      const { model: _model, ...geometry } = room
      void _model
      return geometry
    }),
    ...(device && { device }),
  }
}

/** The request with each uploaded model's id on its room (rooms are in the same order as the draft's) */
export function withRoomModels(request: DraftRequest, rooms: readonly DraftRoom[]): DraftRequest {
  const scan = request.scan as RoomScanPayload | undefined
  if (!scan || !Array.isArray(scan.rooms)) return request
  return {
    ...request,
    scan: {
      ...scan,
      rooms: scan.rooms.map((room, i) => {
        const model = rooms[i]?.model
        return model?.state === 'done' && model.modelId ? { ...room, modelId: model.modelId } : room
      }),
    },
  }
}

/** Every model has an answer: uploaded, or left out */
export function modelsSettled(rooms: readonly DraftRoom[]): boolean {
  return rooms.every((room) => !room.model || room.model.state === 'done' || room.model.state === 'dropped')
}

export interface Draft {
  /** Also the id sent with every attempt, so a repeat never makes a second quote */
  id: string
  /** The signed-in user who wrote it: a draft is never sent under another sign-in */
  owner: string
  createdAt: string
  step: number
  serviceId: string | null
  serviceName: string | null
  customer: { name: string; email: string; phone: string }
  address: string
  postcode: string
  description: string
  answers: RawAnswers
  rooms: DraftRoom[]
  photos: DraftPhoto[]
  send: SendState
  /** The request as it will be sent, fixed when "Price this job" was pressed */
  request: DraftRequest | null
  /** Photo ids in the order they are sent (guided angles first) */
  photoOrder: string[]
  problem: DraftProblem | null
  attempts: number
  /** Not before this moment (ms); 0 = as soon as possible */
  nextTryAt: number
}

/** A draft that became a quote; the screen that was waiting for it takes it and moves on */
export interface SentQuote {
  draftId: string
  quoteId: string
  /** Saved but not priced: the plan limit was reached, or the account is paused */
  held: boolean
}

export interface OutboxState {
  drafts: Draft[]
  sent: SentQuote[]
}

export type DraftPatch = Partial<
  Pick<Draft, 'step' | 'serviceId' | 'serviceName' | 'customer' | 'address' | 'postcode' | 'description' | 'answers' | 'rooms'>
>

export interface NewPhoto {
  uri: string
  fileName: string
  contentType: string
  sizeBytes: number
  angleId: string | null
}

// ---------------------------------------------------------------------------
// What the phone provides
// ---------------------------------------------------------------------------

export interface OutboxDeps {
  api: {
    startUpload(tenantKey: string, file: { fileName: string; contentType: string; sizeBytes: number }): Promise<{ assetId: string; uploadUrl: string }>
    /** T-193: a signed address for one room model of exactly this size */
    startModelUpload(sizeBytes: number): Promise<{ modelId: string; uploadUrl: string }>
    createQuote(body: AppCreateQuoteRequest): Promise<AppCreateQuoteResponse>
  }
  /** The business's form key (from /api/app/bootstrap); may need the network the first time */
  tenantKey(): Promise<string>
  /** One small JSON file on the phone */
  store: { read(): Promise<string | null>; write(json: string): Promise<void> }
  files: {
    /** Send the file to the signed address; throws an ApiError that says whether to try again */
    put(uploadUrl: string, file: { uri: string; contentType: string }, onProgress: (fraction: number) => void): Promise<void>
    /** Delete a photo's copy, or a room model, from the phone (never throws) */
    remove(uri: string): Promise<void>
  }
  /** Keep the customer's link for a quote this device made */
  saveQuoteLink(quoteId: string, viewUrl: string): Promise<void>
  /** Who is signed in on this device (null when nobody is) */
  owner(): string | null
  now(): number
  newId(): string
}

/** How long to wait before the next try, by how many have failed: quick at first, then once a minute */
export const RETRY_SECONDS = [3, 8, 15, 30, 60] as const

export function retryDelayMs(attempts: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.ceil(retryAfterSeconds) * 1000
  return RETRY_SECONDS[Math.min(Math.max(attempts, 1), RETRY_SECONDS.length) - 1]! * 1000
}

/** Storage turned the same photo down this many times: stop asking and say so */
const MAX_STORAGE_REFUSALS = 3

export const OUTBOX_COPY = {
  offline: 'No signal. Saved on this device. It sends by itself when you are back online.',
  busy: 'The server is busy. Trying again shortly.',
  signin: 'Sign in again to send this quote. It is saved on this device.',
  photoRefused: 'A photo could not be uploaded. Take it again.',
} as const

function problemFrom(error: ApiError): DraftProblem {
  if (error.offline) return { kind: 'offline', message: OUTBOX_COPY.offline }
  if (error.status === 401) return { kind: 'signin', message: OUTBOX_COPY.signin }
  if (error.retryable) return { kind: 'busy', message: OUTBOX_COPY.busy }
  return { kind: 'refused', message: error.message }
}

// ---------------------------------------------------------------------------
// Reading a draft (pure helpers for the screens)
// ---------------------------------------------------------------------------

export interface DraftProgress {
  photosTotal: number
  photosDone: number
  /** 0 to 1 across every photo, counting the part of the one on its way */
  fraction: number
  /** One plain line saying where it stands */
  line: string
}

export function draftProgress(draft: Draft): DraftProgress {
  const photosTotal = draft.photos.length
  const photosDone = draft.photos.filter((p) => p.state === 'done').length
  const partial = draft.photos.reduce((sum, p) => sum + (p.state === 'done' ? 1 : p.state === 'uploading' ? clamp01(p.progress) : 0), 0)
  const fraction = photosTotal === 0 ? 1 : Math.min(1, partial / photosTotal)
  let line: string
  if (draft.problem) line = draft.problem.message
  else if (photosDone < photosTotal) line = `Uploading photos: ${photosDone} of ${photosTotal} done`
  else if (draft.send === 'editing') line = photosTotal > 0 ? `${photosTotal === 1 ? 'Photo' : `All ${photosTotal} photos`} uploaded` : ''
  else line = 'Sending the job'
  return { photosTotal, photosDone, fraction, line }
}

/** The name a waiting draft goes by in a list */
export function draftTitle(draft: Draft): string {
  return draft.customer.name.trim() || draft.serviceName || 'New quote'
}

function blankDraft(id: string, owner: string, now: number): Draft {
  return {
    id,
    owner,
    createdAt: new Date(now).toISOString(),
    step: 0,
    serviceId: null,
    serviceName: null,
    customer: { name: '', email: '', phone: '' },
    address: '',
    postcode: '',
    description: '',
    answers: {},
    rooms: [],
    photos: [],
    send: 'editing',
    request: null,
    photoOrder: [],
    problem: null,
    attempts: 0,
    nextTryAt: 0,
  }
}

/** What was saved, made safe to carry on from: nothing is left "on its way" from a run that ended */
export function restoreState(json: string | null): OutboxState {
  if (!json) return { drafts: [], sent: [] }
  try {
    const parsed = JSON.parse(json) as Partial<OutboxState> | null
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : []
    return {
      drafts: drafts
        .filter((d): d is Draft => Boolean(d) && typeof d.id === 'string' && typeof d.owner === 'string' && Array.isArray(d.photos))
        .map((d) => ({
          ...d,
          send: d.send === 'sending' ? 'queued' : d.send,
          nextTryAt: 0,
          photos: d.photos.map((p) => (p.state === 'uploading' ? { ...p, state: 'waiting' as const, progress: 0 } : p)),
          rooms: (Array.isArray(d.rooms) ? d.rooms : []).map((r) => (r.model?.state === 'uploading' ? { ...r, model: { ...r.model, state: 'waiting' as const } } : r)),
        })),
      sent: [],
    }
  } catch {
    return { drafts: [], sent: [] }
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function createOutbox(deps: OutboxDeps) {
  let state: OutboxState = { drafts: [], sent: [] }
  const listeners = new Set<() => void>()
  /** The run in progress, if there is one */
  let current: Promise<void> | null = null
  let again = false

  const emit = () => listeners.forEach((listener) => listener())

  async function persist(): Promise<void> {
    try {
      await deps.store.write(JSON.stringify({ drafts: state.drafts }))
    } catch {
      // the phone's storage failed: the draft is still in memory and still sends
    }
  }

  /** Replace one draft; `save` is false for progress ticks, which are not worth writing down */
  function setDraft(id: string, change: (draft: Draft) => Draft, save = true): Draft | null {
    let next: Draft | null = null
    state = {
      ...state,
      drafts: state.drafts.map((draft) => {
        if (draft.id !== id) return draft
        next = change(draft)
        return next
      }),
    }
    emit()
    if (save) void persist()
    return next
  }

  const find = (id: string) => state.drafts.find((draft) => draft.id === id) ?? null

  const setPhoto = (draftId: string, photoId: string, patch: Partial<DraftPhoto>, save = true) =>
    setDraft(draftId, (draft) => ({ ...draft, photos: draft.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)) }), save)

  /** A try failed for a reason that passes: note it and wait */
  function holdBack(draftId: string, error: ApiError): void {
    setDraft(draftId, (draft) => {
      const attempts = draft.attempts + 1
      return {
        ...draft,
        send: draft.send === 'sending' ? 'queued' : draft.send,
        problem: problemFrom(error),
        attempts,
        nextTryAt: deps.now() + retryDelayMs(attempts, error.retryAfterSeconds),
      }
    })
  }

  /** Upload one photo. True when it is done; false when this draft should wait. */
  async function uploadPhoto(draftId: string, photo: DraftPhoto): Promise<boolean> {
    setPhoto(draftId, photo.id, { state: 'uploading', progress: 0 }, false)
    let assetId: string
    let uploadUrl: string
    try {
      const started = await deps.api.startUpload(await deps.tenantKey(), {
        fileName: photo.fileName,
        contentType: photo.contentType,
        sizeBytes: photo.sizeBytes,
      })
      assetId = started.assetId
      uploadUrl = started.uploadUrl
    } catch (raw) {
      const error = toApiError(raw)
      if (error.retryable || error.status === 401) {
        setPhoto(draftId, photo.id, { state: 'waiting', progress: 0 }, false)
        holdBack(draftId, error)
        return false
      }
      // the server will not take this file (its type or its size): only another photo helps
      setPhoto(draftId, photo.id, { state: 'refused', progress: 0, error: error.message })
      setDraft(draftId, (draft) => ({ ...draft, send: 'editing', problem: { kind: 'refused', message: OUTBOX_COPY.photoRefused } }))
      return false
    }

    try {
      await deps.files.put(uploadUrl, photo, (fraction) => {
        // a photo that was removed or retaken meanwhile is no longer in the draft
        setPhoto(draftId, photo.id, { progress: clamp01(fraction) }, false)
      })
    } catch (raw) {
      const error = toApiError(raw)
      if (error.retryable) {
        setPhoto(draftId, photo.id, { state: 'waiting', progress: 0 }, false)
        holdBack(draftId, error)
        return false
      }
      // Storage said no. Most often the signed address ran out while the phone
      // was offline: ask for a new one next time, a few times at most.
      const refusals = (photo.refusals ?? 0) + 1
      if (refusals >= MAX_STORAGE_REFUSALS) {
        setPhoto(draftId, photo.id, { state: 'refused', progress: 0, refusals, error: OUTBOX_COPY.photoRefused })
        setDraft(draftId, (draft) => ({ ...draft, send: 'editing', problem: { kind: 'refused', message: OUTBOX_COPY.photoRefused } }))
      } else {
        setPhoto(draftId, photo.id, { state: 'waiting', progress: 0, refusals })
      }
      return false
    }

    setPhoto(draftId, photo.id, { state: 'done', progress: 1, assetId })
    return true
  }

  const setModel = (draftId: string, index: number, patch: Partial<RoomModelFile>, save = true) =>
    setDraft(
      draftId,
      (draft) => ({ ...draft, rooms: draft.rooms.map((room, i) => (i === index && room.model ? { ...room, model: { ...room.model, ...patch } } : room)) }),
      save
    )

  /**
   * T-193: upload one room's model. True when this draft can carry on (it is up, or it was left out);
   * false when it should wait (no signal, the server is busy) and try again later.
   */
  async function uploadModel(draftId: string, index: number, model: RoomModelFile): Promise<boolean> {
    setModel(draftId, index, { state: 'uploading' }, false)
    const failed = (error: ApiError): boolean => {
      // no signal: the quote cannot go either, so the model waits with it and no try is counted (T-182)
      if (error.offline) {
        setModel(draftId, index, { state: 'waiting' })
        return false
      }
      const tries = (model.tries ?? 0) + 1
      // storage turned it down for what it is, or it keeps failing: the quote goes without it
      if (!error.retryable || tries >= MAX_MODEL_TRIES) {
        setModel(draftId, index, { state: 'dropped', tries })
        void deps.files.remove(model.uri)
        return true
      }
      setModel(draftId, index, { state: 'waiting', tries })
      return false
    }
    let started: { modelId: string; uploadUrl: string }
    try {
      started = await deps.api.startModelUpload(model.sizeBytes)
    } catch (raw) {
      return failed(toApiError(raw))
    }
    try {
      await deps.files.put(started.uploadUrl, { uri: model.uri, contentType: ROOM_MODEL_CONTENT_TYPE }, () => {})
    } catch (raw) {
      return failed(toApiError(raw))
    }
    setModel(draftId, index, { state: 'done', modelId: started.modelId })
    return true
  }

  async function send(draft: Draft): Promise<void> {
    if (!draft.request) {
      setDraft(draft.id, (d) => ({ ...d, send: 'editing' }))
      return
    }
    const byId = new Map(draft.photos.map((p) => [p.id, p]))
    const ordered = [...draft.photoOrder.filter((id) => byId.has(id)), ...draft.photos.map((p) => p.id).filter((id) => !draft.photoOrder.includes(id))]
    const assetIds = ordered.map((id) => byId.get(id)?.assetId).filter((id): id is string => Boolean(id))

    setDraft(draft.id, (d) => ({ ...d, send: 'sending', problem: null }), false)
    let created: AppCreateQuoteResponse
    try {
      created = await deps.api.createQuote({ ...withRoomModels(draft.request, draft.rooms), assetIds, clientRequestId: draft.id })
    } catch (raw) {
      const error = toApiError(raw)
      if (error.retryable || error.status === 401) {
        holdBack(draft.id, error)
        return
      }
      if (error.code === 'INVALID_ASSETS' && draft.attempts < MAX_STORAGE_REFUSALS) {
        // the photos' records are gone on the server: upload them again, then send
        setDraft(draft.id, (d) => ({
          ...d,
          send: 'queued',
          attempts: d.attempts + 1,
          photos: d.photos.map((p) => ({ ...p, state: 'waiting' as const, progress: 0, assetId: undefined })),
        }))
        return
      }
      if (error.code === 'ROOM_SCAN_NOT_IN_PLAN' && draft.request.scan !== undefined) {
        // T-194: the plan has no room scan (it changed since the scan was made): the quote goes without it,
        // never lost; a size the scan would have filled is then asked for like any other answer
        setDraft(draft.id, (d) => {
          if (!d.request) return d
          const { scan: _scan, ...request } = d.request
          void _scan
          return { ...d, request, send: 'queued' }
        })
        return
      }
      // the request itself was refused (a missing answer, a photo too few): the trade puts it right
      setDraft(draft.id, (d) => ({ ...d, send: 'editing', problem: { kind: 'refused', message: error.message }, attempts: 0, nextTryAt: 0 }))
      return
    }

    if (created.quoteViewUrl) {
      try {
        await deps.saveQuoteLink(created.quoteId, created.quoteViewUrl)
      } catch {
        // the link can be made again from the quote's page
      }
    }
    state = {
      drafts: state.drafts.filter((d) => d.id !== draft.id),
      sent: [...state.sent.filter((s) => s.draftId !== draft.id), { draftId: draft.id, quoteId: created.quoteId, held: created.status === 'held' }],
    }
    emit()
    await persist()
    for (const photo of draft.photos) await deps.files.remove(photo.uri)
    for (const room of draft.rooms) if (room.model) await deps.files.remove(room.model.uri)
  }

  async function work(): Promise<void> {
    // quotes waiting to be sent go first, then the photos of the one being written
    const order = [...state.drafts].sort((a, b) => Number(b.send !== 'editing') - Number(a.send !== 'editing'))
    const owner = deps.owner()
    for (const snapshot of order) {
      let draft = find(snapshot.id)
      // another sign-in's draft waits for its own owner
      if (!draft || draft.owner !== owner || deps.now() < draft.nextTryAt) continue

      let stalled = false
      for (const photo of draft.photos) {
        const current = find(draft.id)?.photos.find((p) => p.id === photo.id)
        if (!current || current.state !== 'waiting') continue
        if (!(await uploadPhoto(draft.id, current))) {
          stalled = true
          break
        }
      }
      draft = find(snapshot.id)
      if (!draft || stalled) continue

      // T-193: then the rooms' 3D models (a model that cannot go is left out, never the quote)
      for (const [index, room] of draft.rooms.entries()) {
        const current = find(draft.id)?.rooms[index]?.model
        if (!room.model || !current || current.state !== 'waiting') continue
        if (!(await uploadModel(draft.id, index, current))) {
          stalled = true
          break
        }
      }
      draft = find(snapshot.id)
      if (!draft || stalled) continue

      // every photo is up: nothing is wrong any more
      if (draft.problem && draft.problem.kind !== 'refused' && draft.send === 'editing') {
        setDraft(draft.id, (d) => ({ ...d, problem: null, attempts: 0 }))
      }
      if (draft.send === 'queued' && draft.photos.every((p) => p.state === 'done') && modelsSettled(draft.rooms)) {
        await send(draft)
      }
    }
  }

  return {
    getState: (): OutboxState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async load(): Promise<void> {
      let saved: string | null = null
      try {
        saved = await deps.store.read()
      } catch {
        saved = null
      }
      // anything started before the load finished is kept
      const restored = restoreState(saved)
      const known = new Set(state.drafts.map((d) => d.id))
      state = { drafts: [...state.drafts, ...restored.drafts.filter((d) => !known.has(d.id))], sent: state.sent }
      emit()
    },

    /** This sign-in's drafts: the one being written and the ones waiting to send */
    mine(): Draft[] {
      const owner = deps.owner()
      return state.drafts.filter((d) => d.owner === owner)
    },

    /** The quote being written: the unfinished one when there is one, or a new one. Null when nobody is signed in. */
    start(): Draft | null {
      const owner = deps.owner()
      if (!owner) return null
      const existing = state.drafts.find((d) => d.send === 'editing' && d.owner === owner)
      if (existing) return existing
      const draft = blankDraft(deps.newId(), owner, deps.now())
      state = { ...state, drafts: [...state.drafts, draft] }
      emit()
      void persist()
      return draft
    },

    find,

    update(id: string, patch: DraftPatch): void {
      setDraft(id, (draft) => ({ ...draft, ...patch }))
    },

    /**
     * T-193: the draft's scanned rooms. A room that is no longer there has its model file deleted; a new
     * one's model starts uploading.
     */
    setRooms(id: string, rooms: DraftRoom[]): void {
      const before = find(id)?.rooms ?? []
      const kept = new Set(rooms.map((room) => room.model?.uri).filter(Boolean))
      setDraft(id, (d) => ({ ...d, rooms }))
      for (const room of before) if (room.model && !kept.has(room.model.uri)) void deps.files.remove(room.model.uri)
      void this.pump()
    },

    /** A new photo; one per guided angle (taking it again replaces the first) */
    addPhoto(id: string, photo: NewPhoto): void {
      const draft = find(id)
      if (!draft) return
      const replaced = photo.angleId ? draft.photos.filter((p) => p.angleId === photo.angleId) : []
      setDraft(id, (d) => ({
        ...d,
        problem: d.problem?.kind === 'refused' ? null : d.problem,
        photos: [
          ...d.photos.filter((p) => !replaced.includes(p)),
          // the size is the phone's own figure: made an ordinary number before it is stored or sent (numbers.ts)
          { ...photo, sizeBytes: toNumber(photo.sizeBytes), id: deps.newId(), state: 'waiting', progress: 0 },
        ],
      }))
      for (const old of replaced) void deps.files.remove(old.uri)
      void this.pump()
    },

    removePhoto(id: string, photoId: string): void {
      const photo = find(id)?.photos.find((p) => p.id === photoId)
      if (!photo) return
      setDraft(id, (d) => {
        const photos = d.photos.filter((p) => p.id !== photoId)
        const stillRefused = photos.some((p) => p.state === 'refused')
        return { ...d, photos, problem: d.problem?.kind === 'refused' && !stillRefused ? null : d.problem }
      })
      void deps.files.remove(photo.uri)
    },

    /** "Price this job": from here it sends by itself, now or when the signal is back */
    queue(id: string, request: DraftRequest, photoOrder: string[]): void {
      setDraft(id, (draft) => ({ ...draft, send: 'queued', request, photoOrder, problem: null, attempts: 0, nextTryAt: 0 }))
      void this.pump()
    },

    /** Take a waiting quote back to change it (not while its request is on the way) */
    edit(id: string): void {
      setDraft(id, (draft) => (draft.send === 'queued' ? { ...draft, send: 'editing', problem: null, attempts: 0, nextTryAt: 0 } : draft))
    },

    discard(id: string): void {
      const draft = find(id)
      if (!draft || draft.send === 'sending') return
      state = { ...state, drafts: state.drafts.filter((d) => d.id !== id) }
      emit()
      void persist()
      for (const photo of draft.photos) void deps.files.remove(photo.uri)
      for (const room of draft.rooms) if (room.model) void deps.files.remove(room.model.uri)
    },

    /** The quote a draft became, once; null while it is still on its way */
    takeSent(draftId: string): SentQuote | null {
      const sent = state.sent.find((s) => s.draftId === draftId) ?? null
      if (sent) {
        state = { ...state, sent: state.sent.filter((s) => s.draftId !== draftId) }
        emit()
      }
      return sent
    },

    /** Is anything waiting on the network? (the screen keeps calling `pump` while there is) */
    hasWork(): boolean {
      const owner = deps.owner()
      return state.drafts.some(
        (d) =>
          d.owner === owner &&
          (d.send !== 'editing' ||
            d.photos.some((p) => p.state === 'waiting' || p.state === 'uploading') ||
            d.rooms.some((r) => r.model?.state === 'waiting' || r.model?.state === 'uploading'))
      )
    },

    /** Try now, whatever the wait was (the trade pressed "Try now", or the app came to the front) */
    retryNow(): void {
      state = { ...state, drafts: state.drafts.map((d) => (d.nextTryAt > 0 ? { ...d, nextTryAt: 0 } : d)) }
      void this.pump()
    },

    /**
     * Do what can be done now. One run at a time; a call during a run asks for
     * one more pass and is answered when that run has finished.
     */
    pump(): Promise<void> {
      if (current) {
        again = true
        return current
      }
      current = (async () => {
        try {
          do {
            again = false
            await work()
          } while (again)
        } finally {
          current = null
        }
      })()
      return current
    },
  }
}

export type Outbox = ReturnType<typeof createOutbox>
