import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow'
import { getRegion } from '@estimator/shared'
import { getOrCreateTenantKey, appOriginFrom } from '@/lib/tenant-site'
import { quoteLinkUrl } from '@/lib/quote-link-url'

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
    .select('name, region, currency, tax_enabled, tax_rate, slug')
    .eq('id', profile.tenant_id)
    .single()

  const tenantKey = await getOrCreateTenantKey(supabase, profile.tenant_id)
  const appOrigin = appOriginFrom(headers().get('host'))

  return (
    <div className="py-4">
      <OnboardingFlow
        businessName={tenant?.name || 'your business'}
        tenantKey={tenantKey}
        appOrigin={appOrigin}
        quoteLink={tenant?.slug ? quoteLinkUrl(appOrigin, tenant.slug) : null}
        initialRegion={getRegion(tenant?.region).code}
        initialCurrency={tenant?.currency || 'USD'}
        initialTaxEnabled={tenant?.tax_enabled ?? false}
        initialTaxRate={tenant?.tax_rate ?? null}
      />
    </div>
  )
}
