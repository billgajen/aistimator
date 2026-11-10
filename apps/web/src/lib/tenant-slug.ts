/**
 * T-149: rules for the readable quote address /quote/{slug} — pure, no IO.
 *
 * Slugs are generated in the database (migration 32, generate_tenant_slug)
 * so every way a tenant is created gets one. This module is the canonical
 * list of reserved words (the migration carries a copy; a unit test checks
 * they match) and validates a slug the business types when changing it.
 */

export const SLUG_MIN_LENGTH = 3
export const SLUG_MAX_LENGTH = 40

/** Words that would collide with app routes or mislead a customer. Sorted. */
export const RESERVED_SLUGS: readonly string[] = [
  'about', 'account', 'admin', 'aistimator', 'api', 'app', 'assets', 'auth',
  'billing', 'blog', 'business', 'contact', 'dashboard', 'demo', 'docs', 'embed',
  'estimate', 'estimates', 'estimator', 'example', 'features', 'help', 'home', 'login',
  'logout', 'mail', 'new', 'null', 'official', 'painting', 'pricing', 'privacy',
  'quote', 'quotes', 'root', 'settings', 'setup', 'share', 'signup', 'static',
  'support', 'terms', 'test', 'trades', 'undefined', 'widget', 'www',
]

const ACCENTS: Record<string, string> = {
  a: 'àáâãäåā', c: 'çćč', e: 'èéêëēėę', i: 'ìíîïīį', n: 'ñń', o: 'òóôõöøō',
  u: 'ùúûüū', y: 'ýÿ', z: 'žźż', s: 'šś', l: 'ł',
}
const FOLD: Record<string, string> = Object.fromEntries(
  Object.entries(ACCENTS).flatMap(([plain, accented]) => [...accented].map((ch) => [ch, plain]))
)

/**
 * Business name or typed text → slug shape. Mirrors the SQL
 * slugify_business_name(): lowercase, accents folded, "&" → "and", anything
 * else → "-", trimmed to 40 characters.
 */
export function slugify(input: string): string {
  const folded = [...input.toLowerCase().replace(/&/g, ' and ').replace(/ß/g, 'ss').replace(/æ/g, 'ae')]
    .map((ch) => FOLD[ch] ?? ch)
    .join('')
  return folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
}

export type SlugProblem = 'too_short' | 'too_long' | 'invalid_characters' | 'reserved'

/** Why a slug can't be used (format and reserved words only; availability is a DB check). */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN_LENGTH) return 'too_short'
  if (slug.length > SLUG_MAX_LENGTH) return 'too_long'
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.includes('--')) return 'invalid_characters'
  if (RESERVED_SLUGS.includes(slug)) return 'reserved'
  return null
}

/** Plain words for the Share page. */
export function slugProblemMessage(problem: SlugProblem | 'taken' | 'already_changed'): string {
  switch (problem) {
    case 'too_short':
      return `Use at least ${SLUG_MIN_LENGTH} letters or numbers.`
    case 'too_long':
      return `Use ${SLUG_MAX_LENGTH} characters or fewer.`
    case 'invalid_characters':
      return 'Use lowercase letters, numbers and single dashes.'
    case 'reserved':
      return 'That word is reserved. Try adding your town or trade.'
    case 'taken':
      return 'Another business already uses that link.'
    case 'already_changed':
      return 'Your link has already been changed once.'
  }
}
