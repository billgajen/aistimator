/**
 * T-211: strikes, blocks and daily limits for calls.
 *
 * Who is counted: a device (a random id the page keeps in localStorage and a cookie) and the
 * address the call came from, as a salted hash. THE RAW ADDRESS IS NEVER STORED OR LOGGED: it is
 * hashed the moment it is read and only the hash goes anywhere.
 *
 * The rules (the numbers are guard-config.ts's):
 *   - a call she ended as off-topic or abusive is one strike;
 *   - two strikes within 24 hours block the visitor for 2 days;
 *   - a strike within 30 days of a block ending blocks again at once, for 7 days;
 *   - a block applies to the device and to the address: either one blocked, the call does not start;
 *   - a device may start 3 calls a day, and a business may receive 20.
 *
 * Kept in Upstash, each key with an expiry. **If Upstash is not configured, slow or failing, the
 * call goes ahead and nothing is counted**: protection must never break a working call.
 *
 * The rules themselves (`afterStrike`, `stateOf`) are pure; the store is an interface, so they
 * are tested without Redis.
 */
import { createHmac } from 'crypto'
import { VOICE_GUARD, type EndReason, type GuardConfig } from './guard-config'

/** What is kept for one device or one address */
export interface GuardRecord {
  /** When each strike in the window happened (seconds since 1970) */
  strikes: number[]
  /** Blocked until then; null when never blocked */
  blockUntil: number | null
}

export const NO_RECORD: GuardRecord = { strikes: [], blockUntil: null }

export interface GuardState {
  blocked: boolean
  /** When the block ends (seconds since 1970); null when not blocked */
  blockedUntil: number | null
  /** Strikes still counted */
  strikes: number
}

const live = (record: GuardRecord, now: number, cfg: GuardConfig) => record.strikes.filter((at) => at > now - cfg.strikeWindowSeconds && at <= now)

export function stateOf(record: GuardRecord, now: number, cfg: GuardConfig = VOICE_GUARD): GuardState {
  const blocked = record.blockUntil !== null && now < record.blockUntil
  return { blocked, blockedUntil: blocked ? record.blockUntil : null, strikes: live(record, now, cfg).length }
}

/** The record after one more strike */
export function afterStrike(record: GuardRecord, now: number, cfg: GuardConfig = VOICE_GUARD): GuardRecord {
  // Already blocked: nothing to add (a blocked visitor cannot start the call that would earn it)
  if (record.blockUntil !== null && now < record.blockUntil) return record
  // A block ended not long ago: this strike blocks again at once, and for longer
  if (record.blockUntil !== null && now < record.blockUntil + cfg.repeatWindowSeconds) return { strikes: [], blockUntil: now + cfg.repeatBlockSeconds }
  const strikes = [...live(record, now, cfg), now]
  if (strikes.length >= cfg.strikesToBlock) return { strikes: [], blockUntil: now + cfg.blockSeconds }
  return { strikes, blockUntil: record.blockUntil }
}

/** How long a record has to be kept: until its strikes leave the window and its block stops mattering */
export function keepSeconds(record: GuardRecord, now: number, cfg: GuardConfig = VOICE_GUARD): number {
  const strikes = record.strikes.length > 0 ? Math.max(...record.strikes) + cfg.strikeWindowSeconds - now : 0
  const block = record.blockUntil !== null ? record.blockUntil + cfg.repeatWindowSeconds - now : 0
  return Math.max(60, Math.ceil(Math.max(strikes, block)))
}

/** Whether an ending is a strike */
export const isStrike = (reason: EndReason, cfg: GuardConfig = VOICE_GUARD): boolean => cfg.strikeReasons.includes(reason)

// ---------- who is counted ----------

/** A device id the page made: letters, digits and dashes only, of a sensible length. Anything else is no id. */
export function deviceIdOf(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(value) ? value : null
}

/** A salted hash of an address. The address itself goes no further than this function. */
export function ipHashOf(ip: string | null | undefined, secret: string): string | null {
  if (!ip || ip === 'unknown') return null
  return createHmac('sha256', secret).update(`qolumns:voice-ip:v1:${ip}`).digest('hex').slice(0, 32)
}

export interface Visitor {
  deviceId: string | null
  ipHash: string | null
}

const subjectKeys = (v: Visitor): string[] => [v.deviceId ? `voice:guard:device:${v.deviceId}` : null, v.ipHash ? `voice:guard:ip:${v.ipHash}` : null].filter((k): k is string => k !== null)
const day = (now: number) => new Date(now * 1000).toISOString().slice(0, 10)
const deviceCallsKey = (deviceId: string, now: number) => `voice:calls:device:${deviceId}:${day(now)}`
const businessCallsKey = (tenantId: string, now: number) => `voice:calls:business:${tenantId}:${day(now)}`

// ---------- the store ----------

export interface GuardStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  /** Add one and make sure the key expires; answers the new count */
  increment(key: string, ttlSeconds: number): Promise<number>
  remove(keys: string[]): Promise<void>
}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the store did not answer in time')), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

const read = (raw: string | null): GuardRecord => {
  if (!raw) return NO_RECORD
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<GuardRecord>
    return { strikes: Array.isArray(parsed.strikes) ? parsed.strikes.filter((n): n is number => typeof n === 'number') : [], blockUntil: typeof parsed.blockUntil === 'number' ? parsed.blockUntil : null }
  } catch {
    return NO_RECORD
  }
}

