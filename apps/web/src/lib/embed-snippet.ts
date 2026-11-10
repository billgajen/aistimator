/**
 * The widget.js embed snippet (AD-024 loader) — pure. Shared by the Share
 * page and the setup flow's last step.
 */
import { PRODUCT_NAME } from '@estimator/shared'

/** The widget.js snippet for a placement and experience (AD-024 loader). */
export function embedSnippet(opts: {
  appOrigin: string
  tenantKey: string
  placement: 'inline' | 'floating'
  experience: 'form' | 'conversational'
}): string {
  const displayAttr = opts.experience === 'conversational' ? `\n  data-display-mode="conversational"` : ''
  if (opts.placement === 'floating') {
    return `<!-- ${PRODUCT_NAME} Widget (Floating) -->
<script
  src="${opts.appOrigin}/widget.js"
  data-tenant-key="${opts.tenantKey}"
  data-mode="floating"
  data-button-text="Get an instant quote"${displayAttr}
  async
></script>`
  }
  return `<!-- ${PRODUCT_NAME} Widget (Inline) -->
<div id="estimator-widget"></div>
<script
  src="${opts.appOrigin}/widget.js"
  data-tenant-key="${opts.tenantKey}"
  data-mode="inline"
  data-container="#estimator-widget"${displayAttr}
  async
></script>`
}
