'use client'

import { useState } from 'react'
import type { RegionCode } from '@estimator/shared'
import { listRegions } from '@estimator/shared'
import type { VerticalPack } from '@/lib/vertical-packs/types'

/**
 * T-150: setup's first question, "What kind of work do you do?" The region's
 * trade templates as large options, plus "Something else" with the
 * business's own words. Packs are data; nothing here knows any trade.
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
  onChoose: (trade: string, otherText: string) => void
  onSkip: () => void
}) {
  const [choice, setChoice] = useState<string | null>(
    initialTrade && (initialTrade === 'other' || packs.some((p) => p.id === initialTrade)) ? initialTrade : null
  )
  const [other, setOther] = useState(initialOther)

  const option = (selected: boolean) =>
    `flex w-full items-start gap-4 rounded-2xl border-2 p-5 text-left transition-colors ${
      selected ? 'border-primary bg-mint/40' : 'border-border bg-surface hover:border-border-strong'
    }`

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">What kind of work do you do?</h1>
      <p className="mt-2 text-text-secondary">
        Pick the closest match for {businessName}. You can change everything afterwards.
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
            setChoice(null)
          }}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {listRegions().map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Your trade">
        {packs.map((pack) => (
          <button
            key={pack.id}
            type="button"
            role="radio"
            aria-checked={choice === pack.id}
            onClick={() => setChoice(pack.id)}
            className={option(choice === pack.id)}
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
          role="radio"
          aria-checked={choice === 'other'}
          onClick={() => setChoice('other')}
          className={option(choice === 'other')}
        >
          <span className="text-3xl leading-none" aria-hidden="true">✳️</span>
          <span className="min-w-0">
            <span className="block text-lg font-semibold text-text-primary">Something else</span>
            <span className="mt-0.5 block text-sm text-text-secondary">We&apos;ll read your website or you tell us in your own words</span>
          </span>
        </button>
      </div>

      {choice === 'other' && (
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
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => choice && onChoose(choice, other)}
          disabled={!choice || saving}
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
