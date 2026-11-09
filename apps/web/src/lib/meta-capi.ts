/**
 * Meta Conversions API (T-144) — server-side marketing events.
 *
 * Paired with the browser Pixel (components/marketing/MetaPixel.tsx): both
 * send the same `event_id`, so Meta counts one event (deduplication). Off
 * until META_PIXEL_ID and META_CAPI_ACCESS_TOKEN are set. Personal data is
 * SHA-256 hashed as Meta requires, and never logged.
 *
 * Scope: OUR marketing funnel only (signup, subscription). Customer quote
 * pages belong to the businesses we serve and are never tracked.
 */

import { createHash } from 'node:crypto'

export type MetaEventName = 'CompleteRegistration' | 'Subscribe' | 'StartTrial' | 'Lead'

export interface MetaEventInput {
  eventName: MetaEventName
  /** Shared with the browser Pixel call for deduplication */
  eventId: string
  eventSourceUrl?: string
  email?: string | null
  clientIp?: string | null
  userAgent?: string | null
  /** Meta browser cookies, when the request carries them */
  fbp?: string | null
  fbc?: string | null
  value?: number
  currency?: string
  /** Unix seconds (default: now) */
  eventTime?: number
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/** Meta's normalisation for email before hashing: trimmed, lower case. */
export function hashEmail(email: string): string {
  return sha256(email.trim().toLowerCase())
}

/** The request body for POST /{pixel}/events (pure, testable). */
export function buildCapiPayload(input: MetaEventInput, opts: { testEventCode?: string } = {}) {
  const userData: Record<string, string | string[]> = {}
  if (input.email) userData.em = [hashEmail(input.email)]
  if (input.clientIp) userData.client_ip_address = input.clientIp
  if (input.userAgent) userData.client_user_agent = input.userAgent
  if (input.fbp) userData.fbp = input.fbp
  if (input.fbc) userData.fbc = input.fbc
  return {
    data: [
      {
        event_name: input.eventName,
        event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: 'website',
        ...(input.eventSourceUrl && { event_source_url: input.eventSourceUrl }),
        user_data: userData,
        ...(input.value !== undefined && input.currency && {
          custom_data: { value: input.value, currency: input.currency.toUpperCase() },
        }),
      },
    ],
    ...(opts.testEventCode && { test_event_code: opts.testEventCode }),
  }
}

export function isMetaConfigured(): boolean {
  return Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_ACCESS_TOKEN)
}

/**
 * Send one event. Never throws and never blocks a user flow for long:
 * marketing must not break signup or billing.
 */
export async function sendMetaEvent(
  input: MetaEventInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ sent: boolean; status?: number }> {
  if (!isMetaConfigured()) return { sent: false }
  const version = process.env.META_GRAPH_API_VERSION || 'v21.0'
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(process.env.META_PIXEL_ID!)}/events?access_token=${encodeURIComponent(process.env.META_CAPI_ACCESS_TOKEN!)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCapiPayload(input, { testEventCode: process.env.META_TEST_EVENT_CODE })),
      signal: controller.signal,
    })
    if (!res.ok) console.warn(`[MetaCAPI] ${input.eventName} rejected (HTTP ${res.status})`)
    return { sent: res.ok, status: res.status }
  } catch {
    console.warn(`[MetaCAPI] ${input.eventName} not sent (network/timeout)`)
    return { sent: false }
  } finally {
    clearTimeout(timer)
  }
}

/** Read Meta's _fbp/_fbc cookies from a Cookie header. */
export function metaCookies(cookieHeader: string | null): { fbp: string | null; fbc: string | null } {
  const get = (name: string) => {
    const m = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
    return m ? decodeURIComponent(m[1]!) : null
  }
  return { fbp: get('_fbp'), fbc: get('_fbc') }
}
