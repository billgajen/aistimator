/**
 * T-153: the public demo — one invented example business any visitor can try
 * as a customer on /demo. Its prices come from its own configuration (AD-001);
 * only these identifiers and defaults are fixed here.
 */

/** Fixed id so the seed script is idempotent */
export const DEMO_TENANT_ID = 'tnt_demo_example_home'

/** Invented, unmistakably an example */
export const DEMO_BUSINESS_NAME = 'Example Home Services'

/** Reserved in migration 36 so no real business can take it */
export const DEMO_SLUG = 'example-home-services'

/** A colour of our own (not a real company's) */
export const DEMO_PRIMARY_COLOR = '#3E6B4F'

/** Files shipped in apps/web/public/demo (drawn for this project) */
export const DEMO_LOGO_PATH = '/demo/example-home-services-logo.svg'
export const DEMO_SAMPLE_PHOTO_PATH = '/demo/sample-water-heater-label.png'

/** A demo service may take one photo at most (cost control) */
export const DEMO_MAX_PHOTOS = 1

/** Visitors' demo requests are deleted after this long */
export const DEMO_RETENTION_HOURS = 24

/** Default global cap on demo requests per day (env DEMO_DAILY_CAP overrides) */
export const DEFAULT_DEMO_DAILY_CAP = 200

/** The contact details the demo pre-fills: reserved, undeliverable, obviously fake */
export const DEMO_CONTACT = {
  name: 'Sam Sample',
  email: 'sam.sample@example.com',
  phone: '(555) 010-0199',
} as const

export function demoDailyCap(env: Record<string, string | undefined>): number {
  const n = Number.parseInt(env.DEMO_DAILY_CAP ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEMO_DAILY_CAP
}
