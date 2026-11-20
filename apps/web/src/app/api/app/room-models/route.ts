import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { startModelUpload } from '@/lib/room-models'

export const dynamic = 'force-dynamic'

/**
 * POST /api/app/room-models (T-193) — the business app starts the upload of
 * a scanned room's 3D model. Body: { sizeBytes }. Answers { modelId,
 * uploadUrl }: a signed address that takes exactly that many bytes of a USDZ,
 * in the signed-in business's own folder (lib/room-models.ts). The app puts
 * the id on the room in the scan it sends with the quote. Neither the key nor
 * the address is logged.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  let body: { sizeBytes?: unknown }
  try {
    body = (await request.json()) as { sizeBytes?: unknown }
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, { status: 400 })
  }
  const started = await startModelUpload(auth.tenantId, body?.sizeBytes)
  if (!started.ok) return NextResponse.json({ error: { code: started.code, message: started.message } }, { status: started.status })
  return NextResponse.json({ modelId: started.modelId, uploadUrl: started.uploadUrl })
}
