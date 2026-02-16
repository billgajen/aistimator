/**
 * Estimator Widget Loader
 *
 * This script loads and initializes the Estimator widget on a page.
 * It can be included via a script tag and configured via data attributes.
 *
 * Usage:
 * <script
 *   src="https://your-domain.com/widget.js"
 *   data-tenant-key="tkey_xxx"
 *   data-mode="inline|floating"
 *   data-display-mode="form|conversational|ab-test"
 *   data-container="#my-container"
 *   data-service-id="svc_xxx"
 *   async
 * ></script>
 */

import { render, type VNode } from 'preact'
import { Widget } from './Widget'
import { ConversationalWidget } from './ConversationalWidget'
import { FloatingButton } from './FloatingButton'
import { injectStyles } from './styles'
import { getWidgetMode } from './ab-test'
import type { WidgetConfig, WidgetDisplayMode } from './types'

declare global {
  interface Window {
    EstimatorWidget?: {
      init: (config: WidgetConfig) => void
      open: () => void
      close: () => void
    }
  }
}

// Widget state
let isOpen = false
let modalContainer: HTMLElement | null = null
let config: WidgetConfig | null = null
let resolvedDisplayMode: 'form' | 'conversational' = 'form'

/**
 * Create the appropriate widget element based on display mode
 */
function createWidgetElement(
  props: { tenantKey: string; serviceId?: string; apiUrl?: string; onClose?: () => void; inline?: boolean }
): VNode {
  if (resolvedDisplayMode === 'conversational') {
    return (
      <ConversationalWidget
        tenantKey={props.tenantKey}
        serviceId={props.serviceId}
        apiUrl={props.apiUrl}
        onClose={props.onClose}
        inline={props.inline}
      />
    )
  }
  return (
    <Widget
      tenantKey={props.tenantKey}
      serviceId={props.serviceId}
      apiUrl={props.apiUrl}
      onClose={props.onClose || (() => {})}
      inline={props.inline || false}
    />
  )
}

/**
 * Initialize the widget
 */
function init(widgetConfig: WidgetConfig) {
  config = widgetConfig

  // Validate required config
  if (!config.tenantKey) {
    console.error('[Estimator] tenantKey is required')
    return
  }

  // Resolve display mode (form, conversational, or ab-test → sticky assignment)
  resolvedDisplayMode = getWidgetMode(config.displayMode)

  // Inject styles
  injectStyles()

  const mode = config.mode || 'floating'

  if (mode === 'inline') {
    initInlineMode()
  } else {
    initFloatingMode()
  }
}

/**
 * Initialize inline mode - render widget directly in a container
 */
function initInlineMode() {
  if (!config) return

  const containerId = config.container || '#estimator-widget'
  const container = document.querySelector(containerId)

  if (!container) {
    console.error(`[Estimator] Container not found: ${containerId}`)
    return
  }

  render(
    createWidgetElement({
      tenantKey: config.tenantKey,
      serviceId: config.serviceId,
      apiUrl: config.apiUrl,
      onClose: undefined,
      inline: true,
    }),
    container
  )
}

/**
 * Initialize floating mode - show a button that opens a modal
 */
function initFloatingMode() {
  if (!config) return

  // Create floating button container
  const buttonContainer = document.createElement('div')
  buttonContainer.id = 'estimator-floating-button'
  document.body.appendChild(buttonContainer)

  render(
    <FloatingButton
      onClick={open}
      label={config.buttonLabel || 'Get Quote'}
      position={config.buttonPosition || 'bottom-right'}
    />,
    buttonContainer
  )

  // Create modal container (hidden initially)
  modalContainer = document.createElement('div')
  modalContainer.id = 'estimator-modal'
  modalContainer.style.display = 'none'
  document.body.appendChild(modalContainer)
}

/**
 * Open the widget modal
 */
function open() {
  if (!config || !modalContainer || isOpen) return

  isOpen = true
  modalContainer.style.display = 'block'

  render(
    <div className="estimator-modal-overlay" onClick={handleOverlayClick}>
      <div className="estimator-modal-content" onClick={(e) => e.stopPropagation()}>
        {createWidgetElement({
          tenantKey: config.tenantKey,
          serviceId: config.serviceId,
          apiUrl: config.apiUrl,
          onClose: close,
          inline: false,
        })}
      </div>
    </div>,
    modalContainer
  )

  // Prevent body scroll
  document.body.style.overflow = 'hidden'
}

/**
 * Close the widget modal
 */
function close() {
  if (!modalContainer || !isOpen) return

  isOpen = false
  modalContainer.style.display = 'none'

  // Re-enable body scroll
  document.body.style.overflow = ''
}

/**
 * Handle overlay click (close on background click)
 */
function handleOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('estimator-modal-overlay')) {
    close()
  }
}

// Expose API on window
window.EstimatorWidget = {
  init,
  open,
  close,
}

// Auto-init from script tag attributes
function autoInit() {
  const script = document.currentScript as HTMLScriptElement | null

  if (!script) {
    // Try to find by src
    const scripts = document.querySelectorAll('script[data-tenant-key]')
    if (scripts.length === 0) return
    // Use the last one
    autoInitFromElement(scripts[scripts.length - 1] as HTMLScriptElement)
    return
  }

  autoInitFromElement(script)
}

function autoInitFromElement(script: HTMLScriptElement) {
  const tenantKey = script.dataset.tenantKey
  if (!tenantKey) return

  init({
    tenantKey,
    mode: (script.dataset.mode as 'inline' | 'floating') || 'floating',
    displayMode: (script.dataset.displayMode as WidgetDisplayMode) || undefined,
    container: script.dataset.container,
    serviceId: script.dataset.serviceId,
    buttonLabel: script.dataset.buttonLabel,
    buttonPosition: script.dataset.buttonPosition as WidgetConfig['buttonPosition'],
    apiUrl: script.dataset.apiUrl,
  })
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit)
} else {
  autoInit()
}
