/**
 * T-152: the Home setup checklist — pure, so every tick is testable.
 *
 * Each step ticks only on a real action by the business or its customers:
 * 1. Add a service        — an active service exists
 * 2. Check your prices    — the business confirmed them (setup's "These are my
 *                           prices", or saving a service on Prices)
 * 3. Share your quote link — the link was copied or the page had its first visit
 * 4. First real request    — a customer request arrived (not a setup test,
 *                           not a quote the business made in its own app)
 *
 * Branding is not a step any more; `hasCustomBranding` drives the tick on the
 * Settings → Branding tab.
 */
import { DEFAULT_PRIMARY_COLOR } from '@estimator/shared'

export interface ChecklistInput {
  hasService: boolean
  pricesCheckedAt: string | null | undefined
  quoteLinkCopiedAt: string | null | undefined
  quoteLinkFirstVisitAt: string | null | undefined
  hasRealRequest: boolean
}

export interface ChecklistStep {
  id: 'service' | 'prices' | 'share' | 'first_request'
  label: string
  completed: boolean
  href: string
}

export function buildChecklist(input: ChecklistInput): { steps: ChecklistStep[]; done: number; complete: boolean } {
  const steps: ChecklistStep[] = [
    { id: 'service', label: 'Add a service', completed: input.hasService, href: '/app/prices' },
    { id: 'prices', label: 'Check your prices', completed: Boolean(input.pricesCheckedAt), href: '/app/prices' },
    {
      id: 'share',
      label: 'Share your quote link',
      completed: Boolean(input.quoteLinkCopiedAt || input.quoteLinkFirstVisitAt),
      href: '/app/share',
    },
    { id: 'first_request', label: 'First real request received', completed: input.hasRealRequest, href: '/app/quotes' },
  ]
  const done = steps.filter((s) => s.completed).length
  return { steps, done, complete: done === steps.length }
}

/**
 * True only when the business really set its branding: an uploaded logo, or a
 * colour other than the starting default. (The old check ticked for every
 * tenant whose branding had no `logoAssetId` key at all, since
 * `undefined !== null`.)
 */
export function hasCustomBranding(branding: unknown): boolean {
  if (!branding || typeof branding !== 'object') return false
  const b = branding as { logoAssetId?: unknown; primaryColor?: unknown }
  const hasLogo = typeof b.logoAssetId === 'string' && b.logoAssetId.trim().length > 0
  const colour = typeof b.primaryColor === 'string' ? b.primaryColor.trim().toLowerCase() : ''
  const hasColour = colour.length > 0 && colour !== DEFAULT_PRIMARY_COLOR.toLowerCase()
  return hasLogo || hasColour
}

/** Quote sources that are the business's own work, not a customer's request */
export const BUSINESS_SOURCES = ['app'] as const
