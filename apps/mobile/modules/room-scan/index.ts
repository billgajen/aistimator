/**
 * LiDAR room scanning (T-138). Native on iOS with a LiDAR sensor and a build
 * of the app that carries the scanner (a development build or the store
 * build). Expo Go cannot carry it: there the app says so on the scan card
 * instead of hiding the card (T-184), so the scan can always be found.
 */
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import type { RoomScanRoom } from '@qolumns/shared'

/**
 * T-193: what the scanner hands back: the room's geometry, and its 3D model (RoomPlan's USDZ) as a file in
 * the app's documents when the export worked. The model is not part of the scan that is sent: the outbox
 * uploads it and puts its id on the room.
 */
export interface ScannedRoom extends Omit<RoomScanRoom, 'name' | 'modelId'> {
  modelUri?: string
  modelSizeBytes?: number
}

interface RoomScanNative {
  isSupported(): boolean
  scanRoom(): Promise<ScannedRoom>
  previewModel(uri: string): Promise<void>
  removeModel(uri: string): void
}

const native = requireOptionalNativeModule<RoomScanNative>('RoomScan')

/**
 *   ready           this phone can scan now
 *   needs_full_app  an iPhone running the app without the scanner in it (Expo Go)
 *   no_lidar        the full app on an iPhone that has no LiDAR sensor
 *   not_ios         not an iPhone
 */
export type RoomScanAvailability = 'ready' | 'needs_full_app' | 'no_lidar' | 'not_ios'

export function roomScanAvailability(): RoomScanAvailability {
  if (Platform.OS !== 'ios') return 'not_ios'
  if (!native) return 'needs_full_app'
  try {
    return native.isSupported() ? 'ready' : 'no_lidar'
  } catch {
    return 'no_lidar'
  }
}

/** What the scan card says when the scan cannot be started here; null when it can */
export function roomScanBlockedLine(availability: RoomScanAvailability): string | null {
  if (availability === 'ready') return null
  if (availability === 'needs_full_app') return 'Room scan needs the full app'
  if (availability === 'no_lidar') return 'This iPhone has no LiDAR sensor (it is on Pro models)'
  return 'Room scan needs an iPhone with LiDAR'
}

export function isRoomScanSupported(): boolean {
  return roomScanAvailability() === 'ready'
}

/** Presents the scanner; resolves with one room's geometry (metres) and its model file. Rejects on cancel. */
export async function scanRoom(): Promise<ScannedRoom> {
  if (!native) throw new Error('Room scan needs the full app')
  return native.scanRoom()
}

/** T-193: can this build show a 3D model? (the full app on an iPhone) */
export function canPreviewModel(): boolean {
  return Platform.OS === 'ios' && Boolean(native)
}

/** T-193: shows a room's 3D model in iOS Quick Look: a file on the phone, or a signed https address */
export async function previewModel(uri: string): Promise<void> {
  if (!native) throw new Error('The 3D model needs the full app')
  return native.previewModel(uri)
}

/** T-193: deletes a model file from the phone (never throws) */
export function removeModelFile(uri: string): void {
  try {
    native?.removeModel(uri)
  } catch {
    // a file that will not delete is not worth stopping for
  }
}
