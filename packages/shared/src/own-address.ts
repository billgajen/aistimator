/**
 * T-199: a business's own address, yourname.<our domain>, for its quote page.
 * Pure rules, read by the web app (choosing, checking, showing) and by the
 * small Cloudflare Worker that serves the addresses (apps/worker/src/addresses.ts).
 *
 * - The address is its own field on the business (`tenants.own_address`). It
 *   is chosen once and is then fixed; only the admin area can change it.
 * - It never replaces the quote link: <our domain>/quote/<name> keeps working
 *   for every business on every plan (AD-042, AD-052).
 * - A subdomain serves the public quote pages and nothing else. Sign-in, the
 *   dashboard, the admin area and the rest of the site are answered with a
 *   redirect to the main address, and no cookie is ever set or passed on.
 */

import { DEMO_SLUG } from './demo'

export const ADDRESS_MIN_LENGTH = 3
export const ADDRESS_MAX_LENGTH = 30
/** After the admin area changes an address, the old one is held this long before anyone else can take it */
export const ADDRESS_HOLD_DAYS = 90

/**
 * Names nobody can take, as an address or as a new quote-link name. Words
 * that would collide with the app's routes or mislead a customer (T-149,
 * T-162), the names the owner listed for T-199, and every subdomain that
 * exists in the domain's DNS (`www` and `pm-bounces` on 22 Nov 2026, read
 * from public DNS). Sorted. The database keeps a copy (`reserved_slugs`,
 * migrations 32, 40 and 49); a unit test checks they match.
 * When a DNS record is added for a new subdomain, add its name here and in a
 * migration first.
 */
export const RESERVED_NAMES: readonly string[] = [
  'about', 'account', 'admin', 'aistimator', 'api', 'app', 'assets', 'auth',
  'billing', 'blog', 'business', 'cdn', 'contact', 'dashboard', 'demo', 'dev', 'docs', 'email', 'embed',
  'estimate', 'estimates', 'estimator', 'example', 'features', 'help', 'home', 'login',
  'logout', 'm', 'mail', 'new', 'null', 'official', 'painting', 'pm-bounces', 'pricing', 'privacy',
  'q', 'qolumns', 'qolums', 'quote', 'quotes', 'root', 'settings', 'setup', 'share', 'signup', 'staging', 'static',
  'status', 'support', 'terms', 'test', 'trades', 'undefined', 'widget', 'www',
]

/** The names T-199 added to the list (migration 49 adds exactly these to the database) */
export const RESERVED_NAMES_T199: readonly string[] = ['cdn', 'dev', 'email', 'm', 'pm-bounces', 'q', 'staging', 'status']

export type AddressProblem = 'too_short' | 'too_long' | 'invalid_characters' | 'reserved'

/** Why a name cannot be an address (its shape and the reserved names only; whether it is free is the database's answer) */
export function addressProblem(name: string): AddressProblem | null {
  if (RESERVED_NAMES.includes(name) || name === DEMO_SLUG) return 'reserved'
  if (name.length < ADDRESS_MIN_LENGTH) return 'too_short'
  if (name.length > ADDRESS_MAX_LENGTH) return 'too_long'
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return 'invalid_characters'
  return null
}

