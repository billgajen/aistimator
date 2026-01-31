import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WidgetPageClient } from './WidgetPageClient'

export const dynamic = 'force-dynamic'

/**
 * Widget & Embed Page
 *
 * Fetches tenant key and renders the client component.
 */
export default async function WidgetPage() {
  const supabase = await createClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get user's tenant
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) {
    redirect('/signup?error=account_incomplete')
  }

  // Get or create tenant_site with tenant_key
  let { data: tenantSite } = await supabase
    .from('tenant_sites')
    .select('tenant_key')
    .eq('tenant_id', profile.tenant_id)
    .single()

  // If no tenant_site exists, create one
  if (!tenantSite) {
    const { data: newSite } = await supabase
      .from('tenant_sites')
      .insert({
        tenant_id: profile.tenant_id,
        domain: 'localhost',
        tenant_key: `tkey_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      })
      .select('tenant_key')
      .single()

    tenantSite = newSite
  }

  const tenantKey = tenantSite?.tenant_key || 'ERROR_NO_KEY'

  return <WidgetPageClient tenantKey={tenantKey} />
}
