/**
 * T-200: the business's quote template settings (`tenants.template_json`),
 * merged on a save. Pure.
 *
 * Two pages save into this one object: Settings → Business ("Quote Template":
 * the three tick boxes and the validity days) and Settings → Branding (the
 * same four, and "Allow customers to accept quotes directly"). A save changes
 * only what it sends. Everything else the business has set is kept, whichever
 * page set it. Before T-200 the Business page's save rebuilt the object from
 * its own four fields, so `acceptQuoteEnabled` was dropped, and a missing
 * value reads as "on": the accept button came back.
 */
import type { TenantTemplate } from '@qolumns/shared'

export const DEFAULT_TEMPLATE: TenantTemplate = {
  showLineItems: true,
  includeAssumptions: true,
  includeExclusions: true,
  validityDays: 30,
}

type TemplatePatch = { [K in keyof TenantTemplate]?: unknown }

const validDays = (value: unknown): number => Math.max(1, Math.min(365, Number(value) || DEFAULT_TEMPLATE.validityDays))

/** The stored template with a save's fields laid over it; a field the save does not send is left as it is */
export function mergeTemplate(current: Partial<TenantTemplate> | null | undefined, patch: TemplatePatch | null | undefined): TenantTemplate {
  // every stored key is kept, the ones this file does not know about as well
  const merged: TenantTemplate = { ...DEFAULT_TEMPLATE, ...(current ?? {}) }
  const sent = patch ?? {}
  if (sent.showLineItems !== undefined) merged.showLineItems = Boolean(sent.showLineItems)
  if (sent.includeAssumptions !== undefined) merged.includeAssumptions = Boolean(sent.includeAssumptions)
  if (sent.includeExclusions !== undefined) merged.includeExclusions = Boolean(sent.includeExclusions)
  if (sent.validityDays !== undefined) merged.validityDays = validDays(sent.validityDays)
  // only a true or a false changes it: anything else is not an answer
  if (typeof sent.acceptQuoteEnabled === 'boolean') merged.acceptQuoteEnabled = sent.acceptQuoteEnabled
  return merged
}
