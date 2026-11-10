'use client'

import { useCallback, useRef } from 'react'

export type LeadProgress = 'contact' | 'questions' | 'photos' | 'details'
type Answers = Array<{ fieldId: string; value: string | number | boolean | string[] }>

/**
 * T-151: save the request as soon as the customer has given their contact
 * details, then record how far they got. Best-effort: a failure here never
 * stops the customer (only invalid contact details are reported back). Test
 * requests from setup never create one.
 */
export function useUnfinishedLead(opts: { tenantKey: string; testToken?: string; honeypot: string; getTurnstileToken: () => Promise<string | null> }) {
  const lead = useRef<{ leadId: string; leadToken: string } | null>(null)
  const { tenantKey, testToken, honeypot, getTurnstileToken } = opts

  const start = useCallback(
    async (serviceId: string, customer: { name: string; email: string; phone: string }): Promise<{ fieldErrors?: Record<string, string>; message?: string }> => {
      if (lead.current) return {}
      try {
        const turnstileToken = await getTurnstileToken()
        const res = await fetch('/api/public/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantKey,
            serviceId,
            customer: { name: customer.name, email: customer.email || null, phone: customer.phone || null },
            turnstileToken: turnstileToken || undefined,
            website: honeypot || undefined,
            ...(testToken && { testToken }),
            source: { type: 'widget' },
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json.leadId) lead.current = { leadId: json.leadId, leadToken: json.leadToken }
        if (res.status === 400 && json.error?.fields) return { fieldErrors: json.error.fields, message: json.error.message }
      } catch {
        // best-effort
      }
      return {}
    },
    [tenantKey, testToken, honeypot, getTurnstileToken]
  )

  const update = useCallback(
    (progress: LeadProgress, data: { answers?: Answers; postcode?: string; assetIds?: string[] } = {}) => {
      const current = lead.current
      if (!current) return
      fetch(`/api/public/leads/${encodeURIComponent(current.leadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantKey, leadToken: current.leadToken, progress, ...data }),
        keepalive: true,
      }).catch(() => undefined)
    },
    [tenantKey]
  )

  /** The fields to send with the submission so the server closes this lead */
  const submitFields = useCallback(() => (lead.current ? { leadId: lead.current.leadId, leadToken: lead.current.leadToken } : {}), [])

  return { start, update, submitFields, hasLead: () => lead.current !== null }
}
