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
}

module.exports = nextConfig
