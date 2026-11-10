/**
 * T-153: limits on the public demo, on top of the normal quote limits
 * (Turnstile, honeypot, the `quotes` rate-limit scope and upload limits).
 *
 * Both limits are counted in the database, so they hold even where Upstash
 * isn't configured:
 * - per IP: DEMO_IP_LIMIT_PER_HOUR (default 5) demo requests an hour, keyed
 *   by a salted hash of the IP stored on the demo request only (it goes with
 *   the request when the request is deleted after 24 hours);
 * - global: DEMO_DAILY_CAP (default 200) demo requests in the last 24 hours.
 * Over either, the visitor sees the recorded example estimate instead.
 */
import { createHmac } from 'crypto'
import { NextResponse } from 'next/server'
import type { createAdminClient } from '@/lib/supabase/server'
import { demoDailyCap } from '@estimator/shared'

type Admin = ReturnType<typeof createAdminClient>

export const DEFAULT_DEMO_IP_LIMIT_PER_HOUR = 5

export function demoIpLimit(env: Record<string, string | undefined>): number {
  const n = Number.parseInt(env.DEMO_IP_LIMIT_PER_HOUR ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEMO_IP_LIMIT_PER_HOUR
}

/** A salted hash, never the IP itself */
export function demoIpHash(ip: string, env: Record<string, string | undefined> = process.env): string {
  const base = env.TEST_QUOTE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || 'aistimator-demo'
  return createHmac('sha256', base).update(`aistimator:demo-ip:v1:${ip}`).digest('hex').slice(0, 32)
}

export type DemoDecision = 'ok' | 'daily_cap' | 'ip_limit'

/** Pure: may one more demo request run? */
export function decideDemo(counts: { last24h: number; ipLastHour: number }, limits: { dailyCap: number; ipPerHour: number }): DemoDecision {
  if (counts.last24h >= limits.dailyCap) return 'daily_cap'
  if (counts.ipLastHour >= limits.ipPerHour) return 'ip_limit'
  return 'ok'
}

export async function checkDemoAllowance(
  supabase: Admin,
  tenantId: string,
  ip: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now()
): Promise<{ decision: DemoDecision; ipHash: string }> {
  const ipHash = demoIpHash(ip, env)
  const [{ count: last24h }, { count: ipLastHour }] = await Promise.all([
    supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', new Date(now - 24 * 3600 * 1000).toISOString()),
    supabase
      .from('quote_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', new Date(now - 3600 * 1000).toISOString())
      .eq('source_json->>demoIp', ipHash),
  ])
  return {
    decision: decideDemo({ last24h: last24h ?? 0, ipLastHour: ipLastHour ?? 0 }, { dailyCap: demoDailyCap(env), ipPerHour: demoIpLimit(env) }),
    ipHash,
  }
}

/** The widget shows the recorded example on this code */
export const DEMO_BUSY = 'DEMO_BUSY'

export function demoBusyResponse(decision: Exclude<DemoDecision, 'ok'>): NextResponse {
  return NextResponse.json(
    { error: { code: DEMO_BUSY, reason: decision, message: 'The demo is busy right now. Here is an example estimate instead.' } },
    { status: 429, headers: { 'Retry-After': decision === 'ip_limit' ? '3600' : '600' } }
  )
}
