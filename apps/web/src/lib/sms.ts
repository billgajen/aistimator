/**
 * Twilio SMS/MMS channel (T-136, AD-027). Small, dependency-free REST client:
 * webhook signature verification, sending, MMS media download, segment
 * counting and US messaging compliance keywords (STOP/START/HELP).
 *
 * Platform credentials: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN. Each tenant
 * has its own number in `sms_configs`.
 *
 * Test mode (SMS_TEST_MODE=true, or no Twilio credentials): outbound messages
 * are recorded with status "test" and never leave the platform — the local
 * gauntlet and CI run the full channel this way.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SendResult, MediaDownload } from './messaging/types'

const TWILIO_API = 'https://api.twilio.com/2010-04-01'

/** Twilio concatenates up to 10 segments reliably; keep replies under that */
export const SMS_MAX_LENGTH = 1530

export function isSmsTestMode(): boolean {
  return process.env.SMS_TEST_MODE === 'true' || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature (X-Twilio-Signature)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Twilio signs POST webhooks as base64(HMAC-SHA1(authToken, url + each param
 * key+value in key-sorted order)). Pure — unit-tested with Twilio's documented example.
 */
export function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(payload, 'utf8').digest('base64')
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string | undefined
): boolean {
  if (!signature || !authToken) return false
  const expected = Buffer.from(computeTwilioSignature(url, params, authToken))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ─────────────────────────────────────────────────────────────────────────────
// Segments (cost visibility)
// ─────────────────────────────────────────────────────────────────────────────

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXTENDED = '^{}\\[~]|€\f'

/** Billable SMS segments for a body (GSM-7: 160/153 per segment; UCS-2: 70/67). */
export function countSmsSegments(body: string): number {
  if (!body) return 0
  let gsmUnits = 0
  let isGsm = true
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) gsmUnits += 1
    else if (GSM7_EXTENDED.includes(ch)) gsmUnits += 2
    else {
      isGsm = false
      break
    }
  }
  if (isGsm) return gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153)
  const ucs2Units = body.length // UTF-16 code units
  return ucs2Units <= 70 ? 1 : Math.ceil(ucs2Units / 67)
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance keywords
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'])
const START_WORDS = new Set(['START', 'UNSTOP'])
const HELP_WORDS = new Set(['HELP', 'INFO'])

export type ComplianceKeyword = 'stop' | 'start' | 'help'

/**
 * A message that is exactly a compliance keyword (case/punctuation-insensitive).
 * "YES" re-subscribes only an opted-out number — the caller decides, because
 * YES is also the intake's confirm word.
 */
