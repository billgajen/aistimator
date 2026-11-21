'use client'

/**
 * T-197: parts the support inbox's pages share.
 */
import { useState } from 'react'
import { SUPPORT_COPY, type SupportSeverity } from '@qolumns/shared'

export const ADMIN_FIELD = 'w-full rounded-lg border border-field bg-white px-3.5 py-2.5 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2'
export const ADMIN_SELECT = 'min-h-[40px] rounded-lg border border-field bg-white px-3 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2'
export const ADMIN_MAIN = 'inline-flex min-h-[40px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50'
export const ADMIN_QUIET = 'inline-flex min-h-[40px] items-center justify-center rounded-lg border border-field bg-white px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50'
export const CARD = 'rounded-xl bg-white p-5 shadow-warm-md'
export const CARD_TITLE = 'text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary'

export function SeverityMark({ severity }: { severity: SupportSeverity | null }) {
  if (!severity) return <span className="text-sm text-text-muted" data-testid="severity" data-severity="none">Not sorted</span>
  const tone = severity === 'high' ? 'bg-danger-light text-danger' : severity === 'medium' ? 'bg-tertiary-light text-tertiary' : 'border border-border bg-surface text-text-muted'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`} data-testid="severity" data-severity={severity}>
      {SUPPORT_COPY.severity[severity]}
    </span>
  )
}

/** One call to an inbox action: the answer, or the reason it failed */
export async function act<T>(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: T | null; message: string | null }> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
    return { ok: response.ok, data, message: response.ok ? null : (data?.error?.message ?? 'That could not be done.') }
  } catch {
    return { ok: false, data: null, message: 'That could not be done. Check your connection.' }
  }
}

export interface SendPreview {
  businesses: number
  subject: string
  html: string
}

/**
 * The confirmation before an email goes to businesses ("Fixed", "Shipped"):
 * the email as it will be sent, how many businesses get it, and one button
 * that sends. Nothing is sent until it is pressed.
 */
export function ConfirmSend({ preview, action, busy, onConfirm, onCancel }: { preview: SendPreview; action: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-tertiary-line bg-white p-4" role="group" aria-label={`Confirm ${action}`} data-testid="confirm-send">
      <p className="text-sm font-semibold text-text-primary" data-testid="confirm-count">
        {preview.businesses === 0
          ? 'Every business on this has already been told. No email will be sent.'
          : `This email goes to ${preview.businesses} ${preview.businesses === 1 ? 'business' : 'businesses'}. Each also sees it in its Help panel.`}
      </p>
      <p className="mt-2 text-sm text-text-secondary">
        Subject: <span className="text-text-primary">{preview.subject}</span>
      </p>
      <iframe title="The email that will be sent" srcDoc={preview.html} sandbox="" className="mt-3 h-[420px] w-full rounded-lg border border-border bg-background" data-testid="confirm-email" />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} disabled={busy} className={ADMIN_MAIN} data-testid="confirm-send-button">
          {busy ? 'Sending…' : `Set to ${action}${preview.businesses > 0 ? ' and send' : ''}`}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={ADMIN_QUIET}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Copy text to the clipboard, and say that it was copied */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          setCopied(false)
        }
      }}
      className={ADMIN_QUIET}
      data-testid="copy-ticket"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
