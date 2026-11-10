import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { SettingsTabs } from '@/components/settings/SettingsTabs'
import { hasCustomBranding } from '@/lib/setup-checklist'

export const dynamic = 'force-dynamic'

/**
 * T-152: Settings is one area with tabs — Business, Branding, Billing,
 * Notifications. Each tab is its own existing page; the old /app/branding
 * and /app/billing URLs redirect here (next.config.js).
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Branding tick: only a real logo or a non-default colour (own tenant only)
  let brandingDone = false
  if (user) {
    const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
    if (profile?.tenant_id) {
      const { data: tenant } = await supabase.from('tenants').select('branding_json').eq('id', profile.tenant_id).single()
      brandingDone = hasCustomBranding((tenant as { branding_json?: unknown } | null)?.branding_json)
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Your business, branding, plan and notifications" />
      <SettingsTabs brandingDone={brandingDone} />
      <div className="mt-6">{children}</div>
    </div>
  )
}
