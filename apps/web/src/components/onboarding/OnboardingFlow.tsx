'use client'

/**
 * Onboarding interview (T-106) — conversational setup that replaces the
 * 5-step wizard for the default path. Scripted flow with AI at the seams
 * (service extraction T-105, pricing compilation T-104); flow control is
 * deterministic. Target: signup → first test quote in under 10 minutes.
 */

import { useState } from 'react'
import { useCopy } from '@/components/share/useCopy'
import Link from 'next/link'
import type { ServiceDraftConfig, AddonConfig, MultiplierConfig, RegionCode } from '@estimator/shared'
import { getRegion, listRegions, currencySymbol as symbolFor } from '@estimator/shared'
import { describePricingRules } from '@/lib/pricing-describe'
import { listPacks, getPack } from '@/lib/vertical-packs'

interface OnboardingFlowProps {
  businessName: string
  tenantKey: string
  appOrigin: string
  /** T-149: the business's own quote page, shown first on the last step */
  quoteLink: string | null
  /** T-133: tenant region (US for new signups, GB for legacy tenants) */
  initialRegion: RegionCode
  initialCurrency: string
  initialTaxEnabled: boolean
  /** DB decimal rate (0.2 = 20%) or null */
  initialTaxRate: number | null
}

type Step = 'source' | 'extracting' | 'services' | 'pricing' | 'basics' | 'creating' | 'done'

interface DraftService {
  name: string
  description: string
  draft: ServiceDraftConfig
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
  selected: boolean
}

function isUnpriced(svc: DraftService): boolean {
  return svc.draft.pricing.workSteps.length === 0 && svc.draft.pricing.baseFee === 0
}

