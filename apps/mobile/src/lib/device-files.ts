/**
 * T-182: the phone's side of the sending queue (outbox.ts): where a draft and
 * its photos are kept, and how a photo is sent.
 *
 * A photo is made smaller before it is kept (a phone camera's photo is far
 * larger than a quote needs, and a small one uploads quickly on a weak
 * signal), then copied into the app's own documents. The camera's own copy
 * sits in a cache the phone may empty at any time; a quote waiting for a
 * signal must not lose its photos to that.
 */

import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { ApiError } from './api'
import { fractionOf, toNumber } from './numbers'
import type { DraftPhoto, NewPhoto } from './outbox'

/** The longer side of a kept photo, in pixels: enough to read a rating label */
const MAX_SIDE = 2400
const JPEG_QUALITY = 0.75

const folder = () => new Directory(Paths.document, 'outbox')
const stateFile = () => new File(folder(), 'drafts.json')

function ensureFolder(): void {
  const dir = folder()
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
}

export const outboxStore = {
  async read(): Promise<string | null> {
    const file = stateFile()
    return file.exists ? file.text() : null
  },
  async write(json: string): Promise<void> {
    ensureFolder()
    const file = stateFile()
    if (!file.exists) file.create({ overwrite: true })
    await file.write(json)
  },
}

export interface PickedPhoto {
  uri: string
  width?: number
  height?: number
  mimeType?: string
  fileName?: string | null
}

/** Make the photo smaller, keep it in the app's documents, and say exactly what was kept */
export async function keepPhoto(picked: PickedPhoto, angleId: string | null): Promise<NewPhoto> {
  ensureFolder()
  const name = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const context = ImageManipulator.manipulate(picked.uri)
    // numbers from the phone go through toNumber: iOS can hand one over as a BigInt (numbers.ts)
    const width = toNumber(picked.width)
    const height = toNumber(picked.height)
    if (Math.max(width, height) > MAX_SIDE) context.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE })
    const rendered = await context.renderAsync()
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY })
    const kept = new File(folder(), `${name}.jpg`)
    await new File(saved.uri).copy(kept)
    return { uri: kept.uri, fileName: `${name}.jpg`, contentType: 'image/jpeg', sizeBytes: toNumber(kept.size), angleId }
  } catch {
    // could not be made smaller: keep the photo as the camera gave it
    const source = new File(picked.uri)
    const extension = source.extension || '.jpg'
    const kept = new File(folder(), `${name}${extension}`)
    await source.copy(kept)
    return { uri: kept.uri, fileName: `${name}${extension}`, contentType: picked.mimeType ?? 'image/jpeg', sizeBytes: toNumber(kept.size), angleId }
  }
}

/** Send one photo to its signed address, reporting how far it has got */
export async function putPhoto(uploadUrl: string, photo: Pick<DraftPhoto, 'uri' | 'contentType'>, onProgress: (fraction: number) => void): Promise<void> {
  const file = new File(photo.uri)
  // the file is gone from the phone: no number of tries will send it
  if (!file.exists) throw new ApiError(410, 'PHOTO_MISSING', 'This photo is no longer on the phone. Take it again.')
  let status: number
  try {
    const result = await file.upload(uploadUrl, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': photo.contentType },
      // the app waits for the answer, so the upload belongs to the app while it is open
      sessionType: 'foreground',
      // T-184: iOS reports these two as 64-bit integers, which reach JavaScript as BigInt. Dividing
      // them and handing the result on threw "Cannot convert BigInt to number" on every tick. They
      // are made ordinary numbers first, and a fault in showing progress can never stop an upload.
      onProgress: (event: { bytesSent?: unknown; totalBytes?: unknown }) => {
        try {
          onProgress(fractionOf(event?.bytesSent, event?.totalBytes))
        } catch {
          // progress is only a display
        }
      },
    })
    status = result.status
  } catch {
    throw new ApiError(0, 'NETWORK', 'No signal')
  }
  if (status < 200 || status >= 300) throw new ApiError(status, 'UPLOAD_FAILED', 'The photo could not be uploaded')
}

export async function removePhoto(uri: string): Promise<void> {
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // a file that will not delete is not worth stopping for
  }
}

/**
 * The business's services and questions as last seen, kept on the phone so a
 * new quote can be started with no signal at all. One file per sign-in.
 */
const cacheFile = (owner: string) => new File(folder(), `form-${owner.replace(/[^A-Za-z0-9_-]/g, '')}.json`)

export async function readFormCache<T>(owner: string): Promise<T | null> {
  try {
    const file = cacheFile(owner)
    return file.exists ? (JSON.parse(await file.text()) as T) : null
  } catch {
    return null
  }
}

export async function writeFormCache(owner: string, value: unknown): Promise<void> {
  try {
    ensureFolder()
    const file = cacheFile(owner)
    if (!file.exists) file.create({ overwrite: true })
    await file.write(JSON.stringify(value))
  } catch {
    // only a convenience: the form is asked for again next time
  }
}

/** T-194: the business's earlier names for scanned areas (lib/area-names.ts), kept with the form cache */
export async function loadAreaNames(owner: string): Promise<string[]> {
  const stored = await readFormCache<unknown>(`${owner}-areas`)
  return Array.isArray(stored) ? stored.filter((n): n is string => typeof n === 'string').slice(0, 12) : []
}

export async function saveAreaNames(owner: string, names: readonly string[]): Promise<void> {
  await writeFormCache(`${owner}-areas`, names.slice(0, 12))
}
