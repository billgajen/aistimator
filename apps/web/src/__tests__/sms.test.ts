import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeTwilioSignature,
  verifyTwilioSignature,
  countSmsSegments,
  classifyComplianceKeyword,
  normalizePhone,
  sendSmsChecked,
  isSmsTestMode,
} from '@/lib/sms'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('Twilio signature (T-136)', () => {
  const url = 'https://example.com/api/sms/webhook'
  const params = { To: '+15125550100', From: '+15125550123', Body: 'Hello there', NumMedia: '0' }

  it('matches an independently computed HMAC-SHA1 (openssl)', () => {
    expect(computeTwilioSignature(url, params, 'test_auth_token')).toBe('USK2ijngQFy5nB6z0CCeDgN6aSM=')
  })

  it('rejects missing, wrong or tampered signatures', () => {
    const good = computeTwilioSignature(url, params, 'test_auth_token')
    expect(verifyTwilioSignature(url, params, good, 'test_auth_token')).toBe(true)
    expect(verifyTwilioSignature(url, params, null, 'test_auth_token')).toBe(false)
    expect(verifyTwilioSignature(url, params, good, undefined)).toBe(false)
    expect(verifyTwilioSignature(url, params, good, 'other_token')).toBe(false)
    expect(verifyTwilioSignature(url, { ...params, Body: 'Hello therE' }, good, 'test_auth_token')).toBe(false)
    expect(verifyTwilioSignature(`${url}?x=1`, params, good, 'test_auth_token')).toBe(false)
  })
})

describe('SMS segments (T-136)', () => {
  it('counts GSM-7 and UCS-2 segments', () => {
    expect(countSmsSegments('')).toBe(0)
    expect(countSmsSegments('a'.repeat(160))).toBe(1)
    expect(countSmsSegments('a'.repeat(161))).toBe(2)
    expect(countSmsSegments('a'.repeat(306))).toBe(2)
    expect(countSmsSegments('a'.repeat(307))).toBe(3)
    expect(countSmsSegments('€'.repeat(80))).toBe(1) // extended chars count double: 160 units
    expect(countSmsSegments('€'.repeat(81))).toBe(2)
    expect(countSmsSegments('Hi 👋')).toBe(1) // UCS-2
    expect(countSmsSegments('é'.repeat(10) + '🎨'.repeat(40))).toBe(2) // 90 UTF-16 units
  })
})

describe('compliance keywords (T-136)', () => {
  it('recognises STOP/START/HELP variants, exact-message only', () => {
    expect(classifyComplianceKeyword('STOP', false)).toBe('stop')
    expect(classifyComplianceKeyword(' stop. ', false)).toBe('stop')
    expect(classifyComplianceKeyword('Unsubscribe', false)).toBe('stop')
    expect(classifyComplianceKeyword('START', true)).toBe('start')
    expect(classifyComplianceKeyword('help', false)).toBe('help')
    expect(classifyComplianceKeyword('please stop by tomorrow', false)).toBeNull()
  })

  it('treats YES as opt-in only for an opted-out number (YES also confirms intake)', () => {
    expect(classifyComplianceKeyword('yes', true)).toBe('start')
    expect(classifyComplianceKeyword('yes', false)).toBeNull()
  })
})

describe('phone normalisation by region calling code (T-136)', () => {
  it('normalises national and international input', () => {
    expect(normalizePhone('(512) 555-0100', '1')).toBe('+15125550100')
    expect(normalizePhone('1 512 555 0100', '1')).toBe('+15125550100')
    expect(normalizePhone('07700 900123', '44')).toBe('+447700900123')
    expect(normalizePhone('+44 7700 900123', '1')).toBe('+447700900123')
    expect(normalizePhone('0044 7700 900123', '1')).toBe('+447700900123')
  })
})

describe('opt-out enforcement on send (T-136)', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.SMS_TEST_MODE = 'true'
  })
  afterEach(() => {
    process.env = { ...env }
  })

  function fakeDb(optedOut: boolean) {
    const inserts: Array<Record<string, unknown>> = []
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: optedOut ? { opted_out: true } : null }) }) }),
        }),
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, ...row })
          return { error: null }
        },
      }),
    } as unknown as SupabaseClient
    return { client, inserts }
  }

  it('blocks and logs a send to an opted-out number', async () => {
    const db = fakeDb(true)
    const r = await sendSmsChecked(db.client, { tenantId: 't', to: '+15125550123', from: '+15125550100', body: 'Your quote' })
    expect(r.success).toBe(false)
    expect(r.blocked).toBe(true)
    expect(db.inserts[0]).toMatchObject({ table: 'sms_messages', status: 'blocked_opt_out', segments: 0 })
  })

  it('sends (test mode) and logs segments otherwise', async () => {
    expect(isSmsTestMode()).toBe(true)
    const db = fakeDb(false)
    const r = await sendSmsChecked(db.client, { tenantId: 't', to: '+15125550123', from: '+15125550100', body: 'Your quote' })
    expect(r.success).toBe(true)
    expect(db.inserts[0]).toMatchObject({ status: 'test', segments: 1 })
  })

  it('never reaches the network in test mode', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const db = fakeDb(false)
    await sendSmsChecked(db.client, { tenantId: 't', to: '+1', from: '+2', body: 'x' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
