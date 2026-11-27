'use client'

/**
 * Plain-language pricing composer (T-104, AD-021/AD-024).
 *
 * The business describes how they charge in plain English (or pastes a price
 * list). The AI compiles it into deterministic pricing config; the review the
 * business approves is rendered by code from the compiled config — never by AI.
 */

import { useEffect, useState } from 'react'
import type { ServiceDraftConfig, AddonConfig, MultiplierConfig, PricingFlag, LinkRepair } from '@qolumns/shared'
import { describePricingRules, type DescribablePricing } from '@/lib/pricing-describe'
import type { LeftOut } from '@/lib/pricing-left-out'
import { LeftOutNote } from '@/components/services/LeftOutNote'
import { PricingFlagsNote } from '@/components/services/PricingFlagsNote'

export interface CompileResult {
  updatedConfig: ServiceDraftConfig
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
  ambiguities: string[]
  /** T-201: what did not fit in one service (ten price lines, ten questions), by name. Absent when all fitted. */
  leftOut?: LeftOut
  /** T-204: what the code tied after the AI's answer (a line to its question, "each additional" to the answer minus 1) */
  linked?: LinkRepair[]
  /** T-204: what is still loose. Shown here and on "Test & Publish"; it never blocks applying or saving. */
  flags?: PricingFlag[]
}

/**
 * T-204: what is shown while the compile runs. It is one request that takes about half a minute, so
 * the steps follow the clock: the first two are the AI's work, the last is the code that checks its
 * answer. Each stays until the next is due; the last stays until the answer is in.
 */
export const COMPILE_STEPS: ReadonlyArray<{ after: number; label: string }> = [
  { after: 0, label: 'Reading your prices…' },
  { after: 9, label: 'Making questions…' },
  { after: 22, label: 'Checking…' },
]

/** The step to show after `seconds` of compiling */
export function compileStepAt(seconds: number): number {
  let index = 0
  COMPILE_STEPS.forEach((step, i) => {
    if (seconds >= step.after) index = i
  })
  return index
}

interface PricingComposerProps {
  serviceName: string
  serviceDescription: string
  /** Current pricing state — sent as compile context so edits preserve it */
  current: DescribablePricing & { currentConfig?: Partial<ServiceDraftConfig> }
  currencySymbol?: string
  onApply: (result: CompileResult) => void
  /** T-207: something small beside the heading (the service editor's guide link) */
  aside?: React.ReactNode
}

/** The example in the box, in the business's own currency (T-201: it was typed in pounds for everyone) */
const placeholder = (c: string) => `Describe how you charge, in your own words — or paste your price list. For example:

"${c}120 call-out fee which covers the first hour. ${c}12 per square metre for walls, ${c}15 for ceilings. Add 20% if ceilings are above 2.6m. Rush jobs within 48 hours are an extra ${c}75. Minimum job ${c}150."`

export function PricingComposer({
  serviceName,
  serviceDescription,
  current,
  currencySymbol = '$',
  onApply,
  aside,
}: PricingComposerProps) {
  const [description, setDescription] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompileResult | null>(null)
  const [step, setStep] = useState(0)

  // T-204: the steps shown while it works
  useEffect(() => {
    if (!compiling) return
    const started = Date.now()
    setStep(0)
    const timer = setInterval(() => setStep(compileStepAt((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [compiling])

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
        {/* T-207: the service editor puts its guide beside this heading */}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <h3 className="font-display text-base font-bold text-text-primary">
            Describe your pricing
          </h3>
          {aside}
        </div>
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
            Describe changes below (e.g. &quot;raise the base fee to {currencySymbol}150&quot;) — anything you
            don&apos;t mention stays as it is.
          </p>
        </details>
      )}

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={placeholder(currencySymbol)}
        rows={6}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2"
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
      </div>

      {compiling && (
        <ol className="mt-3 space-y-1.5" aria-live="polite" data-testid="compile-steps">
          {COMPILE_STEPS.map((item, index) => (
            <li
              key={item.label}
              data-state={index < step ? 'done' : index === step ? 'now' : 'next'}
              className={`flex items-center gap-2 text-sm ${index === step ? 'font-semibold text-text-primary' : index < step ? 'text-secondary' : 'text-text-muted'}`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${index < step ? 'bg-secondary' : index === step ? 'bg-primary' : 'border border-field'}`}
              />
              {item.label}
            </li>
          ))}
          <li className="pt-1 text-xs text-text-muted">This usually takes about half a minute.</li>
        </ol>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-danger-line bg-danger-light p-3 text-sm text-danger">
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

          {/* T-201: what did not fit in one service, by name, before anything is applied */}
          <LeftOutNote leftOut={result.leftOut} />

          {/* T-204: what is still loose. It stays visible here and on "Test & Publish"; applying is allowed. */}
          <PricingFlagsNote
            flags={result.flags}
            testId="compile-flags"
            title="Worth a look before you apply"
            hint={'Say in your description what each one depends on and compile again, or apply and link them on "Pricing Setup".'}
          />

          {/* Questions the AI needs answered instead of guessing */}
          {result.ambiguities.length > 0 && (
            <div className="rounded-lg border border-tertiary-line bg-tertiary-light p-4">
              <h4 className="mb-2 text-sm font-bold text-tertiary">
                A few things weren&apos;t clear — answer these in your description and recompile:
              </h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-tertiary">
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
