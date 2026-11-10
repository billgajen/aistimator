/**
 * T-153: the demo business's widget key, read on the server for /demo.
 * The flag itself is never sent to a browser; the page only gets the key.
 */
import { createAdminClient } from '@/lib/supabase/server'

export async function demoTenantKey(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: tenant } = await supabase.from('tenants').select('id').eq('is_demo', true).limit(1).maybeSingle()
  if (!tenant?.id) return null
  const { data: site } = await supabase
    .from('tenant_sites')
    .select('tenant_key')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return (site?.tenant_key as string | undefined) ?? null
}
