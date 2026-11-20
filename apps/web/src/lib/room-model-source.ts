/**
 * T-194: may the /room-model page open this address? Only an https address
 * on our own storage (the R2 endpoint, or a bucket under it) or on this site.
 * Anything else, a page somewhere else included, is refused. Pure.
 */
export function modelSourceAllowed(src: string, opts: { storageHost: string; pageOrigin: string }): boolean {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }
  if (url.origin === opts.pageOrigin) return true
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = opts.storageHost.toLowerCase()
  if (!host) return false
  return url.host === host || url.host.endsWith(`.${host}`)
}
