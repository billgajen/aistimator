import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import {
  computeBenchmarks,
  type MyServiceInput,
  type BenchmarkRateInput,
} from '@estimator/shared'
import type { PricingRules } from '@estimator/shared'

/**
 * GET /api/learning/benchmarks (T-115)
 *
 * Anonymized cross-tenant rate benchmarks. Reciprocal opt-in: tenants see
 * benchmarks only while sharing their own rates. Privacy: cross-tenant reads
 * happen server-side with the admin client, but ONLY aggregates (percentiles
 * + tenant counts, k >= 3, same currency) ever leave this endpoint.
 * Informational only — never feeds pricing (AD-001).
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('benchmarks_opt_in, currency')
      .eq('id', profile.tenant_id)
      .single()

    if (!tenant?.benchmarks_opt_in) {
      return NextResponse.json({ optedIn: false, benchmarks: [] })
    }

    const admin = createAdminClient()

    // My per-unit rates
    const { data: myRules } = await admin
      .from('service_pricing_rules')
      .select('service_id, rules_json, services!service_id ( name, active )')
      .eq('tenant_id', profile.tenant_id)

    const myServices: MyServiceInput[] = (myRules || [])
      .map((row) => {
        const service = (Array.isArray(row.services) ? row.services[0] : row.services) as
          | { name?: string; active?: boolean }
          | null
        const rules = row.rules_json as PricingRules | null
        const steps = (rules?.workSteps || [])
          .filter((s) => (s.costType === 'per_unit' || s.costType === 'per_hour') && s.defaultCost > 0)
          .map((s) => ({
            unitLabel: s.unitLabel || (s.costType === 'per_hour' ? 'hour' : ''),
            rate: s.defaultCost,
          }))
          .filter((s) => s.unitLabel)
        return {
          serviceId: row.service_id as string,
          serviceName: service?.name || '',
          active: service?.active !== false,
          steps,
        }
      })
      .filter((s) => s.active && s.serviceName && s.steps.length > 0)
      .map(({ serviceId, serviceName, steps }) => ({ serviceId, serviceName, steps }))

    if (myServices.length === 0) {
      return NextResponse.json({ optedIn: true, benchmarks: [] })
    }

    // Other opted-in tenants in the SAME currency (mixing currencies corrupts medians)
    const { data: optedInTenants } = await admin
      .from('tenants')
      .select('id')
      .eq('benchmarks_opt_in', true)
      .eq('currency', tenant.currency)
      .neq('id', profile.tenant_id)
      // T-153: the public demo's example prices are never a benchmark
      .eq('is_demo', false)

    const otherTenantIds = (optedInTenants || []).map((t) => t.id)
    if (otherTenantIds.length === 0) {
      return NextResponse.json({ optedIn: true, benchmarks: [] })
    }

    const { data: otherRules } = await admin
      .from('service_pricing_rules')
      .select('tenant_id, rules_json, services!service_id ( name, active )')
      .in('tenant_id', otherTenantIds)

    const others: BenchmarkRateInput[] = []
    for (const row of otherRules || []) {
      const service = (Array.isArray(row.services) ? row.services[0] : row.services) as
        | { name?: string; active?: boolean }
        | null
      if (!service?.name || service.active === false) continue
      const rules = row.rules_json as PricingRules | null
      for (const step of rules?.workSteps || []) {
        if ((step.costType !== 'per_unit' && step.costType !== 'per_hour') || step.defaultCost <= 0) continue
        const unitLabel = step.unitLabel || (step.costType === 'per_hour' ? 'hour' : '')
        if (!unitLabel) continue
        others.push({
          tenantId: row.tenant_id as string,
          serviceName: service.name,
          unitLabel,
          rate: step.defaultCost,
        })
      }
    }

    const benchmarks = computeBenchmarks(myServices, others)

    return NextResponse.json({
      optedIn: true,
      currency: tenant.currency,
      benchmarks,
    })
  } catch (error) {
    console.error('Benchmarks error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
