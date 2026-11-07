/**
 * WhatsApp intake characterization tests (T-136).
 *
 * Written against the pre-refactor WhatsApp intake so the channel-agnostic
 * engine provably keeps WhatsApp's replies and state transitions identical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/whatsapp', () => ({
  sendTextMessage: vi.fn(async () => ({ success: true, messageId: 'wamid.out' })),
  downloadMedia: vi.fn(async () => ({ success: true, data: Buffer.from('img'), contentType: 'image/jpeg' })),
}))
vi.mock('@/lib/r2', () => ({ uploadToR2: vi.fn(async () => undefined), isR2Configured: () => true }))
vi.mock('@/lib/queue', () => ({ enqueueQuoteJob: vi.fn(async () => undefined) }))
vi.mock('@/lib/usage', () => ({ incrementUsageCounter: vi.fn(async () => undefined) }))
vi.mock('@/lib/lead-hold', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/lead-hold')
  return { ...actual, notifyLeadHeld: vi.fn(async () => undefined) }
})
vi.mock('@/lib/plan-limits', () => ({
  checkPlanLimit: vi.fn(async () => ({ allowed: true, overageAvailable: false, used: 0, limit: 50 })),
  maybeNotifyLimitReached: vi.fn(async () => undefined),
  recordOverageQuote: vi.fn(async () => undefined),
}))

import { processIntakeMessage, sendIntakeResponse } from '@/lib/whatsapp-intake'
import { sendTextMessage } from '@/lib/whatsapp'
import { checkPlanLimit } from '@/lib/plan-limits'
import { enqueueQuoteJob } from '@/lib/queue'
import { incrementUsageCounter } from '@/lib/usage'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WhatsAppConversation, WhatsAppIntakeState, WhatsAppIntakeData } from '@estimator/shared'

type Row = Record<string, unknown>

/** Minimal chainable Supabase fake: tables are arrays; filters are eq/in. */
function fakeSupabase(tables: Record<string, Row[]>) {
  const inserted: Record<string, Row[]> = {}
  const updated: Array<{ table: string; values: Row }> = []
  const builder = (table: string) => {
    let rows = [...(tables[table] || [])]
    let pendingInsert: Row | null = null
    const api = {
      select: () => api,
      eq: (col: string, value: unknown) => {
        rows = rows.filter((r) => r[col] === value)
        return api
      },
      in: () => api,
      order: () => api,
      limit: () => api,
      insert: (values: Row) => {
        pendingInsert = { id: `${table}_${(inserted[table]?.length ?? 0) + 1}`, ...values }
        ;(inserted[table] ||= []).push(pendingInsert)
        return api
      },
      update: (values: Row) => {
        updated.push({ table, values })
        return api
      },
      single: async () => ({ data: pendingInsert ?? rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    }
    return api
  }
  return { client: { from: builder } as unknown as SupabaseClient, inserted, updated }
}

function conversation(state: WhatsAppIntakeState, data: Partial<WhatsAppIntakeData> = {}): WhatsAppConversation {
  return {
    id: 'conv_1',
    tenant_id: 'tnt_1',
    customer_phone: '447700900123',
    customer_name: null,
    status: 'active',
    intake_state: state,
    intake_data: data as WhatsAppIntakeData,
    quote_request_id: null,
    created_at: '2026-11-07T00:00:00Z',
    updated_at: '2026-11-07T00:00:00Z',
  } as WhatsAppConversation
}

const textMessage = (text: string) => ({
  messageId: 'wamid.in',
  from: '447700900123',
  timestamp: '0',
  type: 'text' as const,
  text,
})

const waConfig = { phoneNumberId: 'pn_1', accessToken: 'tok' }

describe('WhatsApp intake — replies and transitions are pinned (T-136)', () => {
  let db: ReturnType<typeof fakeSupabase>
  beforeEach(() => {
    db = fakeSupabase({
      tenants: [{ id: 'tnt_1', region: 'GB', name: 'Brush Co', currency: 'GBP', tax_enabled: false }],
      services: [{ id: 'svc_1', name: 'Exterior Painting', tenant_id: 'tnt_1', active: true, document_type_default: 'instant_estimate' }],
    })
  })

  const run = (state: WhatsAppIntakeState, text: string, data: Partial<WhatsAppIntakeData> = {}) =>
    processIntakeMessage({
      supabase: db.client,
      waConfig,
      tenantId: 'tnt_1',
      conversation: conversation(state, data),
      message: textMessage(text),
    })

  it('idle with one service jumps straight to the description', async () => {
    const r = await run('idle', 'Hi, do you paint houses?')
    expect(r.newState).toBe('awaiting_description')
    expect(r.newData).toEqual({ serviceId: 'svc_1', serviceName: 'Exterior Painting' })
    expect(r.responseText).toBe(
      "Hi! I'll get you an instant quote for *Exterior Painting*.\n\nFirst — briefly describe the job. What needs doing? Sizes, quantities or any details help us quote accurately."
    )
  })

  it('walks description → name → email → phone → address → photos', async () => {
    const d1 = await run('awaiting_description', 'Front of a two-storey semi, peeling render')
    expect(d1.newState).toBe('awaiting_name')
    expect(d1.responseText).toBe('Perfect, thanks!\n\nNow, what\'s your name?')

    const short = await run('awaiting_description', 'paint')
    expect(short.newState).toBeUndefined()

    const n = await run('awaiting_name', 'Sam Taylor')
    expect(n.newState).toBe('awaiting_email')
    expect(n.responseText).toBe("Thanks, Sam Taylor!\n\nWhat's your email address? (We'll send your quote here)")

    const badEmail = await run('awaiting_email', 'not-an-email')
    expect(badEmail.responseText).toBe("That doesn't look like a valid email. Please enter your email address.")

    const e = await run('awaiting_email', 'Sam@Example.com')
    expect(e.newState).toBe('awaiting_phone')
    expect(e.newData?.customerEmail).toBe('sam@example.com')
    expect(e.responseText).toBe('Got it!\n\nWhat\'s your phone number? (Reply "skip" to use your WhatsApp number)')

    const p = await run('awaiting_phone', 'skip')
    expect(p.newState).toBe('awaiting_address')
    expect(p.newData?.customerPhone).toBe('447700900123')
    expect(p.responseText).toBe("Perfect!\n\nWhat's the address or postcode for the job?")

    const a = await run('awaiting_address', '12 High Street, Bristol BS7 8AA')
    expect(a.newState).toBe('awaiting_photos')
    expect(a.newData?.jobPostcode).toBe('BS7 8AA')
    expect(a.responseText).toBe(
      'Got it!\n\nNow, please send photos of the job area. This helps us give you an accurate quote.\n\nSend your photos, then reply "done" when finished (or "skip" if you don\'t have any).'
    )
  })

  it('photos "done" shows the confirmation summary; "no" restarts', async () => {
    const data = {
      serviceId: 'svc_1',
      serviceName: 'Exterior Painting',
      projectDescription: 'Front wall',
      customerName: 'Sam',
      customerEmail: 'sam@example.com',
      customerPhone: '447700900123',
      jobAddress: 'BS7 8AA',
      photoCount: 2,
    }
    const c = await run('awaiting_photos', 'done', data)
    expect(c.newState).toBe('awaiting_confirmation')
    expect(c.responseText).toBe(
      "Great! Here's a summary of your quote request:\n\n- Service: *Exterior Painting*\n- Job: Front wall\n- Name: Sam\n- Email: sam@example.com\n- Phone: 447700900123\n- Location: BS7 8AA\n- Photos: 2 received\n\nDoes this look correct? Reply \"yes\" to submit, or \"no\" to start over."
    )
    const no = await run('awaiting_confirmation', 'no', data)
    expect(no.newState).toBe('idle')
    expect(no.responseText).toBe('No problem! Reply "quote" when you\'re ready to start again.')
  })

  it('"yes" creates the quote and replies with the link', async () => {
    const data = {
      serviceId: 'svc_1',
      serviceName: 'Exterior Painting',
      projectDescription: 'Front wall',
      customerName: 'Sam',
      customerEmail: 'sam@example.com',
      customerPhone: '447700900123',
      jobAddress: 'BS7 8AA',
    }
    const y = await run('awaiting_confirmation', 'yes', data)
    expect(y.newState).toBe('completed')
    expect(y.responseText).toMatch(/^Your quote request has been submitted!\n\nWe're generating your personalized quote now\. You'll receive it at sam@example\.com shortly\.\n\nYou can also view it here:\nhttp.*\/q\/quotes_1\?token=/)
    expect(db.inserted.quote_requests?.[0]?.source_json).toEqual({ type: 'whatsapp' })
    expect(db.updated.some((u) => u.table === 'whatsapp_conversations' && u.values.intake_state === 'processing')).toBe(true)
  })

  it('T-134: over the limit (overage off) the request is captured as an unpriced lead', async () => {
    vi.mocked(checkPlanLimit).mockResolvedValueOnce({
      allowed: false, overageAvailable: false, used: 50, limit: 50, unlimited: false, overagePriceCents: null, stripeCustomerId: null,
    })
    vi.mocked(enqueueQuoteJob).mockClear()
    vi.mocked(incrementUsageCounter).mockClear()
    const data = {
      serviceId: 'svc_1', serviceName: 'Exterior Painting', projectDescription: 'Front wall',
      customerName: 'Sam', customerEmail: 'sam@example.com', customerPhone: '447700900123', jobAddress: 'BS7 8AA',
    }
    const r = await run('awaiting_confirmation', 'yes', data)
    expect(r.success).toBe(true)
    expect(r.newState).toBe('completed')
    expect(r.responseText).toBe('Thanks — Brush Co has your request and will send your estimate shortly.')
    expect(db.inserted.quotes?.[0]).toMatchObject({ status: 'pending_review', content_json: { limitHold: true } })
    expect(db.inserted.quote_requests?.length).toBe(1) // the lead is saved
    expect(enqueueQuoteJob).not.toHaveBeenCalled() // not priced
    expect(incrementUsageCounter).not.toHaveBeenCalled() // doesn't consume the plan
  })

  it('sends replies through the WhatsApp Cloud API', async () => {
    await sendIntakeResponse(waConfig, '447700900123', 'hello')
    expect(sendTextMessage).toHaveBeenCalledWith(waConfig, { to: '447700900123', text: 'hello' })
  })
})
