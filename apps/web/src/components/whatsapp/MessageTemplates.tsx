'use client'

import { useCallback, useEffect, useState } from 'react'
import { PRODUCT_NAME } from '@qolumns/shared'
import type { ConnectionView } from '@/lib/whatsapp-state'
import type { TemplateView } from '@/lib/whatsapp-templates'

const primary = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50'
const quiet = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50'

/** The status, in words and in the design system's status colours (colour is never the only signal) */
const STATUS: Record<TemplateView['state'], { label: string; tone: string } | null> = {
  none: null,
  pending: { label: 'In review with Meta', tone: 'bg-mist text-text-secondary' },
  approved: { label: 'Approved', tone: 'bg-secondary-light text-secondary' },
  rejected: { label: 'Rejected by Meta', tone: 'bg-danger-light text-danger' },
  paused: { label: 'Paused by Meta', tone: 'border border-border bg-surface text-text-muted' },
  disabled: { label: 'Switched off by Meta', tone: 'border border-border bg-surface text-text-muted' },
  unknown: { label: 'Status not known', tone: 'border border-border bg-surface text-text-muted' },
}

const EXPLAIN: Record<TemplateView['state'], string> = {
  none: 'Create it once. Meta reviews the wording, usually within minutes and sometimes up to a day.',
  pending: 'Meta is reviewing the wording. That usually takes minutes and can take up to a day. Press Refresh to see where it stands.',
  approved: `Ready. ${PRODUCT_NAME} sends it when you approve an estimate more than 24 hours after the customer last wrote. Meta charges your business for each one and needs a card on the account for it.`,
  rejected: 'Meta did not approve the wording, so it is not sent. Meta’s reason is below, and in WhatsApp Manager under Message templates.',
  paused: 'Meta has paused this template, usually after customers blocked or reported it. It is not sent while paused. WhatsApp Manager says when the pause ends.',
  disabled: 'Meta has switched this template off, so it is not sent. WhatsApp Manager, under Message templates, says why.',
  unknown: 'Meta gave a status this page does not know. Open WhatsApp Manager, under Message templates, to see it.',
}

/**
 * T-176: the business's one message template. WhatsApp delivers a free-form
 * message only for 24 hours after the customer's last message; after that it
 * delivers only wording Meta approved beforehand. This section creates that
 * wording (fixed: the business does not write it), shows Meta's review of it,
 * read from Meta each time, and refreshes it. Nothing is stored here.
 */
export function MessageTemplates({ connection }: { connection: ConnectionView }) {
  const [template, setTemplate] = useState<TemplateView | null>(null)
  const [busy, setBusy] = useState<'loading' | 'creating' | 'refreshing' | null>('loading')
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async (how: 'loading' | 'refreshing') => {
    setBusy(how)
    setNote(null)
    try {
      const res = await fetch('/api/whatsapp/template')
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setNote(json?.error?.message || 'Could not read the template from Meta. Try again in a minute.')
        return
      }
      setTemplate(json.template as TemplateView)
      setNote((json.problem as string | null) ?? null)
    } catch {
      setNote('Could not reach the server. Try again.')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void load('loading')
  }, [load, connection.phoneNumberId])

  async function create() {
    setBusy('creating')
    setNote(null)
    try {
      const res = await fetch('/api/whatsapp/template', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setNote(json?.error?.message || 'Meta did not accept the template. Try again in a minute.')
        return
      }
      setTemplate(json.template as TemplateView)
    } catch {
      setNote('Could not reach the server. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const status = template ? STATUS[template.state] : null

  return (
    <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="message-templates">
      <h3 className="text-lg font-medium text-text-primary">Message templates</h3>
      <p className="mt-1 max-w-2xl text-sm text-text-secondary">
        WhatsApp lets a business write freely to a customer for 24 hours after the customer’s last message. After that it only delivers wording Meta has
        approved beforehand, called a template. {PRODUCT_NAME} uses one, to tell a customer their estimate is ready.
      </p>

      {busy === 'loading' && !template && (
        <p className="mt-4 text-sm text-text-secondary" role="status">
          Asking Meta…
        </p>
      )}

      {template && (
        <div className="mt-4 rounded-lg border border-border bg-background p-4" data-testid="template-card" data-state={template.state}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Estimate ready</h4>
            {status && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.tone}`} data-testid="template-status">
                {status.label}
              </span>
            )}
          </div>
          <p className="mt-3 max-w-xl whitespace-pre-line break-words rounded-lg border border-border bg-surface p-3 text-sm text-text-primary" data-testid="template-text">
            {template.text}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            The link is each customer’s own. Meta knows this template as <span className="figure">{template.name}</span> ({template.language}).
          </p>
          <p className="mt-3 max-w-2xl text-sm text-text-secondary" data-testid="template-explain">
            {EXPLAIN[template.state]}
          </p>
          {template.state === 'rejected' && template.reason && (
            <p className="mt-2 max-w-2xl text-sm text-danger" data-testid="template-reason">
              Meta’s reason: {template.reason}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {template.state === 'none' ? (
              <button type="button" onClick={create} disabled={busy !== null} className={primary} data-testid="template-create">
                {busy === 'creating' ? 'Sending to Meta…' : 'Create the template'}
              </button>
            ) : (
              <button type="button" onClick={() => void load('refreshing')} disabled={busy !== null} className={quiet} data-testid="template-refresh">
                {busy === 'refreshing' ? 'Asking Meta…' : 'Refresh'}
              </button>
            )}
            {template.managerUrl && template.state !== 'none' && (
              <a href={template.managerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-sm text-text-secondary underline underline-offset-2">
                See it in WhatsApp Manager
              </a>
            )}
          </div>
        </div>
      )}

      {note && (
        <p className="mt-3 max-w-2xl text-sm text-text-secondary" role="status" data-testid="template-note">
          {note}
        </p>
      )}
      {!template && busy === null && (
        <button type="button" onClick={() => void load('loading')} className={`mt-3 ${quiet}`}>
          Try again
        </button>
      )}
    </section>
  )
}
