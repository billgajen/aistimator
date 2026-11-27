'use client'

/**
 * T-204: "Test Your Pricing" on a service's "Test & Publish" step.
 *
 * The business types sample answers, and details the customer's photos would
 * give (a size read from a label, a measured area), and sees the price a
 * customer would get. The price comes from the worker's own pricing pipeline
 * (POST /api/services/preview-price): this component adds nothing up. It used
 * to, with a copy of the maths that ignored a line's condition, a formula and
 * "left empty = 0", so every conditional line looked as if it was always
 * charged.
 */
import { useMemo, useState } from 'react'
import { linkWordsOf, minimumChargeNote, splitMinimum } from '@qolumns/shared'
import type { ExpectedSignalConfig, SuggestedField, WorkStepConfig } from '@qolumns/shared'
import { measuredLines, sampleNote } from '@/lib/sample-price'
import { photoDetails, photoKey, type PreviewPrice, type PreviewValues } from '@/lib/pricing-preview'
import type { ServiceCreateBody } from '@/lib/service-rows'
import { GuideLink } from '@/components/guide/GuideLink'

interface PricingTestProps {
  /** The service as the editor would save it */
  service: ServiceCreateBody
  serviceId?: string
  currencySymbol: string
  /** Told each time a price is worked out (true) or the sample values change (false) */
  onTested?: (tested: boolean) => void
}

const INPUT = 'w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2'

const sentence = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

