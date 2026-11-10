'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PRODUCT_NAME } from '@estimator/shared'

// Extend Window interface for the widget
declare global {
  interface Window {
    EstimatorWidget?: {
      init: (config: unknown) => void
      open: () => void
      close: () => void
    }
  }
}

type Placement = 'inline' | 'floating'
type Experience = 'form' | 'conversational'

/**
 * Developer view of the widget (was the whole /demo page). T-153: /demo shows
 * the public example business; this view opens only with ?tenantKey=, which
 * the dashboard's Share page links to.
 *
 * Mirrors the dashboard's two-axis configuration: Placement (inline |
 * floating) × Experience (form | chat). Every mode renders the hosted embed
 * page in an iframe via widget.js.
 */
export function DeveloperDemo() {
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
          <p className="text-text-secondary mt-1">Test the {PRODUCT_NAME} widget embed</p>
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
  const [placement, setPlacement] = useState<Placement>('inline')
  const [experience, setExperience] = useState<Experience>('form')
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
    removeFloatingWidget()
  }

  const embedCode = useEmbedCode(placement, experience, tenantKey)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-surface shadow-warm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-text-primary">Widget Demo</h1>
          <p className="text-text-secondary mt-1">Test the {PRODUCT_NAME} widget embed</p>
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
                  Placement
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <ModeOption
                    selected={placement === 'inline'}
                    onSelect={() => setPlacement('inline')}
                    title="Inline"
                    description="Embeds on your page, auto-resizes."
                  />
                  <ModeOption
                    selected={placement === 'floating'}
                    onSelect={() => setPlacement('floating')}
                    title="Floating"
                    description="A launcher button that opens a panel."
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Experience
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <ModeOption
                    selected={experience === 'form'}
                    onSelect={() => setExperience('form')}
                    title="Step-by-step form"
                    description="Guided multi-step form with photos."
                  />
                  <ModeOption
                    selected={experience === 'conversational'}
                    onSelect={() => setExperience('conversational')}
                    title="AI chat"
                    description="Conversational intake with photo upload."
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
              Placement: <span className="font-medium">{placement}</span> | Experience:{' '}
              <span className="font-medium">{experience}</span> | Tenant Key:{' '}
              <code className="bg-background px-1 rounded">{tenantKey}</code>
            </p>

            {placement === 'inline' && (
              <div className="border rounded-warm-lg overflow-hidden">
                <IframeWidget
                  tenantKey={tenantKey}
                  mode={experience === 'conversational' ? 'conversational' : undefined}
                />
              </div>
            )}

            {placement === 'floating' && (
              <p className="text-sm text-text-muted">
                Look for the floating button in the bottom-right corner of the page.
              </p>
            )}
          </div>

          {/* The floating mode uses the real production loader */}
          {placement === 'floating' && (
            <WidgetLoader tenantKey={tenantKey} experience={experience} />
          )}
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
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <button
      onClick={onSelect}
      className={`p-3 rounded-warm-lg border-2 text-left transition-colors ${
        selected ? 'border-primary bg-primary-light' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-text-muted mt-1">{description}</div>
    </button>
  )
}

function useEmbedCode(placement: Placement, experience: Experience, tenantKey: string): string {
  const [embedCode, setEmbedCode] = useState('')

  useEffect(() => {
    const origin = window.location.origin
    const key = tenantKey || 'YOUR_TENANT_KEY'
    const displayAttr =
      experience === 'conversational' ? `\n  data-display-mode="conversational"` : ''

    let code = ''
    if (placement === 'floating') {
      code = `<!-- ${PRODUCT_NAME} Widget (Floating) -->
<script
  src="${origin}/widget.js"
  data-tenant-key="${key}"
  data-mode="floating"
  data-button-text="Get an instant quote"${displayAttr}
  async
></script>`
    } else {
      code = `<!-- ${PRODUCT_NAME} Widget (Inline) -->
<div id="estimator-widget"></div>
<script
  src="${origin}/widget.js"
  data-tenant-key="${key}"
  data-mode="inline"
  data-container="#estimator-widget"${displayAttr}
  async
></script>`
    }
    setEmbedCode(code)
  }, [placement, experience, tenantKey])

  return embedCode
}

/**
 * Inline preview: renders the embed page directly with resize handling,
 * exactly what widget.js does in inline mode.
 */
function IframeWidget({ tenantKey, mode }: { tenantKey: string; mode?: string }) {
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
      src={`/embed/${tenantKey}${mode ? `?mode=${mode}` : ''}`}
      style={{ width: '100%', height: `${height}px`, border: 'none' }}
      title="Get a Quote"
    />
  )
}

function removeFloatingWidget() {
  document.getElementById('estimator-floating-launcher')?.remove()
  document.getElementById('estimator-floating-overlay')?.remove()
  document.querySelector('script[src="/widget.js"]')?.remove()
  if (typeof window !== 'undefined' && window.EstimatorWidget) {
    delete window.EstimatorWidget
  }
}

/**
 * Loads the real production widget.js with the chosen attributes.
 */
function WidgetLoader({ tenantKey, experience }: { tenantKey: string; experience: Experience }) {
  useEffect(() => {
    removeFloatingWidget()

    const script = document.createElement('script')
    script.src = '/widget.js'
    script.dataset.tenantKey = tenantKey
    script.dataset.mode = 'floating'
    script.dataset.buttonText = 'Get an instant quote'
    if (experience === 'conversational') {
      script.dataset.displayMode = 'conversational'
    }
    document.body.appendChild(script)

    return () => {
      removeFloatingWidget()
    }
  }, [tenantKey, experience])

  return null
}
