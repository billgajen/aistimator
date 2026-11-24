/** T-149: the full public address of a tenant's quote page (client-safe). */
export function quoteLinkUrl(appOrigin: string, slug: string): string {
  return `${appOrigin.replace(/\/+$/, '')}/quote/${slug}`
}

/**
 * T-201: the mark the dashboard's own "Open" buttons put on the quote link
 * (`?own=1`), so the business opening its own link is never taken for a
 * customer's visit. It reaches the page through a business's own address too,
 * where no sign-in cookie does. The page takes it off the address bar again
 * (components/share/OwnVisitMark).
 */
export const OWN_VISIT_PARAM = 'own'

/** The quote link as the dashboard's "Open" buttons open it */
export function ownVisitUrl(link: string): string {
  return `${link}${link.includes('?') ? '&' : '?'}${OWN_VISIT_PARAM}=1`
}
