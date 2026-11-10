import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateTenantKey, appOriginFrom } from '@/lib/tenant-site'
import { SharePageClient } from '@/components/share/SharePageClient'

export const dynamic = 'force-dynamic'

/**
 * T-149: Share — the quote link and QR code first, the embed code second,
 * the form-field builder under Advanced. (Was /app/widget.)
 */
export default async function SharePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) redirect('/signup?error=account_incomplete')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, region, slug, slug_changed_at')
    .eq('id', profile.tenant_id)
    .single()
  if (!tenant) redirect('/signup?error=account_incomplete')

  const tenantKey = await getOrCreateTenantKey(supabase, profile.tenant_id)

  return (
    <SharePageClient
      appOrigin={appOriginFrom(headers().get('host'))}
      tenantKey={tenantKey}
      businessName={tenant.name}
      region={tenant.region}
      initialSlug={tenant.slug}
      changeable={!tenant.slug_changed_at}
    />
  )
}
