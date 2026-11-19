'use client'

import { useState } from 'react'
import type { RegionCode, Service } from '@qolumns/shared'
import { templateGroups, templatePayload } from '@/lib/service-templates'

/**
 * T-189: "Add from a template" on the services page. The same trade templates
 * setup offers, with each service's starting price. Picking one adds it as a
 * new service and hands it back, so the page can open it for the business to
 * check its prices. One the business already has is marked and cannot be
 * picked.
 */
export function TemplatePicker({
  open,
  region,
  ownedNames,
  money,
  onClose,
  onAdded,
}: {
  open: boolean
  region: RegionCode
  ownedNames: string[]
  money: (n: number) => string
  onClose: () => void
  onAdded: (service: Service) => void
}) {
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null

  const groups = templateGroups(region, ownedNames, money)

  async function add(key: string) {
    const payload = templatePayload(region, key, ownedNames)
    if (!payload || adding) return
    setAdding(key)
    setError(null)
    try {
      const res = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.service) throw new Error(data?.error?.message || 'Could not add the service. Please try again.')
      onAdded(data.service as Service)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the service. Please try again.')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="template-picker-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <h2 id="template-picker-title" className="font-display text-xl font-bold text-text-primary">Add from a template</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-text-secondary">
            Each template comes with its questions, photos to ask for and typical prices. The prices are a starting point: the service opens for you to check them.
          </p>
          {error && <p className="mt-4 rounded-lg border border-danger-line bg-danger-light p-3 text-sm text-danger" role="alert">{error}</p>}
          {groups.length === 0 && <p className="mt-6 text-sm text-text-secondary">There are no templates for your region yet.</p>}

          {groups.map((group) => (
            <section key={group.packId} className="mt-6" data-testid="template-group">
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted">{group.packName}</h3>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {group.services.map((svc) => (
                  <li key={svc.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="template-service" data-owned={svc.owned ? 'true' : 'false'}>
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary">{svc.name}</p>
                      {svc.price && <p className="figure mt-0.5 text-sm text-text-secondary" data-testid="template-price">{svc.price}</p>}
                      <p className="mt-1 text-sm text-text-muted">{svc.description}</p>
                    </div>
                    {svc.owned ? (
                      <span className="inline-flex shrink-0 items-center self-start rounded-full border border-border px-3 py-1 text-xs font-semibold text-text-secondary sm:self-center">
                        You have this
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => add(svc.key)}
                        disabled={adding !== null}
                        aria-label={`Add ${svc.name}`}
                        className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50"
                      >
                        {adding === svc.key ? 'Adding…' : 'Add'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
