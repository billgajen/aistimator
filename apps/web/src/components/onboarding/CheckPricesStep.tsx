'use client'

import { useState } from 'react'
import { formatMoney } from '@estimator/shared'
import { toPriceList, applyPriceList, unitWords, type PriceList, type PriceItem } from '@/lib/price-list'
import { applyCompile, type DraftService } from '@/lib/onboarding-service'
import { PricingComposer } from '@/components/services/PricingComposer'

/**
 * T-150: "Check your prices". Every number each service charges, in plain
 * words, editable in place. Edits are written straight back into the
 * service's pricing config (lib/price-list) — the same config the service
 * editor writes. The business must confirm before setup continues.
 */
export function CheckPricesStep({
  services,
  fromTemplate,
  currency,
  locale,
  currencySymbol,
  onChange,
  onConfirm,
  onBack,
}: {
  /** Only the services being created, with their index in the full list */
  services: Array<{ index: number; svc: DraftService }>
  fromTemplate: boolean
  currency: string
  locale: string
  currencySymbol: string
  onChange: (index: number, svc: DraftService) => void
  onConfirm: () => void
  onBack: () => void
}) {
  const money = (n: number) => formatMoney(n, currency, locale)
  const [describing, setDescribing] = useState<number | null>(null)

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-text-primary">Check your prices</h1>
      <p className="mt-2 text-text-secondary">
        This is everything your estimates will charge. Change any number to match what you charge.
      </p>
      {fromTemplate && (
        <p className="mt-4 rounded-xl border border-tape/50 bg-butter px-4 py-3 text-sm text-text-primary" role="note">
          These are typical starting prices. Change them to yours.
        </p>
      )}

      <div className="mt-6 space-y-5">
        {services.map(({ index, svc }) => {
          const list = toPriceList(svc, money)
          const update = (next: PriceList) => onChange(index, { ...svc, ...applyPriceList(svc, next) })
          const setItem = (group: 'items' | 'addons', key: string, patch: Partial<PriceItem>) =>
            update({ ...list, [group]: list[group].map((i) => (i.key === key ? { ...i, ...patch } : i)) })

          return (
            <section key={index} className="rounded-xl border border-border bg-surface p-5" aria-label={svc.name}>
              <h2 className="font-display text-lg font-bold text-text-primary">{svc.name}</h2>

              {list.items.length === 0 && list.baseFee === 0 && (
                <p className="mt-2 text-sm text-text-muted">No prices yet. Describe how you charge below.</p>
              )}

              {list.items.length > 0 && (
                <ul className="mt-3 divide-y divide-border">
                  {list.items.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary">{item.name}</p>
                        {item.note && <p className="text-xs text-text-muted">{item.note}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <AmountInput
                          label={`${item.name} price`}
                          value={item.amount}
                          prefix={item.unit === 'percent' ? undefined : item.unit === 'credit' ? `−${currencySymbol}` : currencySymbol}
                          onChange={(amount) => setItem('items', item.key, { amount })}
                        />
                        {unitWords(item) && <span className="w-24 text-xs text-text-muted">{unitWords(item)}</span>}
                      </div>
                      {item.range && (
                        <div className="flex w-full items-center justify-end gap-2 text-xs text-text-muted">
                          Usually between
                          <AmountInput small label={`${item.name} low`} value={item.range.low} prefix={currencySymbol} onChange={(low) => setItem('items', item.key, { range: { ...item.range!, low } })} />
                          and
                          <AmountInput small label={`${item.name} high`} value={item.range.high} prefix={currencySymbol} onChange={(high) => setItem('items', item.key, { range: { ...item.range!, high } })} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {list.addons.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Extras the customer can add</h3>
                  <ul className="mt-1 divide-y divide-border">
                    {list.addons.map((addon) => (
                      <li key={addon.key} className="flex items-center justify-between gap-3 py-2.5">
                        <p className="text-sm font-medium text-text-primary">{addon.name}</p>
                        <AmountInput label={`${addon.name} price`} value={addon.amount} prefix={`+${currencySymbol}`} onChange={(amount) => setItem('addons', addon.key, { amount })} />
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {list.adjustments.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Adjustments</h3>
                  <ul className="mt-1 divide-y divide-border">
                    {list.adjustments.map((adj) => (
                      <li key={adj.key} className="flex items-center justify-between gap-3 py-2.5">
                        <p className="text-sm font-medium text-text-primary">{adj.name}:</p>
                        <div className="flex items-center gap-1.5">
                          <AmountInput
                            label={`${adj.name} percentage`}
                            value={adj.percent}
                            allowNegative
                            prefix={adj.percent >= 0 ? '+' : undefined}
                            onChange={(percent) => update({ ...list, adjustments: list.adjustments.map((a) => (a.key === adj.key ? { ...a, percent } : a)) })}
                          />
                          <span className="text-sm text-text-muted">%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 text-sm text-text-primary">
                  <span>
                    Minimum charge
                    <span className="block text-xs text-text-muted">The smallest job you&apos;ll quote</span>
                  </span>
                  <AmountInput label="Minimum charge" value={list.minimumCharge} prefix={currencySymbol} onChange={(minimumCharge) => update({ ...list, minimumCharge })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-text-primary">
                  <span>
                    Base fee
                    <span className="block text-xs text-text-muted">Added to every job</span>
                  </span>
                  <AmountInput label="Base fee" value={list.baseFee} prefix={currencySymbol} onChange={(baseFee) => update({ ...list, baseFee })} />
                </label>
              </div>

              <div className="mt-4">
                {describing === index ? (
                  <PricingComposer
                    serviceName={svc.name}
                    serviceDescription={svc.description}
                    currencySymbol={currencySymbol}
                    current={{
                      baseFee: svc.draft.pricing.baseFee,
                      minimumCharge: svc.draft.pricing.minimumCharge,
                      workSteps: svc.draft.pricing.workSteps,
                      addons: svc.addons,
                      multipliers: svc.multipliers,
                      suggestedFields: svc.draft.suggestedFields,
                      expectedSignals: svc.draft.expectedSignals,
                      currentConfig: svc.draft,
                    }}
                    onApply={(result) => {
                      onChange(index, applyCompile(svc, result))
                      setDescribing(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setDescribing(index)}
                    className="text-sm font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
                  >
                    Describe a change in plain English
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          These are my prices
        </button>
        <button type="button" onClick={onBack} className="text-sm text-text-muted hover:text-text-secondary">
          Back
        </button>
      </div>
    </div>
  )
}

/** A money or percentage box that keeps what the business is typing until it is a number. */
function AmountInput({
  label,
  value,
  prefix,
  onChange,
  allowNegative = false,
  small = false,
}: {
  label: string
  value: number
  prefix?: string
  onChange: (value: number) => void
  allowNegative?: boolean
  small?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center rounded-lg border border-border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      {prefix && <span className="pl-2.5 text-sm text-text-muted">{prefix}</span>}
      <input
        aria-label={label}
        inputMode="decimal"
        value={text ?? String(value)}
        onChange={(e) => {
          const raw = e.target.value
          setText(raw)
          const n = Number(raw.replace(/,/g, ''))
          if (raw.trim() !== '' && Number.isFinite(n) && (allowNegative || n >= 0)) onChange(n)
        }}
        onBlur={() => setText(null)}
        className={`${small ? 'w-16' : 'w-24'} figure rounded-lg bg-transparent px-2.5 py-1.5 text-right text-sm text-text-primary focus:outline-none`}
      />
    </span>
  )
}
