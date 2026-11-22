/**
 * T-199: a business's own address (yourname.<our domain>), the server side.
 * The rules and the words are in packages/shared/src/own-address.ts; whether
 * a business can use an address is the one rule (lib/access.ts).
 *
 * - `tenants.own_address` is written only here, with the service role (the
 *   database refuses anyone else), and only for the signed-in business or by
 *   a platform admin. Every query is scoped to one tenant id.
 * - One name, one business, across the address and the quote-link name: the
 *   database's `own_address_taken` answers, and a trigger holds it even when
 *   two requests arrive together (migration 49).
 * - The feature is off until `NEXT_PUBLIC_OWN_ADDRESS_HOST` is set (after the
 *   Worker and its DNS record serve): nothing is offered and no address is
 *   shown as a link, so no business is ever given a link that does not open.
 */
import {
  ADDRESS_COPY,
  ADDRESS_HOLD_DAYS,
  addressHostFrom,
  addressHostname,
  addressProblem,
  businessLinks,
  canUse,
  cleanAddress,
  planNameFor,
  suggestedAddress,
  type AddressCheckState,
  type BusinessAccess,
  type BusinessLinks,
} from '@qolumns/shared'
import { loadAccess } from '@/lib/access'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

/** The host addresses live under, or null while the feature is off */
export function ownAddressHost(env: Record<string, string | undefined> = process.env): string | null {
  return addressHostFrom(env.NEXT_PUBLIC_OWN_ADDRESS_HOST)
}

