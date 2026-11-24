/**
 * T-201: what an email to a customer carries of the business and of us: the
 * business's logo (when it has one) and whether "Powered by" shows.
 *
 * "Powered by" is decided by `hasCustomBranding` (lib/plan-features.ts), the
 * very function the estimate page and the request form ask, which asks the
 * one access rule (`canUse(access, 'no_badge')`, @qolumns/shared). So an
 * email and the page it links to always agree, a payment being retried
 * included. A read that fails shows the line, as on the page.
 *
 * The HTML itself is in @qolumns/shared (customer-email.ts), shared with the
 * worker's emails.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { businessLogoUrl, type CustomerEmailBrand } from '@qolumns/shared'
import { hasCustomBranding } from '@/lib/plan-features'

export async function customerEmailBrand(db: SupabaseClient, tenantId: string | null | undefined, branding: unknown): Promise<CustomerEmailBrand> {
  const logoAssetId = (branding as { logoAssetId?: unknown } | null | undefined)?.logoAssetId
  const logoUrl = businessLogoUrl(process.env.NEXT_PUBLIC_APP_URL, logoAssetId)
  if (!tenantId) return { logoUrl, showPoweredBy: true }
  try {
    return { logoUrl, showPoweredBy: !(await hasCustomBranding(db, tenantId)) }
  } catch {
    return { logoUrl, showPoweredBy: true }
  }
}
