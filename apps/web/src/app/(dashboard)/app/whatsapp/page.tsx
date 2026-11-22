'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { PlanTag } from '@/components/dashboard/PlanTag'
import Link from 'next/link'
import { PRODUCT_NAME } from '@qolumns/shared'
import { ConnectWhatsApp, type ConnectSettings } from '@/components/whatsapp/ConnectWhatsApp'
import { PausedConnection } from '@/components/whatsapp/PausedConnection'
import { PERSONAL_NUMBER_LINE } from '@/lib/whatsapp-copy'
import type { WhatsAppAccessView } from '@/lib/whatsapp-access'
import { ConnectedCard } from '@/components/whatsapp/ConnectedCard'
import { ManualConnect } from '@/components/whatsapp/ManualConnect'
import type { ConnectionView } from '@/lib/whatsapp-state'

interface Loaded {
  config: ConnectionView | null
  /** T-177: whether the plan allows WhatsApp, and the one line to show when it does not */
  access?: WhatsAppAccessView
  connect: ConnectSettings
  setup: { webhookUrl: string; verifyToken: string | null } | null
  manualNeedsSecret: boolean
}

/**
 * The WhatsApp page (T-175).
 * - Not connected: one main button, "Connect WhatsApp" (Meta's Embedded
 *   Signup), and under it "Connect manually" (T-112, for a business with its
 *   own Meta app). T-177: one short line warns against connecting a personal
 *   number (it replaces T-176's question).
 * - T-177: a plan without WhatsApp sees one upgrade line and no way to
 *   connect; a lapsed subscription sees one line saying the assistant is
 *   paused. A connection made earlier is kept either way.
 * - Connected through Meta: the number, what happens next, what is left to
 *   do, the 60-day renewal, a test message, disconnect.
 * - Connected manually: the manual form, to update or disconnect.
 */
