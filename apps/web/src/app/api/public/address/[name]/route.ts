import { NextResponse } from 'next/server'
import { headers as requestHeaders } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { lookupAddress, ownAddressHost } from '@/lib/own-address'

export const dynamic = 'force-dynamic'

/** How long an answer may be reused (the Worker and the CDN): a plan that ends stops serving within this */
const REUSE_SECONDS = 60

/**
 * GET /api/public/address/:name  (T-199)
 * For the Worker that serves businesses' own addresses: `{ slug, serve }`.
 * `serve` true: show the quote page at the address. False: the business
 * cannot use its address now, so answer with a redirect to its quote link.
 * 404: nobody's address.
 *
 * Public and read-only. It says nothing that the address itself does not
 * (the quote link's name), and nothing about the business's plan beyond what
 * anyone sees by opening the address.
 */
export async function GET(_request: Request, { params }: { params: { name: string } }) {
  // Reading the request's headers is what makes every call look the business up afresh. Without it
  // the database reads inside this route are reused, and an address whose plan ended kept answering
  // "serve" (found by running it; the quote page has the same line for the same reason, T-178).
  requestHeaders()
  const headers = { 'Cache-Control': `public, max-age=0, s-maxage=${REUSE_SECONDS}` }
  const name = (params.name || '').trim().toLowerCase()
  const found = ownAddressHost() ? await lookupAddress(createAdminClient(), name) : null
  if (!found) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not an address' } }, { status: 404, headers })
  return NextResponse.json(found, { headers })
}
