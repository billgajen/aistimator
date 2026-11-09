/**
 * LiDAR room scanning (T-138). Native on iOS with a LiDAR sensor and a
 * development build; everywhere else (Expo Go, Android, older iPhones)
 * `isRoomScanSupported()` is false and the app simply hides the option.
 */
import { requireOptionalNativeModule } from 'expo-modules-core'
import type { RoomScanRoom } from '@estimator/shared'

interface RoomScanNative {
  isSupported(): boolean
  scanRoom(): Promise<Omit<RoomScanRoom, 'name'>>
}

const native = requireOptionalNativeModule<RoomScanNative>('RoomScan')

export function isRoomScanSupported(): boolean {
  try {
    return native?.isSupported() ?? false
  } catch {
    return false
  }
}

/** Presents the scanner; resolves with one room's geometry (metres). Rejects on cancel. */
export async function scanRoom(): Promise<RoomScanRoom> {
  if (!native) throw new Error('Room scanning needs the Aistimator app build (not Expo Go)')
  return native.scanRoom()
}