export function appUrlFrom(env: Record<string, string | undefined> = process.env): string {
  return env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

/** Is the name another business's (address or quote-link name), reserved or held? Null when that could not be read. */
export async function addressTaken(admin: Admin, name: string, tenantId: string): Promise<boolean | null> {
  try {
    const { data, error } = await admin.rpc('own_address_taken', { candidate: name, for_tenant: tenantId })
    return error || typeof data !== 'boolean' ? null : data
  } catch {
    return null
  }
}

export interface AddressCheck {
  name: string
  /** "bluum.<our domain>" */
  hostname: string
  state: AddressCheckState
  /** "bluum.<our domain> is free" */
  message: string
}

/** The live check as a business types. A check that cannot be made answers "taken": never "free" on a failed read. */
export async function checkAddress(admin: Admin, typed: string, tenantId: string, host: string): Promise<AddressCheck> {
  const name = cleanAddress(typed, host)
  const hostname = addressHostname(name, host)
  const answer = (state: AddressCheckState): AddressCheck => ({ name, hostname, state, message: ADDRESS_COPY.check(hostname, state) })
  if (addressProblem(name)) return answer('invalid')
  return answer((await addressTaken(admin, name, tenantId)) === false ? 'free' : 'taken')
}

interface AddressRow {
  id: string
  slug: string
  own_address: string | null
  own_address_later_at: string | null
}

async function addressRow(admin: Admin, tenantId: string): Promise<AddressRow | null> {
  const { data } = await admin.from('tenants').select('id, slug, own_address, own_address_later_at').eq('id', tenantId).maybeSingle()
  return (data as AddressRow | null) ?? null
}

/** What the dashboard is told about this business's address */
export interface AddressView {
  /** The feature is on (the Worker serves) */
  live: boolean
  /** the main domain: what comes after the name */
  host: string | null
  address: string | null
  /** Show the "Choose your own address" card: it can use one and has none */
  canChoose: boolean
  /** "Later" was pressed (Home hides the card; the Quote link page keeps it) */
  later: boolean
  /** The name the box starts with */
  suggested: string
  /** The links to show, main first */
  links: BusinessLinks
  /** A plan without it: "Get your own address, like bluum.<our domain>, on Pro." Null otherwise. */
  planLine: string | null
  /** On the free start: the plan that keeps it ("Pro"), for the small tag */
  tag: string | null
}

export function addressViewOf(row: { slug: string; own_address: string | null; own_address_later_at: string | null }, access: BusinessAccess, host: string | null, appUrl: string): AddressView {
  const can = canUse(access, 'own_address')
  const links = businessLinks({ appUrl, slug: row.slug, ownAddress: row.own_address, canUseAddress: can, host })
  const live = host !== null
  const planName = planNameFor('own_address')
  return {
    live,
    host,
    address: row.own_address,
    canChoose: live && can && !row.own_address,
    later: Boolean(row.own_address_later_at),
    suggested: suggestedAddress(row.slug),
    links,
    // only a business on a plan that lacks it is told which plan has it (never one with no plan at all)
    planLine: live && !can && access.basis === 'plan' && planName && host ? ADDRESS_COPY.onPlan(addressHostname(suggestedAddress(row.slug), host), planName) : null,
    tag: access.basis === 'free_start' && can && live ? planName || null : null,
  }
}

/** `access`: pass what the page has already read, so the rule is read once */
export async function addressView(admin: Admin, tenantId: string, access?: BusinessAccess): Promise<AddressView | null> {
  const [row, can] = await Promise.all([addressRow(admin, tenantId), access ? Promise.resolve(access) : loadAccess(admin, tenantId)])
  return row ? addressViewOf(row, can, ownAddressHost(), appUrlFrom()) : null
}

/** Home's one read: what the business can use (the one rule), and its address */
export async function addressAndAccess(admin: Admin, tenantId: string): Promise<{ access: BusinessAccess; address: AddressView | null }> {
  const access = await loadAccess(admin, tenantId)
  return { access, address: await addressView(admin, tenantId, access) }
}

/** A business's links, main first: for the pages and the app (which never choose, only show) */
export async function linksFor(admin: Admin, tenantId: string, slug: string, ownAddress: string | null): Promise<BusinessLinks> {
  const host = ownAddressHost()
  const canUseAddress = Boolean(host && ownAddress) && canUse(await loadAccess(admin, tenantId), 'own_address')
  return businessLinks({ appUrl: appUrlFrom(), slug, ownAddress, canUseAddress, host })
}

export type AddressResult = { ok: true; address: string | null } | { ok: false; status: number; code: string; message: string }

const refuse = (status: number, code: string, message: string): AddressResult => ({ ok: false, status, code, message })

/** The business's one choice. Fixed once made. */
export async function chooseAddress(admin: Admin, tenantId: string, userId: string | null, typed: string): Promise<AddressResult> {
  const host = ownAddressHost()
  if (!host) return refuse(409, 'NOT_AVAILABLE', ADDRESS_COPY.notNow)
  const [row, access] = await Promise.all([addressRow(admin, tenantId), loadAccess(admin, tenantId)])
  if (!row) return refuse(404, 'NOT_FOUND', 'Business not found')
  if (!canUse(access, 'own_address')) return refuse(403, 'PLAN_REQUIRED', ADDRESS_COPY.notNow)
  if (row.own_address) return refuse(409, 'ALREADY_CHOSEN', ADDRESS_COPY.alreadyChosen)

  const check = await checkAddress(admin, typed, tenantId, host)
  if (check.state === 'invalid') return refuse(400, 'INVALID_ADDRESS', check.message)
  if (check.state === 'taken') return refuse(409, 'ADDRESS_TAKEN', check.message)

  const { data, error } = await admin
    .from('tenants')
    .update({ own_address: check.name, own_address_chosen_at: new Date().toISOString() })
    .eq('id', tenantId)
    .is('own_address', null) // a second choice in a race finds nothing to update
    .select('own_address')
  if (error) {
    // 23505: another business took the name between the check and the write
    if (error.code === '23505') return refuse(409, 'ADDRESS_TAKEN', ADDRESS_COPY.check(check.hostname, 'taken'))
    console.error('[Address] the choice was not saved:', error.code ?? 'error')
    return refuse(500, 'DB_ERROR', ADDRESS_COPY.failed)
  }
  if (!data || data.length === 0) return refuse(409, 'ALREADY_CHOSEN', ADDRESS_COPY.alreadyChosen)

  const { error: logError } = await admin.from('own_address_changes').insert({ tenant_id: tenantId, old_address: null, new_address: check.name, changed_from: 'business', changed_by: userId })
  if (logError) console.error('[Address] the choice was saved but not logged:', logError.code ?? 'error')
  return { ok: true, address: check.name }
}

/** "Later" on Home's card */
export async function addressLater(admin: Admin, tenantId: string): Promise<void> {
  const { error } = await admin.from('tenants').update({ own_address_later_at: new Date().toISOString() }).eq('id', tenantId).is('own_address', null)
  if (error) console.error('[Address] "Later" was not saved:', error.code ?? 'error')
}

/** A plan that includes the address has just started: the card comes back on Home */
export async function offerAddressAgain(admin: Admin, tenantId: string): Promise<void> {
  try {
    await admin.from('tenants').update({ own_address_later_at: null }).eq('id', tenantId).is('own_address', null)
  } catch {
    // the card stays on the Quote link page whatever happens here
  }
}

/**
 * The admin area's change (the owner's action): a new name, or none. The old
 * name is held for 90 days before another business can take it, and the hold
 * is written BEFORE the change so the name is never free even for a moment.
 * The business's plan is not asked: the owner decides.
 */
export async function adminChangeAddress(admin: Admin, tenantId: string, adminUserId: string, typed: string | null, note: string, now: Date = new Date()): Promise<AddressResult & { held?: { address: string; until: string } | null }> {
  const row = await addressRow(admin, tenantId)
  if (!row) return refuse(404, 'NOT_FOUND', 'Business not found')
  const name = typed === null ? null : cleanAddress(typed, ownAddressHost())
  if (name === row.own_address) return { ok: true, address: name, held: null }
  if (name !== null) {
    if (addressProblem(name)) return refuse(400, 'INVALID_ADDRESS', "That name can't be used as an address")
    const taken = await addressTaken(admin, name, tenantId)
    if (taken !== false) return refuse(409, 'ADDRESS_TAKEN', 'That name is taken, reserved or held')
  }

  const until = row.own_address ? new Date(now.getTime() + ADDRESS_HOLD_DAYS * 86_400_000).toISOString() : null
  const { data: logged, error: logError } = await admin
    .from('own_address_changes')
    .insert({ tenant_id: tenantId, old_address: row.own_address, new_address: name, changed_from: 'admin', changed_by: adminUserId, note: note || null, held_until: until })
    .select('id')
    .single()
  if (logError || !logged) {
    console.error('[Address] the admin change was not logged, so it was not made:', logError?.code ?? 'error')
    return refuse(500, 'DB_ERROR', 'Could not change the address')
  }
  const { error } = await admin.from('tenants').update({ own_address: name, own_address_chosen_at: name ? now.toISOString() : null }).eq('id', tenantId)
  if (error) {
    await admin.from('own_address_changes').delete().eq('id', (logged as { id: string }).id)
    if (error.code === '23505') return refuse(409, 'ADDRESS_TAKEN', 'That name is taken, reserved or held')
    console.error('[Address] the admin change failed:', error.code ?? 'error')
    return refuse(500, 'DB_ERROR', 'Could not change the address')
  }
  return { ok: true, address: name, held: row.own_address && until ? { address: row.own_address, until } : null }
}

/**
 * For the Worker that serves the addresses: whose address is this, and is it
 * served now? `serve` false means "answer with a redirect to the quote link":
 * the business cannot use its address at the moment (the one rule), and the
 * address stays its own. Null: nobody's address.
 */
export async function lookupAddress(admin: Admin, name: string): Promise<{ slug: string; serve: boolean } | null> {
  if (addressProblem(name)) return null
  const { data, error } = await admin.from('tenants').select('id, slug').eq('own_address', name).maybeSingle()
  const row = data as { id: string; slug: string } | null
  if (error || !row) return null
  return { slug: row.slug, serve: canUse(await loadAccess(admin, row.id), 'own_address') }
}
