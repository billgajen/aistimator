import type { Metadata } from 'next'
import { ModelPage } from './ModelPage'

export const metadata: Metadata = { title: '3D model', robots: { index: false, follow: false } }

/**
 * /room-model#src=…&name=… (T-194) — the 3D viewer on its own, for the
 * business app: "View in 3D" opens this page in the phone's in-app browser,
 * so the app shows the same viewer as the dashboard and needs no 3D library
 * of its own. The model's signed address rides in the part after "#", which
 * a browser never sends to a server, so it is in no log. Only an address on
 * our own storage (or this site) is opened.
 */
export default function RoomModelPage() {
  const endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')
  let storageHost = ''
  try {
    storageHost = endpoint ? new URL(endpoint).host : ''
  } catch {
    storageHost = ''
  }
  return <ModelPage storageHost={storageHost} />
}
