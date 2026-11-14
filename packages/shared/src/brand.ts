/**
 * T-152: the product's own name and defaults — one place, so customer-facing
 * and dashboard text never carries a stale name.
 *
 * T-162 (AD-045): the product is called Qolumns. Wherever people read the name
 * it comes from here. Technical identifiers (package scope, element ids,
 * message types, the mobile slug and scheme) are lower case: see EMBED_NAMES.
 */
export const PRODUCT_NAME = 'Qolumns'

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

/** The brand colour a new business starts with (migration 3 default). */
export const DEFAULT_PRIMARY_COLOR = '#2563eb'

/**
 * T-154: the support address shown on the marketing site (founder section,
 * footer). Empty until the domain is chosen: anything that shows it renders
 * nothing while it is empty, so filling it in is one edit.
 */
export const SUPPORT_EMAIL = ''
