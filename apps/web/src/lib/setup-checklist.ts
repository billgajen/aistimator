/**
 * T-152: the Home setup checklist — pure, so every tick is testable.
 *
 * Each step ticks only on a real action by the business or its customers:
 * 1. Add a service        — a service exists, switched on or off (T-201: switching
 *                           every service off is not "no services"; Home says so
 *                           in a notice and never goes back to setup)
 * 2. Check your prices    — the business confirmed them (setup's "These are my
 *                           prices", or saving a service on Services)
 * 3. Share your quote link — the business pressed Copy or Share on its link
 *                           (dashboard or phone app), downloaded its QR code,
 *                           or its first real request arrived. T-202: opening the link ticks nothing (a
 *                           visit cannot tell the owner from a customer); a
 *                           business ticked by a visit before T-202 stays ticked.
 * 4. First real request    — a customer request arrived (not a test,
 *                           not a quote the business made in its own app)
 *
 * Branding is not a step any more; `hasCustomBranding` drives the tick on the
 * Settings → Branding tab.
 */
import { DEFAULT_PRIMARY_COLOR } from '@qolumns/shared'

export interface ChecklistInput {
  hasService: boolean
  pricesCheckedAt: string | null | undefined
  quoteLinkCopiedAt: string | null | undefined
  /** Set by a visit to the link before T-202. Nothing writes it any more; read so those businesses stay ticked. */
  quoteLinkFirstVisitAt: string | null | undefined
  hasRealRequest: boolean
}

/**
 * T-202: is "Share your quote link" done? The one rule, read by Home's
 * checklist and by the help assistant's state (lib/help/state.ts).
 */
export function quoteLinkShared(input: Pick<ChecklistInput, 'quoteLinkCopiedAt' | 'quoteLinkFirstVisitAt' | 'hasRealRequest'>): boolean {
  return Boolean(input.quoteLinkCopiedAt || input.quoteLinkFirstVisitAt) || input.hasRealRequest === true
}

export interface ChecklistStep {
  id: 'service' | 'prices' | 'share' | 'first_request'
  label: string
  completed: boolean
  href: string
}

/**
 * T-201: what Home needs to know about a business's services. `any` decides
 * whether setup is over (a service exists, on or off); `allOff` is the notice:
 * there are services and none is switched on.
 */
export function serviceState(services: ReadonlyArray<{ active?: boolean | null }> | null | undefined): { any: boolean; allOff: boolean } {
  const list = services ?? []
  const any = list.length > 0
  return { any, allOff: any && !list.some((service) => service.active === true) }
}

/** T-201: Home's notice when every service is switched off */
export const SERVICES_OFF_NOTICE = {
  text: 'All your services are off, so customers can’t get an estimate.',
  link: 'Go to Services',
} as const

export function buildChecklist(input: ChecklistInput): { steps: ChecklistStep[]; done: number; complete: boolean } {
  const steps: ChecklistStep[] = [
    { id: 'service', label: 'Add a service', completed: input.hasService, href: '/app/services' },
    { id: 'prices', label: 'Check your prices', completed: Boolean(input.pricesCheckedAt), href: '/app/services' },
    {
      id: 'share',
      label: 'Share your quote link',
      completed: quoteLinkShared(input),
      href: '/app/quote-link',
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
