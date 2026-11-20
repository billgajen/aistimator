import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { isRoomModelId, roomModelKey, ROOM_MODEL_URL_SECONDS } from '@/lib/room-models'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Model not found' } }, { status: 404 })

/**
 * GET /api/app/room-models/:modelId (T-194) — the address of a model the app
 * has just uploaded, before the quote it belongs to is sent, so "View in 3D"
 * works straight after a scan. The key is built from the signed-in business's
 * own folder, so another business's id opens nothing. Answers { url }, signed
 * for a few minutes. Neither the key nor the address is logged.
 */
export async function GET(_request: Request, { params }: { params: { modelId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  if (!isRoomModelId(params.modelId) || !isR2Configured()) return notFound()
  try {
    const url = await generateDownloadUrl(roomModelKey(auth.tenantId, params.modelId), ROOM_MODEL_URL_SECONDS)
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[RoomModel] could not be signed:', error instanceof Error ? error.name : 'unknown')
    return notFound()
  }
}
