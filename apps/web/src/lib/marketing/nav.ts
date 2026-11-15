/** T-154: the marketing links, shared by the desktop bar and the phone menu */
export const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/trades', label: 'Trades' },
  { href: '/demo', label: 'Try it as a customer' },
  { href: '/login', label: 'Log in' },
] as const

/** The header button's words at every width (T-165; T-155 had it below md only). In-page buttons say freeOfferLabel(). */
export const HEADER_SHORT_CTA = 'Try it free'
