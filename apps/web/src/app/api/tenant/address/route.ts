import { NextResponse } from 'next/server'
import { ADDRESS_COPY } from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { requireTenant } from '@/lib/auth-tenant'
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { addressLater, addressView, checkAddress, chooseAddress } from '@/lib/own-address'

export const dynamic = 'force-dynamic'

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * GET /api/tenant/address[?check=<name>]  (T-199)
 * The signed-in business's own address: what it has, whether it can choose
 * one, the links to show, and (with ?check) whether a name is free, taken or
 * cannot be used. The live check is rate limited per business and fails open
 * like every limit (AD-055).
 */
export async function GET(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const view = await addressView(admin, auth.tenantId)
  if (!view) return refuse(404, 'NOT_FOUND', 'Business not found')

  const typed = new URL(request.url).searchParams.get('check')
  if (typed === null || !view.host || !view.canChoose) return NextResponse.json({ address: view })
  const limit = await checkRateLimit('address_check', { key: auth.tenantId })
  if (!limit.allowed) return rateLimitedResponse(limit)
  return NextResponse.json({ address: view, check: await checkAddress(admin, typed, auth.tenantId, view.host) })
}

/**
 * PUT /api/tenant/address  { address }
 * The business's one choice. Only for a business that can use an address
 * (the one rule) and has none; fixed once made.
 */
export async function PUT(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { address?: unknown } | null
  if (typeof body?.address !== 'string') return refuse(400, 'VALIDATION_ERROR', ADDRESS_COPY.failed)
  const admin = createAdminClient()
  const result = await chooseAddress(admin, auth.tenantId, auth.userId, body.address)
  if (!result.ok) return refuse(result.status, result.code, result.message)
  return NextResponse.json({ address: await addressView(admin, auth.tenantId) })
}

/** PATCH /api/tenant/address  { later: true }: "Later" on Home's card */
export async function PATCH(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { later?: unknown } | null
  if (body?.later !== true) return refuse(400, 'VALIDATION_ERROR', 'Nothing to change')
  const admin = createAdminClient()
  await addressLater(admin, auth.tenantId)
  return NextResponse.json({ address: await addressView(admin, auth.tenantId) })
}