export interface GuardStatus extends GuardState {
  /** Calls this device has started today, and this business has received; null when not known */
  deviceCallsToday: number | null
  businessCallsToday: number | null
  /** The store was not there to ask: nothing is counted and nothing blocks */
  unavailable: boolean
}

const OPEN: GuardStatus = { blocked: false, blockedUntil: null, strikes: 0, deviceCallsToday: null, businessCallsToday: null, unavailable: true }

/** Where a visitor stands. Never throws: with no store, or a failing one, the answer is "not blocked". */
export async function guardStatus(store: GuardStore | null, visitor: Visitor, tenantId: string | null, now: number, cfg: GuardConfig = VOICE_GUARD): Promise<GuardStatus> {
  if (!store) return OPEN
  try {
    return await within(
      (async () => {
        const records = await Promise.all(subjectKeys(visitor).map(async (key) => read(await store.get(key))))
        const states = records.map((r) => stateOf(r, now, cfg))
        const until = states.map((s) => s.blockedUntil).filter((u): u is number => u !== null)
        const count = async (key: string | null) => (key ? Number((await store.get(key)) ?? 0) || 0 : null)
        return {
          blocked: states.some((s) => s.blocked),
          blockedUntil: until.length > 0 ? Math.max(...until) : null,
          strikes: Math.max(0, ...states.map((s) => s.strikes)),
          deviceCallsToday: await count(visitor.deviceId ? deviceCallsKey(visitor.deviceId, now) : null),
          businessCallsToday: await count(tenantId ? businessCallsKey(tenantId, now) : null),
          unavailable: false,
        }
      })(),
      cfg.storeTimeoutMs
    )
  } catch {
    return OPEN
  }
}

export type StartDecision = { allowed: true; status: GuardStatus } | { allowed: false; why: 'blocked' | 'device_limit' | 'business_limit'; message: string; status: GuardStatus }

/** May this visitor start a call with this business now? An allowed call is counted. */
export async function startCall(store: GuardStore | null, visitor: Visitor, tenantId: string, now: number, cfg: GuardConfig = VOICE_GUARD): Promise<StartDecision> {
  const status = await guardStatus(store, visitor, tenantId, now, cfg)
  if (!store || status.unavailable) return { allowed: true, status }
  if (status.blocked) return { allowed: false, why: 'blocked', message: cfg.blockedMessage, status }
  if ((status.deviceCallsToday ?? 0) >= cfg.callsPerDevicePerDay) return { allowed: false, why: 'device_limit', message: cfg.limitMessage, status }
  if ((status.businessCallsToday ?? 0) >= cfg.callsPerBusinessPerDay) return { allowed: false, why: 'business_limit', message: cfg.limitMessage, status }
  try {
    const [device, business] = await within(
      Promise.all([visitor.deviceId ? store.increment(deviceCallsKey(visitor.deviceId, now), 2 * 24 * 60 * 60) : Promise.resolve(null), store.increment(businessCallsKey(tenantId, now), 2 * 24 * 60 * 60)]),
      cfg.storeTimeoutMs
    )
    return { allowed: true, status: { ...status, deviceCallsToday: device, businessCallsToday: business } }
  } catch {
    return { allowed: true, status: { ...status, unavailable: true } }
  }
}

/**
 * One strike, for the device and for the address. If either is blocked by it, both are, until
 * the later of the two. Never throws: a strike that cannot be kept is not kept.
 */
export async function recordStrike(store: GuardStore | null, visitor: Visitor, now: number, cfg: GuardConfig = VOICE_GUARD): Promise<GuardState & { recorded: boolean }> {
  const keys = subjectKeys(visitor)
  if (!store || keys.length === 0) return { blocked: false, blockedUntil: null, strikes: 0, recorded: false }
  try {
    return await within(
      (async () => {
        let records = await Promise.all(keys.map(async (key) => afterStrike(read(await store.get(key)), now, cfg)))
        const until = records.map((r) => (r.blockUntil !== null && now < r.blockUntil ? r.blockUntil : null)).filter((u): u is number => u !== null)
        if (until.length > 0) records = records.map(() => ({ strikes: [], blockUntil: Math.max(...until) }))
        await Promise.all(keys.map((key, i) => store.set(key, JSON.stringify(records[i]), keepSeconds(records[i]!, now, cfg))))
        const states = records.map((r) => stateOf(r, now, cfg))
        return { blocked: states.some((s) => s.blocked), blockedUntil: until.length > 0 ? Math.max(...until) : null, strikes: Math.max(0, ...states.map((s) => s.strikes)), recorded: true }
      })(),
      cfg.storeTimeoutMs
    )
  } catch {
    return { blocked: false, blockedUntil: null, strikes: 0, recorded: false }
  }
}

/** Test only: forget a visitor's strikes and block, and today's counts for the device and the business */
export async function clearGuard(store: GuardStore | null, visitor: Visitor, tenantId: string | null, now: number, cfg: GuardConfig = VOICE_GUARD): Promise<boolean> {
  if (!store) return false
  try {
    await within(store.remove([...subjectKeys(visitor), ...(visitor.deviceId ? [deviceCallsKey(visitor.deviceId, now)] : []), ...(tenantId ? [businessCallsKey(tenantId, now)] : [])]), cfg.storeTimeoutMs)
    return true
  } catch {
    return false
  }
}
