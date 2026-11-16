import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { slugProblem, slugProblemMessage } from '@/lib/tenant-slug'
import { cleanSlugOptions, hasRandomLink } from '@/lib/clean-slug-server'

type Admin = ReturnType<typeof createAdminClient>

/** Is a well-formed slug free for this tenant? (reserved, current or former slugs are not) */
async function isTaken(admin: Admin, slug: string, tenantId: string): Promise<boolean> {
  const [reserved, owner, former] = await Promise.all([
    admin.from('reserved_slugs').select('slug').eq('slug', slug).maybeSingle(),
    admin.from('tenants').select('id').eq('slug', slug).neq('id', tenantId).maybeSingle(),
    admin.from('tenant_slug_history').select('old_slug').eq('old_slug', slug).maybeSingle(),
  ])
  return Boolean(reserved.data || owner.data || former.data)
}

type Check = { slug: string; available: boolean; reason?: string; message?: string }

async function check(admin: Admin, slug: string, tenantId: string, current: string): Promise<Check> {
  if (slug === current) return { slug, available: true }
  const problem = slugProblem(slug)
  if (problem) return { slug, available: false, reason: problem, message: slugProblemMessage(problem) }
  if (await isTaken(admin, slug, tenantId)) return { slug, available: false, reason: 'taken', message: slugProblemMessage('taken') }
  return { slug, available: true }
}

/**
 * GET /api/tenant/slug[?check=<slug>]
 * The tenant's quote link slug, whether it can still be changed, and
 * (with ?check) whether a new slug is available. T-149.
 *
 * T-174: `random` says the link still ends in generated characters. Replacing
 * such a link is free (it does not use up the one change), and `options`
 * carries up to three clean, free links built from the business's own details.
 */
export async function GET(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const { data: tenant } = await auth.supabase.from('tenants').select('id, name, slug, slug_changed_at').eq('id', auth.tenantId).single()
  if (!tenant) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, { status: 404 })

  const admin = createAdminClient()
  const candidate = new URL(request.url).searchParams.get('check')
  const random = await hasRandomLink(admin, tenant)
  return NextResponse.json({
    slug: tenant.slug,
    changeable: !tenant.slug_changed_at,
    random,
    // a live check asks about one slug; the options are for the page that offers them
    ...(random && candidate === null && { options: await cleanSlugOptions(admin, auth.tenantId) }),
    ...(candidate !== null && { check: await check(admin, candidate.trim().toLowerCase(), auth.tenantId, tenant.slug) }),
  })
}

/**
 * PUT /api/tenant/slug  { slug }
 * Change the quote link once. The old slug keeps redirecting
 * (tenant_slug_history) and can never be taken by another business.
 *
 * T-174: replacing a link that still ends in generated characters is free.
 * The server decides that from the tenant's own record (never from the
 * request), the same format, reserved-word and never-reuse rules apply, and
 * the old link goes into the history table like any other. The one change
 * stays available afterwards.
 */
export async function PUT(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : ''

  const admin = createAdminClient()
  const { data: tenant } = await admin.from('tenants').select('id, name, slug, slug_changed_at').eq('id', auth.tenantId).single()
  if (!tenant) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, { status: 404 })
  if (slug === tenant.slug) return NextResponse.json({ slug, changeable: !tenant.slug_changed_at })
  const free = await hasRandomLink(admin, tenant)
  if (tenant.slug_changed_at) {
    return NextResponse.json({ error: { code: 'ALREADY_CHANGED', message: slugProblemMessage('already_changed') } }, { status: 409 })
  }

  const result = await check(admin, slug, auth.tenantId, tenant.slug)
  if (!result.available) {
    const status = result.reason === 'taken' ? 409 : 400
    return NextResponse.json({ error: { code: result.reason === 'taken' ? 'SLUG_TAKEN' : 'INVALID_SLUG', message: result.message } }, { status })
  }

  // Keep the old slug first, so it is never free for someone else even for a moment
  const { error: historyError } = await admin.from('tenant_slug_history').insert({ old_slug: tenant.slug, tenant_id: auth.tenantId })
  if (historyError && historyError.code !== '23505') {
    console.error('[Slug] history insert failed:', historyError.message)
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not change the link' } }, { status: 500 })
  }
  const { data: updated, error: updateError } = await admin
    .from('tenants')
    // a free replacement leaves slug_changed_at empty: the one change is still there
    .update(free ? { slug } : { slug, slug_changed_at: new Date().toISOString() })
    .eq('id', auth.tenantId)
    .eq('slug', tenant.slug) // a second replacement in a race finds nothing to update
    .is('slug_changed_at', null) // and so does a second change
    .select('slug')
  if (updateError) {
    await admin.from('tenant_slug_history').delete().eq('old_slug', tenant.slug).eq('tenant_id', auth.tenantId)
    const taken = updateError.code === '23505'
    return NextResponse.json(
      { error: { code: taken ? 'SLUG_TAKEN' : 'DB_ERROR', message: taken ? slugProblemMessage('taken') : 'Could not change the link' } },
      { status: taken ? 409 : 500 }
    )
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: { code: 'ALREADY_CHANGED', message: slugProblemMessage('already_changed') } }, { status: 409 })
  }
  return NextResponse.json({ slug, changeable: free, free })
}
