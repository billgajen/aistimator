'use client'

/**
 * SMS channel setup (T-136): connect a Twilio number, track the US A2P 10DLC
 * registration checklist, see this month's segment usage.
 */

import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import { PRODUCT_NAME } from '@estimator/shared'

interface SmsConfigResponse {
  configured: boolean
  config: {
    phoneNumber: string
    messagingServiceSid: string | null
    isActive: boolean
    a2pBrandRegistered: boolean
    a2pCampaignRegistered: boolean
  } | null
  setup: { webhookUrl: string; testMode: boolean }
  usage: { outboundSegmentsThisMonth: number }
}

const inputClass =
  'mt-1 w-full rounded-warm-lg border border-border px-3 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30'

export default function SmsSettingsPage() {
  const [data, setData] = useState<SmsConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [messagingServiceSid, setMessagingServiceSid] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [brandDone, setBrandDone] = useState(false)
  const [campaignDone, setCampaignDone] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/sms/config')
    if (res.ok) {
      const json = (await res.json()) as SmsConfigResponse
      setData(json)
      if (json.config) {
        setPhoneNumber(json.config.phoneNumber)
        setMessagingServiceSid(json.config.messagingServiceSid || '')
        setIsActive(json.config.isActive)
        setBrandDone(json.config.a2pBrandRegistered)
        setCampaignDone(json.config.a2pCampaignRegistered)
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/sms/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber,
        messagingServiceSid: messagingServiceSid || null,
        isActive,
        a2pBrandRegistered: brandDone,
        a2pCampaignRegistered: campaignDone,
      }),
    })
    const json = await res.json().catch(() => null)
    setSaving(false)
    if (res.ok) {
      setMessage({ text: 'Saved', ok: true })
      load()
    } else {
      setMessage({ text: json?.error?.message || 'Failed to save', ok: false })
    }
  }

  if (loading) return <div className="p-6 text-text-muted">Loading…</div>

  const checklist = [
    {
      done: Boolean(phoneNumber),
      title: 'Get a US phone number in Twilio',
      body: 'Buy a local number in the Twilio Console (Phone Numbers → Buy a number) and enter it below.',
      href: 'https://console.twilio.com/us1/develop/phone-numbers/manage/search',
    },
    {
      done: brandDone,
      title: 'Register your brand (A2P 10DLC)',
      body: 'US carriers require a registered brand before business texting at volume. Use your legal business name and EIN.',
      href: 'https://www.twilio.com/docs/messaging/compliance/a2p-10dlc',
      toggle: setBrandDone,
    },
    {
      done: campaignDone,
      title: 'Register a campaign and attach the number',
      body: 'Create a Messaging Service, register a "Customer care" or "Mixed" campaign, and add your number to it. Paste the Messaging Service SID below.',
      href: 'https://www.twilio.com/docs/messaging/services',
      toggle: setCampaignDone,
    },
    {
      done: Boolean(data?.configured),
      title: `Point the number at ${PRODUCT_NAME}`,
      body: `In Twilio, set "A message comes in" to HTTP POST ${data?.setup.webhookUrl ?? ''}`,
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader title="SMS" description="Customers text your number, send photos, and get an estimate link back by text." />

      {data?.setup.testMode && (
        <div className="rounded-warm-lg border border-tape/40 bg-butter/40 p-4 text-sm text-text-secondary">
          Test mode: texts are recorded but not sent (Twilio credentials are not configured on this server).
        </div>
      )}

      <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <h2 className="text-lg font-medium text-text-primary">Setup checklist</h2>
        <ol className="mt-4 space-y-4">
          {checklist.map((item, i) => (
            <li key={item.title} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  item.done ? 'bg-mint text-primary' : 'bg-background text-text-muted'
                }`}
              >
                {item.done ? '✓' : i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-medium text-text-primary">{item.title}</p>
                  {item.toggle && (
                    <label className="flex items-center gap-1.5 text-xs text-text-muted">
                      <input type="checkbox" checked={item.done} onChange={(e) => item.toggle?.(e.target.checked)} />
                      Done
                    </label>
                  )}
                </div>
                <p className="mt-0.5 break-words text-sm text-text-secondary">{item.body}</p>
                {item.href && (
                  <a href={item.href} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">
                    Open guide →
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <h2 className="text-lg font-medium text-text-primary">Your number</h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text-secondary">SMS phone number</label>
            <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+15125550100" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary">
              Messaging Service SID <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <input value={messagingServiceSid} onChange={(e) => setMessagingServiceSid(e.target.value)} placeholder="MG…" className={inputClass} />
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Accept quote requests by text
        </label>
        <div className="mt-6 flex items-center justify-end gap-3">
          {message && <span className={`text-sm ${message.ok ? 'text-primary' : 'text-danger'}`}>{message.text}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-warm-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <h2 className="text-lg font-medium text-text-primary">This month</h2>
        <p className="mt-2 text-sm text-text-secondary">
          <span className="figure text-2xl text-text-primary">{data?.usage.outboundSegmentsThisMonth ?? 0}</span> outbound SMS segments.
          A segment is up to 160 plain characters (70 with emoji); Twilio bills per segment.
        </p>
        <p className="mt-2 text-xs text-text-muted">
          Customers who reply STOP are never texted again by this number until they reply START.
        </p>
      </div>
    </div>
  )
}