/** What the business typed, as a name: lower case, spaces and the domain itself dropped */
export function cleanAddress(typed: string, host?: string | null): string {
  let name = typed.trim().toLowerCase().replace(/^https?:\/\//, '')
  if (host && name.endsWith(`.${host.toLowerCase()}`)) name = name.slice(0, -host.length - 1)
  return name.replace(/\s+/g, '')
}

/** The name to offer first: the business's quote-link name when it fits the address rules, else as much of it as does */
export function suggestedAddress(slug: string | null | undefined): string {
  const name = (slug ?? '').toLowerCase().slice(0, ADDRESS_MAX_LENGTH).replace(/-+$/, '')
  return name
}

// ---------------------------------------------------------------------------
// Hosts and links
// ---------------------------------------------------------------------------

const bareHost = (host: string): string => host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
const withoutPort = (host: string): string => bareHost(host).replace(/:\d+$/, '')

/**
 * The host addresses live under, or null while the feature is off. ONE
 * setting says both (`NEXT_PUBLIC_OWN_ADDRESS_HOST` on the web, `ADDRESS_HOST`
 * on the Worker): the main domain in production, "localhost:8799" on a
 * developer's machine, nothing until the Worker and its DNS record serve.
 */
export function addressHostFrom(setting: string | null | undefined): string | null {
  const host = bareHost(setting ?? '')
  return /^[a-z0-9.-]+(?::\d+)?$/.test(host) ? host : null
}

/** "bluum.<our domain>" */
export function addressHostname(address: string, host: string): string {
  return `${address}.${bareHost(host)}`
}

/** "https://bluum.<our domain>". The scheme is the app's own (http on a developer's machine). */
export function addressUrl(address: string, host: string, appUrl: string): string {
  const scheme = /^http:\/\//i.test(appUrl.trim()) ? 'http' : 'https'
  return `${scheme}://${addressHostname(address, host)}`
}

/**
 * The address a request's Host header names: "bluum.<our domain>" → "bluum".
 * Null for the main host itself, for a host that is not under it, and for a
 * deeper name ("a.b.<our domain>": our certificate does not cover it).
 */
export function addressFromHost(requestHost: string | null | undefined, host: string): string | null {
  const asked = withoutPort(requestHost ?? '')
  const base = withoutPort(host)
  if (!asked || !base || !asked.endsWith(`.${base}`)) return null
  const name = asked.slice(0, -base.length - 1)
  return /^[a-z0-9-]+$/.test(name) ? name : null
}

/** Where the business's quote page is: the links to show, main first */
export interface BusinessLinks {
  /** The link to share, print and put in a QR code */
  main: string
  /** The quote link when the address is the main one ("Also works"); null otherwise */
  also: string | null
  /** The quote link itself, always */
  quoteLink: string
  /** "bluum.<our domain>" when the address is the main link */
  addressHostname: string | null
}

/**
 * The address is the main link only when all three hold: the feature is on
 * (`host`), the business has chosen one, and it can use it now (the one rule,
 * access.ts). Otherwise its quote link is, exactly as before.
 */
export function businessLinks(input: { appUrl: string; slug: string; ownAddress: string | null | undefined; canUseAddress: boolean; host: string | null }): BusinessLinks {
  const quoteLink = `${input.appUrl.replace(/\/+$/, '')}/quote/${input.slug}`
  if (input.host && input.ownAddress && input.canUseAddress) {
    return { main: addressUrl(input.ownAddress, input.host, input.appUrl), also: quoteLink, quoteLink, addressHostname: addressHostname(input.ownAddress, input.host) }
  }
  return { main: quoteLink, also: null, quoteLink, addressHostname: null }
}

// ---------------------------------------------------------------------------
// What a subdomain serves
// ---------------------------------------------------------------------------

/** Paths that belong to the public quote pages: the customer's estimate, its 3D room viewer, and what they load */
const SERVED_PREFIXES = ['/q/', '/room-model/', '/api/public/', '/_next/', '/brand/', '/photos/'] as const
const SERVED_FILES = ['/favicon.ico', '/icon.png', '/apple-icon.png'] as const

export type AddressRoute =
  /** the address itself: the business's quote page */
  | { kind: 'quote_page' }
  /** a path under the quote page: served as it is */
  | { kind: 'serve' }
  /** anything else (sign-in, dashboard, admin, the site): answered with a redirect to the main address */
  | { kind: 'main' }

export function addressRoute(pathname: string): AddressRoute {
  if (pathname === '/' || pathname === '') return { kind: 'quote_page' }
  if (SERVED_FILES.includes(pathname as (typeof SERVED_FILES)[number])) return { kind: 'serve' }
  // "/q/abc", never "/quote/abc" or "/qr"; and never a path that climbs out ("/q/../app")
  if (pathname.includes('..') || pathname.includes('//')) return { kind: 'main' }
  return SERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ? { kind: 'serve' } : { kind: 'main' }
}

/**
 * A link of ours, kept on the address the customer is on: when the page is
 * open at bluum.<our domain> and the link goes to a served path on the main
 * address, the same path on the address. Anything else is returned unchanged.
 */
export function onSameAddress(link: string, current: { host: string; origin: string }, appUrl: string, host: string | null): string {
  if (!host || !addressFromHost(current.host, host)) return link
  // the main address + "/q/abc?token=…" (a link without an address of its own already stays where it is)
  const parts = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(link.trim())
  if (!parts) return link
  const rest = parts[2] || '/'
  const sameSite = parts[1]!.toLowerCase() === appUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (!sameSite || addressRoute(rest.split(/[?#]/)[0]!).kind !== 'serve') return link
  return `${current.origin}${rest}`
}

// ---------------------------------------------------------------------------
// The caller's own address, passed on by the Worker
// ---------------------------------------------------------------------------

/**
 * Everyone who opens a business's address reaches the main site through the
 * Worker, so to the main site they would all look like one caller, and its
 * public limits (counted per caller) would stop real customers. The Worker
 * passes each caller's address on in `ip`, with `key`: a secret both sides
 * hold (ADDRESS_PROXY_KEY). The main site believes `ip` only with the right
 * key; anyone else sending these headers is ignored.
 */
export const ADDRESS_PROXY_HEADERS = { key: 'x-address-proxy-key', ip: 'x-address-client-ip' } as const

/** The caller's address as the Worker passed it on, or null when the request did not come through the Worker */
export function addressProxyCaller(headers: { get(name: string): string | null }, secret: string | null | undefined): string | null {
  const expected = (secret ?? '').trim()
  const given = headers.get(ADDRESS_PROXY_HEADERS.key) ?? ''
  if (!expected || given.length !== expected.length) return null
  // compared in full, whatever differs, so the time taken says nothing about the key
  let differs = 0
  for (let i = 0; i < expected.length; i++) differs |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  if (differs !== 0) return null
  const ip = (headers.get(ADDRESS_PROXY_HEADERS.ip) ?? '').trim()
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export type AddressCheckState = 'free' | 'taken' | 'invalid'

export const ADDRESS_COPY = {
  cardHeading: 'Choose your own address',
  cardText: 'Your quote page, at an address with your name in it. Your current quote link keeps working.',
  later: 'Later',
  choose: 'Choose this address',
  confirmText: "This is your address for good. You can't change it yourself later.",
  back: 'Back',
  alsoWorks: 'Also works',
  /** What the address can be made of, shown under the box */
  rules: `${ADDRESS_MIN_LENGTH} to ${ADDRESS_MAX_LENGTH} characters: lowercase letters, numbers and single hyphens.`,
  chosen: 'This is your address now.',
  notNow: 'Choosing an address is not part of your plan.',
  alreadyChosen: 'Your address has already been chosen. Ask us if it needs to change.',
  failed: 'That did not save. Try again.',
  use: (hostname: string) => `Use ${hostname}`,
  check: (hostname: string, state: AddressCheckState) => `${hostname} ${state === 'free' ? 'is free' : state === 'taken' ? 'is taken' : "can't be used"}`,
  /** Starter's quiet line on the Quote link page */
  onPlan: (hostname: string, planName: string) => `Get your own address, like ${hostname}, on ${planName}.`,
  /** The plan line on Pricing and Features */
  planLine: (host: string) => `Your own address: yourname.${host}`,
} as const
