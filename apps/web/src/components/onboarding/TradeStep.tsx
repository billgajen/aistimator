'use client'

import { useState } from 'react'
import type { RegionCode } from '@qolumns/shared'
import { listRegions } from '@qolumns/shared'
import type { VerticalPack } from '@/lib/vertical-packs/types'
import { MAX_TRADES, OTHER_TRADE, toggleTrade, tradeIds } from '@/lib/trades'

/**
 * T-150: setup's first question, "What kind of work do you do?" The region's
 * trade templates as large options, plus "Something else" with the
 * business's own words. Packs are data; nothing here knows any trade.
 *
 * T-204: more than one trade can be picked (a business that does heating and
 * plumbing picks both). "Something else" stands alone: it leads to the
 * website or the business's own words, not to a template.
 */
export function TradeStep({
  businessName,
  region,
  onRegionChange,
  packs,
  initialTrade,
  initialOther,
  saving,
  error,
  onChoose,
  onSkip,
}: {
  businessName: string
  region: RegionCode
  onRegionChange: (code: string) => void
  packs: VerticalPack[]
  initialTrade: string | null
  initialOther: string
  saving: boolean
  error: string | null
  onChoose: (trades: string[], otherText: string) => void
  onSkip: () => void
}) {
  // A previous answer, kept where it still fits this region's templates
  const [choices, setChoices] = useState<string[]>(() =>
    tradeIds(initialTrade).filter((id) => id === OTHER_TRADE || packs.some((p) => p.id === id))
  )
  const [other, setOther] = useState(initialOther)
  const picked = (id: string) => choices.includes(id)
  const packsPicked = choices.filter((id) => id !== OTHER_TRADE).length

  const option = (selected: boolean) =>
    `flex w-full items-start gap-4 rounded-2xl border-2 p-5 text-left transition-colors ${
      selected ? 'border-primary bg-mint/40' : 'border-border bg-surface hover:border-border-strong'
    }`

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">What kind of work do you do?</h1>
      <p className="mt-2 text-text-secondary">
        Pick the closest match for {businessName}, or more than one if you do several kinds of work. You can change
        everything afterwards.
      </p>

      <div className="mt-4 max-w-xs">
        <label className="mb-1 block text-sm font-medium text-text-secondary" htmlFor="setup-region">
          Where is your business?
        </label>
        <select
          id="setup-region"
          value={region}
          onChange={(e) => {
            onRegionChange(e.target.value)
            setChoices([])
          }}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2"
        >
          {listRegions().map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" role="group" aria-label="Your trades">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            role="checkbox"
            aria-checked={picked(pack.id)}
            // the most trades one setup takes: the rest stay pickable once one is unticked
            disabled={!picked(pack.id) && packsPicked >= MAX_TRADES}
            onClick={() => setChoices((now) => toggleTrade(now, pack.id))}
            className={`${option(picked(pack.id))} disabled:cursor-not-allowed disabled:opacity-50`}
            data-testid="trade-option"
          >
            <span className="text-3xl leading-none" aria-hidden="true">{pack.icon}</span>
            <span className="min-w-0">
              <span className="block text-lg font-semibold text-text-primary">{pack.name}</span>
              <span className="mt-0.5 block text-sm text-text-secondary">{pack.description}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          role="checkbox"
          aria-checked={picked(OTHER_TRADE)}
          onClick={() => setChoices((now) => toggleTrade(now, OTHER_TRADE))}
          className={option(picked(OTHER_TRADE))}
          data-testid="trade-option-other"
        >
          <span className="text-3xl leading-none" aria-hidden="true">✳️</span>
          <span className="min-w-0">
            <span className="block text-lg font-semibold text-text-primary">Something else</span>
            <span className="mt-0.5 block text-sm text-text-secondary">We&apos;ll read your website or you tell us in your own words</span>
          </span>
        </button>
      </div>

      {packsPicked >= MAX_TRADES && (
        <p className="mt-3 text-sm text-text-secondary">That is the most one setup takes. You can add more services from a template afterwards.</p>
      )}

      {picked(OTHER_TRADE) && (
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-text-secondary" htmlFor="trade-other">
            What do you do? <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <input
            id="trade-other"
            type="text"
            value={other}
            maxLength={200}
            onChange={(e) => setOther(e.target.value)}
            placeholder="e.g. Tree surgery, pressure washing, removals"
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2"
          />
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-danger-line bg-danger-light p-3 text-sm text-danger">{error}</div>}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => choices.length > 0 && onChoose(choices, other)}
          disabled={choices.length === 0 || saving}
          className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" onClick={onSkip} className="text-sm text-text-muted hover:text-text-secondary">
          Skip — set up manually instead
        </button>
      </div>
    </div>
  )
}
