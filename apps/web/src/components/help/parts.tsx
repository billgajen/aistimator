'use client'

/**
 * T-197: small parts the Help panel's screens share.
 */
import { SUPPORT_COPY, type FeatureStatus, type SupportStatus } from '@qolumns/shared'
import { STATUS_TONE } from '@/lib/status-tone'

/** A field on white: an edge that can be seen (system.md), 16 px text so a phone does not zoom */
export const FIELD = 'w-full rounded-lg border border-field bg-white px-3.5 py-2.5 text-base text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 sm:text-sm'
export const MAIN_BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50'
export const QUIET_BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-field bg-white px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50'
export const LABEL = 'mb-1.5 block text-sm font-semibold text-text-primary'

const REPORT_TONE: Record<SupportStatus, string> = {
  new: STATUS_TONE.waiting,
  looking: STATUS_TONE.waiting,
  fixed: STATUS_TONE.good,
  answered: STATUS_TONE.good,
  not_a_fault: STATUS_TONE.closed,
}
const FEATURE_TONE: Record<FeatureStatus, string> = {
  under_review: STATUS_TONE.waiting,
  planned: STATUS_TONE.waiting,
  shipped: STATUS_TONE.good,
  not_planned: STATUS_TONE.closed,
}

/** A status in words, in the colour of whose turn it is. `owner` uses the inbox's words ("New" where a business reads "Sent"). */
export function StatusPill({ status, owner = false }: { status: SupportStatus; owner?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPORT_TONE[status]}`} data-testid="support-status" data-status={status}>
      {(owner ? SUPPORT_COPY.ownerStatus : SUPPORT_COPY.status)[status]}
    </span>
  )
}

export function FeatureStatusPill({ status }: { status: FeatureStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${FEATURE_TONE[status]}`} data-testid="feature-status" data-status={status}>
      {SUPPORT_COPY.featureStatus[status]}
    </span>
  )
}

/** A message under a form: what went wrong, said plainly. Never an alert box. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg border border-danger-line bg-danger-light px-3.5 py-2.5 text-sm text-danger" data-testid="help-error">
      {message}
    </p>
  )
}

export function Thanks({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <div className="space-y-4" data-testid="help-thanks">
      <p role="status" className="rounded-lg border border-secondary-line bg-secondary-light px-4 py-3 text-sm text-secondary">
        {message}
      </p>
      <button type="button" onClick={onDone} className={QUIET_BUTTON}>
        Done
      </button>
    </div>
  )
}

/** "21 Nov" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** POST JSON and read the answer; a network failure is an answer too */
export async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: (T & { error?: { code?: string; message?: string } }) | null }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}
