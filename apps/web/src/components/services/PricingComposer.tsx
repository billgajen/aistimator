'use client'

/**
 * Plain-language pricing composer (T-104, AD-021/AD-024).
 *
 * The business describes how they charge in plain English (or pastes a price
 * list). The AI compiles it into deterministic pricing config; the review the
 * business approves is rendered by code from the compiled config — never by AI.
 */

import { useState } from 'react'
import type { ServiceDraftConfig, AddonConfig, MultiplierConfig } from '@estimator/shared'
import { describePricingRules, type DescribablePricing } from '@/lib/pricing-describe'

export interface CompileResult {
  updatedConfig: ServiceDraftConfig
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
  ambiguities: string[]
}

interface PricingComposerProps {
  serviceName: string
  serviceDescription: string
  /** Current pricing state — sent as compile context so edits preserve it */
  current: DescribablePricing & { currentConfig?: Partial<ServiceDraftConfig> }
  currencySymbol?: string
  onApply: (result: CompileResult) => void
}

const PLACEHOLDER = `Describe how you charge, in your own words — or paste your price list. For example:

"£120 call-out fee which covers the first hour. £12 per square metre for walls, £15 for ceilings. Add 20% if ceilings are above 2.6m. Rush jobs within 48 hours are an extra £75. Minimum job £150."`

export function PricingComposer({
  serviceName,
  serviceDescription,
  current,
  currencySymbol = '$',
  onApply,
}: PricingComposerProps) {
  const [description, setDescription] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompileResult | null>(null)

  const handleCompile = async () => {
    if (!description.trim() || compiling) return
    setCompiling(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/services/ai-draft/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          serviceName,
          serviceDescription,
          currentConfig: current.currentConfig,
          currentAddons: current.addons,
          currentMultipliers: current.multipliers,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to compile pricing')
      }
      setResult(data as CompileResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile pricing')
    } finally {
      setCompiling(false)
    }
  }

  const handleApply = () => {
    if (!result) return
    onApply(result)
    setResult(null)
    setDescription('')
  }

  // Existing rules rendered in plain English (round-trip: business always reads
  // their pricing in language, never in config fields)
  const currentSections = describePricingRules(current, currencySymbol)

  // Deterministic preview of what the compiled config will actually do
  const previewSections = result
    ? describePricingRules(
        {
          baseFee: result.updatedConfig.pricing.baseFee,
          minimumCharge: result.updatedConfig.pricing.minimumCharge,
          workSteps: result.updatedConfig.pricing.workSteps,
          addons: result.addons,
          multipliers: result.multipliers,
          suggestedFields: result.updatedConfig.suggestedFields,
          expectedSignals: result.updatedConfig.expectedSignals,
        },
        currencySymbol
      )
    : []

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3">
        <h3 className="font-display text-base font-bold text-text-primary">
          Describe your pricing
        </h3>
        <p className="text-sm text-text-secondary">
          Write it the way you&apos;d explain it to a customer — we&apos;ll turn it into pricing
          rules you can review below. No forms, no formulas.
        </p>
      </div>

      {!result && currentSections.length > 0 && (
        <details className="mb-3 rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium text-text-secondary">
            Your current pricing in plain English
          </summary>
          <div className="mt-3 space-y-3">
            {currentSections.map((section) => (
              <div key={section.title}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {section.title}
                </p>
                <ul className="space-y-1">
                  {section.lines.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Describe changes below (e.g. &quot;raise the base fee to £150&quot;) — anything you
            don&apos;t mention stays as it is.
          </p>
        </details>
      )}

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={6}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        disabled={compiling}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleCompile}
          disabled={!description.trim() || compiling}
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {compiling ? 'Compiling…' : 'Compile Pricing'}
        </button>
        {compiling && (
          <span className="text-sm text-text-muted">Turning your words into pricing rules…</span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          {/* Deterministic review — rendered from the compiled config by code */}
          <div className="rounded-lg border border-border bg-background p-4">
            <h4 className="mb-3 text-sm font-bold text-text-primary">
              Here&apos;s what your pricing will do:
            </h4>
            {previewSections.length === 0 ? (
              <p className="text-sm text-text-muted">
                Nothing could be compiled from that description — try adding specific amounts and
                rates.
              </p>
            ) : (
              <div className="space-y-3">
                {previewSections.map((section) => (
                  <div key={section.title}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {section.title}
                    </p>
                    <ul className="space-y-1">
                      {section.lines.map((line, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Questions the AI needs answered instead of guessing */}
          {result.ambiguities.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <h4 className="mb-2 text-sm font-bold text-amber-900">
                A few things weren&apos;t clear — answer these in your description and recompile:
              </h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-amber-800">
                {result.ambiguities.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Apply This Pricing
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
            >
              Discard
            </button>
            <span className="text-xs text-text-muted">
              You can fine-tune everything in the editors below after applying.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
