/**
 * Plan definition → API/view shape (T-134). One mapping for the billing API
 * and the public pricing page, so numbers are never duplicated.
 */

import type { PlanDefinition, PlanInfo } from '@estimator/shared'

export function toPlanInfo(plan: PlanDefinition, currency = 'USD'): PlanInfo {
  const cur = plan.monthlyPrice[currency] !== undefined ? currency : Object.keys(plan.monthlyPrice)[0] ?? 'USD'
  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    monthlyEstimateLimit: plan.quoteLimit,
    priceCents: plan.monthlyPrice[cur] ?? 0,
    annualPriceCents: plan.annualPrice?.[cur] ?? null,
    currency: cur.toLowerCase(),
    overagePriceCents: plan.overageEnabled ? plan.overagePriceCents ?? null : null,
    trialDays: plan.trialDays ?? null,
    channels: plan.channels,
    recommended: Boolean(plan.recommended),
    features: {
      pdfGeneration: plan.features.pdf_generation,
      emailNotifications: plan.features.email_notifications,
      customBranding: plan.features.custom_branding,
      prioritySupport: plan.features.priority_support,
      apiAccess: plan.features.api_access,
      calibrationInsights: plan.features.calibration_insights,
      lidarScanning: plan.features.lidar_scanning,
      multipleUsers: plan.features.multiple_users,
    },
  }
}
