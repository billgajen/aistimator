/** T-149: the full public address of a tenant's quote page (client-safe). */
export function quoteLinkUrl(appOrigin: string, slug: string): string {
  return `${appOrigin.replace(/\/+$/, '')}/quote/${slug}`
}
