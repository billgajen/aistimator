import { describe, it, expect, vi } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
const { bearerToken } = await import('@/lib/supabase/server')

const jwt = (payload: Record<string, unknown>) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.')

describe('bearerToken (T-137 app auth)', () => {
  it('accepts a signed-in user token', () => {
    const t = jwt({ role: 'authenticated', sub: 'u1' })
    expect(bearerToken(`Bearer ${t}`)).toBe(t)
  })

  it('ignores service-role and anon keys, so a leaked key cannot bypass RLS', () => {
    expect(bearerToken(`Bearer ${jwt({ role: 'service_role' })}`)).toBeNull()
    expect(bearerToken(`Bearer ${jwt({ role: 'anon' })}`)).toBeNull()
  })

  it('ignores missing, malformed and non-bearer headers', () => {
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken('Bearer not-a-jwt')).toBeNull()
    expect(bearerToken('Bearer a.!!!.c')).toBeNull()
  })
})
