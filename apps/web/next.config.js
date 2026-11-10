/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@estimator/shared'],
  /**
   * T-152: the dashboard menu is Home, Quotes, Prices, Share, Settings.
   * Renamed pages redirect (query string kept, e.g. Stripe's ?success=true).
   * Temporary (307) so a later rename never fights a cached permanent one.
   */
  async redirects() {
    return [
      { source: '/app/services', destination: '/app/prices', permanent: false },
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