export default function WhatsAppSettingsPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [registrationProblem, setRegistrationProblem] = useState<string | null>(null)
  const [justDisconnected, setJustDisconnected] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/whatsapp/config')
      .then(async (res) => {
        if (!res.ok) throw new Error('failed')
        return (await res.json()) as Loaded
      })
      .then((json) => live && setData(json))
      .catch(() => live && setError('Could not load your WhatsApp settings. Reload the page to try again.'))
    return () => {
      live = false
    }
  }, [])

  // T-199: on the free start, a small tag says which plan keeps WhatsApp
  const header = (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          WhatsApp
          <PlanTag name={data?.access?.tag} />
        </span>
      }
      description="Let customers ask for a quote on WhatsApp."
    />
  )

  if (error) {
    return (
      <div>
        {header}
        <p className="rounded-xl border border-danger-line bg-danger-light p-4 text-sm text-danger" role="alert">
          {error}
        </p>
      </div>
    )
  }
  if (!data) {
    return (
      <div>
        {header}
        <p className="py-12 text-center text-sm text-text-secondary" role="status">
          Loading…
        </p>
      </div>
    )
  }

  const setConfig = (config: ConnectionView | null) => setData((current) => (current ? { ...current, config } : current))
  const onConnected = (config: ConnectionView, problem: string | null) => {
    setJustDisconnected(false)
    setRegistrationProblem(problem)
    setConfig(config)
  }
  const onDisconnected = () => {
    setRegistrationProblem(null)
    setJustDisconnected(true)
    setData((current) => (current ? { ...current, config: null, manualNeedsSecret: false } : current))
  }
  const { config } = data
  const access: WhatsAppAccessView = data.access ?? { allowed: true, why: null, line: null }

  // T-177: the plan does not include WhatsApp. One line, the way to the plans, and no way to connect.
  // A number connected earlier is kept, silent; it can still be disconnected.
  if (!access.allowed && access.why === 'plan') {
    return (
      <div className="space-y-6">
        {header}
        <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="whatsapp-upgrade">
          <p className="max-w-2xl text-sm text-text-primary" data-testid="access-line">
            {access.line}
          </p>
          <Link href="/app/settings/billing" className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            See plans
          </Link>
        </section>
        {justDisconnected && (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-text-secondary" role="status" data-testid="disconnected-note">
            WhatsApp is disconnected. {PRODUCT_NAME} no longer has access to that number.
          </p>
        )}
        {config && <PausedConnection config={config} onDisconnected={onDisconnected} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      {!access.allowed && (
        <p className="rounded-xl border border-tertiary-line bg-surface p-4 text-sm text-text-primary" role="status" data-testid="access-line">
          {access.line}{' '}
          <Link href="/app/settings/billing" className="font-semibold text-primary underline underline-offset-2">
            Billing
          </Link>
        </p>
      )}

      {justDisconnected && (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-text-secondary" role="status" data-testid="disconnected-note">
          WhatsApp is disconnected. {PRODUCT_NAME} no longer has access to that number.
        </p>
      )}

      {config?.method === 'embedded' && (
        <ConnectedCard
          // a reconnect or a finished step changes what the card starts from
          key={`${config.phoneNumberId}:${config.connectedAt}`}
          config={config}
          settings={data.connect}
          registrationProblem={registrationProblem}
          onChanged={(next, problem) => {
            if (problem !== undefined) setRegistrationProblem(problem)
            setConfig(next)
          }}
          onDisconnected={onDisconnected}
        />
      )}

      {config?.method === 'manual' && (
        <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="whatsapp-manual-connected">
          <p className="text-sm font-semibold text-secondary">{config.isActive ? 'Connected manually' : 'Connected manually, switched off'}</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-text-primary">{config.displayPhoneNumber}</h2>
          <p className="mt-1 mb-6 max-w-2xl text-sm text-text-secondary">
            This number is connected through your own Meta app. {PRODUCT_NAME} stays quiet in your chats, and steps in only when a customer asks for a
            price for one of your services.
          </p>
          <ManualConnect config={config} setup={data.setup} needsSecret={data.manualNeedsSecret} onSaved={(next) => setData((c) => (c ? { ...c, config: next, manualNeedsSecret: false } : c))} onDisconnected={onDisconnected} />
        </section>
      )}

      {!config && access.allowed && (
        <>
          <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="whatsapp-not-connected">
            <h2 className="text-lg font-medium text-text-primary">Connect your WhatsApp number</h2>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary" data-testid="connect-intro">
              Meta opens in a small window and walks you through it: sign in, choose your business, and pick a number. You can use a new number, or the one
              you already use in the WhatsApp Business app, which keeps working in the app. It takes a few minutes, and you can close the window at any
              point without changing anything.
            </p>
            <p className="mt-2 max-w-2xl text-sm font-medium text-text-primary" data-testid="personal-number-line">
              {PERSONAL_NUMBER_LINE}
            </p>
            <div className="mt-4">
              <ConnectWhatsApp settings={data.connect} onConnected={onConnected} />
            </div>
            <p className="mt-4 max-w-2xl text-sm text-text-secondary" data-testid="what-it-does">
              Once connected, you keep using WhatsApp as you do now. {PRODUCT_NAME} stays quiet, and steps in only when a customer asks for a price for one
              of your services: it asks a few short questions and sends a link to their estimate, priced from your own price list.
            </p>
          </section>

          <details className="group rounded-xl bg-surface p-6 shadow-warm" open={!data.connect.available} data-testid="manual-section">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-lg font-medium text-text-primary">
              <svg className="h-4 w-4 text-text-muted transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Connect manually <span className="text-sm font-normal text-text-muted">· with your own Meta app</span>
            </summary>
            <div className="mt-4">
              <ManualConnect config={null} setup={data.setup} needsSecret={false} onSaved={(next) => onConnected(next, null)} onDisconnected={onDisconnected} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}
