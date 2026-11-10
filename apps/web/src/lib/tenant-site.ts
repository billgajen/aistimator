/**
 * The tenant's widget key: its tenant_sites row, created on first need
 * (same behaviour the Widget and onboarding pages had inline).
 */
import type { createClient } from '@/lib/supabase/server'

type UserClient = Awaited<ReturnType<typeof createClient>>

export async function getOrCreateTenantKey(supabase: UserClient, tenantId: string): Promise<string> {
  const { data: site } = await supabase
    .from('tenant_sites')
    .select('tenant_key')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (site?.[0]?.tenant_key) return site[0].tenant_key as string

  const { data: created } = await supabase
    .from('tenant_sites')
    .insert({
      tenant_id: tenantId,
      domain: 'localhost',
      tenant_key: `tkey_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    })
    .select('tenant_key')
    .single()
  return (created?.tenant_key as string | undefined) || 'ERROR_NO_KEY'
}

/** The public origin for links and snippets (env first, else the request host). */
export function appOriginFrom(host: string | null): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')
  const h = host || 'localhost:3000'
  return `${h.startsWith('localhost') ? 'http' : 'https'}://${h}`
}
