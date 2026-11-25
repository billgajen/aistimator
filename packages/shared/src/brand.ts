/**
 * T-152: the product's own name and defaults — one place, so customer-facing
 * and dashboard text never carries a stale name.
 *
 * T-162 (AD-045): the product is called Qolumns. Wherever people read the name
 * it comes from here. Technical identifiers (package scope, element ids,
 * message types, the mobile slug and scheme) are lower case: see EMBED_NAMES.
 */
import domains from './domains.json'

export const PRODUCT_NAME = 'Qolumns'

/**
 * T-174: where the product lives. One file (domains.json) so the web app's
 * redirects (next.config.js, which cannot import TypeScript), the deploy
 * script and the checks all read the same names.
 * - APP_DOMAIN is the main address. The app's own links never read it: they
 *   come from NEXT_PUBLIC_APP_URL (web) and APP_URL (worker), set per
 *   environment.
 * - REDIRECT_DOMAINS answer with a permanent redirect to the main address,
 *   path and query kept.
 * - PREVIOUS_DOMAINS keep serving, with no redirect: quote links, QR codes
 *   and embed code already given out point at them, and the embed loader
 *   only trusts messages from the address it was loaded from.
 */
export const APP_DOMAIN: string = domains.main
export const REDIRECT_DOMAINS: readonly string[] = domains.redirects
export const PREVIOUS_DOMAINS: readonly string[] = domains.previous

/**
 * T-162: the public names of the embed code — what a business's web page sees.
 * Identifiers, so lower case (the two globals are QolumnsWidget and QolumnsIframe).
 * The React side reads them from here. The two static loaders
 * (apps/web/public/widget.js and iframe-loader.js) cannot import, so they carry
 * the same strings and a unit test checks they match.
 */
export const EMBED_NAMES = {
  /** id of the container the inline snippet mounts into */
  containerId: 'qolumns-widget',
  /** window global of widget.js */
  widgetGlobal: 'QolumnsWidget',
  /** window global of iframe-loader.js */
  iframeGlobal: 'QolumnsIframe',
  /** postMessage type: the embedded page's height changed */
  resizeMessage: 'qolumns-resize',
  /** postMessage type: a request was submitted */
  submittedMessage: 'qolumns-submitted',
  /** CustomEvent the loaders dispatch on document after a submission */
  submittedEvent: 'qolumns:submitted',
  /** ids of the floating button and its overlay */
  launcherId: 'qolumns-floating-launcher',
  overlayId: 'qolumns-floating-overlay',
  /** prefix of the loaders' console messages */
  consolePrefix: '[qolumns]',
} as const

/**
 * T-191: the page that says how to have data deleted or an account closed (T-181). The website's footer and the
 * app's "Delete your account" row both open it, so the two cannot point at different places.
 */
export const DATA_DELETION_PATH = '/data-deletion'

/**
 * T-205: the support page. It is the App Store's "Support URL", the website's footer links to it and
 * so does the app's Account screen, so the three cannot point at different places.
 */
export const SUPPORT_PATH = '/support'

/** The brand colour a new business starts with (migration 3 default). */
export const DEFAULT_PRIMARY_COLOR = '#2563eb'

/**
 * T-154: the support address shown on the marketing site (the founder
 * section). Anything that shows it renders nothing while it is empty.
 * T-174: the address is on the product's own domain (delivered by Cloudflare
 * Email Routing to the owner's inbox).
 */
export const SUPPORT_EMAIL = 'hello@qolumns.com'

/**
 * T-177: who runs the product, for the Privacy and Terms pages. The company
 * number is not written here: it is read from NEXT_PUBLIC_COMPANY_NUMBER (a
 * public value, set per environment), and the sentence leaves it out until
 * it is set.
 */
export const OPERATOR = {
  name: 'Billiom Limited',
  registeredIn: 'England and Wales',
} as const

/** "Qolumns is run by Billiom Limited, a company registered in England and Wales (company number …)." */
export function operatorStatement(companyNumber?: string | null): string {
  const number = (companyNumber ?? '').replace(/\s+/g, ' ').trim()
  return `${PRODUCT_NAME} is run by ${OPERATOR.name}, a company registered in ${OPERATOR.registeredIn}${number ? ` (company number ${number})` : ''}.`
}

/**
 * T-187: the same facts as one short line for the site's footer, after the copyright mark and the
 * product's name: "Run by Billiom Limited, a company registered in England and Wales (company number …)."
 */
export function operatorLine(companyNumber?: string | null): string {
  const number = (companyNumber ?? '').replace(/\s+/g, ' ').trim()
  return `Run by ${OPERATOR.name}, a company registered in ${OPERATOR.registeredIn}${number ? ` (company number ${number})` : ''}.`
}

/** The law the terms are under */
export const GOVERNING_LAW = `the law of ${OPERATOR.registeredIn}`