export function OnboardingFlow({
  businessName,
  tenantKey,
  appOrigin,
  quoteLink,
  initialRegion,
  initialCurrency,
  initialTaxEnabled,
  initialTaxRate,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('source')
  const [error, setError] = useState<string | null>(null)

  // Source step
  const [sourceMode, setSourceMode] = useState<'website' | 'describe' | 'template'>('website')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [businessDescription, setBusinessDescription] = useState('')
  // T-133: region first — it decides currency, units and which packs fit
  const [region, setRegion] = useState<RegionCode>(initialRegion)
  const regionDef = getRegion(region)
  // T-113: vertical pack templates (this region's packs listed first)
  const availablePacks = listPacks(region)
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)

  // Extracted services
  const [services, setServices] = useState<DraftService[]>([])

  // Pricing interview
  const [pricingQueue, setPricingQueue] = useState<number[]>([])
  const [pricingIndex, setPricingIndex] = useState(0)
  const [pricingText, setPricingText] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [compileResult, setCompileResult] = useState<{
    updatedConfig: ServiceDraftConfig
    addons: AddonConfig[]
    multipliers: MultiplierConfig[]
    ambiguities: string[]
  } | null>(null)

  // Basics
  const [currency, setCurrency] = useState(initialCurrency || 'USD')
  const [taxEnabled, setTaxEnabled] = useState(initialTaxEnabled)
  const [taxLabel, setTaxLabel] = useState(getRegion(initialRegion).copy.taxLabel)
  const [taxRatePct, setTaxRatePct] = useState(
    initialTaxRate !== null ? Math.round(initialTaxRate * 100) : 20
  )
  const [serviceArea, setServiceArea] = useState('')

  // Creation
  const [createdCount, setCreatedCount] = useState(0)

  const currencySymbol = symbolFor(currency, regionDef.locale)

  /** T-133: choosing a region applies its defaults (all still editable) */
  const handleRegionChange = (code: string) => {
    const next = getRegion(code)
    setRegion(next.code)
    setCurrency(next.currency)
    setTaxLabel(next.copy.taxLabel)
    setSelectedPackId(null)
  }

  /** T-113: apply a vertical pack — no network, no AI, instant */
  const handleApplyPack = () => {
    const pack = selectedPackId ? getPack(selectedPackId) : undefined
    if (!pack) return
    setServices(
      pack.services.map((svc) => ({
        name: svc.name,
        description: svc.description,
        draft: svc.draft,
        addons: svc.addons || [],
        multipliers: svc.multipliers || [],
        selected: true,
      }))
    )
    setError(null)
    setStep('services')
  }

  /** Step 1 → 2: extract services from website or description */
  const handleExtract = async () => {
    setError(null)
    setStep('extracting')
    try {
      const res = await fetch('/api/services/ai-draft/extract-from-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sourceMode === 'website'
            ? { url: websiteUrl.trim() }
            : { text: businessDescription.trim() }
        ),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Extraction failed')
      if (!data.services?.length) {
        throw new Error(
          sourceMode === 'website'
            ? 'No services found on that site. Try describing your services instead.'
            : 'No services could be identified. Try adding more detail about what you offer.'
        )
      }
      setServices(
        data.services.map(
          (svc: { name: string; description: string; draft: ServiceDraftConfig }) => ({
            ...svc,
            addons: [],
            multipliers: [],
            selected: true,
          })
        )
      )
      setStep('services')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStep('source')
    }
  }

  /** Step 2 → 3: confirm service selection, queue unpriced ones for interview */
  const handleConfirmServices = () => {
    const queue = services
      .map((svc, i) => ({ svc, i }))
      .filter(({ svc }) => svc.selected && isUnpriced(svc))
      .map(({ i }) => i)
    setPricingQueue(queue)
    setPricingIndex(0)
    setPricingText('')
    setCompileResult(null)
    setStep(queue.length > 0 ? 'pricing' : 'basics')
  }

  /** Pricing interview: compile the plain-language description for the current service */
  const handleCompilePricing = async () => {
    const svcIndex = pricingQueue[pricingIndex]
    if (svcIndex === undefined || !pricingText.trim() || compiling) return
    const svc = services[svcIndex]
    if (!svc) return
    setCompiling(true)
    setError(null)
    try {
      const res = await fetch('/api/services/ai-draft/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: pricingText,
          serviceName: svc.name,
          serviceDescription: svc.description,
          currentConfig: svc.draft,
          currency,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Failed to compile pricing')
      setCompileResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile pricing')
    } finally {
      setCompiling(false)
    }
  }

  /** Accept compiled pricing and advance the interview */
  const handleAcceptPricing = () => {
    const svcIndex = pricingQueue[pricingIndex]
    if (svcIndex === undefined || !compileResult) return
    setServices((prev) =>
      prev.map((svc, i) =>
        i === svcIndex
          ? {
              ...svc,
              draft: compileResult.updatedConfig,
              addons: compileResult.addons,
              multipliers: compileResult.multipliers,
            }
          : svc
      )
    )
    advancePricing()
  }

  const advancePricing = () => {
    setCompileResult(null)
    setPricingText('')
    setError(null)
    if (pricingIndex + 1 < pricingQueue.length) {
      setPricingIndex(pricingIndex + 1)
    } else {
      setStep('basics')
    }
  }

  /** Step 4 → 5: save tenant basics, then create all services */
  const handleFinish = async () => {
    setError(null)
    setStep('creating')
    setCreatedCount(0)

    try {
      // Tenant basics. NOTE: API expects tax rate as DECIMAL 0-1 (see CHANGELOG tax lessons)
      const areaValues = serviceArea
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
      const tenantRes = await fetch('/api/tenant', {
        method: 'PUT', // the tenant route exports PUT (verified: PATCH 405s)
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region,
          currency,
          taxEnabled,
          ...(taxEnabled && { taxLabel, taxRate: Math.min(100, Math.max(0, taxRatePct)) / 100 }),
          serviceAreaMode: areaValues.length > 0 ? 'postcode_allowlist' : 'none',
          serviceAreaValues: areaValues,
        }),
      })
      if (!tenantRes.ok) {
        // Guard: error responses may have no JSON body (e.g. 405)
        const data = await tenantRes.json().catch(() => null)
        throw new Error(data?.error?.message || `Failed to save business settings (${tenantRes.status})`)
      }

      // Create services (same payload shape as bulk import)
      let created = 0
      for (const svc of services.filter((s) => s.selected)) {
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: svc.name,
            description: svc.description,
            documentTypeDefault: 'instant_estimate',
            scopeIncludes: svc.draft.scope.included,
            scopeExcludes: svc.draft.scope.excluded,
            defaultAssumptions: svc.draft.scope.assumptions,
            mediaConfig: {
              minPhotos: svc.draft.media.minPhotos,
              maxPhotos: svc.draft.media.maxPhotos,
              photoGuidance: svc.draft.media.photoGuidance,
              // Guided-capture slots (T-107) — verified missing here: without
              // this line pack/AI-draft angles were silently dropped
              requiredAngles: svc.draft.media.requiredAngles,
            },
            workSteps: svc.draft.pricing.workSteps,
            expectedSignals: svc.draft.expectedSignals,
            pricingRules: {
              baseFee: svc.draft.pricing.baseFee,
              minimumCharge: svc.draft.pricing.minimumCharge,
              addons: svc.addons,
              multipliers: svc.multipliers,
              workSteps: svc.draft.pricing.workSteps,
            },
            draftConfig: svc.draft,
          }),
        })
        if (res.ok) {
          created++
          setCreatedCount(created)
        }
      }

      if (created === 0) {
        throw new Error('No services could be created — please try again')
      }
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStep('basics')
    }
  }

  const embedSnippet = `<script
  src="${appOrigin}/widget.js"
  data-tenant-key="${tenantKey}"
  data-mode="floating"
  async
></script>`
  const { copy, copiedId } = useCopy()

  const currentPricingService =
    step === 'pricing' && pricingQueue[pricingIndex] !== undefined
      ? services[pricingQueue[pricingIndex]!]
      : undefined

  const selectedCount = services.filter((s) => s.selected).length

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress */}
      <div className="mb-8 flex items-center gap-2">
        {(['source', 'services', 'pricing', 'basics', 'done'] as const).map((s, i) => {
          const stepOrder: Step[] = ['source', 'services', 'pricing', 'basics', 'done']
          const currentIdx = stepOrder.indexOf(
            step === 'extracting' ? 'source' : step === 'creating' ? 'basics' : step
          )
          return (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= currentIdx ? 'bg-secondary' : 'bg-border'
              }`}
            />
          )
        })}
      </div>

      {error && step !== 'source' && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* STEP: source */}
      {step === 'source' && (
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">
            Let&apos;s get {businessName} quoting in minutes
          </h1>
          <div className="mt-5 max-w-xs">
            <label className="mb-1 block text-sm font-medium text-text-secondary">
              Where is your business?
            </label>
            <select
              value={region}
              onChange={(e) => handleRegionChange(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {listRegions().map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-4 text-text-secondary">
            Next: where should we learn about your services?
          </p>

          <div className={`mt-6 grid gap-3 ${availablePacks.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {availablePacks.length > 0 && (
              <button
                type="button"
                onClick={() => setSourceMode('template')}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  sourceMode === 'template'
                    ? 'border-primary bg-surface'
                    : 'border-border hover:border-border-strong'
                }`}
              >
                <div className="font-semibold text-text-primary">Use a template</div>
                <div className="mt-1 text-sm text-text-secondary">
                  Ready-made setup for your trade — fastest start
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSourceMode('website')}
              className={`rounded-xl border p-4 text-left transition-colors ${
                sourceMode === 'website'
                  ? 'border-primary bg-surface'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <div className="font-semibold text-text-primary">Read my website</div>
              <div className="mt-1 text-sm text-text-secondary">
                We&apos;ll read your services and pricing pages
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('describe')}
              className={`rounded-xl border p-4 text-left transition-colors ${
                sourceMode === 'describe'
                  ? 'border-primary bg-surface'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <div className="font-semibold text-text-primary">I&apos;ll describe it</div>
              <div className="mt-1 text-sm text-text-secondary">
                Tell us what you offer in your own words
              </div>
            </button>
          </div>

          <div className="mt-4">
            {sourceMode === 'template' ? (
              <div className="space-y-2">
                {availablePacks.map((pack) => (
                  <label
                    key={pack.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                      selectedPackId === pack.id
                        ? 'border-primary bg-surface'
                        : 'border-border hover:border-border-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pack"
                      checked={selectedPackId === pack.id}
                      onChange={() => setSelectedPackId(pack.id)}
                      className="mt-1 h-4 w-4 border-border text-primary focus:ring-primary/30"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-text-primary">
                        {pack.icon} {pack.name}
                      </span>
                      <span className="mt-0.5 block text-sm text-text-secondary">
                        {pack.description}
                      </span>
                      <span className="mt-1 block text-xs text-text-muted">
                        {pack.services.length} service{pack.services.length === 1 ? '' : 's'} with
                        typical rates — review and adjust everything before going live
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : sourceMode === 'website' ? (
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && websiteUrl.trim()) handleExtract()
                }}
                placeholder="www.yourbusiness.com"
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            ) : (
              <textarea
                value={businessDescription}
                onChange={(e) => setBusinessDescription(e.target.value)}
                rows={5}
                placeholder={`e.g. "We're a painting and decorating company. We do interior painting, exterior painting, and wallpapering. Interior is priced per room, exterior depends on the size of the property..."`}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={sourceMode === 'template' ? handleApplyPack : handleExtract}
              disabled={
                sourceMode === 'template'
                  ? !selectedPackId
                  : sourceMode === 'website'
                    ? !websiteUrl.trim()
                    : !businessDescription.trim()
              }
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
            <Link href="/app/services" className="text-sm text-text-muted hover:text-text-secondary">
              Skip — set up manually instead
            </Link>
          </div>
        </div>
      )}

      {/* STEP: extracting */}
      {step === 'extracting' && (
        <div className="flex flex-col items-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-4 font-medium text-text-primary">
            {sourceMode === 'website'
              ? 'Reading your website...'
              : 'Understanding your services...'}
          </p>
          <p className="mt-1 text-sm text-text-muted">This takes up to 30 seconds</p>
        </div>
      )}

      {/* STEP: services review */}
      {step === 'services' && (
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-text-primary">
            Here&apos;s what we found
          </h1>
          <p className="mt-2 text-text-secondary">
            Untick anything you don&apos;t offer. You can edit everything later.
          </p>

          <div className="mt-6 space-y-3">
            {services.map((svc, index) => (
              <label
                key={index}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                  svc.selected ? 'border-primary' : 'border-border opacity-60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={svc.selected}
                  onChange={() =>
                    setServices((prev) =>
                      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s))
                    )
                  }
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-text-primary">{svc.name}</div>
                  {svc.description && (
                    <div className="mt-0.5 text-sm text-text-secondary">{svc.description}</div>
                  )}
                  <div className="mt-1 text-xs text-text-muted">
                    {isUnpriced(svc)
                      ? "No pricing found — we'll ask you next"
                      : `${svc.draft.pricing.workSteps.length} priced item${svc.draft.pricing.workSteps.length === 1 ? '' : 's'} found`}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirmServices}
              disabled={selectedCount === 0}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Looks right — continue
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('source')
                setError(null)
              }}
              className="text-sm text-text-muted hover:text-text-secondary"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* STEP: pricing interview */}
      {step === 'pricing' && currentPricingService && (
        <div>
          <p className="text-sm font-medium text-text-muted">
            Pricing {pricingIndex + 1} of {pricingQueue.length}
          </p>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-text-primary">
            How do you charge for {currentPricingService.name}?
          </h1>
          <p className="mt-2 text-text-secondary">
            Explain it the way you would to a customer — rates, extras, minimums. We&apos;ll turn it
            into pricing rules and show you exactly what they&apos;ll do.
          </p>

          {!compileResult && (
            <>
              <textarea
                value={pricingText}
                onChange={(e) => setPricingText(e.target.value)}
                rows={5}
                placeholder={`e.g. "${currencySymbol}120 call-out covers the first hour, then ${currencySymbol}45/hour. Add 20% for weekend jobs. Minimum charge ${currencySymbol}150."`}
                className="mt-4 w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
                disabled={compiling}
              />
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCompilePricing}
                  disabled={!pricingText.trim() || compiling}
                  className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {compiling ? 'Compiling…' : 'Set Pricing'}
                </button>
                <button
                  type="button"
                  onClick={advancePricing}
                  className="text-sm text-text-muted hover:text-text-secondary"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}

          {compileResult && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4">
                <h3 className="mb-3 text-sm font-bold text-text-primary">
                  Here&apos;s what your pricing will do:
                </h3>
                <div className="space-y-3">
                  {describePricingRules(
                    {
                      baseFee: compileResult.updatedConfig.pricing.baseFee,
                      minimumCharge: compileResult.updatedConfig.pricing.minimumCharge,
                      workSteps: compileResult.updatedConfig.pricing.workSteps,
                      addons: compileResult.addons,
                      multipliers: compileResult.multipliers,
                      suggestedFields: compileResult.updatedConfig.suggestedFields,
                      expectedSignals: compileResult.updatedConfig.expectedSignals,
                    },
                    currencySymbol
                  ).map((section) => (
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
              </div>

              {compileResult.ambiguities.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <h4 className="mb-2 text-sm font-bold text-amber-900">
                    A few things weren&apos;t clear:
                  </h4>
                  <ul className="list-inside list-disc space-y-1 text-sm text-amber-800">
                    {compileResult.ambiguities.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAcceptPricing}
                  className="inline-flex items-center rounded-lg bg-secondary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  That&apos;s right
                </button>
                <button
                  type="button"
                  onClick={() => setCompileResult(null)}
                  className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface"
                >
                  Let me rephrase
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP: basics */}
      {step === 'basics' && (
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-text-primary">
            Last step — the basics
          </h1>

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-secondary">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="USD">USD — US Dollar</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="EUR">EUR — Euro</option>
                <option value="CAD">CAD — Canadian Dollar</option>
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="NZD">NZD — New Zealand Dollar</option>
              </select>
            </div>

            <div className="rounded-xl border border-border p-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={taxEnabled}
                  onChange={(e) => setTaxEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                />
                <span className="text-sm font-medium text-text-primary">
                  Add {regionDef.copy.taxLabel.toLowerCase()} to estimates
                </span>
              </label>
              {taxEnabled && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Tax name</label>
                    <input
                      type="text"
                      value={taxLabel}
                      onChange={(e) => setTaxLabel(e.target.value)}
                      placeholder={regionDef.copy.taxLabel}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-text-muted">Rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={taxRatePct}
                      onChange={(e) => setTaxRatePct(parseFloat(e.target.value) || 0)}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-text-secondary">
                Service area <span className="font-normal text-text-muted">(optional)</span>
              </label>
              <input
                type="text"
                value={serviceArea}
                onChange={(e) => setServiceArea(e.target.value)}
                placeholder={`${regionDef.copy.postalCodeLabel}s or prefixes, comma-separated — e.g. ${regionDef.copy.postalPrefixExample}`}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1 text-xs text-text-muted">
                Leave blank to accept quote requests from anywhere
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleFinish}
            className="mt-6 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Create {selectedCount} service{selectedCount === 1 ? '' : 's'} &amp; finish
          </button>
        </div>
      )}

      {/* STEP: creating */}
      {step === 'creating' && (
        <div className="flex flex-col items-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-4 font-medium text-text-primary">
            Creating your services… {createdCount}/{selectedCount}
          </p>
        </div>
      )}

      {/* STEP: done */}
      {step === 'done' && (
        <div>
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-secondary-light">
            <svg className="h-6 w-6 text-secondary" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">
            You&apos;re ready to quote
          </h1>
          <p className="mt-2 text-text-secondary">
            {createdCount} service{createdCount === 1 ? '' : 's'} created. Here&apos;s how customers reach you:
          </p>

          <div className="mt-6 space-y-4">
            {quoteLink && (
              <div className="rounded-xl border border-border p-4">
                <h3 className="font-semibold text-text-primary">1. Your quote link</h3>
                <p className="mt-1 text-sm text-text-secondary">
                  Share it anywhere: your Google profile, social bio, texts and emails. Try it yourself first and
                  you&apos;ll get a real estimate back.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary">
                    {quoteLink}
                  </code>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => copy('link', quoteLink)}
                      className="inline-flex items-center rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      {copiedId === 'link' ? 'Copied' : 'Copy'}
                    </button>
                    <a
                      href={quoteLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface"
                    >
                      Open
                    </a>
                  </div>
                </div>
                <Link href="/app/share" className="mt-2 inline-block text-sm text-text-secondary underline underline-offset-2">
                  QR code and ready-made texts
                </Link>
              </div>
            )}

            <div className="rounded-xl border border-border p-4">
              <h3 className="font-semibold text-text-primary">{quoteLink ? '2. ' : ''}Add it to your website</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Paste this snippet before the closing <code>&lt;/body&gt;</code> tag:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-primary p-3 text-xs text-white">
                <code>{embedSnippet}</code>
              </pre>
              <button
                type="button"
                onClick={() => copy('embed', embedSnippet, { shareEvent: false })}
                className="mt-2 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface"
              >
                {copiedId === 'embed' ? 'Copied' : 'Copy Snippet'}
              </button>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/app"
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