export function PricingTest({ service, serviceId, currencySymbol, onTested }: PricingTestProps) {
  const [values, setValues] = useState<PreviewValues>({})
  const [price, setPrice] = useState<PreviewPrice | null>(null)
  const [sampled, setSampled] = useState<Array<{ signalKey: string; size: number }>>([])
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const fields = useMemo(() => (service.suggestedFields ?? []) as SuggestedField[], [service.suggestedFields])
  const workSteps = useMemo(() => (service.workSteps ?? []) as WorkStepConfig[], [service.workSteps])
  const expectedSignals = useMemo(() => (service.expectedSignals ?? []) as ExpectedSignalConfig[], [service.expectedSignals])

  const measured = measuredLines({ workSteps, expectedSignals }, values as Record<string, string | number | boolean>)
  const details = photoDetails({ workSteps, expectedSignals, suggestedFields: fields })
  const money = (amount: number) => `${amount < 0 ? '-' : ''}${currencySymbol}${Math.abs(amount).toFixed(2)}`

  const set = (key: string, value: string | number | boolean | string[]) => {
    setValues((previous) => ({ ...previous, [key]: value }))
    setPrice(null)
    setProblem(null)
    onTested?.(false)
  }

  const calculate = async () => {
    setWorking(true)
    setProblem(null)
    try {
      const response = await fetch('/api/services/preview-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, values, serviceId }),
      })
      const data = (await response.json().catch(() => null)) as { price?: PreviewPrice; sampled?: Array<{ signalKey: string; size: number }>; error?: { message?: string } } | null
      if (!response.ok || !data?.price) {
        setPrice(null)
        setProblem(data?.error?.message || 'The test price is not available right now. Try again in a moment.')
        onTested?.(false)
        return
      }
      setPrice(data.price)
      setSampled(data.sampled ?? [])
      onTested?.(true)
    } catch {
      setPrice(null)
      setProblem('The test price is not available right now. Try again in a moment.')
      onTested?.(false)
    } finally {
      setWorking(false)
    }
  }

  const numberFields = fields.filter((f) => f.type === 'number')
  const choiceFields = fields.filter((f) => f.type === 'dropdown' || f.type === 'radio')
  const manyFields = fields.filter((f) => f.type === 'checkbox' && (f.options?.length ?? 0) > 0)
  const tickFields = fields.filter((f) => f.type === 'boolean' || (f.type === 'checkbox' && (f.options?.length ?? 0) === 0))
  const nothingToAsk = numberFields.length + choiceFields.length + manyFields.length + tickFields.length + measured.length + details.length === 0

  // What the result needs in words
  const { lines, minimum } = splitMinimum(price?.lines ?? [])
  const chargedIds = new Set((price?.steps ?? []).map((step) => step.id).filter(Boolean))
  const unmeasuredIds = new Set((price?.unmeasured ?? []).map((line) => line.stepId))
  const notIncluded = price ? workSteps.filter((step) => !chargedIds.has(step.id) && !unmeasuredIds.has(step.id)) : []
  const sampledWords = sampled.map(({ signalKey, size }) => {
    const step = workSteps.find((s) => s.quantitySource?.signalKey === signalKey)
    return `${step?.name || signalKey}: ${size.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${step?.unitLabel || 'units'}`
  })
  const note = price ? sampleNote({ unmeasured: price.unmeasured.map((line) => line.name), sampled: sampledWords }) : null

  return (
    <div className="space-y-6" data-testid="pricing-test">
      <div>
        {/* T-207: the guide for this step, beside its heading */}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <h3 className="text-base font-medium text-text-primary">Test Your Pricing</h3>
          <GuideLink id="test-pricing" />
        </div>
        <p className="mb-3 text-sm text-text-muted">
          Enter a customer&apos;s answers to see the price they would get. It is worked out the same way as a real request.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h4 className="mb-3 text-sm font-medium text-text-primary">The customer&apos;s answers</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          {numberFields.map((field) => (
            <div key={field.fieldId}>
              <label htmlFor={`test-${field.fieldId}`} className="mb-1 block text-sm text-text-secondary">
                {field.label}
              </label>
              <input
                id={`test-${field.fieldId}`}
                type="number"
                min={0}
                value={values[field.fieldId] === undefined ? '' : String(values[field.fieldId])}
                onChange={(e) => set(field.fieldId, e.target.value)}
                placeholder={field.required || field.criticalForPricing ? '' : 'Left empty'}
                className={INPUT}
              />
            </div>
          ))}
          {choiceFields.map((field) => (
            <div key={field.fieldId}>
              <label htmlFor={`test-${field.fieldId}`} className="mb-1 block text-sm text-text-secondary">
                {field.label}
              </label>
              <select id={`test-${field.fieldId}`} value={(values[field.fieldId] as string) || ''} onChange={(e) => set(field.fieldId, e.target.value)} className={INPUT}>
                <option value="">Select...</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {manyFields.map((field) => {
            const chosen = Array.isArray(values[field.fieldId]) ? (values[field.fieldId] as string[]) : []
            return (
              <fieldset key={field.fieldId}>
                <legend className="mb-1 block text-sm text-text-secondary">{field.label}</legend>
                <div className="space-y-1">
                  {field.options?.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={chosen.includes(option)}
                        onChange={(e) => set(field.fieldId, e.target.checked ? [...chosen, option] : chosen.filter((o) => o !== option))}
                        className="h-4 w-4 rounded-sm border-border text-primary"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
          {tickFields.map((field) => (
            <div key={field.fieldId} className="flex items-center pt-6">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={values[field.fieldId] === true} onChange={(e) => set(field.fieldId, e.target.checked)} className="h-4 w-4 rounded-sm border-border text-primary" />
                <span className="text-sm text-text-secondary">{field.label}</span>
              </label>
            </div>
          ))}
        </div>

        {(measured.length > 0 || details.length > 0) && (
          <div className="mt-5 border-t border-border pt-4" data-testid="test-from-photos">
            <h4 className="text-sm font-medium text-text-primary">From the customer&apos;s photos</h4>
            <p className="mb-3 mt-1 text-xs text-text-muted">
              On a real request these are read or measured from the photos. Pick what to try.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {details.map((signal) => {
                const key = photoKey(signal.signalKey)
                const label = sentence(signal.description || signal.signalKey.replace(/_/g, ' '))
                if (signal.type === 'boolean') {
                  return (
                    <div key={key} className="flex items-center pt-6" data-testid="photo-detail">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={values[key] === true} onChange={(e) => set(key, e.target.checked)} className="h-4 w-4 rounded-sm border-border text-primary" />
                        <span className="text-sm text-text-secondary">{label}</span>
                      </label>
                    </div>
                  )
                }
                return (
                  <div key={key} data-testid="photo-detail">
                    <label htmlFor={key} className="mb-1 block text-sm text-text-secondary">
                      {label}
                    </label>
                    {signal.type === 'enum' && (signal.possibleValues?.length ?? 0) > 0 ? (
                      <select id={key} value={(values[key] as string) || ''} onChange={(e) => set(key, e.target.value)} className={INPUT}>
                        <option value="">Not read</option>
                        {signal.possibleValues!.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={key}
                        type={signal.type === 'number' ? 'number' : 'text'}
                        value={values[key] === undefined ? '' : String(values[key])}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder="Not read"
                        className={INPUT}
                      />
                    )}
                  </div>
                )
              })}
              {/* T-189: a line measured from the customer's photos has no size here. Its own box
                  offers a sample size from the service's own range, or takes one to try. */}
              {measured.map((line) => (
                <div key={line.key} data-testid="sample-size">
                  <label htmlFor={line.key} className="mb-1 block text-sm text-text-secondary">
                    {line.name} ({line.unit})
                  </label>
                  <input
                    id={line.key}
                    type="number"
                    min={0}
                    value={values[line.key] === undefined ? '' : String(values[line.key])}
                    onChange={(e) => set(line.key, e.target.value)}
                    placeholder={line.suggested !== null ? String(line.suggested) : 'Size to try'}
                    className={INPUT}
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    {line.suggested !== null
                      ? `Measured from the customer's photos. The sample uses ${line.suggested.toLocaleString('en-US')} ${line.unit} unless you type another size.`
                      : "Measured from the customer's photos. Type a size to see a sample price."}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {nothingToAsk && <p className="text-sm text-text-muted">No customer questions defined. Go back to add questions that affect pricing.</p>}
        <button
          type="button"
          onClick={calculate}
          disabled={working}
          data-testid="calculate-preview"
          className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {working ? 'Working it out…' : 'Calculate Preview'}
        </button>
        {problem && (
          <p className="mt-3 text-sm text-danger" role="alert" data-testid="test-problem">
            {problem}
          </p>
        )}
      </div>

      {price && (
        <div className="rounded-lg border border-border bg-background p-4" data-testid="test-result">
          <h4 className="mb-3 text-sm font-medium text-text-primary">Preview Breakdown</h4>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center justify-between gap-4 text-sm" data-testid="test-line">
                <span className="text-text-primary">{line.label}</span>
                <span className="figure font-medium text-text-primary">{money(line.amount)}</span>
              </div>
            ))}
            {price.unmeasured.map((line) => (
              <div key={line.stepId} className="flex items-center justify-between gap-4 text-sm" data-testid="sample-rate">
                <span className="text-text-primary">{line.name}</span>
                <span className="text-right text-text-secondary">
                  {money(line.rate)} per {line.unitLabel || 'unit'}, priced from the customer&apos;s photos
                </span>
              </div>
            ))}
            {lines.length === 0 && price.unmeasured.length === 0 && <p className="text-sm text-text-muted">Nothing is charged with these answers.</p>}

            <div className="mt-2 space-y-1 border-t border-border pt-2">
              {minimum && (
                <p className="text-sm text-text-secondary" data-testid="minimum-note">
                  {minimumChargeNote(money(minimum.minimumCharge))}
                </p>
              )}
              {price.taxAmount > 0 && (
                <>
                  <div className="flex items-center justify-between text-sm text-text-secondary">
                    <span>Subtotal</span>
                    <span className="figure" data-testid="test-subtotal">{money(price.subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-text-secondary">
                    <span>
                      {price.taxLabel || 'Tax'}
                      {typeof price.taxRate === 'number' ? ` (${price.taxRate}%)` : ''}
                    </span>
                    <span className="figure">{money(price.taxAmount)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between font-medium" data-testid="sample-total">
                <span className="text-text-primary">{price.unmeasured.length > 0 ? 'Total so far' : sampled.length > 0 ? 'Sample total' : 'Total'}</span>
                <span className="figure text-lg text-text-primary">
                  {money(price.total)}
                  {price.unmeasured.length > 0 ? ' + the lines priced from photos' : ''}
                </span>
              </div>
              {note && (
                <p className="pt-1 text-sm text-text-secondary" data-testid="sample-note">
                  {note}
                </p>
              )}
            </div>
          </div>

          {notIncluded.length > 0 && (
            <div className="mt-4 border-t border-border pt-3" data-testid="test-not-included">
              <h5 className="mb-1 text-sm font-medium text-text-primary">Not charged with these answers</h5>
              <ul className="space-y-1">
                {notIncluded.map((step) => {
                  const words = linkWordsOf(step, fields)
                  const why = words.condition || words.quantity
                  return (
                    <li key={step.id} className="text-sm text-text-secondary">
                      {step.name}
                      {why ? <span className="text-text-muted"> · {why}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
