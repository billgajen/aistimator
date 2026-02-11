'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// Extend Window interface for the widget
declare global {
  interface Window {
    EstimatorWidget?: {
      init: (config: unknown) => void
      open: () => void
      close: () => void
    }
    EstimatorIframe?: {
      init: (config: { tenantKey: string; container: string; serviceId?: string }) => void
    }
  }
}

type EmbedMode = 'floating' | 'inline' | 'iframe'

/**
 * Widget Demo Page
 *
 * A local development page for testing the widget embed.
 * Supports three modes: floating button, inline, and iframe.
 */
export default function DemoPage() {
  return (
    <Suspense fallback={<DemoPageLoading />}>
      <DemoPageContent />
    </Suspense>
  )
}

function DemoPageLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-surface shadow-warm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-text-primary">Widget Demo</h1>
          <p className="text-text-secondary mt-1">Test the Estimator widget embed</p>
        </div>
      </div>
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </div>
  )
}

function DemoPageContent() {
  const searchParams = useSearchParams()
  const [tenantKey, setTenantKey] = useState('')
  const [mode, setMode] = useState<EmbedMode>('iframe')
  const [showDemo, setShowDemo] = useState(false)

  // Auto-fill tenant key from URL params
  useEffect(() => {
    const keyFromUrl = searchParams.get('tenantKey')
    if (keyFromUrl && !tenantKey) {
      setTenantKey(keyFromUrl)
    }
  }, [searchParams, tenantKey])

  function handleStartDemo() {
    if (!tenantKey.trim()) {
      alert('Please enter a tenant key')
      return
    }
    setShowDemo(true)
  }

  function handleReset() {
    setShowDemo(false)
    // Remove any existing widget elements
    const floatingBtn = document.getElementById('estimator-floating-button')
    const modal = document.getElementById('estimator-modal')
    const widgetContainer = document.getElementById('widget-container')
    const iframeContainer = document.getElementById('iframe-container')

    if (floatingBtn) floatingBtn.remove()
    if (modal) modal.remove()
    if (widgetContainer) widgetContainer.innerHTML = ''
    if (iframeContainer) iframeContainer.innerHTML = ''

    // Remove styles
    const styles = document.getElementById('estimator-widget-styles')
    if (styles) styles.remove()

    // Reset globals
    if (typeof window !== 'undefined') {
      if (window.EstimatorWidget) delete window.EstimatorWidget
    }
  }

  const embedCode = useEmbedCode(mode, tenantKey)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-surface shadow-warm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-text-primary">Widget Demo</h1>
          <p className="text-text-secondary mt-1">Test the Estimator widget embed</p>
        </div>
      </div>

      {/* Configuration */}
      {!showDemo && (
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-surface rounded-warm-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Configuration</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Tenant Key
                </label>
                <input
                  type="text"
                  value={tenantKey}
                  onChange={(e) => setTenantKey(e.target.value)}
                  placeholder="tkey_xxx"
                  className="w-full px-3 py-2 border rounded-warm-lg focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <p className="text-xs text-text-muted mt-1">
                  Get this from your tenant settings in the dashboard
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Embed Mode
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <ModeOption
                    mode="iframe"
                    currentMode={mode}
                    onSelect={setMode}
                    title="Iframe"
                    description="Recommended. Easy to embed, auto-resizes."
                  />
                  <ModeOption
                    mode="floating"
                    currentMode={mode}
                    onSelect={setMode}
                    title="Floating"
                    description="Shows a button that opens a modal."
                  />
                  <ModeOption
                    mode="inline"
                    currentMode={mode}
                    onSelect={setMode}
                    title="Inline"
                    description="Renders directly in a container."
                  />
                </div>
              </div>

              <button
                onClick={handleStartDemo}
                className="w-full bg-primary text-white py-2 px-4 rounded-warm-lg font-medium hover:bg-primary-hover"
              >
                Load Widget
              </button>
            </div>
          </div>

          {/* Embed code preview */}
          <div className="bg-surface rounded-warm-lg shadow p-6 mt-6">
            <h2 className="text-lg font-semibold mb-4">Embed Code</h2>
            <p className="text-sm text-text-secondary mb-4">
              Copy this code to embed the widget on your website:
            </p>

            <pre className="bg-gray-900 text-gray-100 p-4 rounded-warm-lg text-sm overflow-x-auto whitespace-pre-wrap">
              {embedCode}
            </pre>

            <button
              onClick={() => {
                navigator.clipboard.writeText(embedCode)
                alert('Copied to clipboard!')
              }}
              className="mt-4 px-4 py-2 text-sm border border-border rounded-warm-lg hover:bg-background"
            >
              Copy to Clipboard
            </button>
          </div>
        </div>
      )}

      {/* Demo area */}
      {showDemo && (
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-surface rounded-warm-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Widget Preview</h2>
              <button
                onClick={handleReset}
                className="text-sm text-text-secondary hover:text-text-primary"
              >
                Reset Demo
              </button>
            </div>

            <p className="text-sm text-text-secondary mb-4">
              Mode: <span className="font-medium">{mode}</span> |
              Tenant Key: <code className="bg-background px-1 rounded">{tenantKey}</code>
            </p>

            {mode === 'iframe' && (
              <div id="iframe-container" className="border rounded-warm-lg overflow-hidden">
                <IframeWidget tenantKey={tenantKey} />
              </div>
            )}

            {mode === 'inline' && (
              <div
                id="widget-container"
                className="border-2 border-dashed border-border rounded-warm-lg p-4"
              >
                <p className="text-text-muted text-center">Widget will load here</p>
              </div>
            )}

            {mode === 'floating' && (
              <p className="text-sm text-text-muted">
                Look for the floating button in the bottom-right corner of the page.
              </p>
            )}
          </div>

          {/* Inject the widget script for non-iframe modes */}
          {mode !== 'iframe' && <WidgetLoader tenantKey={tenantKey} mode={mode} />}
        </div>
      )}

      {/* Simulated page content */}
      {showDemo && (
        <div className="max-w-4xl mx-auto px-4 pb-20">
          <div className="bg-surface rounded-warm-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Sample Page Content</h2>
            <p className="text-text-secondary mb-4">
              This is example page content to demonstrate how the widget looks
              when embedded on a real website.
            </p>
            <p className="text-text-secondary mb-4">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function ModeOption({
  mode,
  currentMode,
  onSelect,
  title,
  description,
}: {
  mode: EmbedMode
  currentMode: EmbedMode
  onSelect: (mode: EmbedMode) => void
  title: string
  description: string
}) {
  const isSelected = mode === currentMode
  return (
    <button
      onClick={() => onSelect(mode)}
      className={`p-3 rounded-warm-lg border-2 text-left transition-colors ${
        isSelected
          ? 'border-primary bg-primary-light'
          : 'border-border hover:border-border'
      }`}
    >
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-text-muted mt-1">{description}</div>
    </button>
  )
}

function useEmbedCode(mode: EmbedMode, tenantKey: string): string {
  const [embedCode, setEmbedCode] = useState('')

  useEffect(() => {
    const origin = window.location.origin
    const key = tenantKey || 'YOUR_TENANT_KEY'

    let code = ''
    switch (mode) {
      case 'iframe':
        code = `<!-- Estimator Widget (Iframe) -->
<div id="estimator-widget"></div>
<script
  src="${origin}/iframe-loader.js"
  data-tenant-key="${key}"
  data-container="#estimator-widget"
  async
></script>`
        break

      case 'floating':
        code = `<!-- Estimator Widget (Floating) -->
<script
  src="${origin}/widget.js"
  data-tenant-key="${key}"
  data-mode="floating"
  data-button-label="Get Quote"
  async
></script>`
        break

      case 'inline':
        code = `<!-- Estimator Widget (Inline) -->
<div id="estimator-widget"></div>
<script
  src="${origin}/widget.js"
  data-tenant-key="${key}"
  data-mode="inline"
  data-container="#estimator-widget"
  async
></script>`
        break
    }
    setEmbedCode(code)
  }, [mode, tenantKey])

  return embedCode
}

/**
 * Iframe widget component
 */
function IframeWidget({ tenantKey }: { tenantKey: string }) {
  const [height, setHeight] = useState(400)

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'estimator-resize' && event.data?.tenantKey === tenantKey) {
        setHeight(event.data.height)
      }
      if (event.data?.type === 'estimator-submitted') {
        console.log('Quote submitted:', event.data)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [tenantKey])

  return (
    <iframe
      src={`/embed/${tenantKey}`}
      style={{ width: '100%', height: `${height}px`, border: 'none' }}
      title="Get a Quote"
    />
  )
}

/**
 * Component to dynamically load the JS widget
 */
function WidgetLoader({ tenantKey, mode }: { tenantKey: string; mode: string }) {
  useEffect(() => {
    initWidgetDemo(tenantKey, mode)

    return () => {
      // Cleanup on unmount
      const floatingBtn = document.getElementById('estimator-floating-button')
      const modal = document.getElementById('estimator-modal')
      const script = document.querySelector('script[src="/widget.js"]')
      if (floatingBtn) floatingBtn.remove()
      if (modal) modal.remove()
      if (script) script.remove()
      // Reset body scroll if modal was open
      document.body.style.overflow = ''
    }
  }, [tenantKey, mode])

  return null
}

/**
 * Initialize widget for demo
 */
function initWidgetDemo(tenantKey: string, mode: string) {
  if (typeof window === 'undefined') return

  // Load the actual widget.js script
  const existingScript = document.querySelector('script[src="/widget.js"]')
  if (existingScript) {
    existingScript.remove()
  }

  // Clean up any existing widget elements
  const existingButton = document.getElementById('estimator-floating-button')
  const existingModal = document.getElementById('estimator-modal')
  if (existingButton) existingButton.remove()
  if (existingModal) existingModal.remove()

  // Create and inject the widget script with proper data attributes
  const script = document.createElement('script')
  script.src = '/widget.js'
  script.dataset.tenantKey = tenantKey
  script.dataset.mode = mode
  if (mode === 'inline') {
    script.dataset.container = '#widget-container'
  }
  script.dataset.buttonLabel = 'Get Quote'
  document.body.appendChild(script)
}

