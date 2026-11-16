/**
 * T-174: the product's addresses (one file, shared with packages/shared/src/brand.ts).
 * Each name in `redirects` answers with a permanent redirect to the main
 * address, path and query string kept. The names in `previous` are not here:
 * they keep serving (see brand.ts).
 */
const domains = require('../../packages/shared/src/domains.json')
const domainRedirects = domains.redirects.map((host) => ({
  source: '/:path*',
  has: [{ type: 'host', value: host }],
  destination: `https://${domains.main}/:path*`,
  permanent: true,
}))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@qolumns/shared'],
  /**
   * T-152: the dashboard menu is Home, Quotes, Prices, Share, Settings.
   * Renamed pages redirect (query string kept, e.g. Stripe's ?success=true).
   * Temporary (307) so a later rename never fights a cached permanent one.
   */
  async redirects() {
    return [
      // T-174: first, so an old dashboard path on a redirected name goes straight to the main address
      ...domainRedirects,
      // T-160: "Prices" is "Services" again and "Share" is "Quote link"; old
      // bookmarks and links keep working (the query string is carried over)
      { source: '/app/prices', destination: '/app/services', permanent: false },
      { source: '/app/share', destination: '/app/quote-link', permanent: false },
      { source: '/app/widget', destination: '/app/quote-link', permanent: false },
      { source: '/app/branding', destination: '/app/settings/branding', permanent: false },
      { source: '/app/billing', destination: '/app/settings/billing', permanent: false },
    ]
  },
  /**
   * T-156: the one-tap approval page and its endpoint carry a secret in the
   * path. Never send it on as a referrer, never index it, never cache it.
   */
  async headers() {
    const secretPath = [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Cache-Control', value: 'no-store, max-age=0' },
    ]
    return [
      { source: '/approve/:token*', headers: secretPath },
      { source: '/api/public/approval/:token*', headers: secretPath },
    ]
  },
}

module.exports = nextConfig
