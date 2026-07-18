import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow'

export const dynamic = 'force-dynamic'

/**
 * Onboarding interview (T-106) — conversational setup for new tenants.
 * Fetches tenant basics and the embed tenant key, then hands off to the
 * client-side interview flow.
 */
export default async function OnboardingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) {
    redirect('/signup?error=account_incomplete')
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, currency, tax_enabled, tax_rate')
    .eq('id', profile.tenant_id)
    .single()

  // Get or create tenant_site with tenant_key (same logic as the widget page)
  let { data: tenantSite } = await supabase
    .from('tenant_sites')
    .select('tenant_key')
    .eq('tenant_id', profile.tenant_id)
    .single()

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

  // Resolve app origin for the embed snippet
  const headersList = headers()
  const host = headersList.get('host') || 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`

  return (
    <div className="py-4">
      <OnboardingFlow
        businessName={tenant?.name || 'your business'}
        tenantKey={tenantKey}
        appOrigin={appOrigin}
        initialCurrency={tenant?.currency || 'USD'}
        initialTaxEnabled={tenant?.tax_enabled ?? false}
        initialTaxRate={tenant?.tax_rate ?? null}
      />
    </div>
  )
}