export function classifyComplianceKeyword(text: string | undefined, optedOut: boolean): ComplianceKeyword | null {
  const word = (text || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (!word) return null
  if (STOP_WORDS.has(word)) return 'stop'
  if (START_WORDS.has(word) || (optedOut && word === 'YES')) return 'start'
  if (HELP_WORDS.has(word)) return 'help'
  return null
}

export const CONSENT_NOTICE = 'Msg & data rates may apply. Reply STOP to opt out, HELP for help.'

export function helpMessage(businessName: string): string {
  return `${businessName}: instant estimates by text. Reply STOP to opt out. Msg & data rates may apply.`
}

export function stopConfirmation(businessName: string): string {
  return `You're unsubscribed from ${businessName} texts and won't receive more messages. Reply START to resubscribe.`
}

export function startConfirmation(businessName: string): string {
  return `You're resubscribed to ${businessName} texts. Reply STOP to opt out, HELP for help.`
}

export async function isOptedOut(supabase: SupabaseClient, tenantId: string, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('sms_opt_outs')
    .select('opted_out')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle()
  return Boolean((data as { opted_out?: boolean } | null)?.opted_out)
}

export async function setOptOut(
  supabase: SupabaseClient,
  tenantId: string,
  phone: string,
  optedOut: boolean,
  keyword: string
): Promise<void> {
  await supabase.from('sms_opt_outs').upsert(
    { tenant_id: tenantId, phone, opted_out: optedOut, last_keyword: keyword, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id,phone' }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sending + media
// ─────────────────────────────────────────────────────────────────────────────

function authHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID || ''
  const token = process.env.TWILIO_AUTH_TOKEN || ''
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
}

/** Low-level send. Prefer `sendSmsChecked`, which enforces opt-outs and logs. */
export async function sendSms(opts: {
  to: string
  from: string
  body: string
  messagingServiceSid?: string | null
}): Promise<SendResult & { test?: boolean }> {
  const body = opts.body.length > SMS_MAX_LENGTH ? `${opts.body.slice(0, SMS_MAX_LENGTH - 1)}…` : opts.body
  const segments = countSmsSegments(body)
  if (isSmsTestMode()) {
    return { success: true, messageId: `test_${Date.now()}`, segments, test: true }
  }
  const form = new URLSearchParams({ To: opts.to, Body: body })
  if (opts.messagingServiceSid) form.set('MessagingServiceSid', opts.messagingServiceSid)
  else form.set('From', opts.from)
  try {
    const res = await fetch(`${TWILIO_API}/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; num_segments?: string }
    if (!res.ok) return { success: false, error: data.message || `Twilio HTTP ${res.status}`, segments }
    return { success: true, messageId: data.sid, segments: Number(data.num_segments) || segments }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Twilio request failed', segments }
  }
}

/**
 * Send with compliance: refuses numbers that opted out (for this tenant) and
 * logs every attempt — sent, test, blocked or failed — with its segments.
 */
export async function sendSmsChecked(
  supabase: SupabaseClient,
  opts: {
    tenantId: string
    conversationId?: string | null
    to: string
    from: string
    body: string
    messagingServiceSid?: string | null
  }
): Promise<SendResult & { blocked?: boolean; test?: boolean }> {
  if (await isOptedOut(supabase, opts.tenantId, opts.to)) {
    await supabase.from('sms_messages').insert({
      tenant_id: opts.tenantId,
      conversation_id: opts.conversationId ?? null,
      direction: 'outbound',
      message_type: 'text',
      from_phone: opts.from,
      to_phone: opts.to,
      content: opts.body,
      segments: 0,
      status: 'blocked_opt_out',
    })
    return { success: false, blocked: true, error: 'Recipient has opted out (STOP)' }
  }
  const result = await sendSms(opts)
  await supabase.from('sms_messages').insert({
    tenant_id: opts.tenantId,
    conversation_id: opts.conversationId ?? null,
    provider_message_id: result.messageId ?? null,
    direction: 'outbound',
    message_type: 'text',
    from_phone: opts.from,
    to_phone: opts.to,
    content: opts.body,
    segments: result.success ? result.segments ?? 0 : 0,
    status: result.success ? (result.test ? 'test' : 'sent') : 'failed',
  })
  return result
}

/** Download an MMS media item (Twilio media URLs use HTTP basic auth). */
export async function downloadTwilioMedia(url: string): Promise<MediaDownload> {
  try {
    if (!/^https:\/\/api\.twilio\.com\//.test(url) && !isSmsTestMode()) {
      return { success: false, error: 'Unexpected media host' }
    }
    const res = await fetch(url, { headers: isSmsTestMode() ? {} : { Authorization: authHeader() } })
    if (!res.ok) return { success: false, error: `media HTTP ${res.status}` }
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    return { success: true, data: Buffer.from(await res.arrayBuffer()), contentType }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'media download failed' }
  }
}

/**
 * Normalise to E.164 using the tenant region's calling code for national
 * numbers ("(512) 555-0100" + "1" → "+15125550100"; "07700 900123" + "44" →
 * "+447700900123"). Already-international input is kept.
 */
export function normalizePhone(raw: string, callingCode: string): string {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (trimmed.startsWith('+')) return `+${digits}`
  if (trimmed.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.startsWith(callingCode) && digits.length > 10) return `+${digits}`
  return `+${callingCode}${digits.replace(/^0+/, '')}`
}
